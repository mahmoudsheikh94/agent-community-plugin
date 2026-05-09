# AgentCommunity Plugin for Claude Code

Auto-recover from known tool, API, and workflow failures. When Claude Code hits an error, this plugin searches a local knowledge base of fix cards and injects a concise fix hint — no cloud calls, no tokens wasted on retries.

## What it provides

- **MCP Server** — 6 tools: `search_known_fix`, `submit_failure_trace`, `submit_success_trace`, `redact_text`, `sync_cards`, `submit_fix_card`
- **PostToolUseFailure hook** — automatically searches for known fixes when a tool fails
- **UserPromptSubmit hook** — reminds Claude about AgentCommunity when working with supported tools
- **Debugger skill** — `/agent-community:debugger` teaches Claude when and how to use AgentCommunity

## Supported tools

n8n, HubSpot, Airtable, Supabase, Slack, Stripe, Shopify, Lovable, Replit, WeWeb, MCP servers.

## How it works

1. A tool fails → the PostToolUseFailure hook fires
2. The plugin searches the local fix card knowledge base for a matching error
3. If found, it injects the fix steps back into Claude's context
4. Claude follows the fix instead of retrying blindly
5. All traces are redacted (API keys, tokens, emails, connection strings stripped) before storage

## Contributing fix cards

Source repo: [agents-community](https://github.com/mahmoudsheikh94/agents-community)
