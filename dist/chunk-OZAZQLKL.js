#!/usr/bin/env node
import {
  loadToolIndex
} from "./chunk-ZHGN53BU.js";

// src/validation/index.ts
import { createHash } from "crypto";

// src/utils/similarity.ts
function jaccardSimilarity(a, b) {
  const setA = new Set(a.map((s) => s.toLowerCase()));
  const setB = new Set(b.map((s) => s.toLowerCase()));
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = (/* @__PURE__ */ new Set([...setA, ...setB])).size;
  return union === 0 ? 0 : intersection / union;
}

// src/validation/index.ts
var REQUIRED_FIELDS = [
  "tool",
  "error_signature",
  "title",
  "symptom",
  "root_cause",
  "fix_steps",
  "agent_instruction"
];
var UNSTABLE_PATTERNS = [
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/,
  /\/(?:home|Users|tmp)\/[^\s]+/
];
function generateCardId(tool, errorSignature, contextKey) {
  const hash = createHash("sha256").update(`${tool}|${errorSignature}|${contextKey}`).digest("hex");
  return hash.slice(0, 12);
}
function computeQualityScore(card) {
  let score = 0;
  if (card.fix_steps && card.fix_steps.length >= 2) score += 25;
  if (card.verified_on) score += 25;
  if (card.applies_when && card.applies_when.length >= 2) score += 25;
  if (card.not_this_if && card.not_this_if.length >= 1) score += 15;
  if (card.root_cause && card.root_cause.split(/\s+/).length > 30) score += 10;
  return score;
}
function validateCard(card, dataDir) {
  const errors = [];
  const warnings = [];
  for (const field of REQUIRED_FIELDS) {
    const val = card[field];
    if (val === void 0 || val === null || val === "") {
      errors.push(`Missing required field: ${field}`);
    } else if (Array.isArray(val) && val.length === 0) {
      errors.push(`Required field is empty array: ${field}`);
    }
  }
  if (card.error_signature) {
    if (card.error_signature.length > 80) {
      errors.push(
        `error_signature exceeds 80 chars (${card.error_signature.length})`
      );
    }
    for (const pat of UNSTABLE_PATTERNS) {
      if (pat.test(card.error_signature)) {
        errors.push(
          `error_signature contains unstable content (UUIDs, timestamps, or file paths)`
        );
        break;
      }
    }
  }
  if (card.tool && card.error_signature) {
    const id = generateCardId(
      card.tool,
      card.error_signature,
      card.context_key ?? ""
    );
    const existingIndex = loadToolIndex(card.tool, dataDir);
    const duplicate = existingIndex.find((e) => e.id === id);
    if (duplicate) {
      errors.push(`Duplicate fingerprint: card with id ${id} already exists`);
    }
    if (card.tags && card.tags.length > 0) {
      const sameSignature = existingIndex.filter(
        (e) => e.error_signature === card.error_signature
      );
      for (const existing of sameSignature) {
        const similarity = jaccardSimilarity(card.tags, existing.tags);
        if (similarity > 0.8) {
          warnings.push(
            `Near-duplicate: tag similarity ${(similarity * 100).toFixed(0)}% with existing card ${existing.id}`
          );
        }
      }
    }
  }
  const quality_score = computeQualityScore(card);
  if (quality_score < 50) {
    warnings.push(`Low quality score: ${quality_score}/100 (draft quality)`);
  }
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    quality_score
  };
}

export {
  jaccardSimilarity,
  generateCardId,
  validateCard
};
