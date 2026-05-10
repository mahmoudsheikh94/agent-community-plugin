# AgentCommunity Plugin for Claude Code

Auto-recover from known tool, API, and workflow failures. When Claude Code hits an error, this plugin searches a local knowledge base of 1,964 community-sourced fix cards and injects a concise fix hint — no cloud calls, no tokens wasted on retries.

## Install

```bash
claude --plugin-dir /path/to/agent-community-plugin
```

This registers the MCP server, hooks, and the `/agent-community:debugger` skill.

## How it works

```
Tool fails → PostToolUseFailure hook → search fix cards → inject fix hint → Claude applies fix
```

1. A tool fails — the **PostToolUseFailure hook** fires automatically
2. The plugin searches the local knowledge base for a matching error signature
3. If found, it injects the fix steps, root cause, and safety notes into Claude's context
4. Claude follows the fix instead of retrying blindly
5. All traces are **redacted** (API keys, tokens, emails, connection strings stripped) before storage
6. If Claude discovers a novel fix, it can **submit a new fix card** back to the knowledge base

## What a fix hint looks like

When Claude hits an error like `DOMMatrix is not defined` while working with n8n:

```
Fix: DOMMatrix error in Extract from File (PDF) Node

Root cause: The upgraded pdfjs-dist dependency in n8n v1.98.0 requires
browser-native APIs not available in server-side environments like Docker.

Steps:
  1. Downgrade n8n to version 1.97.1
  2. For Docker: use image tag n8n.io/n8nio/n8n:1.97.1
  3. Test the Extract from File (PDF) node again

Safety: Downgrading may re-introduce other bugs fixed in later versions.
```

## What it provides

- **MCP Server** — 6 tools: `search_known_fix`, `submit_failure_trace`, `submit_success_trace`, `redact_text`, `sync_cards`, `submit_fix_card`
- **PostToolUseFailure hook** — automatically searches for known fixes when a tool fails
- **UserPromptSubmit hook** — reminds Claude about AgentCommunity when working with supported tools
- **Debugger skill** — `/agent-community:debugger` teaches Claude when and how to use AgentCommunity

## Knowledge base

| Tool | Fix Cards | Source |
|------|-----------|--------|
| n8n | 1,667 | community.n8n.io forum threads |
| WeWeb | 297 | community.weweb.io forum threads |

The plugin also matches errors for: HubSpot, Airtable, Supabase, Slack, Stripe, Shopify, Lovable, Replit, and MCP servers.

## Privacy

- **Local-first** — all search and storage happens on your machine
- **No cloud calls** — the plugin never phones home
- **Automatic redaction** — API keys, tokens, emails, database URIs, and webhook URLs are stripped before any text is stored
- **No telemetry** — zero usage tracking

## Quality

Validated on a random sample of 30 cards:
- **93% accuracy** — fixes are correct and actionable
- **100% search hit rate** — real error messages return relevant cards

## Contributing fix cards

Source repo: [agents-community](https://github.com/mahmoudsheikh94/agents-community)

Fix cards can also be submitted directly through Claude Code using the `submit_fix_card` MCP tool after discovering a novel fix.
