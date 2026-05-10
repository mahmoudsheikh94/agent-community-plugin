#!/usr/bin/env node
import {
  generateCardId,
  jaccardSimilarity
} from "./chunk-USTE5N6Q.js";
import {
  loadToolIndex
} from "./chunk-OTKUNYBJ.js";
import "./chunk-IERZIF3F.js";
import "./chunk-NSPRIPOP.js";

// src/ingest/dedup/index.ts
var Deduplicator = class {
  existingIndex;
  constructor(tool = "n8n", dataDir) {
    this.existingIndex = loadToolIndex(tool, dataDir);
  }
  checkDuplicate(candidate) {
    const tool = candidate.tool ?? "n8n";
    const errorSig = candidate.error_signature ?? "";
    const contextKey = candidate.context_key ?? "";
    const candidateId = generateCardId(tool, errorSig, contextKey);
    const exactMatch = this.existingIndex.find((e) => e.id === candidateId);
    if (exactMatch) {
      return {
        action: "skip_exact",
        existing_card_id: exactMatch.id,
        reason: `Exact duplicate: card ${exactMatch.id} already exists`
      };
    }
    for (const existing of this.existingIndex) {
      const sigA = errorSig.toLowerCase();
      const sigB = existing.error_signature.toLowerCase();
      const isSubstring = sigA.length > 5 && sigB.length > 5 && (sigA.includes(sigB) || sigB.includes(sigA));
      if (isSubstring) {
        const similarity = jaccardSimilarity(
          candidate.tags ?? [],
          existing.tags
        );
        if (similarity > 0.6) {
          return {
            action: "skip_semantic",
            existing_card_id: existing.id,
            similarity_score: similarity,
            reason: `Semantic duplicate: signature substring match with ${existing.id} (tag similarity: ${(similarity * 100).toFixed(0)}%)`
          };
        }
      }
    }
    return {
      action: "new",
      reason: "No duplicate found"
    };
  }
  addToIndex(entry) {
    this.existingIndex.push(entry);
  }
};
export {
  Deduplicator
};
