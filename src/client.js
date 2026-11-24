// HTTP client. Keys come only from the environment, are never logged and are
// scrubbed from anything handed back to the agent.
import { API_BASE_DEFAULT } from './docs.js';

const HINTS = {
  missing_api_key: 'Set NACALLER_API_KEY in the MCP server config.',
  invalid_api_key: 'The key is wrong or revoked. Create a new one in the NaCaller dashboard (Settings, Developers).',
  phone_unverified: 'The account owner must verify their phone number in the dashboard first.',
  account_pending: 'The account is awaiting approval; calling is not available yet.',
  insufficient_scope: 'This key was created without the scope this tool needs (see required_scope). A human can make a key with a wider preset in the dashboard (Settings, Developers); agents and billing_link are only in Full access. Do not retry.',
  no_verify_app: 'The account has no OTP site yet. A human must create one under OTP in the dashboard.',
  rate_limited: 'Wait retry_after_seconds, then retry. Do not loop.',
  daily_limit_reached: 'This key hit its daily call limit (resets at midnight IST). Stop; ask the human.',
  outside_calling_hours: 'Calls go out 9 am to 9 pm India time only. Try again after opens_at.',
  agent_not_found: 'Call agents_list and use one of the returned ids.',
  no_minutes: 'The account is out of calling minutes/wallet. A human must top up in the dashboard.',
  contact_opted_out: 'This number opted out. Do not retry.',
  number_blocked: 'This number cannot be called.',
  international_not_allowed: 'Only Indian numbers are enabled for this account.',
  calling_paused: 'Calling is paused on this account in the dashboard.',
  agent_draft: 'This agent was saved through the API and has not been activated. Only a person can: tell the human to open Agents in the NaCaller dashboard and press Activate. You cannot, and must not retry.',
  agent_limit_reached: 'The plan agent limit is reached. Tell the human; they can delete an agent or upgrade in the dashboard.',
  is_ivr_flow: 'That id is a keypad flow. Use the ivr_* tools.',
  ivr_flow_not_found: 'Call ivr_list and use one of the returned ids.',
  wallet_unavailable: 'Adding money is not switched on for this account. Tell the human.',
};
const STATUS_HINTS = {
  401: 'The key was rejected. Check NACALLER_API_KEY: nc_live_ / nc_test_ keys serve calls, agents, campaigns (and OTP when created with the otp scope); nck_live_ keys serve OTP.',
  402: 'Out of credits. A human must buy a pack or top up in the dashboard; do not retry.',
  429: 'Rate limited. Wait and retry once, do not loop.',
  503: 'Service temporarily unavailable. Retry once later.',
};

export class ApiError extends Error {
  constructor(status, code, message, extra = {}) { super(message); this.status = status; this.code = code; this.extra = extra; }
}

/** nc_live_ / nc_test_ -> developer API (and OTP, when the key holds the otp scope), nck_ -> verification API.
 *  Either may be given as NACALLER_API_KEY. A TEST key never mixes with a live one: with nc_test_ present,
 *  a nck_ key is ignored so a sandbox session can never reach the live OTP line. */
export function loadKeys(env = process.env) {
  const keys = { v1: null, otp: null, test: false };
  for (const k of [env.NACALLER_API_KEY, env.NACALLER_OTP_KEY]) {
    const t = String(k || '').trim();
    if (/^nc_(live|test)_/.test(t)) keys.v1 = t;
    else if (/^nck_/.test(t)) keys.otp = t;
  }
  keys.test = !!keys.v1 && keys.v1.startsWith('nc_test_');
  if (keys.test) keys.otp = null;
  return keys;
}

export function createClient({ env = process.env, fetchImpl = fetch } = {}) {
  const keys = loadKeys(env);
  const base = String(env.NACALLER_API_BASE || API_BASE_DEFAULT).replace(/\/+$/, '');
  const secrets = [keys.v1, keys.otp].filter(Boolean);
  const scrub = (s) => secrets.reduce((t, k) => t.split(k).join('[redacted-key]'), String(s));

  async function request(kind, method, path, { query, body } = {}) {
    // OTP: a site key (nck_) when given, otherwise the developer key, which works when it holds the otp scope.
    const key = kind === 'otp' ? (keys.otp || keys.v1) : keys[kind];
    if (!key) {
      throw new ApiError(0, 'missing_api_key', kind === 'v1'
        ? 'This tool needs a developer API key (nc_live_... or nc_test_...). Set NACALLER_API_KEY in the MCP server config.'
        : 'This tool needs a verification key (nck_live_...) or a developer key with the otp scope. Set NACALLER_OTP_KEY (or NACALLER_API_KEY) in the MCP server config; create one in the dashboard under Verify, or under Settings, Developers.');
    }
    const url = new URL(base + (kind === 'v1' ? '/api/v1' : '/api/verify') + path);
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    let res;
    try {
      res = await fetchImpl(url, {
        method,
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new ApiError(0, 'network_error', scrub(`Could not reach ${base}: ${e.message}`));
    }
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON body */ }
    if (res.ok) return data;
    // Two shapes: { error: { code, message } } (developer API) and { error: 'msg', code, message } (verify API, string kept for old clients).
    const e = data && data.error;
    const nested = e && typeof e === 'object';
    const { code: c, message: m, ...extra } = nested ? e : {};
    const { error: _drop, code: flatCode, message: flatMsg, ...rest } = data || {};
    throw new ApiError(res.status, c || flatCode || `http_${res.status}`, scrub(m || flatMsg || (typeof e === 'string' ? e : `HTTP ${res.status}`)), { ...extra, ...rest });
  }
  return { request, keys, base, testMode: keys.test };
}

/** What the agent sees when a call fails: what happened and what to fix. */
export function errorResult(err) {
  const known = err instanceof ApiError;
  const out = known
    ? { error: err.code, status: err.status || undefined, message: err.message, ...err.extra, fix: HINTS[err.code] || STATUS_HINTS[err.status] }
    : { error: 'internal_error', message: 'The NaCaller MCP server hit an unexpected error.' };
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
}
