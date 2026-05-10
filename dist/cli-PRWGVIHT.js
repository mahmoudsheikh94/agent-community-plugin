#!/usr/bin/env node
import {
  htmlToText
} from "./chunk-EB42U7WB.js";

// src/ingest/cli.ts
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync
} from "fs";
import { join, resolve } from "path";

// src/ingest/crawler/rate-limiter.ts
var RateLimiter = class {
  constructor(maxRequests = 20, windowMs = 1e4) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }
  maxRequests;
  windowMs;
  timestamps = [];
  async acquire() {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
    if (this.timestamps.length >= this.maxRequests) {
      const oldest = this.timestamps[0];
      const waitMs = this.windowMs - (now - oldest) + 10;
      await new Promise((resolve2) => setTimeout(resolve2, waitMs));
      return this.acquire();
    }
    this.timestamps.push(Date.now());
  }
};

// src/ingest/crawler/discourse.ts
var QUESTIONS_CATEGORY_ID = 12;
var DiscourseCrawler = class {
  constructor(baseUrl = "https://community.n8n.io", rateLimiter = new RateLimiter()) {
    this.baseUrl = baseUrl;
    this.rateLimiter = rateLimiter;
  }
  baseUrl;
  rateLimiter;
  async fetchTopicPage(page) {
    await this.rateLimiter.acquire();
    const url = `${this.baseUrl}/c/questions/${QUESTIONS_CATEGORY_ID}/l/latest.json?page=${page}`;
    const response = await this.fetchWithRetry(url);
    const data = await response.json();
    const topics = data.topic_list?.topics ?? [];
    const hasMore = !!data.topic_list?.more_topics_url;
    return { topics, hasMore };
  }
  async fetchTopicDetail(topicId) {
    await this.rateLimiter.acquire();
    const url = `${this.baseUrl}/t/${topicId}.json`;
    const response = await this.fetchWithRetry(url);
    if (!response) return null;
    return await response.json();
  }
  async fetchMissingPosts(topicId, postIds) {
    if (postIds.length === 0) return [];
    await this.rateLimiter.acquire();
    const params = postIds.map((id) => `post_ids[]=${id}`).join("&");
    const url = `${this.baseUrl}/t/${topicId}/posts.json?${params}`;
    const response = await this.fetchWithRetry(url);
    if (!response) return [];
    const data = await response.json();
    return data.post_stream?.posts ?? [];
  }
  async *crawlSolvedTopics(state, options = {}) {
    let page = state.last_page;
    let yielded = 0;
    const maxTopics = options.maxTopics ?? Infinity;
    while (yielded < maxTopics) {
      const { topics, hasMore } = await this.fetchTopicPage(page);
      if (topics.length === 0) break;
      state.total_topics_seen += topics.length;
      const solved = topics.filter((t) => t.has_accepted_answer);
      if (options.verbose) {
        options.onPage?.(page, solved.length);
      }
      for (const summary of solved) {
        if (yielded >= maxTopics) break;
        try {
          const thread = await this.extractThread(summary);
          if (thread) {
            state.total_solved_saved++;
            state.last_topic_id = summary.id;
            yielded++;
            yield thread;
          }
        } catch (err) {
          if (options.verbose) {
            console.error(
              `[crawler] Failed to extract topic ${summary.id}: ${err}`
            );
          }
        }
      }
      state.last_page = page + 1;
      state.last_crawled_at = (/* @__PURE__ */ new Date()).toISOString();
      if (!hasMore) break;
      page++;
    }
  }
  async extractThread(summary) {
    const topic = await this.fetchTopicDetail(summary.id);
    if (!topic) return null;
    let posts = topic.post_stream.posts;
    let answerPost = posts.find((p) => p.accepted_answer);
    if (!answerPost && topic.post_stream.stream.length > posts.length) {
      const loadedIds = new Set(posts.map((p) => p.id));
      const missingIds = topic.post_stream.stream.filter(
        (id) => !loadedIds.has(id)
      );
      for (let i = 0; i < missingIds.length && !answerPost; i += 20) {
        const chunk = missingIds.slice(i, i + 20);
        const extraPosts = await this.fetchMissingPosts(summary.id, chunk);
        posts = [...posts, ...extraPosts];
        answerPost = extraPosts.find((p) => p.accepted_answer);
      }
    }
    if (!answerPost) return null;
    const opPost = posts.find((p) => p.post_number === 1);
    if (!opPost) return null;
    const replyChain = [];
    let current = answerPost;
    const visited = /* @__PURE__ */ new Set();
    while (current.reply_to_post_number && current.reply_to_post_number > 1 && !visited.has(current.reply_to_post_number)) {
      visited.add(current.reply_to_post_number);
      const parent = posts.find(
        (p) => p.post_number === current.reply_to_post_number
      );
      if (!parent) break;
      replyChain.unshift(htmlToText(parent.cooked));
      current = parent;
    }
    return {
      topic_id: summary.id,
      title: topic.title,
      slug: topic.slug,
      tags: topic.tags ?? [],
      url: `${this.baseUrl}/t/${topic.slug}/${summary.id}`,
      crawled_at: (/* @__PURE__ */ new Date()).toISOString(),
      question_text: htmlToText(opPost.cooked),
      answer_text: htmlToText(answerPost.cooked),
      answer_username: answerPost.username,
      answer_likes: answerPost.like_count,
      reply_chain: replyChain,
      topic_views: summary.views,
      topic_reply_count: summary.reply_count
    };
  }
  async fetchWithRetry(url, retries = 3) {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await fetch(url, {
          headers: { Accept: "application/json" }
        });
        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get("Retry-After") ?? "60", 10) * 1e3;
          await new Promise((r) => setTimeout(r, retryAfter));
          continue;
        }
        if (response.status === 404) {
          throw new Error(`404 Not Found: ${url}`);
        }
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${url}`);
        }
        return response;
      } catch (err) {
        if (attempt < retries - 1 && !(err instanceof Error && err.message.startsWith("404"))) {
          const delay = Math.pow(2, attempt) * 1e3;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }
    throw new Error(`Failed after ${retries} retries: ${url}`);
  }
};

// src/ingest/cli.ts
function loadEnvFile() {
  const envPath = resolve(".env.local");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    const value = trimmed.slice(eqIdx + 1);
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}
loadEnvFile();
function getIngestDir() {
  return resolve("data", "ingest");
}
function loadCrawlState() {
  const statePath = join(getIngestDir(), "state.json");
  if (existsSync(statePath)) {
    return JSON.parse(readFileSync(statePath, "utf-8"));
  }
  return {
    last_page: 1,
    last_topic_id: 0,
    last_crawled_at: "1970-01-01T00:00:00Z",
    total_topics_seen: 0,
    total_solved_saved: 0
  };
}
function saveCrawlState(state) {
  const dir = getIngestDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify(state, null, 2) + "\n");
}
function saveRawThread(thread) {
  const rawDir = join(getIngestDir(), "raw");
  mkdirSync(rawDir, { recursive: true });
  writeFileSync(
    join(rawDir, `${thread.topic_id}.json`),
    JSON.stringify(thread, null, 2) + "\n"
  );
}
function loadProcessedIds() {
  const path = join(getIngestDir(), "processed.jsonl");
  if (!existsSync(path)) return /* @__PURE__ */ new Set();
  const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
  return new Set(lines.map((l) => parseInt(l, 10)));
}
function loadRawThreads() {
  const rawDir = join(getIngestDir(), "raw");
  if (!existsSync(rawDir)) return [];
  const processedIds = loadProcessedIds();
  const threads = [];
  for (const file of readdirSync(rawDir)) {
    if (!file.endsWith(".json")) continue;
    const topicId = parseInt(file.replace(".json", ""), 10);
    if (processedIds.has(topicId)) continue;
    threads.push(
      JSON.parse(readFileSync(join(rawDir, file), "utf-8"))
    );
  }
  return threads;
}
function getFlag(args, flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : void 0;
}
async function handleCrawl(args) {
  const maxTopics = parseInt(getFlag(args, "--max-topics") ?? "0") || void 0;
  const verbose = args.includes("--verbose");
  const state = loadCrawlState();
  const crawler = new DiscourseCrawler(
    "https://community.n8n.io",
    new RateLimiter(20, 1e4)
  );
  console.log(`Starting crawl from page ${state.last_page}...`);
  if (maxTopics) console.log(`Max topics: ${maxTopics}`);
  let count = 0;
  for await (const thread of crawler.crawlSolvedTopics(state, {
    maxTopics,
    verbose,
    onPage: (page, solved) => {
      if (verbose) console.log(`  Page ${page}: ${solved} solved topics`);
    }
  })) {
    saveRawThread(thread);
    count++;
    if (verbose) {
      console.log(
        `  [${count}] ${thread.topic_id}: ${thread.title.slice(0, 60)}`
      );
    }
  }
  saveCrawlState(state);
  console.log(`
Crawl complete:`);
  console.log(`  Threads saved: ${count}`);
  console.log(`  Total topics seen: ${state.total_topics_seen}`);
  console.log(`  Total solved saved: ${state.total_solved_saved}`);
  console.log(`  Last page: ${state.last_page}`);
}
async function handleTransform(args) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("OPENAI_API_KEY is required for transform (set in .env.local or environment)");
    process.exit(1);
  }
  const dryRun = args.includes("--dry-run");
  const minQuality = parseInt(getFlag(args, "--min-quality") ?? "0") || 0;
  const concurrency = parseInt(getFlag(args, "--concurrency") ?? "3") || 3;
  const verbose = args.includes("--verbose");
  const threads = loadRawThreads();
  if (threads.length === 0) {
    console.log(
      "No unprocessed raw threads found. Run 'ingest crawl' first."
    );
    return;
  }
  console.log(`Found ${threads.length} unprocessed threads.`);
  const estimatedCost = (threads.length * 1e-3).toFixed(3);
  console.log(`Estimated LLM cost: ~$${estimatedCost} (gpt-4o-mini)`);
  if (dryRun) {
    console.log("Dry run \u2014 no cards will be saved.");
  }
  const { ThreadTransformer } = await import("./thread-to-cards-BGD4MRB6.js");
  const { Deduplicator } = await import("./dedup-TOEDAT2E.js");
  const { validateCard, generateCardId } = await import("./validation-OBICJGLK.js");
  const { saveCard, rebuildToolIndex } = await import("./store-LW7NALVY.js");
  const { appendFileSync } = await import("fs");
  const transformer = new ThreadTransformer(apiKey, { concurrency });
  const deduplicator = new Deduplicator();
  let generated = 0;
  let saved = 0;
  let skipped = 0;
  let deduped = 0;
  let failed = 0;
  const processedPath = join(getIngestDir(), "processed.jsonl");
  const batchCardIds = /* @__PURE__ */ new Set();
  for await (const result of transformer.transformBatch(
    threads,
    (completed, total) => {
      if (verbose) {
        process.stderr.write(
          `\r  Progress: ${completed}/${total} threads`
        );
      }
    }
  )) {
    if (result.skipped) {
      skipped++;
      appendFileSync(processedPath, `${result.source_topic_id}
`);
      continue;
    }
    for (const card of result.cards) {
      generated++;
      const dedupResult = deduplicator.checkDuplicate(card);
      if (dedupResult.action !== "new") {
        deduped++;
        if (verbose) {
          console.log(
            `
  Dedup: ${dedupResult.reason}`
          );
        }
        continue;
      }
      const cardId = generateCardId(
        card.tool ?? "n8n",
        card.error_signature ?? "",
        card.context_key ?? ""
      );
      if (batchCardIds.has(cardId)) {
        deduped++;
        continue;
      }
      const validation = validateCard(card);
      if (!validation.valid) {
        failed++;
        if (verbose) {
          console.log(
            `
  Validation failed: ${validation.errors.join("; ")}`
          );
        }
        continue;
      }
      if (validation.quality_score < minQuality) {
        if (verbose) {
          console.log(
            `
  Below quality threshold: ${validation.quality_score} < ${minQuality}`
          );
        }
        continue;
      }
      const fullCard = {
        id: cardId,
        tool: "n8n",
        error_signature: card.error_signature ?? "",
        context_key: card.context_key ?? "",
        title: card.title ?? "",
        symptom: card.symptom ?? "",
        applies_when: card.applies_when ?? [],
        not_this_if: card.not_this_if ?? [],
        root_cause: card.root_cause ?? "",
        fix_steps: card.fix_steps ?? [],
        agent_instruction: card.agent_instruction ?? "",
        safety_notes: card.safety_notes ?? [],
        fix_type: card.fix_type ?? "workaround",
        tags: card.tags ?? [],
        severity: card.severity ?? "blocks_execution",
        confidence: result.llm_confidence,
        quality_score: validation.quality_score,
        source_type: "community",
        verified_on: card.verified_on ?? "",
        created: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
        version_notes: [result.source_url]
      };
      if (!dryRun) {
        saveCard(fullCard);
        batchCardIds.add(cardId);
      }
      saved++;
      if (verbose) {
        console.log(
          `
  Saved: ${fullCard.title} (quality: ${validation.quality_score})`
        );
      }
    }
    appendFileSync(processedPath, `${result.source_topic_id}
`);
  }
  if (!dryRun && saved > 0) {
    rebuildToolIndex("n8n");
  }
  console.log(`

Transform complete:`);
  console.log(`  Threads processed: ${threads.length}`);
  console.log(`  Threads skipped (not actionable): ${skipped}`);
  console.log(`  Cards generated: ${generated}`);
  console.log(`  Cards deduplicated: ${deduped}`);
  console.log(`  Cards failed validation: ${failed}`);
  console.log(`  Cards saved: ${saved}`);
  if (dryRun) console.log(`  (dry run \u2014 nothing actually saved)`);
}
async function handleStatus() {
  const state = loadCrawlState();
  const rawDir = join(getIngestDir(), "raw");
  const rawCount = existsSync(rawDir) ? readdirSync(rawDir).filter((f) => f.endsWith(".json")).length : 0;
  const processedCount = loadProcessedIds().size;
  console.log(`Crawl state:`);
  console.log(`  Last page: ${state.last_page}`);
  console.log(`  Last topic ID: ${state.last_topic_id}`);
  console.log(`  Last crawled: ${state.last_crawled_at}`);
  console.log(`  Total topics seen: ${state.total_topics_seen}`);
  console.log(`  Total solved saved: ${state.total_solved_saved}`);
  console.log(`  Raw threads on disk: ${rawCount}`);
  console.log(`  Already processed: ${processedCount}`);
  console.log(`  Pending transform: ${rawCount - processedCount}`);
}
async function handleStats(args) {
  const runsDir = join(getIngestDir(), "runs");
  if (!existsSync(runsDir)) {
    console.log("No pipeline runs yet.");
    return;
  }
  const last = parseInt(getFlag(args, "--last") ?? "5") || 5;
  const files = readdirSync(runsDir).filter((f) => f.endsWith(".json")).sort().slice(-last);
  if (files.length === 0) {
    console.log("No pipeline runs yet.");
    return;
  }
  for (const file of files) {
    const stats = JSON.parse(readFileSync(join(runsDir, file), "utf-8"));
    console.log(`
--- Run: ${stats.run_id} ---`);
    console.log(`  Started: ${stats.started_at}`);
    console.log(`  Topics crawled: ${stats.topics_crawled}`);
    console.log(`  Cards saved: ${stats.cards_saved}`);
    console.log(`  Cost: $${stats.estimated_cost_usd}`);
    if (stats.errors?.length > 0) {
      console.log(`  Errors: ${stats.errors.length}`);
    }
  }
}
async function handleImport(args) {
  const topicId = parseInt(getFlag(args, "--topic") ?? "0");
  if (!topicId) {
    console.error("Usage: agent-community ingest import --topic <ID>");
    process.exit(1);
  }
  const crawler = new DiscourseCrawler(
    "https://community.n8n.io",
    new RateLimiter(20, 1e4)
  );
  console.log(`Fetching topic ${topicId}...`);
  const topic = await crawler.fetchTopicDetail(topicId);
  if (!topic) {
    console.error("Topic not found.");
    process.exit(1);
  }
  console.log(`Title: ${topic.title}`);
  console.log(`Posts: ${topic.posts_count}`);
  const { htmlToText: htmlToText2 } = await import("./html-to-text-J46TMICC.js");
  const posts = topic.post_stream.posts;
  const answerPost = posts.find((p) => p.accepted_answer);
  const opPost = posts.find((p) => p.post_number === 1);
  if (!answerPost || !opPost) {
    console.error("No accepted answer found in this topic.");
    process.exit(1);
  }
  const thread = {
    topic_id: topic.id,
    title: topic.title,
    slug: topic.slug,
    tags: topic.tags ?? [],
    url: `https://community.n8n.io/t/${topic.slug}/${topic.id}`,
    crawled_at: (/* @__PURE__ */ new Date()).toISOString(),
    question_text: htmlToText2(opPost.cooked),
    answer_text: htmlToText2(answerPost.cooked),
    answer_username: answerPost.username,
    answer_likes: answerPost.like_count,
    reply_chain: [],
    topic_views: topic.views,
    topic_reply_count: topic.reply_count
  };
  saveRawThread(thread);
  console.log(`Saved raw thread to data/ingest/raw/${topicId}.json`);
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) {
    console.log(`
Transforming with LLM...`);
    const { ThreadTransformer } = await import("./thread-to-cards-BGD4MRB6.js");
    const transformer = new ThreadTransformer(apiKey, { concurrency: 1 });
    const results = await transformer.transform(thread);
    if (results.skipped) {
      console.log(`Thread skipped: ${results.skip_reason}`);
    } else {
      console.log(`Generated ${results.cards.length} card(s):`);
      for (const card of results.cards) {
        console.log(`  - ${card.title}`);
        console.log(`    error_signature: ${card.error_signature}`);
        console.log(`    fix_steps: ${card.fix_steps?.length ?? 0} steps`);
      }
    }
  } else {
    console.log(
      "\nSet OPENAI_API_KEY to also transform the thread into fix cards."
    );
  }
}
async function handlePush() {
  const { readdirSync: readdirSync2, readFileSync: readFileSync2 } = await import("fs");
  const { upsertCards } = await import("./supabase-DHQDATNT.js");
  const cardsDir = join(resolve("data"), "tools", "n8n", "cards");
  if (!existsSync(cardsDir)) {
    console.error("No cards found. Run 'ingest transform' first.");
    process.exit(1);
  }
  const cards = readdirSync2(cardsDir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync2(join(cardsDir, f), "utf-8")));
  console.log(`Pushing ${cards.length} cards to Supabase...`);
  const { inserted, errors } = await upsertCards(cards);
  console.log(`
Done: ${inserted} cards upserted.`);
  if (errors.length > 0) {
    console.error(`Errors (${errors.length}):`);
    for (const e of errors) {
      console.error(`  ${e}`);
    }
  }
}
async function handleIngestCommand(subcommand, args) {
  switch (subcommand) {
    case "crawl":
      return handleCrawl(args);
    case "transform":
      return handleTransform(args);
    case "run":
      return handleCrawl(args).then(() => handleTransform(args));
    case "import":
      return handleImport(args);
    case "stats":
      return handleStats(args);
    case "status":
      return handleStatus();
    case "push":
      return handlePush();
    default:
      console.log(`Usage: agent-community ingest <command>

Commands:
  crawl      [--max-topics N] [--verbose]              Crawl solved topics from n8n forum
  transform  [--dry-run] [--min-quality N] [--concurrency N] [--verbose]  Transform raw threads into fix cards
  run        [--max-topics N] [--dry-run] [--min-quality N]  Full pipeline: crawl + transform
  import     --topic <ID>                              Import a single topic by ID
  push                                                 Push all local cards to Supabase
  stats      [--last N]                                Show pipeline run history
  status                                               Show current crawl state`);
  }
}
export {
  handleIngestCommand
};
