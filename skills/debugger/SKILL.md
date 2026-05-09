---
name: debugger
description: Search known fixes and log failure/success traces via AgentCommunity when tool, API, or workflow errors occur
when_to_use: When encountering tool errors, API failures, workflow issues, or MCP server problems with n8n, HubSpot, Airtable, Supabase, Slack, Stripe, Shopify, Lovable, Replit, or WeWeb
user-invocable: true
---

# AgentCommunity Debugger

When you encounter a tool failure, API error, or workflow issue:

1. **Search before retrying.** Before retrying the same failed action more than once, use the `search_known_fix` MCP tool with the error message and tool name. It may have a known fix.

2. **Follow the fix card.** If a match is found with confidence >= 30%, follow the `agent_instruction` and `fix_steps` from the result. These are verified solutions.

3. **Log failures.** When you hit an error that has no known fix, use `submit_failure_trace` to log a redacted trace. This helps improve the knowledge base over time.

4. **Log successes.** When a fix works, use `submit_success_trace` with the `related_fix_id` to track effectiveness.

5. **Redact first.** If you need to log any output that might contain secrets, use `redact_text` first. Never submit API keys, tokens, passwords, or connection strings.

6. **Be concise.** Prefer operational fixes over generic explanations. The goal is to get the user unblocked, not to teach theory.
