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
var ERROR_SIGNALS = [
  "error",
  "fail",
  "failed",
  "failure",
  "broken",
  "not working",
  "doesn't work",
  "does not work",
  "issue",
  "bug",
  "crash",
  "exception",
  "timeout",
  "refused",
  "denied",
  "unauthorized",
  "403",
  "404",
  "500",
  "502",
  "503",
  "econnrefused",
  "enotfound",
  "cannot read",
  "undefined",
  "null",
  "missing",
  "invalid"
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
  const hasErrorSignal = ERROR_SIGNALS.some((sig) => prompt.includes(sig));
  if (!hasErrorSignal) {
    process.stdout.write("{}\n");
    return;
  }
  const output = {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: `AgentCommunity has a knowledge base of verified fixes for ${mentionedTools.join(", ")}. Consider calling search_known_fix with the tool name and error text to check for a known solution before other approaches.`
    }
  };
  process.stdout.write(JSON.stringify(output) + "\n");
}
run();
