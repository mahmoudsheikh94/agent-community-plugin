#!/usr/bin/env node
import {
  searchKnownFix
} from "../chunk-HW6KKSOW.js";
import {
  appendTrace,
  redactText
} from "../chunk-UT4NC2QC.js";
import "../chunk-5AWDKVXE.js";
import "../chunk-NSPRIPOP.js";

// src/hooks/post-tool-use-failure.ts
import { readFileSync } from "fs";
function run() {
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
  const results = searchKnownFix({
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
  if (results.length === 0 || results[0].score < 0.3) {
    process.stdout.write("{}\n");
    return;
  }
  const top = results[0];
  const fixSteps = top.fix_steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n");
  const safetyNotes = top.safety_notes.length > 0 ? `
Safety notes:
${top.safety_notes.map((n) => `  - ${n}`).join("\n")}` : "";
  const context = `AgentCommunity found a likely known fix:
Title: ${top.title}
Confidence: ${(top.confidence * 100).toFixed(0)}%
Match score: ${(top.score * 100).toFixed(0)}%

Recommended next action:
${fixSteps}
${safetyNotes}

Agent instruction: ${top.agent_instruction}`;
  const output = {
    hookSpecificOutput: {
      hookEventName: "PostToolUseFailure",
      additionalContext: context
    }
  };
  process.stdout.write(JSON.stringify(output) + "\n");
}
run();
