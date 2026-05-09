#!/usr/bin/env node
import {
  validateCard
} from "./chunk-KJEDYEFE.js";
import {
  redactText,
  searchKnownFix
} from "./chunk-H5DBXSUI.js";

// src/cli.ts
import { readFileSync } from "fs";
var args = process.argv.slice(2);
var command = args[0];
function getFlag(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : void 0;
}
switch (command) {
  case "search": {
    const tool = getFlag("--tool");
    const error = getFlag("--error");
    if (!error) {
      console.error("Usage: agent-community search --tool <tool> --error <error>");
      process.exit(1);
    }
    const results = searchKnownFix({ tool, error });
    if (results.length === 0) {
      console.log("No matching fix cards found.");
    } else {
      for (const r of results) {
        console.log(`
--- ${r.title} ---`);
        console.log(`ID: ${r.id}`);
        console.log(`Score: ${(r.score * 100).toFixed(0)}%`);
        console.log(`Confidence: ${(r.confidence * 100).toFixed(0)}%`);
        console.log(`Matched on: ${r.matched_on.join(", ")}`);
        console.log(`
Instruction: ${r.agent_instruction}`);
        console.log(`
Fix steps:`);
        r.fix_steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
        if (r.safety_notes.length > 0) {
          console.log(`
Safety notes:`);
          r.safety_notes.forEach((n) => console.log(`  - ${n}`));
        }
      }
    }
    break;
  }
  case "redact": {
    const text = getFlag("--text");
    if (!text) {
      console.error("Usage: agent-community redact --text <text>");
      process.exit(1);
    }
    const result = redactText(text);
    console.log(JSON.stringify(result, null, 2));
    break;
  }
  case "validate": {
    const file = getFlag("--file");
    if (!file) {
      console.error("Usage: agent-community validate --file <path>");
      process.exit(1);
    }
    const card = JSON.parse(readFileSync(file, "utf-8"));
    const result = validateCard(card);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.valid ? 0 : 1);
    break;
  }
  case "hook:post-tool-use-failure": {
    await import("./hooks/post-tool-use-failure.js");
    break;
  }
  case "hook:user-prompt-submit": {
    await import("./hooks/user-prompt-submit.js");
    break;
  }
  default:
    console.log(`AgentCommunity CLI v0.1.0

Commands:
  search    --tool <tool> --error <error>   Search for known fixes
  redact    --text <text>                   Redact secrets from text
  validate  --file <path>                   Validate a fix card JSON file
  hook:post-tool-use-failure                Run PostToolUseFailure hook (stdin)
  hook:user-prompt-submit                   Run UserPromptSubmit hook (stdin)`);
}
