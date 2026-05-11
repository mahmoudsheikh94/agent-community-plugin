#!/usr/bin/env node
import {
  listTools,
  loadCard,
  loadToolIndex,
  redactText
} from "./chunk-OTKUNYBJ.js";
import {
  getSupabaseClient,
  isSupabaseEnabled,
  searchCards
} from "./chunk-IERZIF3F.js";

// src/community/sessions.ts
import { createHash, randomUUID } from "crypto";
var currentSession = null;
async function initSession(agentType) {
  const session = {
    session_id: "as_" + randomUUID().slice(0, 12),
    agent_type: agentType,
    workspace_hash: createHash("sha256").update(process.cwd()).digest("hex").slice(0, 16)
  };
  currentSession = session;
  const sb = getSupabaseClient();
  if (sb) {
    try {
      await sb.from("agent_sessions").insert({
        session_id: session.session_id,
        agent_type: session.agent_type,
        workspace_hash: session.workspace_hash
      });
    } catch (err) {
      process.stderr.write(
        `[agent-community] session registration failed: ${err}
`
      );
    }
  }
  return session;
}
function getSession() {
  return currentSession;
}

// src/community/evidence.ts
import { randomUUID as randomUUID2 } from "crypto";
import { appendFileSync } from "fs";
import { join } from "path";
function getDataDir() {
  return process.env.AGENT_COMMUNITY_DATA_DIR ?? process.env.CLAUDE_PLUGIN_ROOT ? join(process.env.CLAUDE_PLUGIN_ROOT, "data") : join(process.cwd(), "data");
}
async function submitEvidence(report) {
  const reportId = "er_" + randomUUID2().slice(0, 12);
  const { redacted: redactedDetail } = redactText(report.outcome_detail);
  const redactedSteps = report.steps_taken.map((s) => redactText(s).redacted);
  const redactedAltSteps = report.alternative_steps?.map(
    (s) => redactText(s).redacted
  );
  let session = getSession();
  if (!session) {
    session = await initSession("claude-code");
  }
  const record = {
    report_id: reportId,
    session_id: session.session_id,
    card_id: report.card_id,
    report_type: report.report_type,
    environment: report.environment,
    steps_taken: redactedSteps,
    outcome_detail: redactedDetail,
    alternative_steps: redactedAltSteps ?? null
  };
  const sb = getSupabaseClient();
  if (sb) {
    try {
      await sb.from("evidence_reports").insert(record);
      const consensus = await getConsensusForCard(report.card_id);
      return {
        report_id: reportId,
        consensus_tier: consensus?.confidence_tier ?? "unverified",
        card_confidence: consensus?.success_rate ?? 0.5
      };
    } catch (err) {
      process.stderr.write(
        `[agent-community] evidence insert failed, falling back to local: ${err}
`
      );
    }
  }
  try {
    const evidencePath = join(getDataDir(), "evidence.jsonl");
    appendFileSync(
      evidencePath,
      JSON.stringify(record) + "\n"
    );
  } catch {
  }
  return {
    report_id: reportId,
    consensus_tier: "unverified",
    card_confidence: 0.5
  };
}
async function getConsensusForCard(cardId) {
  const sb = getSupabaseClient();
  if (!sb) return null;
  try {
    const { data, error } = await sb.from("consensus_state").select("*").eq("winning_card_id", cardId).limit(1).maybeSingle();
    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}
async function getConsensusBatch(cardIds) {
  const result = /* @__PURE__ */ new Map();
  if (cardIds.length === 0) return result;
  const sb = getSupabaseClient();
  if (!sb) return result;
  try {
    const { data, error } = await sb.from("consensus_state").select("*").in("winning_card_id", cardIds);
    if (error || !data) return result;
    for (const row of data) {
      result.set(row.winning_card_id, row);
    }
  } catch {
  }
  return result;
}

// src/community/consensus.ts
async function enrichWithConsensus(results) {
  if (!isSupabaseEnabled() || results.length === 0) return results;
  try {
    const cardIds = results.map((r) => r.id);
    const consensusMap = await getConsensusBatch(cardIds);
    if (consensusMap.size === 0) return results;
    return results.map((r) => {
      const consensus = consensusMap.get(r.id);
      if (!consensus) return r;
      return {
        ...r,
        consensus_tier: consensus.confidence_tier,
        evidence_summary: {
          total_reports: consensus.total_reports,
          success_rate: consensus.success_rate,
          unique_workspaces: consensus.unique_workspaces,
          last_verified: consensus.last_evaluated ? new Date(consensus.last_evaluated).toISOString().slice(0, 10) : ""
        }
      };
    });
  } catch {
    return results;
  }
}

// src/search/index.ts
function tokenize(text) {
  return text.toLowerCase().replace(/[^a-z0-9_-]/g, " ").split(/\s+/).filter((t) => t.length > 1);
}
function substringMatch(haystack, needle) {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}
function tokenOverlap(tokensA, tokensB) {
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  const setB = new Set(tokensB);
  const matches = tokensA.filter((t) => setB.has(t)).length;
  const union = (/* @__PURE__ */ new Set([...tokensA, ...tokensB])).size;
  return union > 0 ? matches / union : 0;
}
function scoreEntry(entry, errorText, errorTokens, toolName) {
  const matched_on = [];
  let signatureScore = 0;
  let toolScore = 0;
  let tagScore = 0;
  let titleScore = 0;
  if (substringMatch(errorText, entry.error_signature)) {
    signatureScore = 0.5;
    matched_on.push("error_signature");
  } else {
    const sigTokens = tokenize(entry.error_signature);
    const overlap = tokenOverlap(errorTokens, sigTokens);
    if (overlap > 0.3) {
      signatureScore = 0.3 * overlap;
      matched_on.push("error_signature_fuzzy");
    }
  }
  if (toolName) {
    const normalized = normalizeToolName(toolName) ?? toolName.toLowerCase();
    if (entry.tool.toLowerCase() === normalized) {
      toolScore = 0.2;
      matched_on.push("tool");
    }
  }
  const tagTokens = entry.tags.map((t) => t.toLowerCase());
  const tagOverlap = errorTokens.filter((t) => tagTokens.includes(t)).length;
  if (tagOverlap > 0) {
    tagScore = Math.min(0.15, 0.05 * tagOverlap);
    matched_on.push("tags");
  }
  const titleTokens = tokenize(entry.title);
  const titleOv = tokenOverlap(errorTokens, titleTokens);
  if (titleOv > 0) {
    titleScore = 0.15 * titleOv;
    matched_on.push("title");
  }
  const total = Math.min(1, signatureScore + toolScore + tagScore + titleScore);
  return { signatureScore, toolScore, tagScore, titleScore, total, matched_on };
}
function normalizeToolName(raw) {
  const lower = raw.toLowerCase();
  const pluginMatch = lower.match(/^mcp__plugin_[^_]+_([^_]+)__/);
  if (pluginMatch) return pluginMatch[1];
  const cloudMatch = lower.match(/^mcp__claude_ai_([^_]+)__/);
  if (cloudMatch) return cloudMatch[1];
  const simpleMatch = lower.match(/^mcp__([^_]+)__/);
  if (simpleMatch) return simpleMatch[1];
  if (!lower.startsWith("mcp__")) return null;
  return null;
}
function cardToIndexEntry(card) {
  return {
    id: card.id,
    tool: card.tool,
    error_signature: card.error_signature,
    context_key: card.context_key,
    title: card.title,
    symptom: card.symptom,
    tags: card.tags
  };
}
function applyNotThisIf(card, errorText) {
  if (!card.not_this_if || card.not_this_if.length === 0) return false;
  return card.not_this_if.some(
    (condition) => errorText.toLowerCase().includes(condition.toLowerCase())
  );
}
function buildResults(cards, errorText, errorTokens, toolName) {
  const candidates = [];
  for (const card of cards) {
    const entry = cardToIndexEntry(card);
    const score = scoreEntry(entry, errorText, errorTokens, toolName);
    if (score.total >= 0.1) {
      candidates.push({ card, score });
    }
  }
  candidates.sort((a, b) => b.score.total - a.score.total);
  const results = [];
  for (const { card, score } of candidates.slice(0, 5)) {
    if (applyNotThisIf(card, errorText)) continue;
    results.push({
      id: card.id,
      title: card.title,
      score: Math.round(score.total * 100) / 100,
      agent_instruction: card.agent_instruction,
      fix_steps: card.fix_steps,
      safety_notes: card.safety_notes,
      confidence: card.confidence,
      matched_on: score.matched_on
    });
  }
  return results;
}
async function searchKnownFix(params, dataDir) {
  const { tool, error, task, context } = params;
  const errorTokens = tokenize(
    [error, task, context].filter(Boolean).join(" ")
  );
  const errorText = [error, task, context].filter(Boolean).join(" ");
  const normalizedTool = tool ? normalizeToolName(tool) ?? tool.toLowerCase() : null;
  let results;
  if (isSupabaseEnabled()) {
    try {
      const cards = await searchCards(normalizedTool, 500);
      results = buildResults(cards, errorText, errorTokens, tool ?? null);
    } catch {
      results = searchLocal(params, dataDir);
    }
  } else {
    results = searchLocal(params, dataDir);
  }
  try {
    return await enrichWithConsensus(results);
  } catch {
    return results;
  }
}
function searchLocal(params, dataDir) {
  const { tool, error, task, context } = params;
  const errorTokens = tokenize(
    [error, task, context].filter(Boolean).join(" ")
  );
  const errorText = [error, task, context].filter(Boolean).join(" ");
  const availableTools = listTools(dataDir);
  const toolsToSearch = [];
  if (tool) {
    const normalized = normalizeToolName(tool) ?? tool.toLowerCase();
    if (availableTools.includes(normalized)) {
      toolsToSearch.push(normalized);
    } else {
      toolsToSearch.push(...availableTools);
    }
  } else {
    toolsToSearch.push(...availableTools);
  }
  if (!toolsToSearch.includes("_general")) {
    toolsToSearch.push("_general");
  }
  const candidates = [];
  for (const t of toolsToSearch) {
    const index = loadToolIndex(t, dataDir);
    for (const entry of index) {
      const score = scoreEntry(entry, errorText, errorTokens, tool ?? null);
      if (score.total >= 0.1) {
        candidates.push({ entry, score });
      }
    }
  }
  candidates.sort((a, b) => b.score.total - a.score.total);
  const top = candidates.slice(0, 5);
  const results = [];
  for (const { entry, score } of top) {
    const card = loadCard(entry.tool, entry.id, dataDir);
    if (!card) continue;
    if (applyNotThisIf(card, errorText)) continue;
    results.push({
      id: card.id,
      title: card.title,
      score: Math.round(score.total * 100) / 100,
      agent_instruction: card.agent_instruction,
      fix_steps: card.fix_steps,
      safety_notes: card.safety_notes,
      confidence: card.confidence,
      matched_on: score.matched_on
    });
  }
  return results;
}

export {
  initSession,
  getSession,
  submitEvidence,
  searchKnownFix
};
