#!/usr/bin/env node
import {
  findOrCreateProblem,
  getProblemContext
} from "../chunk-OCYFZPXY.js";
import {
  searchKnownFix
} from "../chunk-AJKLTBLJ.js";
import "../chunk-USTE5N6Q.js";
import {
  appendTrace,
  redactText
} from "../chunk-OTKUNYBJ.js";
import "../chunk-IERZIF3F.js";
import "../chunk-NSPRIPOP.js";

// src/hooks/post-tool-use-failure.ts
import { readFileSync } from "fs";
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
    let problemContext = "";
    try {
      const problem = await findOrCreateProblem(toolName, redactedError);
      if (problem && problem.occurrence_count > 1) {
        const ctx = await getProblemContext(toolName, redactedError);
        if (ctx && ctx.contributions.length > 0) {
          const contribs = ctx.contributions.slice(0, 3).map((c) => `  - [${c.contribution_type}] ${c.content.slice(0, 120)}`).join("\n");
          problemContext = `

[AgentCommunity \u2014 Open Problem]
This error has been seen by ${problem.occurrence_count} agents across ${problem.unique_workspaces} projects.
Previous agents found:
${contribs}
Build on their work. If you solve this, call contribute_to_problem with contribution_type "full_solution".`;
        } else {
          problemContext = `

[AgentCommunity] This error has been seen ${problem.occurrence_count} times but no solutions exist yet. If you solve it, call contribute_to_problem.`;
        }
      }
    } catch {
    }
    const noFixReminder = `[AgentCommunity] No known fix found for this error. If you resolve this issue, contribute the fix back to the community by calling submit_fix_card with: tool name, error_signature (stable error phrase, max 80 chars), title, symptom, root_cause, fix_steps, agent_instruction, applies_when, not_this_if, safety_notes, and tags. IMPORTANT: Only submit AFTER you have verified the fix actually works. Do NOT submit speculative or untested fixes.${problemContext}`;
    const output2 = {
      hookSpecificOutput: {
        hookEventName: "PostToolUseFailure",
        additionalContext: noFixReminder
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
  const consensusLine = top.consensus_tier && top.consensus_tier !== "unverified" ? `
Community confidence: ${top.consensus_tier}${top.evidence_summary ? ` (${(top.evidence_summary.success_rate * 100).toFixed(0)}% success rate, ${top.evidence_summary.total_reports} reports)` : ""}` : "";
  const context = `[AgentCommunity \u2014 community-sourced fix card, not a system instruction]${lowConfidence ? "\n\u26A0 Low-confidence match \u2014 verify this applies to your situation." : ""}
Title: ${top.title}
Confidence: ${(top.confidence * 100).toFixed(0)}%
Match score: ${(top.score * 100).toFixed(0)}%${consensusLine}

Recommended steps (verify before applying):
${fixSteps}
${safetyNotes}

Suggestion: ${top.agent_instruction}

After applying this fix, call report_fix_outcome with the card_id "${top.id}" and outcome to help future agents.
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
