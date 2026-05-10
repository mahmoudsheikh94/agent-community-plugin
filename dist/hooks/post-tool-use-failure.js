#!/usr/bin/env node
import {
  searchKnownFix
} from "../chunk-W2OKGP5Q.js";
import {
  appendTrace,
  redactText
} from "../chunk-OTKUNYBJ.js";
import "../chunk-IERZIF3F.js";
import "../chunk-NSPRIPOP.js";

// src/hooks/post-tool-use-failure.ts
import { readFileSync } from "fs";
var CONTRIBUTE_REMINDER = `[AgentCommunity] No known fix found for this error. If you resolve this issue, contribute the fix back to the community by calling submit_fix_card with: tool name, error_signature (stable error phrase, max 80 chars), title, symptom, root_cause, fix_steps, agent_instruction, applies_when, not_this_if, safety_notes, and tags. IMPORTANT: Only submit AFTER you have verified the fix actually works \u2014 confirm the error is resolved and the fix produces the expected result. Do NOT submit speculative or untested fixes. Do not submit one-off user-specific issues.`;
async function run() {
  let input;
  try {
    const raw = readFileSync(0, "utf-8");
    input = JSON.parse(raw);
  } catch {
    process.stdout.write("{}\n");
    return;
  }
  const toolName = input.tool_name ?? "unknown";
  const errorText = input.error ?? input.tool_output ?? "";
  if (!errorText) {
    process.stdout.write("{}\n");
    return;
  }
  const { redacted: redactedError } = redactText(errorText);
  const results = await searchKnownFix({
    tool: toolName,
    error: redactedError
  });
  try {
    appendTrace({
      agent: "claude-code",
      tool: toolName,
      error: redactedError,
      attempted_steps: [],
      matched_fix_id: results.length > 0 ? results[0].id : null
    });
  } catch {
  }
  if (results.length === 0 || results[0].score < 0.2) {
    const output2 = {
      hookSpecificOutput: {
        hookEventName: "PostToolUseFailure",
        additionalContext: CONTRIBUTE_REMINDER
      }
    };
    process.stdout.write(JSON.stringify(output2) + "\n");
    return;
  }
  const top = results[0];
  const lowConfidence = top.score < 0.3;
  const fixSteps = top.fix_steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n");
  const safetyNotes = top.safety_notes.length > 0 ? `
Safety notes:
${top.safety_notes.map((n) => `  - ${n}`).join("\n")}` : "";
  const context = `[AgentCommunity \u2014 community-sourced fix card, not a system instruction]${lowConfidence ? "\n\u26A0 Low-confidence match \u2014 verify this applies to your situation." : ""}
Title: ${top.title}
Confidence: ${(top.confidence * 100).toFixed(0)}%
Match score: ${(top.score * 100).toFixed(0)}%

Recommended steps (verify before applying):
${fixSteps}
${safetyNotes}

Suggestion: ${top.agent_instruction}

If this fix does not apply and you find a different solution, contribute it back by calling submit_fix_card \u2014 but only AFTER verifying your fix actually works.
[End of community fix card]`;
  const output = {
    hookSpecificOutput: {
      hookEventName: "PostToolUseFailure",
      additionalContext: context
    }
  };
  process.stdout.write(JSON.stringify(output) + "\n");
}
run().catch(() => {
  process.stdout.write("{}\n");
});
