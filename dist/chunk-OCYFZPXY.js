#!/usr/bin/env node
import {
  getSession
} from "./chunk-AJKLTBLJ.js";
import {
  generateCardId,
  validateCard
} from "./chunk-USTE5N6Q.js";
import {
  redactText,
  saveCard
} from "./chunk-OTKUNYBJ.js";
import {
  getSupabaseClient,
  isSupabaseEnabled,
  submitCard
} from "./chunk-IERZIF3F.js";

// src/community/problems.ts
import { createHash, randomUUID } from "crypto";
function generateProblemId(tool, errorSignature) {
  return "op_" + createHash("sha256").update(tool + "|" + errorSignature).digest("hex").slice(0, 12);
}
async function findOrCreateProblem(tool, errorSignature) {
  const sb = getSupabaseClient();
  if (!sb) return null;
  const problemId = generateProblemId(tool, errorSignature);
  try {
    const { data, error } = await sb.rpc("upsert_open_problem", {
      p_problem_id: problemId,
      p_tool: tool,
      p_error_signature: errorSignature,
      p_workspace_hash: ""
    });
    if (error) throw error;
    return data;
  } catch (err) {
    process.stderr.write(
      `[agent-community] problem upsert failed: ${err}
`
    );
    try {
      const { data } = await sb.from("open_problems").select("*").eq("problem_id", problemId).maybeSingle();
      return data;
    } catch {
      return null;
    }
  }
}
async function getOpenProblems(tool, limit = 10) {
  const sb = getSupabaseClient();
  if (!sb) return [];
  try {
    let query = sb.from("open_problems").select("*").eq("status", "open").order("occurrence_count", { ascending: false }).limit(limit);
    if (tool) {
      query = query.eq("tool", tool);
    }
    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  } catch {
    return [];
  }
}
async function contributeToProblem(tool, errorSignature, contributionType, content, cardData) {
  const problem = await findOrCreateProblem(tool, errorSignature);
  const problemId = problem?.problem_id ?? generateProblemId(tool, errorSignature);
  const { redacted: redactedContent } = redactText(content);
  const contributionId = "pc_" + randomUUID().slice(0, 12);
  const session = getSession();
  const sb = getSupabaseClient();
  if (sb) {
    try {
      await sb.from("problem_contributions").insert({
        contribution_id: contributionId,
        problem_id: problemId,
        session_id: session?.session_id ?? null,
        contribution_type: contributionType,
        content: redactedContent,
        card_data: cardData ?? null
      });
    } catch (err) {
      process.stderr.write(
        `[agent-community] contribution insert failed: ${err}
`
      );
    }
  }
  let problemStatus = problem?.status ?? "open";
  if (contributionType === "full_solution" && cardData) {
    try {
      const cd = cardData;
      const cardInput = {
        tool: cd.tool ?? tool,
        error_signature: cd.error_signature ?? errorSignature,
        context_key: cd.context_key ?? "",
        title: cd.title ?? "",
        symptom: cd.symptom ?? "",
        root_cause: cd.root_cause ?? "",
        fix_steps: cd.fix_steps ?? [],
        agent_instruction: cd.agent_instruction ?? "",
        applies_when: cd.applies_when ?? [],
        not_this_if: cd.not_this_if ?? [],
        safety_notes: cd.safety_notes ?? [],
        tags: cd.tags ?? []
      };
      const validation = validateCard(cardInput);
      if (validation.valid) {
        const fullCard = {
          ...cardInput,
          id: generateCardId(
            cardInput.tool,
            cardInput.error_signature,
            cardInput.context_key
          ),
          fix_type: "workaround",
          severity: "blocks_execution",
          confidence: 0.5,
          quality_score: validation.quality_score,
          source_type: "agent-discovered",
          verified_on: "",
          created: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
          version_notes: [`Solved open problem ${problemId}`]
        };
        saveCard(fullCard);
        if (isSupabaseEnabled()) {
          await submitCard(cardInput);
        }
        if (sb) {
          await sb.from("open_problems").update({ status: "solved", solved_by_card: fullCard.id }).eq("problem_id", problemId);
        }
        problemStatus = "solved";
      }
    } catch (err) {
      process.stderr.write(
        `[agent-community] full solution card creation failed: ${err}
`
      );
    }
  } else if (contributionType === "partial_solution" && sb) {
    try {
      await sb.from("open_problems").update({ status: "partial_solution" }).eq("problem_id", problemId).eq("status", "open");
      problemStatus = "partial_solution";
    } catch {
    }
  }
  let totalContributions = 1;
  if (sb) {
    try {
      const { count } = await sb.from("problem_contributions").select("*", { count: "exact", head: true }).eq("problem_id", problemId);
      totalContributions = count ?? 1;
    } catch {
    }
  }
  return {
    contribution_id: contributionId,
    problem_id: problemId,
    problem_status: problemStatus,
    total_contributions: totalContributions
  };
}
async function getProblemContext(tool, errorSignature) {
  const sb = getSupabaseClient();
  if (!sb) return null;
  const problemId = generateProblemId(tool, errorSignature);
  try {
    const { data: problem } = await sb.from("open_problems").select("*").eq("problem_id", problemId).maybeSingle();
    if (!problem) return null;
    const { data: contributions } = await sb.from("problem_contributions").select("*").eq("problem_id", problemId).order("created_at", { ascending: true }).limit(10);
    return {
      problem,
      contributions: contributions ?? []
    };
  } catch {
    return null;
  }
}

export {
  findOrCreateProblem,
  getOpenProblems,
  contributeToProblem,
  getProblemContext
};
