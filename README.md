<p align="center"><a href="https://nacaller.com"><img src="assets/banner.png" alt="NaCaller MCP server: add phone verification with one prompt" width="100%"></a></p>

<p align="center"><a href="https://nacaller.com/docs/ai-agents">Docs</a> · <a href="https://nacaller.com/openapi.json">OpenAPI</a> · <a href="https://nacaller.com/missed-call-otp">Miss OTP</a> · <a href="https://nacaller.com/voice-otp">Voice OTP</a> · <a href="LICENSE">MIT</a></p>

# NaCaller MCP server

Lets Claude Code, Codex, Cursor, Antigravity and other MCP-capable coding agents use NaCaller with your API key: send a Voice OTP, start a missed-call verification, place AI calls, run campaigns and read results.

## Keys

NaCaller has two key types today. Both are server secrets and go in environment variables only; this server never accepts a key as a tool argument and never prints one.

| Key | Looks like | Created in | Used by |
| --- | --- | --- | --- |
| Developer key | `nc_live_...` | Dashboard, Settings, Developers | `calls_*`, `agents_list`, `campaigns_*` |
| Verification key | `nck_live_...` | Dashboard, Verify (one per site) | `otp_*` |

Set whichever you have in `NACALLER_API_KEY`. To use both, put the second in `NACALLER_OTP_KEY`. A tool whose key is missing returns a message saying which variable to set.

Optional: `NACALLER_API_BASE` (default `https://api.nacaller.com`), `NACALLER_MAX_CONTACTS` (campaign hard cap, default `100`).

## Connect your agent

Replace `nc_live_xxx` with your key. Never commit it.

**Claude Code**

```bash
claude mcp add nacaller -e NACALLER_API_KEY=nc_live_xxx -- npx -y github:talkingwp/nacaller-mcp
```

**Cursor** (`.cursor/mcp.json`)

```json
{ "mcpServers": { "nacaller": { "command": "npx", "args": ["-y", "github:talkingwp/nacaller-mcp"], "env": { "NACALLER_API_KEY": "nc_live_xxx" } } } }
```

**Codex** (`~/.codex/config.toml`)

```toml
[mcp_servers.nacaller]
command = "npx"
args = ["-y", "github:talkingwp/nacaller-mcp"]
env = { NACALLER_API_KEY = "nc_live_xxx" }
```

**Antigravity** (MCP config JSON, same shape as Cursor)

```json
{ "mcpServers": { "nacaller": { "command": "npx", "args": ["-y", "github:talkingwp/nacaller-mcp"], "env": { "NACALLER_API_KEY": "nc_live_xxx" } } } }
```

Check the key works without involving an agent (a harmless read, nothing is sent or called):

```bash
NACALLER_API_KEY=nc_live_xxx npx -y github:talkingwp/nacaller-mcp --selftest
```

## Tools

| Tool | Does | Key |
| --- | --- | --- |
| `otp_send_voice` | Real call that reads a 6-digit code in one of 10 languages (te hi en ta kn ml mr bn or gu) | verification |
| `otp_check` | Checks the code the person heard | verification |
| `otp_missed_call_start` | Starts a missed-call verification, returns the number to ring | verification |
| `otp_status` | pending / verified / expired | verification |
| `calls_place` | Places one real AI call | developer |
| `calls_list`, `calls_get` | Recent calls; one call with transcript and signed recording link | developer |
| `agents_list` | Your agents (ids for the tools above) | developer |
| `campaigns_create` | Two-step: dry run plus confirmation token, then create. Capped by `NACALLER_MAX_CONTACTS` | developer |
| `campaigns_results` | Totals and one row per contact | developer |
| `nacaller_docs` | Bundled guidance and snippets: overview, otp, webhooks, calls, campaigns, errors, nextjs, express, django, laravel, html | none |

Also exposed: resource `nacaller://docs/integration-guide` and prompt `integrate_phone_verification`.

Deliberately not included: anything that moves money, changes billing or the account, creates or deletes keys, or reads other accounts.

### Campaign confirm step

`campaigns_create` without `confirmation_token` dials nothing. It returns the de-duplicated contact count, agent, calling hours and a token. Only a second call with identical arguments plus that token creates the campaign. Tokens are bound to the arguments, work once, expire in 10 minutes and die with the process. The API gives no cost estimate, so none is invented: calls are billed per connected minute from the owner's plan and wallet.

## Safety

- OTP and call tools with live keys place real phone calls and spend real credits or minutes. Prefer an `nc_test_` key (Settings, Developers, Test key): the same tools run against a simulation, nothing is called or charged, and the OTP code is always 123456. Give agents the narrowest scope (OTP only, Calling, Read only).
- Calls go out 9 am to 9 pm India time only; do-not-call numbers are refused by NaCaller.
- Each key has a daily call limit (default 200) and 300 requests a minute.

## Develop

```bash
npm install
npm test          # real server over stdio against a local mock of the API
```

Not available in NaCaller yet (so not in this server): creating or editing agents and IVR flows, balance, recharge links, an SDK.
