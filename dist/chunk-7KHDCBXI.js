#!/usr/bin/env node
import {
  fetchUpdatedCards,
  insertTrace,
  isSupabaseEnabled
} from "./chunk-SDA3ARN5.js";

// src/store/index.ts
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, statSync, renameSync } from "fs";
import { join, resolve } from "path";
import { randomUUID } from "crypto";

// src/redaction/index.ts
var PATTERNS = [
  {
    name: "aws_key",
    pattern: /AKIA[0-9A-Z]{16}/g,
    replacement: "[REDACTED:aws_key]"
  },
  {
    name: "slack_token",
    pattern: /xox[bpors]-[0-9a-zA-Z-]{10,}/g,
    replacement: "[REDACTED:slack_token]"
  },
  {
    name: "openai_key",
    pattern: /sk-[a-zA-Z0-9_\-]{12,}/g,
    replacement: "[REDACTED:api_key]"
  },
  {
    name: "jwt",
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    replacement: "[REDACTED:jwt]"
  },
  {
    name: "bearer_token",
    pattern: /Bearer\s+[a-zA-Z0-9_\-.]{20,}/g,
    replacement: "[REDACTED:bearer_token]"
  },
  {
    name: "database_url",
    pattern: /(?:postgres|postgresql|mysql|mongodb|redis):\/\/[^\s"'`,)}\]]+/g,
    replacement: "[REDACTED:database_url]"
  },
  {
    name: "webhook_url",
    pattern: /https?:\/\/[^\s"']*(?:\/hooks\/|\/webhook\/|\/webhooks\/|hooks\.slack\.com\/services\/)[^\s"']*/g,
    replacement: "[REDACTED:webhook_url]"
  },
  {
    name: "generic_webhook",
    pattern: /https?:\/\/(?:discord(?:app)?\.com\/api\/webhooks|hooks\.slack\.com\/services)\/[^\s"']*/g,
    replacement: "[REDACTED:webhook_url]"
  },
  {
    name: "env_secret",
    pattern: /(?:SECRET|TOKEN|API_KEY|PASSWORD|DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY|PRIVATE_KEY|ACCESS_KEY|AUTH_SECRET|ENCRYPTION_KEY)\s*=\s*["']?[^\s"']+["']?/g,
    replacement: "[REDACTED:env_secret]"
  },
  {
    name: "email",
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    replacement: "[REDACTED:email]"
  },
  {
    name: "generic_api_key",
    pattern: /(?:api[_-]?key|apikey|api[_-]?secret)\s*[:=]\s*["']?[a-zA-Z0-9_\-]{16,}["']?/gi,
    replacement: "[REDACTED:api_key]"
  }
];
function redactText(text) {
  let redacted = text;
  const counts = /* @__PURE__ */ new Map();
  for (const { name, pattern, replacement } of PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let matchCount = 0;
    redacted = redacted.replace(regex, () => {
      matchCount++;
      return replacement;
    });
    if (matchCount > 0) {
      counts.set(name, (counts.get(name) ?? 0) + matchCount);
    }
  }
  const redactions = Array.from(counts.entries()).map(([type, count]) => ({
    type,
    count
  }));
  return { redacted, redactions };
}

// src/store/index.ts
function getDataDir() {
  if (process.env.AGENT_COMMUNITY_DATA_DIR) {
    return resolve(process.env.AGENT_COMMUNITY_DATA_DIR);
  }
  if (process.env.CLAUDE_PLUGIN_ROOT) {
    return resolve(process.env.CLAUDE_PLUGIN_ROOT, "..", "data");
  }
  return resolve("data");
}
function listTools(dataDir) {
  const dir = join(dataDir ?? getDataDir(), "tools");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
}
var indexCache = /* @__PURE__ */ new Map();
var CACHE_TTL = 6e4;
function loadToolIndex(tool, dataDir) {
  const cacheKey = `${dataDir ?? getDataDir()}:${tool}`;
  const cached = indexCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.entries;
  }
  const indexPath = join(dataDir ?? getDataDir(), "tools", tool, "index.jsonl");
  if (!existsSync(indexPath)) return [];
  const lines = readFileSync(indexPath, "utf-8").split("\n").filter(Boolean);
  const entries = lines.map((line) => JSON.parse(line));
  indexCache.set(cacheKey, { entries, ts: Date.now() });
  return entries;
}
function loadCard(tool, id, dataDir) {
  const cardPath = join(dataDir ?? getDataDir(), "tools", tool, "cards", `${id}.json`);
  if (!existsSync(cardPath)) return null;
  return JSON.parse(readFileSync(cardPath, "utf-8"));
}
function saveCard(card, dataDir) {
  const base = dataDir ?? getDataDir();
  const toolDir = join(base, "tools", card.tool);
  const cardsDir = join(toolDir, "cards");
  mkdirSync(cardsDir, { recursive: true });
  writeFileSync(join(cardsDir, `${card.id}.json`), JSON.stringify(card, null, 2) + "\n");
  const indexEntry = {
    id: card.id,
    tool: card.tool,
    error_signature: card.error_signature,
    context_key: card.context_key,
    title: card.title,
    symptom: card.symptom,
    tags: card.tags
  };
  appendFileSync(join(toolDir, "index.jsonl"), JSON.stringify(indexEntry) + "\n");
  indexCache.delete(`${base}:${card.tool}`);
}
function appendTrace(trace, dataDir) {
  const base = dataDir ?? getDataDir();
  mkdirSync(base, { recursive: true });
  const traceId = `tr_${randomUUID().slice(0, 8)}`;
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const redactedTrace = { trace_id: traceId, timestamp };
  for (const [key, value] of Object.entries(trace)) {
    if (typeof value === "string") {
      redactedTrace[key] = redactText(value).redacted;
    } else if (Array.isArray(value)) {
      redactedTrace[key] = value.map(
        (v) => typeof v === "string" ? redactText(v).redacted : v
      );
    } else {
      redactedTrace[key] = value;
    }
  }
  const tracesPath = join(base, "traces.jsonl");
  try {
    const stats = statSync(tracesPath);
    if (stats.size > 10 * 1024 * 1024) {
      renameSync(tracesPath, join(base, "traces.old.jsonl"));
    }
  } catch {
  }
  appendFileSync(tracesPath, JSON.stringify(redactedTrace) + "\n");
  if (isSupabaseEnabled()) {
    insertTrace(redactedTrace).catch(() => {
    });
  }
  return traceId;
}
function rebuildToolIndex(tool, dataDir) {
  const base = dataDir ?? getDataDir();
  const cardsDir = join(base, "tools", tool, "cards");
  const indexPath = join(base, "tools", tool, "index.jsonl");
  if (!existsSync(cardsDir)) return;
  const entries = [];
  for (const file of readdirSync(cardsDir)) {
    if (!file.endsWith(".json")) continue;
    const card = JSON.parse(readFileSync(join(cardsDir, file), "utf-8"));
    const indexEntry = {
      id: card.id,
      tool: card.tool,
      error_signature: card.error_signature,
      context_key: card.context_key,
      title: card.title,
      symptom: card.symptom,
      tags: card.tags
    };
    entries.push(JSON.stringify(indexEntry));
  }
  writeFileSync(indexPath, entries.join("\n") + (entries.length > 0 ? "\n" : ""));
  indexCache.delete(`${base}:${tool}`);
}
async function syncFromSupabase(dataDir) {
  if (!isSupabaseEnabled()) {
    return { updated: 0, tools: [] };
  }
  const base = dataDir ?? getDataDir();
  const metaPath = join(base, ".sync_meta.json");
  let lastSyncedAt = "1970-01-01T00:00:00Z";
  if (existsSync(metaPath)) {
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    lastSyncedAt = meta.last_synced_at ?? lastSyncedAt;
  }
  let cards;
  try {
    cards = await fetchUpdatedCards(lastSyncedAt);
  } catch {
    return { updated: 0, tools: [] };
  }
  if (cards.length === 0) {
    return { updated: 0, tools: [] };
  }
  const affectedTools = /* @__PURE__ */ new Set();
  for (const card of cards) {
    const cardsDir = join(base, "tools", card.tool, "cards");
    mkdirSync(cardsDir, { recursive: true });
    writeFileSync(join(cardsDir, `${card.id}.json`), JSON.stringify(card, null, 2) + "\n");
    affectedTools.add(card.tool);
  }
  for (const tool of affectedTools) {
    rebuildToolIndex(tool, base);
  }
  mkdirSync(base, { recursive: true });
  writeFileSync(metaPath, JSON.stringify({ last_synced_at: (/* @__PURE__ */ new Date()).toISOString() }) + "\n");
  const toolsList = [...affectedTools];
  return { updated: cards.length, tools: toolsList };
}

export {
  redactText,
  getDataDir,
  listTools,
  loadToolIndex,
  loadCard,
  saveCard,
  appendTrace,
  rebuildToolIndex,
  syncFromSupabase
};
