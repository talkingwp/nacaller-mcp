// Bundled integration guidance for the nacaller_docs tool and the MCP resource.
// Facts here match the public NaCaller docs: https://nacaller.com/docs/ai-agents

export const API_BASE_DEFAULT = 'https://api.nacaller.com';
export const LANGUAGES = ['te', 'hi', 'en', 'ta', 'kn', 'ml', 'mr', 'bn', 'or', 'gu'];

const OVERVIEW = `NaCaller API, as it exists today
Base URL: ${API_BASE_DEFAULT}  (JSON over HTTPS, Authorization: Bearer <key>)

Key types, created in the dashboard, all SERVER SECRETS (env var, never browser code):
- nck_live_...  verification key (one per site). Endpoints: /api/verify/*  (Miss OTP, Voice OTP)
- nc_live_...   developer key with scopes (otp, calls, campaigns, read, agents, billing_link). Endpoints: /api/v1/*, and /api/verify/* when it holds the otp scope
- nc_test_...   test key (Settings, Developers, tick Test key): same endpoints, everything simulated, nothing real happens. START HERE when building or when an agent is driving.

Verification (nck_ key)
- POST /api/verify/start  { phone, reference? }                              missed call -> { requestId, callNumber, instruction, expiresAt }
- POST /api/verify/start  { phone, method:"voice", language, reference? }    voice OTP    -> { id, status:"calling", expiresAt }
- POST /api/verify/check  { id, code }                                       voice only   -> { verified:true } | 400 { verified:false, attemptsLeft } | 410 expired
- GET  /api/verify/status/:id                                                -> { status: pending|verified|expired, verified }
Errors: { "error": "message" } with an HTTP status (400 bad number, 401 bad key, 402 no credits, 429 rate limit, 503 line not configured).
25 free verifications and 5 free voice calls per account, once, on its first site. nck_ keys have no sandbox (free credits run live); with an nc_test_ key OTP is simulated: voice start returns test_code 123456 and /check accepts it, nothing is called.
Verify errors keep { "error": "message" } and also carry code and message; responses carry X-RateLimit-Limit/-Remaining and 429s Retry-After.

Developer API (nc_live_ key), base /api/v1
- GET  /agents                                                    -> { data: [{ id, name, language, status }] } (status: active, paused or draft)
- GET  /agents/:id    (scope agents)                              -> the agent in full
- POST /agents        (scope agents) { name, role, prompt, greeting?, personality?, caller_name?, gender?, knowledge_base?, calling_rules?, booking_url?, brochure_url?, maps_url?, languages?, transfer_number?, transfer_whisper? }   -> 201, saved as a DRAFT
- PATCH /agents/:id   (scope agents) any of those fields          -> the agent goes back to DRAFT
- GET/POST /ivr-flows, GET/PATCH /ivr-flows/:id  (scope agents)   keypad flows: { name, languages?, flow:{ sponsor?, opt_out?, closing?, steps:[{type:"say",text} | {type:"ask",text,options:[{key,label,verdict?}]}] } }; also drafts
- GET  /balance       (scope read)                                -> { wallet:{balance_inr}, plan:{minutes_remaining,...}, otp:{verification_credits,voice_credits} }
- POST /balance/topup-link { amount_inr } (scope billing_link)    -> { url, charged:false }: a dashboard link a PERSON opens to pay. Charges nothing.
- POST /calls { agent_id, phone, name?, variables?, language? }   -> 201 { id, status:"initiated" }
- GET  /calls?status=&agent_id=&campaign_id=&limit=&cursor=       -> { data, has_more, next_cursor }
- GET  /calls/:id                                                  -> detail with transcript and a signed recording_url
- POST /campaigns { name, agent_id, contacts:[{phone,name?,variables?}], language? }   add ?dryRun=true to estimate cost and readiness without creating anything
- GET  /campaigns/:id/results
Errors: { "error": { "code", "message" } }. Limit 300 requests/minute per key (429 rate_limited, Retry-After) and a daily call limit per key (default 200, 429 daily_limit_reached).
Calls only go out 9 am to 9 pm India time (422 outside_calling_hours). Do-not-call numbers are never dialled. The key owner's own minutes and wallet pay.

Scopes (set when the key is created; presets OTP only, Calling, Read only, Full access): otp, calls, campaigns, read (GET only), agents, billing_link. Only Full access has agents and billing_link. A refused call is 403 insufficient_scope naming the scope. Old keys with no scopes keep calls, campaigns and read, never OTP, agents or billing_link.
DRAFT-FIRST: an agent or keypad flow created or edited with a live key is a draft (status "draft"). A draft cannot place calls, run campaigns or answer a number (409 agent_draft). Only a person can activate it, with the Activate button on the Agents page in the dashboard; the API and these tools cannot. Editing a live agent puts it back to draft, so ask the human first. No delete exists. Test keys do all of this in a sandbox and store nothing.
MONEY: nothing here charges or moves money. For a top-up, give the human the link from billing_topup_link and stop; never try to pay.
Test keys (nc_test_): same validation and errors as live, simulated objects marked test:true, no phone rung, no credits or wallet, no records. OTP test code is always 123456. Use one whenever you only need to see the flow work.
Campaign dry run: POST /api/v1/campaigns?dryRun=true returns { would_succeed, blockers, contacts:{received,valid,invalid,duplicates,opted_out,dialable}, estimated_cost_inr:{low,high,rate_per_minute_inr,assumptions}, wallet:{covers_estimate,shortfall_inr}, calling_hours, limits } and creates nothing.
OpenAPI 3.1: https://nacaller.com/openapi.json

NOT available today (do not invent): an SDK, deleting agents or flows, activating an agent through the API, paying or charging through the API, recorded IVR audio, voice selection, or anything not listed above.`;

const OTP = `Two-call phone verification
Use Miss OTP (missed call) first; offer Voice OTP ("get a call instead") as the fallback. Indian mobiles only (10 digits, starting 6 to 9).

Miss OTP: Verified in about 3 seconds once the user gives the missed call.
1. Server: POST /api/verify/start { phone, reference: yourUserId } -> { requestId, callNumber, instruction, expiresAt }. Save requestId against the user.
2. Show the user: "Give a missed call to <callNumber> from <phone>." Poll GET /api/verify/status/<requestId> every 2-3 s from YOUR server until verified or expired (5 minute window).
   Only mark the phone verified in your database when status is "verified" (or a signed webhook says so). Never trust the browser.

Voice OTP: we ring the number and read a 6-digit code aloud, in ${LANGUAGES.length} languages (${LANGUAGES.join(', ')}).
1. POST /api/verify/start { phone, method:"voice", language:"hi", reference } -> { id, status:"calling" }
2. User types the code. POST /api/verify/check { id, code } -> 200 { verified:true }. 400 includes attemptsLeft (5 attempts), 410 expired (10 minutes).
Limits: 3 voice calls per number per hour, 10 per day. Billed per answered call.

Webhook (optional, instead of polling): POST to your HTTPS callback URL with { event:"verification.verified", requestId, phone, reference, verifiedAt, timestamp } and header X-MissOTP-Signature = hex HMAC-SHA256 of the RAW body keyed with the site's signing secret. Compare in constant time; reject timestamp older than 5 minutes. One attempt, no retries: keep polling as a backup.`;

const WEBHOOKS = `Verify the verification webhook (header X-MissOTP-Signature, HMAC-SHA256 hex of the raw body):

// Node / Express
import crypto from 'node:crypto';
app.post('/webhooks/nacaller', express.raw({ type: 'application/json' }), (req, res) => {
  const sent = String(req.get('X-MissOTP-Signature') || '');
  const expected = crypto.createHmac('sha256', process.env.NACALLER_WEBHOOK_SECRET).update(req.body).digest('hex');
  const ok = sent.length === expected.length && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
  if (!ok) return res.status(401).end();
  const event = JSON.parse(req.body.toString('utf8'));
  if (Date.now() - event.timestamp > 5 * 60 * 1000) return res.status(400).end();
  // event.requestId is verified: mark that user's phone verified.
  res.sendStatus(204);
});

# Python
expected = hmac.new(SECRET, request.get_data(), hashlib.sha256).hexdigest()
if not hmac.compare_digest(request.headers.get("X-MissOTP-Signature", ""), expected): abort(401)

Call results webhook (call.completed) uses a DIFFERENT header: X-NaCaller-Signature = "sha256=" + hex HMAC-SHA256 of the raw body. Retried after 1 min, 5 min, 30 min, 2 h, 6 h; de-duplicate on call.id.`;

const CALLS = `Calls (nc_live_ key). Always confirm with the human before placing a real call: it dials a real phone and spends the key owner's minutes.
- agents_list first to get agent ids.
- calls_place { agent_id, phone, name?, variables?, language? }. variables are merge fields for the script, e.g. { fee_amount: "4500" } (names: lowercase letters, digits, underscore; max 20).
- calls_get returns summary, outcome, transcript and a signed recording link that lasts 10 minutes. Fetch again for a fresh one.
- Errors to expect: 404 agent_not_found, 403 contact_opted_out / number_blocked / international_not_allowed, 402 no_minutes, 422 outside_calling_hours (9 am to 9 pm IST), 429 daily_limit_reached.`;

const CAMPAIGNS = `Campaigns (nc_live_ key). A campaign dials every contact. The MCP server forces a two-step confirm and a contact cap (NACALLER_MAX_CONTACTS, default 100).
- campaigns_create without confirmation_token returns a dry-run summary and a token. Show it to the human. Only after they say yes, call again with the SAME arguments plus the token.
- The same person twice counts as one call; opted-out numbers are skipped, not dialled.
- Starts immediately inside 9 am to 9 pm IST, otherwise at the next 9 am (starts_at).
- campaigns_results returns totals and one row per contact (status, outcome, captured fields).
- The API does not report cost up front. Calls are billed per connected minute from the account's plan minutes then wallet.`;

const ERRORS = `Error codes
Developer API (/api/v1): { error: { code, message } }
 401 missing_api_key / invalid_api_key | 403 account_suspended, account_pending, phone_unverified, contact_opted_out, number_blocked, international_not_allowed
 400 invalid_request, invalid_json, invalid_cursor | 404 agent_not_found, call_not_found, campaign_not_found
 402 no_minutes | 409 calling_paused | 422 outside_calling_hours, all_contacts_opted_out
 429 rate_limited (300/min per key, Retry-After), daily_limit_reached | 503 unavailable | 500 internal_error
Verification (/api/verify): { error: "message" }
 400 invalid phone/method/language, wrong code (with attemptsLeft) | 401 bad key | 402 no credits | 403 number cannot be verified
 404 unknown request | 410 code expired | 429 rate limit | 502 call could not be placed | 503 not available`;

const nextjs = `// app/api/verify/start/route.ts  (Next.js App Router, server only)
import { NextResponse } from 'next/server';
const BASE = 'https://api.nacaller.com/api/verify';
const headers = { Authorization: \`Bearer \${process.env.NACALLER_KEY}\`, 'Content-Type': 'application/json' };

export async function POST(req: Request) {
  const { phone, userId } = await req.json();
  const r = await fetch(\`\${BASE}/start\`, { method: 'POST', headers, body: JSON.stringify({ phone, reference: userId }) });
  const data = await r.json();
  return NextResponse.json(data, { status: r.status });   // { requestId, callNumber, instruction, expiresAt }
}

// app/api/verify/status/[id]/route.ts
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await fetch(\`\${BASE}/status/\${encodeURIComponent(id)}\`, { headers });
  return NextResponse.json(await r.json(), { status: r.status });  // { status, verified }
}
// Voice OTP: POST \${BASE}/start with { phone, method: 'voice', language: 'hi' } then POST \${BASE}/check { id, code }.`;

const express = `// Express (server only). NACALLER_KEY lives in the environment.
import express from 'express';
const BASE = 'https://api.nacaller.com/api/verify';
const headers = { Authorization: \`Bearer \${process.env.NACALLER_KEY}\`, 'Content-Type': 'application/json' };
const app = express(); app.use(express.json());

app.post('/verify/start', async (req, res) => {
  const r = await fetch(\`\${BASE}/start\`, { method: 'POST', headers, body: JSON.stringify({ phone: req.body.phone, reference: req.user.id }) });
  res.status(r.status).json(await r.json());
});
app.get('/verify/status/:id', async (req, res) => {
  const r = await fetch(\`\${BASE}/status/\${encodeURIComponent(req.params.id)}\`, { headers });
  const data = await r.json();
  if (data.verified) { /* mark req.user's phone verified in YOUR database here */ }
  res.status(r.status).json({ status: data.status, verified: !!data.verified });
});`;

const django = `# Django view (server only). NACALLER_KEY in the environment.
import os, requests
from django.http import JsonResponse
from django.views.decorators.http import require_POST, require_GET

BASE = "https://api.nacaller.com/api/verify"
AUTH = {"Authorization": f"Bearer {os.environ['NACALLER_KEY']}"}

@require_POST
def verify_start(request):
    r = requests.post(f"{BASE}/start", headers=AUTH, timeout=10,
                      json={"phone": request.POST["phone"], "reference": str(request.user.id)})
    return JsonResponse(r.json(), status=r.status_code)

@require_GET
def verify_status(request, rid):
    r = requests.get(f"{BASE}/status/{rid}", headers=AUTH, timeout=10)
    data = r.json()
    if data.get("verified"):
        pass  # mark request.user's phone verified in your database here
    return JsonResponse({"status": data.get("status"), "verified": bool(data.get("verified"))}, status=r.status_code)`;

const laravel = `<?php // routes/web.php or a controller (server only). NACALLER_KEY in .env
use Illuminate\\Support\\Facades\\Http;
use Illuminate\\Http\\Request;

Route::post('/verify/start', function (Request $request) {
    $r = Http::withToken(env('NACALLER_KEY'))->acceptJson()->timeout(10)
        ->post('https://api.nacaller.com/api/verify/start', [
            'phone' => $request->input('phone'),
            'reference' => (string) $request->user()->id,
        ]);
    return response()->json($r->json(), $r->status());
});

Route::get('/verify/status/{id}', function (string $id) {
    $r = Http::withToken(env('NACALLER_KEY'))->acceptJson()->timeout(10)
        ->get('https://api.nacaller.com/api/verify/status/' . urlencode($id));
    if ($r->json('verified')) { /* mark the user's phone verified in your database */ }
    return response()->json(['status' => $r->json('status'), 'verified' => (bool) $r->json('verified')], $r->status());
});`;

const html = `<!-- Plain HTML form. The browser talks ONLY to YOUR server routes (/verify/start, /verify/status/:id),
     never to api.nacaller.com: the key must not reach the page. -->
<form id="f"><input name="phone" inputmode="numeric" maxlength="10" placeholder="10-digit mobile" required>
<button>Verify</button></form><p id="msg"></p>
<script>
f.onsubmit = async (e) => {
  e.preventDefault();
  const r = await fetch('/verify/start', { method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ phone: f.phone.value }) });
  const d = await r.json();
  if (!r.ok) return msg.textContent = d.error;
  msg.textContent = d.instruction;                 // "Give a missed call to <number> from <phone>..."
  const t = setInterval(async () => {
    const s = await (await fetch('/verify/status/' + d.requestId)).json();
    if (s.status !== 'pending') { clearInterval(t); msg.textContent = s.verified ? 'Verified' : 'Expired, try again'; }
  }, 2500);
};
</script>`;

export const TOPICS = {
  overview: OVERVIEW,
  otp: OTP,
  webhooks: WEBHOOKS,
  calls: CALLS,
  campaigns: CAMPAIGNS,
  errors: ERRORS,
  nextjs, express, django, laravel, html,
};
export const TOPIC_NAMES = Object.keys(TOPICS);

export const GUIDE = `# Integrate NaCaller\n\n${OVERVIEW}\n\n---\n${OTP}\n\n---\n${WEBHOOKS}\n\n---\n${ERRORS}`;
