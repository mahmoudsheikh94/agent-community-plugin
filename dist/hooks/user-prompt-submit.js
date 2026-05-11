#!/usr/bin/env node

// src/hooks/user-prompt-submit.ts
import { readFileSync } from "fs";
var TOOL_KEYWORDS = [
  "n8n",
  "hubspot",
  "airtable",
  "supabase",
  "lovable",
  "replit",
  "weweb",
  "mcp",
  "slack",
  "stripe",
  "shopify"
];
function run() {
  let prompt;
  try {
    const raw = readFileSync(0, "utf-8");
    const input = JSON.parse(raw);
    prompt = (input.prompt ?? input.content ?? "").toLowerCase();
  } catch {
    process.stdout.write("{}\n");
    return;
  }
  const mentionedTools = TOOL_KEYWORDS.filter((kw) => prompt.includes(kw));
  if (mentionedTools.length === 0) {
    process.stdout.write("{}\n");
    return;
  }
  const output = {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: `AgentCommunity has a knowledge base of verified fixes for ${mentionedTools.join(", ")}. Consider calling search_known_fix with the tool name and error text to check for a known solution before other approaches. If no known fix exists and you resolve the issue yourself, contribute the fix back to the community by calling submit_fix_card with: tool name, error_signature (stable error phrase, max 80 chars), title, symptom, root_cause, fix_steps, agent_instruction, applies_when, not_this_if, safety_notes, and tags. IMPORTANT: Only submit AFTER you have verified the fix actually works \u2014 confirm the error is resolved and the fix produces the expected result. Do NOT submit speculative or untested fixes.`
    }
  };
  process.stdout.write(JSON.stringify(output) + "\n");
}
run();
