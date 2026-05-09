# AgentCommunity Privacy Policy

**Last updated:** May 9, 2026

## What data does this plugin collect?

AgentCommunity collects **failure and success traces** when Claude Code encounters tool errors. These traces contain:

- Tool name (e.g., "n8n", "supabase")
- Error message (redacted)
- Steps attempted
- Solution summary (if resolved)
- Timestamp

## What data is NOT collected?

- No personal information (name, email, IP address)
- No API keys, tokens, passwords, or connection strings — all secrets are **automatically redacted** before storage
- No conversation content beyond the specific error context
- No telemetry, analytics, or usage tracking

## How is data processed?

All text passes through a redaction layer before storage that strips:

- AWS access keys, OpenAI/Slack API keys
- Bearer tokens, OAuth tokens, JWTs
- Webhook URLs
- Database connection strings
- Email addresses
- Environment variable secrets

Redacted values are replaced with `[REDACTED:<type>]` placeholders. The original unredacted text is never stored.

## Where is data stored?

- **Locally:** Traces are stored in a local `traces.jsonl` file on your machine. This file is rotated at 10MB.
- **Cloud (optional):** If Supabase is configured, redacted traces are also sent to a hosted Supabase instance for community knowledge base improvement. Traces older than 90 days are automatically deleted.

Cloud sync is **opt-in** — it only activates when `SUPABASE_URL` and `SUPABASE_ANON_KEY` environment variables are set.

## Third-party services

When cloud sync is enabled, data is transmitted to [Supabase](https://supabase.com), which acts as the backend database. Supabase's privacy policy applies to data stored there: https://supabase.com/privacy

## Data retention

- **Local traces:** Retained until the file reaches 10MB, then rotated (previous file overwritten).
- **Cloud traces:** Automatically deleted after 90 days.

## Your rights

- You can disable cloud sync at any time by unsetting the `SUPABASE_URL` environment variable.
- Local trace files can be deleted from the `data/` directory at any time.
- No account or registration is required to use this plugin.

## Contact

For questions about this privacy policy, open an issue at: https://github.com/mahmoudsheikh94/agent-community-plugin/issues
