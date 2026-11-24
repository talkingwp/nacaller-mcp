#!/usr/bin/env node
// NaCaller MCP server (stdio). Config: NACALLER_API_KEY (and/or NACALLER_OTP_KEY),
// optional NACALLER_API_BASE, NACALLER_MAX_CONTACTS (default 100).
// Logs go to stderr only (stdout is the protocol) and never contain a key.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema,
  ListPromptsRequestSchema, GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createClient, errorResult } from './client.js';
import { createTools } from './tools.js';
import { GUIDE } from './docs.js';

const GUIDE_URI = 'nacaller://docs/integration-guide';

export function buildServer({ env = process.env, fetchImpl } = {}) {
  const client = createClient({ env, fetchImpl });
  const cap = parseInt(env.NACALLER_MAX_CONTACTS, 10);
  const tools = createTools(client, { maxContacts: Number.isFinite(cap) && cap > 0 ? cap : 100, env });

  const server = new Server({ name: 'nacaller', version: '0.2.0' }, {
    capabilities: { tools: {}, resources: {}, prompts: {} },
    instructions: 'NaCaller: Indian voice OTP, missed-call verification and AI calling. Read nacaller_docs("overview") first. Never ask the human to paste an API key into chat; it is configured in the server environment. Confirm with the human before any real call or campaign. Agents and keypad flows you save are DRAFTS that only a person can activate in the dashboard. Money: billing_topup_link only returns a link for the human; never try to pay.',
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.list() }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try { return await tools.call(req.params.name, req.params.arguments); }
    catch (e) { return errorResult(e); }
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [{ uri: GUIDE_URI, name: 'NaCaller integration guide', mimeType: 'text/markdown', description: 'What the NaCaller API does today, two-call OTP integration, webhook signature and error codes.' }],
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    if (req.params.uri !== GUIDE_URI) throw new Error('Unknown resource');
    return { contents: [{ uri: GUIDE_URI, mimeType: 'text/markdown', text: GUIDE }] };
  });
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [{ name: 'integrate_phone_verification', description: 'Add NaCaller phone verification (Miss OTP with Voice OTP fallback) to the current project.', arguments: [{ name: 'framework', description: 'nextjs, express, django, laravel or html', required: false }] }],
  }));
  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    if (req.params.name !== 'integrate_phone_verification') throw new Error('Unknown prompt');
    const fw = req.params.arguments?.framework || 'the framework this project already uses';
    return { messages: [{ role: 'user', content: { type: 'text', text: `Add NaCaller phone verification to this project in ${fw}.\nFirst call nacaller_docs with topic "overview", then "otp", then the framework topic if one exists.\nRules: the key (nck_live_...) goes only in a server-side environment variable, never client code or logs; the browser talks only to our own server routes; mark a phone verified only when the NaCaller status is "verified"; test with the owner's own phone number; do not invent endpoints that nacaller_docs does not list.\n\n${GUIDE}` } }] };
  });
  return { server, client };
}

/** A harmless read that proves a key works. Prints no key. Returns true when every configured key is accepted. */
export async function selftest({ env = process.env, fetchImpl, log = console.error } = {}) {
  const { client } = buildServer({ env, fetchImpl });
  let ok = true, any = false;
  if (client.keys.v1) {
    any = true;
    try { const r = await client.request('v1', 'GET', '/agents', { query: { limit: 1 } }); log(`developer key (${client.testMode ? 'nc_test_, simulated' : 'nc_live_'}): OK, ${(r.data || []).length ? 'agents found' : 'no agents yet'}`); }
    catch (e) { ok = false; log(`developer key: FAILED (${e.code}: ${e.message})`); }
  }
  if (client.keys.otp) {
    any = true;
    try { await client.request('otp', 'GET', '/status/selftest'); log('verification key (nck_): OK'); }
    catch (e) {
      // An unknown id means the key itself was accepted: nothing is created or sent.
      if (e.status === 404) log('verification key (nck_): OK');
      else { ok = false; log(`verification key (nck_): FAILED (${e.code}: ${e.message})`); }
    }
  }
  if (!any) { log('No usable key. Set NACALLER_API_KEY (nc_live_..., nc_test_... or nck_live_...) in the environment.'); return false; }
  log(`base: ${client.base}`);
  return ok;
}

const isMain = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) {
  if (process.argv.includes('--selftest')) {
    process.exit((await selftest()) ? 0 : 1);
  }
  const { server, client } = buildServer();
  if (!client.keys.v1 && !client.keys.otp) console.error('nacaller-mcp: no key found. Set NACALLER_API_KEY; tools will return a setup hint until then.');
  await server.connect(new StdioServerTransport());
}
