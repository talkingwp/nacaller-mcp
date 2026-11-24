// Tool definitions. Deliberately absent: anything that moves money, changes
// billing or the account, activates an agent, deletes anything, creates or deletes keys, or reads other tenants.
// billing_topup_link only fetches a LINK for a person to open; it charges nothing.
import crypto from 'node:crypto';
import { ApiError } from './client.js';
import { LANGUAGES, TOPICS, TOPIC_NAMES } from './docs.js';

const text = (o) => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o, null, 2) }] });
const last10 = (p) => String(p || '').replace(/\D/g, '').slice(-10);
const bad = (m) => new ApiError(0, 'invalid_request', m);
const PHONE = { type: 'string', description: 'Indian mobile number, 10 digits (e.g. 9876543210) or +91 form.' };
const RO = { readOnlyHint: true, openWorldHint: true };
const LANGS = { type: 'array', minItems: 1, maxItems: 10, items: { type: 'string' }, description: 'Language names or codes: English, Hindi, Telugu, Tamil, Kannada, Malayalam, Bengali, Marathi, Gujarati (en hi te ta kn ml bn mr gu).' };
const AGENT_PROPS = {
  name: { type: 'string', description: 'Max 80 chars.' }, role: { type: 'string', description: 'Short job title, e.g. Receptionist. Max 80 chars.' },
  prompt: { type: 'string', description: 'Who the agent is and how it behaves on the call. Max 12000 chars. No unfilled [placeholders].' },
  greeting: { type: 'string', description: 'Opening line, max 500 chars.' }, personality: { type: 'string', description: 'Tone and speech style, max 1000 chars.' },
  caller_name: { type: 'string', description: 'The name the agent gives, max 40 chars.' }, gender: { type: 'string', enum: ['feminine', 'masculine'] },
  knowledge_base: { type: 'string', description: 'Facts the agent may quote, max 20000 chars.' }, calling_rules: { type: 'string', description: 'How it must behave, max 4000 chars.' },
  booking_url: { type: 'string', description: 'https only.' }, brochure_url: { type: 'string', description: 'https only.' }, maps_url: { type: 'string', description: 'https only.' },
  languages: LANGS, transfer_number: { type: 'string', description: 'An Indian mobile (10 digits) a hot lead may be transferred to. Only use a number the human gave you.' },
  transfer_whisper: { type: 'string', description: 'Max 200 chars.' },
};
const TEXT = { description: 'Text, or a map of language code to text, e.g. {"en":"Hello","hi":"Namaste"}.', oneOf: [{ type: 'string' }, { type: 'object', additionalProperties: { type: 'string' } }] };
const FLOW = { type: 'object', additionalProperties: false, required: ['steps'], description: 'A keypad call. Steps play in order (max 12): there is no branching, no transfer and no loops. Key 9 always means stop these calls.', properties: {
  sponsor: TEXT, opt_out: { type: 'boolean', description: 'Offer "press 9 to stop calls". Default true; leave it on.' }, closing: TEXT,
  steps: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'object', required: ['type', 'text'], additionalProperties: false, properties: {
    id: { type: 'string', description: 'lowercase letters, digits, underscore. Optional.' }, type: { type: 'string', enum: ['say', 'ask'] }, text: TEXT, title: TEXT,
    rotate: { type: 'boolean' }, menu_in_recording: { type: 'boolean' },
    options: { type: 'array', minItems: 2, maxItems: 8, description: 'Only for type "ask".', items: { type: 'object', required: ['key', 'label'], additionalProperties: false, properties: {
      key: { type: 'string', description: 'lowercase letters, digits, underscore; unique in the question.' }, label: TEXT, say: TEXT,
      verdict: { type: 'string', enum: ['interested', 'callback', 'not_interested', 'wrong_person', 'do_not_call'] }, fixed: { type: 'boolean' } } } } } } } } };
const TOKEN = { type: 'string', description: 'From the step 1 preview. Never invent one; only set it after the human approved the preview.' };

export function createTools(client, { maxContacts = 100, env = process.env } = {}) {
  const secret = crypto.randomBytes(32);          // lives only in this process: tokens die with it
  const used = new Set();
  const TOKEN_TTL_MS = 10 * 60 * 1000;
  const sign = (digest, exp) => crypto.createHmac('sha256', secret).update(`${digest}|${exp}`).digest('base64url');
  const digestOf = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
  const v1 = (m, p, o) => client.request('v1', m, p, o);
  const otp = (m, p, o) => client.request('otp', m, p, o);

  /* The confirm step for anything that saves an agent or a flow: the same idea as campaigns_create. Without a token
     NOTHING is sent to the API (the preview reads at most); with one, it must match these exact arguments. */
  const omitToken = ({ confirmation_token, ...rest }) => rest;
  const tokenFor = (digest) => { const e = Date.now() + TOKEN_TTL_MS; return `${e}.${sign(digest, e)}`; };
  async function gated(label, args, preview, commit, after) {
    const payload = omitToken(args);
    const digest = digestOf({ label, payload });
    if (!args.confirmation_token) {
      return { saved: false, preview: await preview(), confirmation_token: tokenFor(digest), next_step: `Show this preview to the human and ask for an explicit yes. Only then call ${label} again with the same arguments plus this confirmation_token (valid 10 minutes, works once).` };
    }
    const [expS, sig] = String(args.confirmation_token).split('.');
    const exp = Number(expS);
    const good = sig && Number.isFinite(exp) && (() => { const e = Buffer.from(sign(digest, exp)), g = Buffer.from(sig); return e.length === g.length && crypto.timingSafeEqual(e, g); })();
    if (!good) throw bad('confirmation_token does not match these arguments (or is not from this server). Call again without a token and show the human the new preview.');
    if (Date.now() > exp) throw bad('confirmation_token expired. Call again without a token and re-confirm with the human.');
    if (used.has(args.confirmation_token)) throw bad('confirmation_token was already used. Nothing is saved twice from one confirmation; start over if you really want another.');
    used.add(args.confirmation_token);
    return { saved: true, result: await commit(payload), next_step: after };
  }

  /* Does this server know POST /campaigns?dryRun=true? An older server would IGNORE the flag and create a real
     campaign, so it is never sent blind: one throwaway probe whose answer tells the two apart without creating
     anything. The probe has an invalid phone and a made-up agent. New server: 404 agent_not_found (the
     agent check comes first in dry-run mode). Old server: 400 on the phone before it looks at the agent. */
  let dryRunSupported = null;
  async function hasDryRun() {
    if (dryRunSupported !== null) return dryRunSupported;
    try {
      await v1('POST', '/campaigns', { query: { dryRun: 'true' }, body: { name: 'probe', agent_id: 'nacaller-mcp-probe', contacts: [{ phone: 'x' }] } });
      dryRunSupported = false;          // it answered 2xx: whatever this is, do not trust it
    } catch (e) {
      if (e.status === 404 && e.code === 'agent_not_found') dryRunSupported = true;
      else if (e.status === 400) dryRunSupported = false;
      else throw e;                     // 401/403/429/network: tell the human, do not guess
    }
    return dryRunSupported;
  }

  const tools = [
    {
      name: 'otp_send_voice',
      description: 'Send a Voice OTP: NaCaller phones the number and reads a 6-digit code aloud in the chosen language. REAL phone call that spends one voice credit (25 verifications and 5 voice calls are free per account, once). Only use a number the human gave you or their own; for testing use the human\'s own phone. Returns an id: after the person reads out the code, call otp_check. The code is never returned to you. Needs a verification key (nck_live_) or a developer key with the otp scope. With a test key (nc_test_) nothing is called and the code is always 123456 (the response says so).',
      inputSchema: { type: 'object', required: ['to', 'language'], additionalProperties: false, properties: {
        to: PHONE,
        language: { type: 'string', enum: LANGUAGES, description: 'Language the code is read in: te Telugu, hi Hindi, en English, ta Tamil, kn Kannada, ml Malayalam, mr Marathi, bn Bengali, or Odia, gu Gujarati.' },
        reference: { type: 'string', description: 'Optional: your own user id, echoed back in status and webhooks. Max 120 chars.' } } },
      annotations: { openWorldHint: true, destructiveHint: false },
      run: (a) => otp('POST', '/start', { body: { phone: a.to, method: 'voice', language: a.language, ...(a.reference && { reference: a.reference }) } }),
    },
    {
      name: 'otp_check',
      description: 'Check the 6-digit code a person read out from a Voice OTP call. Takes the id from otp_send_voice. Returns { verified: true } on success; a wrong code returns attemptsLeft (5 attempts, then the request expires after which you must send again). 410 means expired. Needs a verification key.',
      inputSchema: { type: 'object', required: ['id', 'code'], additionalProperties: false, properties: {
        id: { type: 'string', description: 'The id returned by otp_send_voice.' },
        code: { type: 'string', description: 'The 6-digit code the person typed.' } } },
      annotations: { openWorldHint: true },
      run: (a) => otp('POST', '/check', { body: { id: a.id, code: a.code } }),
    },
    {
      name: 'otp_missed_call_start',
      description: 'Start a Miss OTP (missed-call) verification. Nothing is sent to the phone: the user gives a missed call to the returned callNumber from their own number and is verified, usually within seconds. Spends one verification credit only when it verifies. Returns requestId; poll otp_status. Needs a verification key (nck_live_).',
      inputSchema: { type: 'object', required: ['phone'], additionalProperties: false, properties: {
        phone: PHONE, reference: { type: 'string', description: 'Optional: your own user id. Max 120 chars.' } } },
      annotations: { openWorldHint: true, destructiveHint: false },
      run: (a) => otp('POST', '/start', { body: { phone: a.phone, ...(a.reference && { reference: a.reference }) } }),
    },
    {
      name: 'otp_status',
      description: 'Read the status of a verification (missed call or voice) by its id/requestId: pending, verified or expired. Poll every 2 to 3 seconds at most. Needs a verification key.',
      inputSchema: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } },
      annotations: RO,
      run: (a) => otp('GET', `/status/${encodeURIComponent(a.id)}`),
    },
    {
      name: 'calls_place',
      description: 'Place ONE real AI phone call with one of your agents. It dials a real person and spends the key owner\'s calling minutes, so confirm the number and agent with the human first and prefer their own number for tests. Calls only go out 9 am to 9 pm India time; do-not-call numbers are refused. Get agent_id from agents_list; a draft agent is refused with agent_draft. Needs a developer key (nc_live_) with the calls scope. With a test key (nc_test_) nothing is dialled and the result is simulated (test: true).',
      inputSchema: { type: 'object', required: ['agent_id', 'phone'], additionalProperties: false, properties: {
        agent_id: { type: 'string' }, phone: PHONE, name: { type: 'string', description: 'Contact name, max 80 chars.' },
        variables: { type: 'object', additionalProperties: { type: ['string', 'number'] }, description: 'Merge fields for the agent script, e.g. {"fee_amount":"4500"}. Max 20; names are lowercase letters, digits, underscore.' },
        language: { type: 'string', description: 'Optional language code or name to call in.' } } },
      annotations: { openWorldHint: true, destructiveHint: false },
      run: (a) => v1('POST', '/calls', { body: a }),
    },
    {
      name: 'calls_list',
      description: 'List recent calls on the account, newest first, with outcome, summary and duration. Filter by status, agent_id or campaign_id. Cursor pagination: pass next_cursor back as cursor while has_more is true. Needs a developer key.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {
        status: { type: 'string' }, agent_id: { type: 'string' }, campaign_id: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100 }, cursor: { type: 'string' } } },
      annotations: RO,
      run: (a) => v1('GET', '/calls', { query: a }),
    },
    {
      name: 'calls_get',
      description: 'Get one call in full: outcome, summary, sentiment, captured fields, transcript and a signed recording link valid for 10 minutes (call again for a fresh one). Needs a developer key.',
      inputSchema: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } },
      annotations: RO,
      run: (a) => v1('GET', `/calls/${encodeURIComponent(a.id)}`),
    },
    {
      name: 'agents_list',
      description: 'List the AI agents on the account (id, name, language, status: active, paused or draft). Use active ids in calls_place and campaigns_create: a draft agent is refused (agent_draft) until a person activates it in the dashboard. To read an agent in full use agents_get; to save one, agents_create or agents_update. Needs a developer key (calls, campaigns, read or agents scope).',
      inputSchema: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 100 }, cursor: { type: 'string' } } },
      annotations: RO,
      run: (a) => v1('GET', '/agents', { query: a }),
    },
    {
      name: 'agents_get',
      description: 'Read ONE agent in full: prompt, greeting, knowledge, languages, transfer number, links, and status (active, paused or draft). A draft cannot call until a person activates it. Needs a developer key with the agents scope (the plain agents_list works with a calls or read key).',
      inputSchema: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } },
      annotations: RO,
      run: (a) => v1('GET', `/agents/${encodeURIComponent(a.id)}`),
    },
    {
      name: 'agents_create',
      description: 'Save a NEW agent as a DRAFT. A draft cannot place calls, run campaigns or answer a phone number: a PERSON must open the NaCaller dashboard, Agents page, listen to it and press Activate. You cannot activate it and there is no delete. TWO STEPS, like campaigns_create: first call with the fields and no confirmation_token returns a preview and a token and saves NOTHING; show the human the preview (name, role, prompt, greeting, languages, any transfer number) and ask for an explicit yes; only then call again with identical arguments plus the token. After saving, tell the human the agent is waiting for their Activate. Same rules as the dashboard (an Indian mobile for transfers, https links only, no unfilled [placeholders]); it counts against the plan\'s agent limit (agent_limit_reached). Needs a developer key with the agents scope. With a test key (nc_test_) nothing is stored.',
      inputSchema: { type: 'object', required: ['name', 'role', 'prompt'], additionalProperties: false, properties: { ...AGENT_PROPS, confirmation_token: TOKEN } },
      annotations: { openWorldHint: true, destructiveHint: false },
      run: (a) => gated('agents_create', a, async () => ({ will_save_as: 'draft', agent: omitToken(a) }), (p) => v1('POST', '/agents', { body: p }), 'The agent is saved as a DRAFT. Tell the human to open Agents in the NaCaller dashboard, listen to it and press Activate. You cannot activate it.'),
    },
    {
      name: 'agents_update',
      description: 'Change fields of an existing agent. The agent goes back to DRAFT: if it was live it STOPS taking calls, campaign dials and inbound calls until a person presses Activate in the dashboard, so tell the human that before you do it. Only the fields you send change. TWO STEPS: the first call (no confirmation_token) saves nothing and returns what will change, the agent\'s current status and a token; show it to the human and wait for an explicit yes; then call again with identical arguments plus the token. You cannot activate it and there is no delete. Needs a developer key with the agents scope. With a test key (nc_test_) nothing is stored.',
      inputSchema: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' }, ...AGENT_PROPS, confirmation_token: TOKEN } },
      annotations: { openWorldHint: true, destructiveHint: true, idempotentHint: true },
      run: (a) => gated('agents_update', a, async () => {
        const cur = await v1('GET', `/agents/${encodeURIComponent(a.id)}`);
        const { id, ...changes } = omitToken(a);
        return { agent: { id: cur.id, name: cur.name, current_status: cur.status }, will_change: changes, will_save_as: 'draft', warning: cur.status === 'active' ? 'This agent is LIVE. Saving puts it back to draft: it stops taking calls, campaign dials and inbound calls until a person presses Activate in the dashboard.' : undefined };
      }, (p) => { const { id, ...body } = p; return v1('PATCH', `/agents/${encodeURIComponent(id)}`, { body }); }, 'The agent is now a DRAFT. Tell the human to press Activate on the Agents page. You cannot activate it.'),
    },
    {
      name: 'ivr_list',
      description: 'List keypad (IVR) flows: scripted calls that play lines and record which key the person pressed (a poll, a survey or a one-way broadcast). A flow\'s id is the agent_id used by calls_place and campaigns_create. Needs a developer key with the agents scope.',
      inputSchema: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 100 }, cursor: { type: 'string' } } },
      annotations: RO,
      run: (a) => v1('GET', '/ivr-flows', { query: a }),
    },
    {
      name: 'ivr_get',
      description: 'Read one keypad (IVR) flow: its steps, options and status (draft until a person activates it). Needs a developer key with the agents scope.',
      inputSchema: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' } } },
      annotations: RO,
      run: (a) => v1('GET', `/ivr-flows/${encodeURIComponent(a.id)}`),
    },
    {
      name: 'ivr_create',
      description: 'Save a NEW keypad (IVR) flow as a DRAFT: a scripted call with up to 12 steps, each a line to say or a question with 2 to 8 options (the person presses a key). Steps play in order: no branching, no transfers. It is strictly validated and refused with the reason if anything is off. A draft cannot call until a PERSON presses Activate in the NaCaller dashboard; you cannot, and there is no delete. TWO STEPS: first call (no confirmation_token) saves nothing and returns the flow and a token; show the human every line that will be spoken and get an explicit yes; then call again with identical arguments plus the token. Recorded audio is added in the dashboard. Counts against the plan\'s agent limit. Needs a developer key with the agents scope. With a test key (nc_test_) nothing is stored.',
      inputSchema: { type: 'object', required: ['name', 'flow'], additionalProperties: false, properties: { name: { type: 'string', description: 'Max 80 chars.' }, languages: LANGS, flow: FLOW, confirmation_token: TOKEN } },
      annotations: { openWorldHint: true, destructiveHint: false },
      run: (a) => gated('ivr_create', a, async () => ({ will_save_as: 'draft', flow: omitToken(a) }), (p) => v1('POST', '/ivr-flows', { body: p }), 'The flow is saved as a DRAFT. Tell the human to open Agents in the NaCaller dashboard, listen to it and press Activate. You cannot activate it.'),
    },
    {
      name: 'ivr_update',
      description: 'Change a keypad (IVR) flow (name, languages or the whole flow, which is replaced). It goes back to DRAFT and, if it was live, stops being usable for calls and campaigns until a person presses Activate in the dashboard: tell the human first. TWO STEPS: first call (no confirmation_token) saves nothing and returns the change, the current status and a token; get an explicit yes from the human; then call again with identical arguments plus the token. Needs a developer key with the agents scope. With a test key (nc_test_) nothing is stored.',
      inputSchema: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' }, name: { type: 'string' }, languages: LANGS, flow: FLOW, confirmation_token: TOKEN } },
      annotations: { openWorldHint: true, destructiveHint: true, idempotentHint: true },
      run: (a) => gated('ivr_update', a, async () => {
        const cur = await v1('GET', `/ivr-flows/${encodeURIComponent(a.id)}`);
        const { id, ...changes } = omitToken(a);
        return { flow: { id: cur.id, name: cur.name, current_status: cur.status }, will_change: changes, will_save_as: 'draft', warning: cur.status === 'active' ? 'This flow is LIVE. Saving puts it back to draft until a person presses Activate in the dashboard.' : undefined };
      }, (p) => { const { id, ...body } = p; return v1('PATCH', `/ivr-flows/${encodeURIComponent(id)}`, { body }); }, 'The flow is now a DRAFT. Tell the human to press Activate on the Agents page. You cannot activate it.'),
    },
    {
      name: 'balance_get',
      description: 'Read the account\'s balance: wallet in rupees, plan minutes included, used and remaining, and OTP verification and voice credits. Read only: it changes nothing. Use it before suggesting a campaign. Needs a developer key with the read scope. With a test key (nc_test_) the numbers are made up and marked test.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      annotations: RO,
      run: () => v1('GET', '/balance'),
    },
    {
      name: 'billing_topup_link',
      description: 'Get a LINK for the human to add money to the NaCaller wallet. This CHARGES NOTHING and moves no money: it returns a dashboard address with the amount filled in, and a person must open it signed in, check the amount and pay themselves. Give the human the link and the amount, then stop. NEVER try to open the link, pay, fill a payment form or work around it, and never ask for card details. Ask the human which amount (whole rupees, 200 to 50,000) rather than choosing one. Limited to 5 links an hour. Needs a developer key with the billing_link scope (not part of Read only). With a test key (nc_test_) the link is fake.',
      inputSchema: { type: 'object', required: ['amount_inr'], additionalProperties: false, properties: { amount_inr: { type: 'integer', minimum: 200, maximum: 50000, description: 'Whole rupees the human asked to add.' } } },
      annotations: { openWorldHint: true, destructiveHint: false },
      run: (a) => v1('POST', '/balance/topup-link', { body: { amount_inr: a.amount_inr } }),
    },
    {
      name: 'campaigns_create',
      description: `Create and START a calling campaign that dials every contact. TWO STEPS by design. Step 1: call with name, agent_id, contacts and no confirmation_token: nothing is created or dialled; you get a dry-run summary (contacts after validation and de-duplication, estimated cost range, whether the wallet covers it, calling hours, limits) and a confirmation_token (withheld when the dry run says it would fail: fix the blockers first). Show the summary to the human and ask for an explicit yes. Step 2: only after they say yes, call again with the identical arguments plus the token. Hard cap: ${maxContacts} contacts per campaign here (env NACALLER_MAX_CONTACTS). The cost is an estimate (a range, with its assumptions), billed per connected minute from the owner's plan and wallet. Needs a developer key with the campaigns scope. A test key (nc_test_) simulates the whole thing.`,
      inputSchema: { type: 'object', required: ['name', 'agent_id', 'contacts'], additionalProperties: false, properties: {
        name: { type: 'string', description: 'Max 100 chars.' }, agent_id: { type: 'string' },
        contacts: { type: 'array', minItems: 1, items: { type: 'object', required: ['phone'], additionalProperties: false, properties: {
          phone: PHONE, name: { type: 'string' }, variables: { type: 'object', additionalProperties: { type: ['string', 'number'] } } } } },
        language: { type: 'string' },
        confirmation_token: { type: 'string', description: 'From the step 1 dry run. Never invent one; only set it after the human approved the summary.' } } },
      annotations: { openWorldHint: true, destructiveHint: false },
      run: async (a) => {
        const { confirmation_token, ...payload } = a;
        const seen = new Set();
        const unique = [];
        payload.contacts.forEach((c, i) => {
          const t = last10(c.phone);
          if (t.length !== 10) throw bad(`contacts[${i}].phone is not a valid 10-digit mobile number.`);
          if (!seen.has(t)) { seen.add(t); unique.push(c); }
        });
        if (unique.length > maxContacts) throw bad(`${unique.length} unique contacts is over this server's cap of ${maxContacts}. Split the list, or the human can raise NACALLER_MAX_CONTACTS in the MCP config.`);
        const digest = digestOf({ n: payload.name, a: payload.agent_id, l: payload.language || null, c: payload.contacts.map((c) => [last10(c.phone), c.name || null, c.variables || null]) });

        if (!confirmation_token) {
          if (await hasDryRun()) {
            const d = await v1('POST', '/campaigns', { query: { dryRun: 'true' }, body: { ...payload, contacts: unique } });
            if (!d || d.dry_run !== true) throw new ApiError(502, 'unexpected_response', 'The dry run did not answer as a dry run, so nothing was confirmed. Stop and tell the human.');
            const e0 = Date.now() + TOKEN_TTL_MS;
            return {
              dry_run: true, created: false, would_succeed: d.would_succeed, blockers: d.blockers,
              summary: { name: payload.name, agent_id: payload.agent_id, contacts: d.contacts, estimated_cost_inr: d.estimated_cost_inr, wallet: d.wallet, calling_hours: d.calling_hours, limits: d.limits, language: payload.language || 'en', test: d.test === true ? true : undefined },
              ...(d.would_succeed ? { confirmation_token: `${e0}.${sign(digest, e0)}`, next_step: 'Show this summary (cost range, wallet, hours) to the human. Only if they explicitly approve, call campaigns_create again with the same arguments plus this confirmation_token. Token expires in 10 minutes and works once.' }
                : { next_step: 'This campaign would not start. Fix the blockers, then run the dry run again. No token was issued.' }),
            };
          }
          // Older server without a dry run: a harmless read that also proves the key works and the agent id exists.
          const agents = await v1('GET', '/agents', { query: { limit: 100 } });
          const agent = (agents.data || []).find((x) => x.id === payload.agent_id);
          if (!agent && !agents.has_more) throw new ApiError(404, 'agent_not_found', 'No agent with that id on this account.');
          const exp = Date.now() + TOKEN_TTL_MS;
          return {
            dry_run: true, created: false,
            summary: { name: payload.name, agent: agent ? { id: agent.id, name: agent.name } : { id: payload.agent_id }, contacts: unique.length, duplicates_removed: payload.contacts.length - unique.length, language: payload.language || 'en', calling_hours: '9 am to 9 pm India time; outside them it starts at the next 9 am', estimated_cost: 'not available from this server (it has no dry-run endpoint): billed per connected minute from plan minutes then wallet', opted_out_numbers: 'skipped by NaCaller at launch, not dialled' },
            confirmation_token: `${exp}.${sign(digest, exp)}`,
            next_step: 'Show this summary to the human. Only if they explicitly approve, call campaigns_create again with the same arguments plus this confirmation_token. Token expires in 10 minutes and works once.',
          };
        }
        const [expS, sig] = String(confirmation_token).split('.');
        const exp = Number(expS);
        const good = sig && Number.isFinite(exp) && (() => { const e = Buffer.from(sign(digest, exp)), g = Buffer.from(sig); return e.length === g.length && crypto.timingSafeEqual(e, g); })();
        if (!good) throw bad('confirmation_token does not match these arguments (or is not from this server). Run the dry run again without a token and show the human the new summary.');
        if (Date.now() > exp) throw bad('confirmation_token expired. Run the dry run again and re-confirm with the human.');
        if (used.has(confirmation_token)) throw bad('confirmation_token was already used. A campaign is never created twice from one confirmation; start over if you really want another.');
        used.add(confirmation_token);
        return { created: true, campaign: await v1('POST', '/campaigns', { body: { ...payload, contacts: unique } }) };
      },
    },
    {
      name: 'campaigns_results',
      description: 'Results of a campaign: totals (contacts, called, answered, opted_out) and one row per contact with status, outcome, summary and captured fields. Cursor pagination. Needs a developer key.',
      inputSchema: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 }, cursor: { type: 'string' } } },
      annotations: RO,
      run: (a) => v1('GET', `/campaigns/${encodeURIComponent(a.id)}/results`, { query: { limit: a.limit, cursor: a.cursor } }),
    },
    {
      name: 'nacaller_docs',
      description: `Concise NaCaller integration guidance and framework snippets, bundled with this server (works offline). Topics: ${TOPIC_NAMES.join(', ')}. Start with "overview" for what the API can and cannot do today, then "otp" and a framework (nextjs, express, django, laravel, html).`,
      inputSchema: { type: 'object', required: ['topic'], additionalProperties: false, properties: { topic: { type: 'string', enum: TOPIC_NAMES } } },
      annotations: { readOnlyHint: true },
      run: (a) => {
        const t = TOPICS[String(a.topic || '').toLowerCase()];
        if (!t) throw bad(`Unknown topic. Choose one of: ${TOPIC_NAMES.join(', ')}.`);
        return t;
      },
    },
  ];

  const byName = new Map(tools.map((t) => [t.name, t]));
  return {
    list: () => tools.map(({ run, ...def }) => def),
    async call(name, args) {
      const t = byName.get(name);
      if (!t) throw bad(`Unknown tool ${name}.`);
      const missing = (t.inputSchema.required || []).filter((k) => args?.[k] === undefined || args[k] === '');
      if (missing.length) throw bad(`Missing required argument(s): ${missing.join(', ')}.`);
      return text(await t.run(args || {}));
    },
  };
}
