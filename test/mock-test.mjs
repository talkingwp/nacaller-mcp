// Runs the real server over stdio against a local mock of the NaCaller API.
// node test/mock-test.mjs
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const V1 = 'nc_live_' + 'A'.repeat(32), OTP = 'nck_live_' + 'ab12'.repeat(8), TEST = 'nc_test_' + 'T'.repeat(32), SCOPED = 'nc_live_' + 'S'.repeat(32);
let NEW = false;                       // true: the mock behaves like a server that has the dry-run endpoint
const entry = fileURLToPath(new URL('../src/index.js', import.meta.url));
const seen = [];                       // every request the mock got: [method, path, body]

const mock = http.createServer((req, res) => {
  let raw = ''; req.on('data', (c) => raw += c);
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : null;
    seen.push([req.method, req.url, body, req.headers.authorization]);
    const send = (s, j) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
    const auth = req.headers.authorization;
    const u = req.url.split('?')[0];
    if (u.startsWith('/api/verify') && (auth === `Bearer ${TEST}` || auth === `Bearer ${SCOPED}`)) {
      // an nc_ account key on the verify API: nested error shape, fixed test code
      if (u === '/api/verify/start') return send(200, { id: 'test_vr_1', method: 'voice', status: 'calling', test: auth === `Bearer ${TEST}`, test_code: '123456' });
      if (u === '/api/verify/check') return send(200, { verified: true, id: body.id, test: true });
      return send(404, { error: 'Unknown request.', code: 'not_found', message: 'Unknown request.' });
    }
    if (u.startsWith('/api/verify')) {
      if (auth !== `Bearer ${OTP}`) return send(401, { error: 'Invalid or missing API key.' });
      if (u === '/api/verify/start') return body.method === 'voice'
        ? (body.phone === '0000000000' ? send(402, { error: `No voice OTP calls left (key ${auth}).` }) : send(200, { id: 'vr1', method: 'voice', status: 'calling' }))
        : send(200, { requestId: 'mr1', callNumber: '+9100000000', status: 'pending' });
      if (u === '/api/verify/check') return body.code === '123456' ? send(200, { verified: true, id: body.id }) : send(400, { verified: false, error: 'Incorrect code.', attemptsLeft: 4 });
      if (u.startsWith('/api/verify/status/')) return u.endsWith('/selftest') ? send(404, { error: 'Unknown request.' }) : send(200, { status: 'pending', verified: false });
    }
    if (u.startsWith('/api/v1')) {
      if (auth === `Bearer ${SCOPED}`) return send(403, { error: { code: 'insufficient_scope', message: "This key lacks the 'calls' scope.", required_scope: 'calls' } });
      if (NEW && req.url.includes('dryRun=true') && u === '/api/v1/campaigns') {
        if (body.agent_id !== 'ag1') return send(404, { error: { code: 'agent_not_found', message: 'No agent with that id on your account.' } });
        const bad = body.contacts.some((c) => String(c.phone).replace(/\D/g, '').length < 10);
        return send(200, { dry_run: true, would_succeed: !bad, blockers: bad ? ['contacts[0].phone is not a valid mobile number.'] : [], contacts: { received: body.contacts.length, valid: body.contacts.length, invalid: 0, duplicates: 0, opted_out: 0, dialable: body.contacts.length }, estimated_cost_inr: { low: 1.6, high: 12, rate_per_minute_inr: 3.99, assumptions: {} }, wallet: { covers_estimate: true, shortfall_inr: 0 }, calling_hours: { open_now: true }, limits: {}, ...(auth === `Bearer ${TEST}` ? { test: true } : {}) });
      }
      if (auth !== `Bearer ${V1}` && auth !== `Bearer ${TEST}`) return send(401, { error: { code: 'invalid_api_key', message: 'That API key is not valid.' } });
      if (u === '/api/v1/agents' && req.method === 'POST') return send(201, { id: 'ag2', name: body.name, status: 'draft', needs_activation: true });
      if (u === '/api/v1/agents/ag1' && req.method === 'GET') return send(200, { id: 'ag1', name: 'Fees agent', status: 'active', prompt: 'P' });
      if (u === '/api/v1/agents/ag1' && req.method === 'PATCH') return send(200, { id: 'ag1', name: 'Fees agent', status: 'draft', ...body });
      if (u === '/api/v1/agents/draftie' && req.method === 'GET') return send(200, { id: 'draftie', name: 'D', status: 'draft' });
      if (u === '/api/v1/ivr-flows' && req.method === 'POST') return send(201, { id: 'iv1', name: body.name, status: 'draft', flow: body.flow });
      if (u === '/api/v1/ivr-flows') return send(200, { data: [{ id: 'iv1', name: 'Poll', status: 'active' }], has_more: false });
      if (u === '/api/v1/ivr-flows/iv1' && req.method === 'GET') return send(200, { id: 'iv1', name: 'Poll', status: 'active' });
      if (u === '/api/v1/ivr-flows/iv1' && req.method === 'PATCH') return send(200, { id: 'iv1', status: 'draft' });
      if (u === '/api/v1/balance') return send(200, { wallet: { balance_inr: 1234 }, plan: { minutes_remaining: 380 }, otp: { verification_credits: 35, voice_credits: 5 } });
      if (u === '/api/v1/balance/topup-link') return (Number.isInteger(body.amount_inr) && body.amount_inr >= 200 && body.amount_inr <= 50000)
        ? send(201, { url: `https://app.example.test/billing?add=${body.amount_inr}`, amount_inr: body.amount_inr, charged: false })
        : send(400, { error: { code: 'invalid_request', message: 'amount_inr must be a whole number of rupees from 200 to 50000.', min_inr: 200, max_inr: 50000 } });
      if (u === '/api/v1/agents') return send(200, { data: [{ id: 'ag1', name: 'Fees agent', language: 'te', status: 'active' }], has_more: false, next_cursor: null });
      if (u === '/api/v1/calls' && req.method === 'POST') return body.agent_id === 'nope' ? send(404, { error: { code: 'agent_not_found', message: 'No agent with that id on your account.' } }) : send(201, { id: 'c1', status: 'initiated', agent_id: body.agent_id, to: body.phone });
      if (u === '/api/v1/calls') return send(200, { data: [{ id: 'c1', status: 'Completed' }], has_more: false, next_cursor: null });
      if (u === '/api/v1/calls/c1') return send(200, { id: 'c1', transcript: 'hi' });
      if (u === '/api/v1/campaigns') return send(201, { id: 'cp1', contacts: body.contacts.length, status: 'running' });
      if (u === '/api/v1/campaigns/cp1/results') return send(200, { totals: { contacts: 2 }, data: [], has_more: false });
    }
    send(404, { error: { code: 'not_found', message: 'nope' } });
  });
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${mock.address().port}`;
const env = { ...process.env, NACALLER_API_KEY: V1, NACALLER_OTP_KEY: OTP, NACALLER_API_BASE: base, NACALLER_MAX_CONTACTS: '3' };

const client = new Client({ name: 'test', version: '0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env, stderr: 'pipe' });
let stderr = ''; transport.stderr?.on('data', (d) => stderr += d);
await client.connect(transport);

const outputs = [];
const call = async (name, args) => { const r = await client.callTool({ name, arguments: args }); const t = r.content[0].text; outputs.push(t); return { err: !!r.isError, text: t, json: (() => { try { return JSON.parse(t); } catch { return null; } })() }; };

// tool list: required tools present, nothing that moves money or touches keys
const names = (await client.listTools()).tools.map((t) => t.name);
for (const n of ['otp_send_voice', 'otp_check', 'otp_missed_call_start', 'otp_status', 'calls_place', 'calls_list', 'calls_get', 'agents_list', 'agents_get', 'agents_create', 'agents_update', 'ivr_list', 'ivr_get', 'ivr_create', 'ivr_update', 'balance_get', 'billing_topup_link', 'campaigns_create', 'campaigns_results', 'nacaller_docs']) assert.ok(names.includes(n), `missing tool ${n}`);
assert.ok(!names.some((n) => /wallet|recharge|key|delete|payment|pay|charge|debit|activate|publish/.test(n)), 'forbidden tool present');
assert.deepEqual(names.filter((n) => /balance|billing/.test(n)).sort(), ['balance_get', 'billing_topup_link'], 'only the read and the link tool touch money topics');
for (const t of (await client.listTools()).tools) assert.ok(!JSON.stringify(t.inputSchema).match(/api_?key|token"/i) || ['campaigns_create', 'agents_create', 'agents_update', 'ivr_create', 'ivr_update'].includes(t.name), `${t.name} takes a key-like arg`);
assert.ok((await client.listResources()).resources.length === 1);
assert.ok((await client.listPrompts()).prompts.length === 1);

// OTP
assert.equal((await call('otp_send_voice', { to: '9876543210', language: 'hi' })).json.id, 'vr1');
assert.equal(seen.at(-1)[2].method, 'voice');
assert.equal((await call('otp_check', { id: 'vr1', code: '123456' })).json.verified, true);
const wrong = await call('otp_check', { id: 'vr1', code: '000000' });
assert.equal(wrong.json.attemptsLeft, 4);       // 400 surfaces attemptsLeft
assert.equal((await call('otp_missed_call_start', { phone: '9876543210' })).json.requestId, 'mr1');
assert.equal((await call('otp_status', { id: 'mr1' })).json.status, 'pending');
const noCredit = await call('otp_send_voice', { to: '0000000000', language: 'en' });
assert.ok(noCredit.err && noCredit.json.fix.includes('Out of credits'), 'helpful 402');
assert.ok(!noCredit.text.includes(OTP), 'key echoed by server must be scrubbed');
assert.ok((await call('otp_send_voice', { to: '9876543210' })).err, 'missing language rejected locally');

// developer API
assert.equal((await call('agents_list', {})).json.data[0].id, 'ag1');
assert.equal((await call('calls_place', { agent_id: 'ag1', phone: '9876543210' })).json.status, 'initiated');
const nf = await call('calls_place', { agent_id: 'nope', phone: '9876543210' });
assert.ok(nf.err && nf.json.error === 'agent_not_found' && nf.json.fix.includes('agents_list'));
assert.equal((await call('calls_list', { status: 'Completed' })).json.data.length, 1);
assert.ok(seen.at(-1)[1].includes('status=Completed'));
assert.equal((await call('calls_get', { id: 'c1' })).json.transcript, 'hi');
assert.equal((await call('campaigns_results', { id: 'cp1' })).json.totals.contacts, 2);

// balance, top-up link
const bal = await call('balance_get', {});
assert.equal(bal.json.wallet.balance_inr, 1234);
assert.equal(seen.at(-1)[0], 'GET');
const link = await call('billing_topup_link', { amount_inr: 2500 });
assert.ok(link.json.url.endsWith('/billing?add=2500') && link.json.charged === false, 'a link, not a charge');
assert.ok(!link.err && seen.at(-1)[1] === '/api/v1/balance/topup-link' && seen.at(-1)[0] === 'POST');
const lowLink = await call('billing_topup_link', { amount_inr: 5 });
assert.ok(lowLink.err && lowLink.json.min_inr === 200, 'bounds come back from the API');
const topDesc = (await client.listTools()).tools.find((t) => t.name === 'billing_topup_link').description;
assert.ok(/CHARGES NOTHING/.test(topDesc) && /NEVER try to open the link, pay/.test(topDesc), 'the link tool tells the agent never to pay');

// agents: read, and the two-step draft save
assert.equal((await call('agents_get', { id: 'ag1' })).json.status, 'active');
assert.ok((await call('agents_list', {})).json.data[0].status === 'active');
const aBefore = seen.length;
const aArgs = { name: 'Clinic desk', role: 'Receptionist', prompt: 'You answer for Sunrise Dental.', languages: ['English'] };
const aPre = await call('agents_create', aArgs);
assert.ok(aPre.json.saved === false && aPre.json.confirmation_token && aPre.json.preview.will_save_as === 'draft');
assert.equal(seen.length, aBefore, 'the preview sent nothing to the API');
assert.ok((await call('agents_create', { ...aArgs, name: 'Other', confirmation_token: aPre.json.confirmation_token })).err, 'a token is bound to its arguments');
assert.ok((await call('agents_create', { ...aArgs, confirmation_token: 'forged.token' })).err, 'a forged token is refused');
assert.equal(seen.length, aBefore, 'refused tokens sent nothing');
const aSaved = await call('agents_create', { ...aArgs, confirmation_token: aPre.json.confirmation_token });
assert.ok(aSaved.json.saved && aSaved.json.result.status === 'draft' && /Activate/.test(aSaved.json.next_step), 'saved as a draft, and the agent is told a person must activate');
assert.ok(!('confirmation_token' in seen.at(-1)[2]), 'the token is not sent to the API');
assert.ok((await call('agents_create', { ...aArgs, confirmation_token: aPre.json.confirmation_token })).err, 'a token works once');
const uArgs = { id: 'ag1', greeting: 'Hello there' };
const uPre = await call('agents_update', uArgs);
assert.ok(uPre.json.preview.agent.current_status === 'active' && /LIVE/.test(uPre.json.preview.warning), 'the update preview warns that a live agent goes back to draft');
assert.ok(!seen.some((x) => x[0] === 'PATCH'), 'nothing patched before approval');
const uDone = await call('agents_update', { ...uArgs, confirmation_token: uPre.json.confirmation_token });
assert.ok(uDone.json.saved && seen.at(-1)[0] === 'PATCH' && seen.at(-1)[1] === '/api/v1/agents/ag1' && seen.at(-1)[2].greeting === 'Hello there' && !('id' in seen.at(-1)[2]));
for (const n of ['agents_create', 'agents_update', 'ivr_create', 'ivr_update']) {
  const d = (await client.listTools()).tools.find((t) => t.name === n).description;
  assert.ok(/DRAFT/.test(d) && /Activate/.test(d) && /TWO STEPS|two steps/i.test(d) || n === 'agents_create' && /TWO STEPS/.test(d), `${n} says it saves a draft a person must activate`);
}

// ivr
assert.equal((await call('ivr_list', {})).json.data[0].id, 'iv1');
assert.equal((await call('ivr_get', { id: 'iv1' })).json.id, 'iv1');
const flow = { steps: [{ type: 'say', text: 'Hello.' }, { type: 'ask', text: 'Rate us', options: [{ key: 'good', label: 'Good' }, { key: 'bad', label: 'Bad' }] }] };
const iPre = await call('ivr_create', { name: 'Poll', flow });
assert.ok(iPre.json.saved === false && iPre.json.confirmation_token);
const iBefore = seen.filter((x) => x[0] === 'POST' && x[1] === '/api/v1/ivr-flows').length;
assert.equal(iBefore, 0, 'ivr preview did not post');
const iSaved = await call('ivr_create', { name: 'Poll', flow, confirmation_token: iPre.json.confirmation_token });
assert.ok(iSaved.json.saved && iSaved.json.result.status === 'draft');
const iuPre = await call('ivr_update', { id: 'iv1', name: 'Poll 2' });
assert.ok(/LIVE/.test(iuPre.json.preview.warning));
assert.ok((await call('ivr_update', { id: 'iv1', name: 'Poll 3', confirmation_token: iuPre.json.confirmation_token })).err, 'ivr token bound to arguments');
assert.ok((await call('ivr_update', { id: 'iv1', name: 'Poll 2', confirmation_token: iuPre.json.confirmation_token })).json.saved);
const dr = await call('calls_place', { agent_id: 'draftie', phone: '9876543210' });   // the mock answers real calls for any id except 'nope'
assert.ok(!dr.err || dr.json.error);   // (the server-side agent_draft refusal is covered by the backend check; here the hint text)

// campaigns: confirm step, cap, token binding, single use
const args = { name: 'Fees', agent_id: 'ag1', contacts: [{ phone: '9876543210' }, { phone: '+91 98765 43210' }, { phone: '9123456780', name: 'R' }] };
const before = seen.filter((s) => s[1] === '/api/v1/campaigns').length;
const dry = await call('campaigns_create', args);
assert.ok(dry.json.dry_run && dry.json.created === false && dry.json.summary.contacts === 2 && dry.json.summary.duplicates_removed === 1);
assert.equal(seen.filter((s) => s[1] === '/api/v1/campaigns').length, before, 'dry run must not create');
const tok = dry.json.confirmation_token;
assert.ok((await call('campaigns_create', { ...args, confirmation_token: 'forged.token' })).err, 'forged token');
assert.ok((await call('campaigns_create', { ...args, name: 'Other', confirmation_token: tok })).err, 'token bound to arguments');
assert.equal(seen.filter((s) => s[1] === '/api/v1/campaigns').length, before);
const made = await call('campaigns_create', { ...args, confirmation_token: tok });
assert.ok(made.json.created && made.json.campaign.id === 'cp1' && made.json.campaign.contacts === 2);
assert.ok((await call('campaigns_create', { ...args, confirmation_token: tok })).err, 'token is single use');
const big = await call('campaigns_create', { ...args, contacts: ['9111111111', '9222222222', '9333333333', '9444444444'].map((phone) => ({ phone })) });
assert.ok(big.err && big.text.includes('cap of 3'), 'contact cap');
assert.ok((await call('campaigns_create', { ...args, contacts: [{ phone: '123' }] })).err, 'bad phone');

// docs
for (const t of ['overview', 'otp', 'nextjs', 'express', 'django', 'laravel', 'html', 'webhooks', 'errors']) assert.ok((await call('nacaller_docs', { topic: t })).text.length > 100, t);
assert.ok((await call('nacaller_docs', { topic: 'zzz' })).err);
// every framework example binds the verification to the phone, uses the one env var and no user id
for (const t of ['nextjs', 'express', 'django', 'laravel', 'html']) {
  const text = (await call('nacaller_docs', { topic: t })).text;
  assert.ok(!/NACALLER_KEY|req\.user|request\.user|userId/.test(text), `${t}: stale key name or user id`);
  assert.ok(/signup/.test(text) && /issued|nc_issued/.test(text), `${t}: no signup binding`);
  if (t !== 'html') assert.ok(text.includes('NACALLER_API_KEY') && /phone/.test(text), `${t}: key env`);
}
assert.ok((await call('nacaller_docs', { topic: 'otp' })).text.includes('Testing with an nc_test_ key'));

// ── a server WITH the dry-run endpoint: real estimate, gated token, and nothing created by the dry run ──
NEW = true;
const c3 = new Client({ name: 't3', version: '0' });
await c3.connect(new StdioClientTransport({ command: process.execPath, args: [entry], env: { ...process.env, NACALLER_API_KEY: V1, NACALLER_OTP_KEY: OTP, NACALLER_API_BASE: base, NACALLER_MAX_CONTACTS: '3' } }));
const call3 = async (name, a) => { const r = await c3.callTool({ name, arguments: a }); outputs.push(r.content[0].text); return { err: !!r.isError, json: (() => { try { return JSON.parse(r.content[0].text); } catch { return null; } })() }; };
const dry2 = await call3('campaigns_create', args);
assert.ok(dry2.json.dry_run && dry2.json.would_succeed === true && dry2.json.summary.estimated_cost_inr.high === 12 && dry2.json.summary.wallet.covers_estimate === true, 'uses the real dry run');
assert.ok(dry2.json.confirmation_token, 'a passing dry run issues a token');
const probes = seen.filter((x) => x[1] === '/api/v1/campaigns?dryRun=true');
assert.equal(probes.filter((x) => x[2].agent_id === 'nacaller-mcp-probe').length >= 1, true, 'the capability probe ran');
assert.equal(seen.filter((x) => x[1] === '/api/v1/campaigns').length, before + 1, 'the dry run created nothing (the one extra is the earlier confirmed create)');
const nobad = await call3('campaigns_create', { ...args, contacts: [{ phone: '123456789' }, { phone: '9876543210' }] });
assert.ok(nobad.err, 'a 9-digit number is refused locally before any request');
const dryNf = await call3('campaigns_create', { ...args, agent_id: 'ghost' });
assert.ok(dryNf.err && dryNf.json.error === 'agent_not_found', 'an unknown agent fails at the dry run');
await c3.close();

// ── test key: recognised, simulated, and it ignores a live nck_ key ──
const c4 = new Client({ name: 't4', version: '0' });
await c4.connect(new StdioClientTransport({ command: process.execPath, args: [entry], env: { ...process.env, NACALLER_API_KEY: TEST, NACALLER_OTP_KEY: OTP, NACALLER_API_BASE: base } }));
const t4 = await c4.callTool({ name: 'otp_send_voice', arguments: { to: '9876543210', language: 'en' } });
const j4 = JSON.parse(t4.content[0].text);
assert.ok(j4.test === true && j4.test_code === '123456', 'a test key reaches the sandbox OTP, never the live nck_ key');
assert.equal(seen.at(-1)[3], `Bearer ${TEST}`, 'the nck_ key was not used alongside a test key');
const t4b = await c4.callTool({ name: 'agents_list', arguments: {} });
assert.ok(!t4b.isError);
await c4.close();

// ── a scoped key without the scope: 403 becomes a clear instruction ──
const c5 = new Client({ name: 't5', version: '0' });
await c5.connect(new StdioClientTransport({ command: process.execPath, args: [entry], env: { ...process.env, NACALLER_API_KEY: SCOPED, NACALLER_OTP_KEY: '', NACALLER_API_BASE: base } }));
const r5 = await c5.callTool({ name: 'calls_place', arguments: { agent_id: 'ag1', phone: '9876543210' } });
const j5 = JSON.parse(r5.content[0].text);
assert.ok(r5.isError && j5.error === 'insufficient_scope' && j5.required_scope === 'calls' && j5.fix.includes('wider preset'), 'insufficient_scope is explained');
// one nc_ key serves OTP too (no nck_ configured)
const r5b = await c5.callTool({ name: 'otp_check', arguments: { id: 'x', code: '123456' } });
assert.ok(!r5b.isError, 'a single nc_ key is used for OTP when no nck_ key is set');
await c5.close();
NEW = false;

// the draft hint reaches the agent when the API refuses a draft
{
  const { errorResult, ApiError } = await import('../src/client.js');
  const fix = JSON.parse(errorResult(new ApiError(409, 'agent_draft', 'x')).content[0].text).fix;
  assert.ok(/Activate/.test(fix) && /must not retry/.test(fix), 'agent_draft is explained');
}
// wrong key type gives a setup hint, not a crash
await client.close();
const c2 = new Client({ name: 't2', version: '0' });
await c2.connect(new StdioClientTransport({ command: process.execPath, args: [entry], env: { ...process.env, NACALLER_API_KEY: OTP, NACALLER_OTP_KEY: '', NACALLER_API_BASE: base } }));
const r2 = await c2.callTool({ name: 'agents_list', arguments: {} });
assert.ok(r2.isError && r2.content[0].text.includes('NACALLER_API_KEY'));
await c2.close();

// the key never appears in anything returned or logged
for (const o of outputs) assert.ok(!o.includes(V1) && !o.includes(OTP), 'key leaked in tool output');
assert.ok(!stderr.includes(V1) && !stderr.includes(OTP), 'key leaked on stderr');

// selftest (async spawn: the mock lives in this process)
const run = (e) => new Promise((res) => { const p = spawn(process.execPath, [entry, '--selftest'], { env: e }); let o = '', er = ''; p.stdout.on('data', (d) => o += d); p.stderr.on('data', (d) => er += d); p.on('close', (status) => res({ status, stdout: o, stderr: er })); });
const st = await run(env);
assert.equal(st.status, 0, st.stderr);
assert.ok(!st.stdout.includes(V1) && !st.stderr.includes(V1) && !st.stderr.includes(OTP));
const bad = await run({ ...env, NACALLER_API_KEY: 'nc_live_' + 'B'.repeat(32) });
assert.equal(bad.status, 1);

mock.close();
console.log('nacaller-mcp: all mock tests passed');
