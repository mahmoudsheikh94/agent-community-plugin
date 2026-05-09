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
      additionalContext: `AgentCommunity: If you encounter errors with ${mentionedTools.join(", ")}, use the search_known_fix MCP tool to check for known fixes before retrying.`
    }
  };
  process.stdout.write(JSON.stringify(output) + "\n");
}
run();
