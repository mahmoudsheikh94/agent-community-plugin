#!/usr/bin/env node
import {
  listTools,
  loadCard,
  loadToolIndex
} from "./chunk-OTKUNYBJ.js";
import {
  isSupabaseEnabled,
  searchCards
} from "./chunk-IERZIF3F.js";

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
  if (isSupabaseEnabled()) {
    try {
      const cards = await searchCards(normalizedTool, 500);
      return buildResults(cards, errorText, errorTokens, tool ?? null);
    } catch {
    }
  }
  return searchLocal(params, dataDir);
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
  searchKnownFix
};
