#!/usr/bin/env node
import {
  generateCardId,
  validateCard
} from "./chunk-KJEDYEFE.js";
import {
  appendTrace,
  isSupabaseEnabled,
  redactText,
  saveCard,
  searchKnownFix,
  submitCard,
  syncFromSupabase
} from "./chunk-H5DBXSUI.js";

// src/mcp-server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
var server = new Server(
  { name: "agent-community", version: "0.1.0" },
  { capabilities: { tools: {} } }
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_known_fix",
      description: "Search the AgentCommunity knowledge base for known fixes matching a tool error. Returns ranked fix cards with instructions.",
      inputSchema: {
        type: "object",
        properties: {
          tool: {
            type: "string",
            description: "Tool name: n8n, hubspot, airtable, supabase, slack, stripe, etc."
          },
          error: { type: "string", description: "The error message or code" },
          task: {
            type: "string",
            description: "What the agent was trying to do"
          },
          context: {
            type: "string",
            description: "Additional context about the situation"
          }
        },
        required: ["error"]
      }
    },
    {
      name: "submit_failure_trace",
      description: "Log a redacted failure trace to help improve the knowledge base. Secrets are automatically redacted before storage.",
      inputSchema: {
        type: "object",
        properties: {
          agent: { type: "string", description: "Agent identifier" },
          tool: { type: "string", description: "Tool that failed" },
          task: { type: "string", description: "What was being attempted" },
          error: { type: "string", description: "The error encountered" },
          context: { type: "string", description: "Additional context" },
          attempted_steps: {
            type: "array",
            items: { type: "string" },
            description: "Steps already attempted"
          }
        },
        required: ["agent", "tool", "error"]
      }
    },
    {
      name: "submit_success_trace",
      description: "Log a redacted success trace after resolving an issue. Helps track which fixes work.",
      inputSchema: {
        type: "object",
        properties: {
          agent: { type: "string", description: "Agent identifier" },
          tool: { type: "string", description: "Tool that was fixed" },
          task: { type: "string", description: "What was being attempted" },
          solution_summary: {
            type: "string",
            description: "What resolved the issue"
          },
          related_fix_id: {
            type: "string",
            description: "ID of the fix card that helped, if any"
          }
        },
        required: ["agent", "tool", "solution_summary"]
      }
    },
    {
      name: "redact_text",
      description: "Redact secrets (API keys, tokens, emails, connection strings) from text. Use before logging or sharing error output.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text to redact" }
        },
        required: ["text"]
      }
    },
    {
      name: "sync_cards",
      description: "Sync latest fix cards from the AgentCommunity cloud knowledge base to local cache. Returns count of updated cards.",
      inputSchema: {
        type: "object",
        properties: {},
        required: []
      }
    },
    {
      name: "submit_fix_card",
      description: "Create a new fix card and save it locally. Optionally submits to the cloud knowledge base if configured.",
      inputSchema: {
        type: "object",
        properties: {
          tool: { type: "string", description: "Tool name (lowercase)" },
          error_signature: {
            type: "string",
            description: "Stable error code or phrase (max 80 chars, no timestamps/UUIDs)"
          },
          context_key: {
            type: "string",
            description: "Differentiator when multiple cards share the same error_signature"
          },
          title: { type: "string", description: "One-line summary (max 80 chars)" },
          symptom: { type: "string", description: "What the agent observes (max 2 sentences)" },
          root_cause: { type: "string", description: "Why the error happens" },
          fix_steps: {
            type: "array",
            items: { type: "string" },
            description: "Ordered fix steps"
          },
          agent_instruction: {
            type: "string",
            description: "Concise instruction for the agent to follow"
          },
          applies_when: {
            type: "array",
            items: { type: "string" },
            description: "Preconditions that must be true"
          },
          not_this_if: {
            type: "array",
            items: { type: "string" },
            description: "Fast disqualifiers"
          },
          safety_notes: {
            type: "array",
            items: { type: "string" },
            description: "Safety warnings"
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Search tags"
          }
        },
        required: [
          "tool",
          "error_signature",
          "title",
          "symptom",
          "root_cause",
          "fix_steps",
          "agent_instruction"
        ]
      }
    }
  ]
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  switch (name) {
    case "search_known_fix": {
      const results = searchKnownFix({
        tool: args?.tool,
        error: args?.error,
        task: args?.task,
        context: args?.context
      });
      return {
        content: [
          { type: "text", text: JSON.stringify({ matches: results }, null, 2) }
        ]
      };
    }
    case "submit_failure_trace": {
      const traceId = appendTrace({
        agent: args?.agent ?? "unknown",
        tool: args?.tool ?? "unknown",
        task: args?.task,
        error: args?.error ?? "",
        context: args?.context,
        attempted_steps: args?.attempted_steps ?? [],
        matched_fix_id: null
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ trace_id: traceId, saved: true })
          }
        ]
      };
    }
    case "submit_success_trace": {
      const traceId = appendTrace({
        agent: args?.agent ?? "unknown",
        tool: args?.tool ?? "unknown",
        task: args?.task,
        solution_summary: args?.solution_summary ?? "",
        related_fix_id: args?.related_fix_id
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ trace_id: traceId, saved: true })
          }
        ]
      };
    }
    case "redact_text": {
      const result = redactText(args?.text ?? "");
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
    case "sync_cards": {
      const result = await syncFromSupabase();
      return {
        content: [
          { type: "text", text: JSON.stringify(result, null, 2) }
        ]
      };
    }
    case "submit_fix_card": {
      const cardData = {
        tool: args?.tool,
        error_signature: args?.error_signature,
        context_key: args?.context_key ?? "",
        title: args?.title,
        symptom: args?.symptom,
        root_cause: args?.root_cause ?? "",
        fix_steps: args?.fix_steps ?? [],
        agent_instruction: args?.agent_instruction,
        applies_when: args?.applies_when ?? [],
        not_this_if: args?.not_this_if ?? [],
        safety_notes: args?.safety_notes ?? [],
        tags: args?.tags ?? []
      };
      const validation = validateCard(cardData);
      if (!validation.valid) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "Card validation failed",
                validation_errors: validation.errors,
                warnings: validation.warnings
              })
            }
          ],
          isError: true
        };
      }
      const fullCard = {
        ...cardData,
        id: generateCardId(cardData.tool, cardData.error_signature, cardData.context_key),
        fix_type: "workaround",
        severity: "blocks_execution",
        confidence: 0.5,
        quality_score: validation.quality_score,
        source_type: "agent-discovered",
        verified_on: "",
        created: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
        version_notes: []
      };
      saveCard(fullCard);
      let submissionId = null;
      if (isSupabaseEnabled()) {
        try {
          submissionId = await submitCard(cardData);
        } catch {
        }
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              card_id: fullCard.id,
              saved_locally: true,
              submitted_to_cloud: submissionId !== null,
              submission_id: submissionId,
              quality_score: validation.quality_score,
              warnings: validation.warnings
            })
          }
        ]
      };
    }
    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true
      };
  }
});
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const jitter = Math.random() * 3e4;
  setTimeout(() => syncFromSupabase().catch(() => {
  }), jitter);
}
main().catch(console.error);
