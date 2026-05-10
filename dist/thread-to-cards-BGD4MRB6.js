#!/usr/bin/env node

// src/ingest/transformer/thread-to-cards.ts
import OpenAI from "openai";

// src/ingest/transformer/prompt.ts
var SYSTEM_PROMPT = `You are a technical analyst extracting structured fix cards from n8n community forum threads.

A fix card captures a specific, reproducible error that an AI agent might encounter when using n8n, along with the steps to resolve it.

You will receive a forum thread with a QUESTION and an ACCEPTED ANSWER. Your job is to extract zero or more fix cards.

## Rules

1. SKIP the thread entirely (return empty array) if:
   - The question is about general advice, opinions, or feature requests, not a specific error
   - The answer is just "upgrade n8n" with no other actionable steps
   - The question is about UI/UX preferences, not a functional issue
   - The problem is specific to one user's infrastructure with no generalizable fix
   - The thread is a discussion without a clear error \u2192 fix pattern

2. For each distinct error in the thread, produce a fix card with ALL of these fields:
   - error_signature: A STABLE error phrase (max 80 chars). Extract the actual error message from the thread. Strip UUIDs, timestamps, file paths, usernames, IP addresses. Example: "ECONNREFUSED" not "ECONNREFUSED at /home/user/app.js:42"
   - context_key: What differentiates this from other cards with the same error_signature. Usually the n8n node name or integration. Examples: "http-request-node", "google-sheets", "webhook-trigger", "code-node"
   - title: One-line summary, max 80 chars
   - symptom: What the user/agent sees. Max 2 sentences.
   - applies_when: 2+ preconditions that must be true for this fix to apply
   - not_this_if: 1+ conditions that disqualify this fix
   - root_cause: Why the error happens. Be detailed \u2014 aim for 30+ words.
   - fix_steps: Ordered steps to fix. Be specific and actionable for an AI agent. At least 2 steps.
   - agent_instruction: One concise sentence telling the AI agent exactly what to do.
   - safety_notes: Any warnings (data loss risk, credential exposure, downtime, etc.). Use empty array [] if none.
   - fix_type: One of: "code_change", "config_change", "api_call", "workaround", "architecture"
   - tags: Search keywords \u2014 include node names, integration names, error codes, relevant concepts
   - severity: One of: "blocks_execution", "silent_wrong_result", "degraded"
   - confidence: Your confidence this fix is correct and generalizable (0.0-1.0). Lower for ambiguous or old threads.
   - verified_on: The n8n version if mentioned (e.g., "1.52.0"). Empty string if not mentioned.

3. For error_signature, ALWAYS prefer the ACTUAL error text from the thread. If no clear error message exists, synthesize a short phrase that an AI agent would see in the n8n output.

4. The tool field is always "n8n".

## Output Format

Return a JSON array of fix card objects. Return an empty array [] if the thread is not actionable.

Example response:
\`\`\`json
[
  {
    "error_signature": "credentials not available for manual execution",
    "context_key": "hubspot-node",
    "title": "HubSpot credentials not available in manual execution",
    "symptom": "When manually executing a workflow with a HubSpot node, n8n throws 'credentials not available for manual execution'.",
    "applies_when": ["Using HubSpot node", "Manual execution mode"],
    "not_this_if": ["Error occurs in production/webhook-triggered execution"],
    "root_cause": "n8n's manual execution mode loads credentials differently than production mode. When credentials were created via the API or imported, they may not be properly linked to the workflow's execution context during manual runs.",
    "fix_steps": ["Open the HubSpot node settings", "Re-select the credentials from the dropdown", "Save the workflow", "Try manual execution again"],
    "agent_instruction": "Re-select the HubSpot credentials in the node settings and save the workflow.",
    "safety_notes": [],
    "fix_type": "config_change",
    "tags": ["hubspot", "credentials", "manual-execution", "node-configuration"],
    "severity": "blocks_execution",
    "confidence": 0.85,
    "verified_on": ""
  }
]
\`\`\``;
function buildUserPrompt(thread) {
  const parts = [
    `## Forum Thread`,
    ``,
    `**Title:** ${thread.title}`,
    `**URL:** ${thread.url}`,
    `**Tags:** ${thread.tags.length > 0 ? thread.tags.join(", ") : "none"}`,
    `**Views:** ${thread.topic_views} | **Replies:** ${thread.topic_reply_count}`,
    ``,
    `### Question`,
    thread.question_text
  ];
  if (thread.reply_chain.length > 0) {
    parts.push(``, `### Reply Context`);
    for (const reply of thread.reply_chain) {
      parts.push(reply, ``);
    }
  }
  parts.push(
    ``,
    `### Accepted Answer (by ${thread.answer_username}, ${thread.answer_likes} likes)`,
    thread.answer_text
  );
  return parts.join("\n");
}

// src/ingest/transformer/thread-to-cards.ts
var ThreadTransformer = class {
  client;
  concurrency;
  constructor(apiKey, options = { concurrency: 3 }) {
    this.client = new OpenAI({ apiKey });
    this.concurrency = options.concurrency;
  }
  async transform(thread) {
    const userPrompt = buildUserPrompt(thread);
    if (thread.question_text.length < 30 || thread.answer_text.length < 30) {
      return {
        source_topic_id: thread.topic_id,
        source_url: thread.url,
        cards: [],
        llm_confidence: 0,
        skipped: true,
        skip_reason: "Thread too short to be actionable"
      };
    }
    try {
      const response = await this.client.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 4096,
        temperature: 0.1,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt }
        ]
      });
      const text = response.choices[0]?.message?.content ?? "";
      const cards = this.parseCards(text);
      if (cards.length === 0) {
        return {
          source_topic_id: thread.topic_id,
          source_url: thread.url,
          cards: [],
          llm_confidence: 0,
          skipped: true,
          skip_reason: "LLM determined thread is not actionable"
        };
      }
      const avgConfidence = cards.reduce((sum, c) => sum + (c.confidence ?? 0.5), 0) / cards.length;
      return {
        source_topic_id: thread.topic_id,
        source_url: thread.url,
        cards: cards.map((c) => ({ ...c, tool: "n8n" })),
        llm_confidence: avgConfidence,
        skipped: false
      };
    } catch (err) {
      return {
        source_topic_id: thread.topic_id,
        source_url: thread.url,
        cards: [],
        llm_confidence: 0,
        skipped: true,
        skip_reason: `LLM error: ${err instanceof Error ? err.message : String(err)}`
      };
    }
  }
  async *transformBatch(threads, onProgress) {
    let completed = 0;
    const total = threads.length;
    for (let i = 0; i < threads.length; i += this.concurrency) {
      const chunk = threads.slice(i, i + this.concurrency);
      const results = await Promise.allSettled(
        chunk.map((thread) => this.transform(thread))
      );
      for (const result of results) {
        completed++;
        onProgress?.(completed, total);
        if (result.status === "fulfilled") {
          yield result.value;
        } else {
          yield {
            source_topic_id: chunk[results.indexOf(result)]?.topic_id ?? 0,
            source_url: "",
            cards: [],
            llm_confidence: 0,
            skipped: true,
            skip_reason: `Promise rejected: ${result.reason}`
          };
        }
      }
    }
  }
  parseCards(text) {
    const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    const jsonStr = fenceMatch ? fenceMatch[1] : text;
    try {
      const parsed = JSON.parse(jsonStr.trim());
      if (Array.isArray(parsed)) {
        return parsed;
      }
      return [parsed];
    } catch {
      const arrayMatch = text.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        try {
          return JSON.parse(arrayMatch[0]);
        } catch {
          return [];
        }
      }
      return [];
    }
  }
};
export {
  ThreadTransformer
};
