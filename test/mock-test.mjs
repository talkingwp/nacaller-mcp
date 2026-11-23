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
      if (u === '/api/v1/agents') return send(200, { data: [{ id: 'ag1', name: 'Fees agent', language: 'te' }], has_more: false, next_cursor: null });
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
for (const n of ['otp_send_voice', 'otp_check', 'otp_missed_call_start', 'otp_status', 'calls_place', 'calls_list', 'calls_get', 'agents_list', 'campaigns_create', 'campaigns_results', 'nacaller_docs']) assert.ok(names.includes(n), `missing tool ${n}`);
assert.ok(!names.some((n) => /wallet|balance|recharge|key|billing|delete|payment/.test(n)), 'forbidden tool present');
for (const t of (await client.listTools()).tools) assert.ok(!JSON.stringify(t.inputSchema).match(/api_?key|token"/i) || t.name === 'campaigns_create', `${t.name} takes a key-like arg`);
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
