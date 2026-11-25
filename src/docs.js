// Bundled integration guidance for the nacaller_docs tool and the MCP resource.
// Facts here match the public NaCaller docs: https://nacaller.com/docs/ai-agents

export const API_BASE_DEFAULT = 'https://api.nacaller.com';
export const LANGUAGES = ['te', 'hi', 'en', 'ta', 'kn', 'ml', 'mr', 'bn', 'or', 'gu'];

const OVERVIEW = `NaCaller API, as it exists today
Base URL: ${API_BASE_DEFAULT}  (JSON over HTTPS, Authorization: Bearer <key>)

Key types, created in the dashboard, all SERVER SECRETS. Keep the key in ONE env var, NACALLER_API_KEY (the MCP server reads the same name); never in browser code. For /api/verify it holds a site key (nck_live_), an account key with the otp scope (nc_live_) or, while building, a test key (nc_test_):
- nck_live_...  verification key (one per site). Endpoints: /api/verify/*  (Miss OTP, Voice OTP)
- nc_live_...   developer key with scopes (otp, calls, campaigns, read, agents, billing_link). Endpoints: /api/v1/*, and /api/verify/* when it holds the otp scope
- nc_test_...   test key (Settings, Developers, tick Test key): same endpoints, everything simulated, nothing real happens. START HERE when building or when an agent is driving.

Verification (nck_ key)
- POST /api/verify/start  { phone, reference? }                              missed call -> { requestId, callNumber, instruction, expiresAt }
- POST /api/verify/start  { phone, method:"voice", language, reference? }    voice OTP    -> { id, status:"calling", expiresAt }
- POST /api/verify/check  { id, code }                                       voice only   -> { verified:true } | 400 { verified:false, attemptsLeft } | 410 expired
- GET  /api/verify/status/:id                                                -> { requestId, method, phone, reference, status: pending|verified|expired, verified, verifiedAt, expiresAt }   (phone is the 10 digits it was started with, reference is what you sent)
Errors: { "error": "message" } with an HTTP status (400 bad number, 401 bad key, 402 no credits, 429 rate limit, 503 line not configured).
25 free verifications and 5 free voice calls per account, once, on its first site. nck_ keys have no sandbox (free credits run live); with an nc_test_ key OTP is simulated: voice start returns test_code 123456 and /check accepts it; a missed-call start returns callNumber +910000000000 with an instruction saying no call is needed, and that request reads as verified about 3 seconds later. Nothing is called. An nc_test_ key is accepted on /api/verify/start, /status and /check.
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
Test keys (nc_test_): same validation and errors as live, simulated objects marked test:true, no phone rung, no credits or wallet, no records. The Voice OTP test code is always 123456. Use one whenever you only need to see the flow work.
Campaign dry run: POST /api/v1/campaigns?dryRun=true returns { would_succeed, blockers, contacts:{received,valid,invalid,duplicates,opted_out,dialable}, estimated_cost_inr:{low,high,rate_per_minute_inr,assumptions}, wallet:{covers_estimate,shortfall_inr}, calling_hours, limits } and creates nothing.
OpenAPI 3.1: https://nacaller.com/openapi.json

NOT available today (do not invent): an SDK, deleting agents or flows, activating an agent through the API, paying or charging through the API, recorded IVR audio, voice selection, or anything not listed above.`;

const OTP = `Two-call phone verification
Use Miss OTP (missed call) first; offer Voice OTP ("get a call instead") as the fallback. Indian mobiles only (10 digits, starting 6 to 9).

SECURITY, bind the verification to the phone. "verified" only proves the requestId was verified for the phone it was started with. If your signup only asks "is this requestId verified?", a user can verify their OWN phone and then sign up with SOMEONE ELSE'S number and the same requestId, or reuse one verified requestId for many accounts. Every example below does this instead:
 (a) at /start, remember requestId -> phone on your server (a DB row or the session);
 (b) at signup (or whenever you save the phone), require that the requestId was issued for EXACTLY the phone being submitted, then re-read GET /status server side and require verified AND status.phone == that phone;
 (c) let a requestId be used once (atomic delete, or UPDATE ... WHERE used = false); make the phone column unique as a last backstop;
 (d) the key stays on the server; (e) fail closed if NaCaller is unreachable or answers non-JSON.
Never trust a browser that says it verified. The webhook payload also carries phone and reference: bind it the same way.

Miss OTP: Verified in about 3 seconds once the user gives the missed call.
1. Server: POST /api/verify/start { phone, reference } -> { requestId, callNumber, instruction, expiresAt }. Send a plain 10-digit number or +91...; both work. A signup form has no user yet, so use the phone or a signup session id as reference, not a user id. Save requestId -> phone.
2. Show the user: "Give a missed call to <callNumber> from <phone>." Poll GET /api/verify/status/<requestId> every 2-3 s from YOUR server until verified or expired (5 minute window). Return only { status, verified } to the browser.
3. Finish step (signup etc.): apply (b) and (c) above. Do not mark anything verified from the poll alone.

Testing with an nc_test_ key: missed call /start returns callNumber +910000000000 and an instruction saying no call is needed; the requestId reads pending, then verified about 3 seconds later, with phone and reference in the status, so you can test the phone binding end to end (swap the phone at signup: it must be refused). Voice OTP: no call is placed, /start returns test_code 123456 and /check accepts it. No credits used, nothing stored, no webhook sent; test requests live in memory and vanish on a restart (404). Check one real number with a live key before launch.

Voice OTP: we ring the number and read a 6-digit code aloud, in ${LANGUAGES.length} languages (${LANGUAGES.join(', ')}).
1. POST /api/verify/start { phone, method:"voice", language:"hi", reference } -> { id, status:"calling" }
2. User types the code. POST /api/verify/check { id, code } -> 200 { verified:true, id, phone, reference }. 400 includes attemptsLeft (5 attempts), 410 expired (10 minutes). Bind it the same way: the id was issued for this phone, the returned phone equals it, used once.
Limits: 3 voice calls per number per hour, 10 per day. Billed per answered call.

Webhook (optional, instead of polling): POST to your HTTPS callback URL with { event:"verification.verified", requestId, phone, reference, verifiedAt, timestamp } and header X-MissOTP-Signature = hex HMAC-SHA256 of the RAW body keyed with the site's signing secret (dashboard, Verify page, your site's card, "Webhook signing secret"; it is NOT the API key). Compare in constant time; reject timestamp older than 5 minutes. One attempt, no retries: keep polling as a backup.`;

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
  // event.requestId is verified. Bind it first: event.phone must equal the phone you issued that requestId for,
  // and a requestId may be used once. Then mark that phone verified.
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
Verification (/api/verify): { error: "message", code, message }
 400 invalid phone/method/language, wrong code (with attemptsLeft) | 401 bad key | 402 no credits | 403 number cannot be verified
 404 unknown request (also a test request after a restart) | 410 code expired | 429 rate limit | 502 call could not be placed | 503 not available`;

const nextjs = `// Next.js (App Router), Node 18+. Server only.
// lib/nacaller.ts
const BASE = "https://api.nacaller.com/api/verify";
export const last10 = (p: unknown) => String(p).replace(/\\D/g, "").slice(-10);
// requestId -> phone it was issued for. On serverless, memory is not shared between instances: use a database or Redis.
export const issued = new Map<string, string>();
export async function nc(path: string, init: RequestInit = {}) {   // never throws; copes with a non-JSON reply
  try {
    const r = await fetch(BASE + path, { ...init, signal: AbortSignal.timeout(10_000),
      headers: { Authorization: \`Bearer \${process.env.NACALLER_API_KEY}\`, "Content-Type": "application/json" } });
    return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) as any };
  } catch { return { ok: false, status: 502, data: { error: "Verification service unreachable" } as any }; }
}

// app/api/verify/start/route.ts
import { NextResponse } from "next/server";
import { nc, last10, issued } from "@/lib/nacaller";
export async function POST(req: Request) {
  const phone = last10((await req.json()).phone);
  const r = await nc("/start", { method: "POST", body: JSON.stringify({ phone, reference: phone }) });
  if (!r.ok) return NextResponse.json({ error: r.data.error || "Could not start" }, { status: r.status });
  issued.set(r.data.requestId, phone);                                   // (a) bind it to this phone
  const { requestId, callNumber, instruction, expiresAt } = r.data;
  return NextResponse.json({ requestId, callNumber, instruction, expiresAt });
}

// app/api/verify/status/[id]/route.ts   (the browser polls this)
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!issued.has(id)) return NextResponse.json({ error: "Unknown request" }, { status: 404 });
  const r = await nc(\`/status/\${encodeURIComponent(id)}\`);
  return NextResponse.json({ status: r.data.status, verified: !!r.data.verified }, { status: r.ok ? 200 : r.status });
}

// app/api/signup/route.ts   (the finish step: never trust the browser)
export async function POST(req: Request) {
  const body = await req.json(), phone = last10(body.phone);
  if (issued.get(body.requestId) !== phone) return NextResponse.json({ error: "Verify this number first" }, { status: 400 }); // (b)
  const r = await nc(\`/status/\${encodeURIComponent(body.requestId)}\`);
  if (!r.ok || !r.data.verified || r.data.phone !== phone) return NextResponse.json({ error: "Number not verified" }, { status: 400 });
  if (!issued.delete(body.requestId)) return NextResponse.json({ error: "Verification already used" }, { status: 400 });      // (c) once
  // create the account for \`phone\` here (make the phone column UNIQUE as a last backstop)
  return NextResponse.json({ ok: true });
}`;

const express = `// Express, Node 18+ (global fetch). Server only.
import express from "express";
const BASE = "https://api.nacaller.com/api/verify";
const headers = { Authorization: \`Bearer \${process.env.NACALLER_API_KEY}\`, "Content-Type": "application/json" };
const last10 = (p) => String(p).replace(/\\D/g, "").slice(-10);   // "+91 98765 43210" and "9876543210" both work
const issued = new Map();   // requestId -> phone it was issued for. A database table in production.

async function nc(path, init) {   // never throws; copes with a failed call or a non-JSON reply
  try {
    const r = await fetch(BASE + path, { ...init, headers, signal: AbortSignal.timeout(10_000) });
    return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
  } catch { return { ok: false, status: 502, data: { error: "Verification service unreachable" } }; }
}
const app = express(); app.use(express.json());

app.post("/verify/start", async (req, res) => {
  const phone = last10(req.body.phone);
  const r = await nc("/start", { method: "POST", body: JSON.stringify({ phone, reference: phone }) });
  if (!r.ok) return res.status(r.status).json({ error: r.data.error || "Could not start" });
  issued.set(r.data.requestId, phone);                                   // (a) bind it to this phone
  const { requestId, callNumber, instruction, expiresAt } = r.data;
  res.json({ requestId, callNumber, instruction, expiresAt });
});

app.get("/verify/status/:id", async (req, res) => {                      // the browser polls this
  if (!issued.has(req.params.id)) return res.status(404).json({ error: "Unknown request" });
  const r = await nc(\`/status/\${encodeURIComponent(req.params.id)}\`);
  res.status(r.ok ? 200 : r.status).json({ status: r.data.status, verified: !!r.data.verified });
});

app.post("/signup", async (req, res) => {                                // the finish step: never trust the browser
  const { requestId } = req.body, phone = last10(req.body.phone);
  if (issued.get(requestId) !== phone) return res.status(400).json({ error: "Verify this number first" });   // (b)
  const r = await nc(\`/status/\${encodeURIComponent(requestId)}\`);
  if (!r.ok || !r.data.verified || r.data.phone !== phone) return res.status(400).json({ error: "Number not verified" });
  if (!issued.delete(requestId)) return res.status(400).json({ error: "Verification already used" });         // (c) once
  // create the account for \`phone\` here (make the phone column UNIQUE as a last backstop)
  res.json({ ok: true });
});`;

const django = `# views.py (server only). pip install requests. Uses Django sessions to remember requestId -> phone.
import os, re, requests
from django.http import JsonResponse
from django.views.decorators.http import require_GET, require_POST

BASE = "https://api.nacaller.com/api/verify"
AUTH = {"Authorization": f"Bearer {os.environ['NACALLER_API_KEY']}"}

def last10(p): return re.sub(r"\\D", "", p or "")[-10:]   # "+91 98765 43210" and "9876543210" both work

def nc(method, path, **kw):   # never raises; a failed call or non-JSON reply is a failure, not a verification
    try:
        r = requests.request(method, BASE + path, headers=AUTH, timeout=10, **kw)
        try: data = r.json()
        except ValueError: data = {}
        return r.ok, r.status_code, data
    except requests.RequestException:
        return False, 502, {"error": "Verification service unreachable"}

@require_POST
def verify_start(request):
    phone = last10(request.POST.get("phone"))
    ok, status, d = nc("POST", "/start", json={"phone": phone, "reference": phone})
    if not ok:
        return JsonResponse({"error": d.get("error", "Could not start")}, status=status)
    issued = request.session.get("nc_issued", {})
    issued[d["requestId"]] = phone                                   # (a) bind it to this phone
    request.session["nc_issued"] = issued
    return JsonResponse({k: d.get(k) for k in ("requestId", "callNumber", "instruction", "expiresAt")})

@require_GET
def verify_status(request, rid):                                      # the browser polls this
    if rid not in request.session.get("nc_issued", {}):
        return JsonResponse({"error": "Unknown request"}, status=404)
    ok, status, d = nc("GET", f"/status/{rid}")
    return JsonResponse({"status": d.get("status"), "verified": bool(d.get("verified"))}, status=200 if ok else status)

@require_POST
def signup(request):                                                  # the finish step: never trust the browser
    rid, phone = request.POST.get("requestId", ""), last10(request.POST.get("phone"))
    issued = request.session.get("nc_issued", {})
    if issued.get(rid) != phone:                                      # (b) issued for exactly this phone
        return JsonResponse({"error": "Verify this number first"}, status=400)
    ok, _, d = nc("GET", f"/status/{rid}")
    if not ok or not d.get("verified") or d.get("phone") != phone:
        return JsonResponse({"error": "Number not verified"}, status=400)
    del issued[rid]; request.session["nc_issued"] = issued           # (c) single use
    # create the account for \`phone\` here (make the phone column unique as a last backstop)
    return JsonResponse({"ok": True})`;

const laravel = `<?php // routes/web.php (server only). NACALLER_API_KEY is in .env. The session remembers requestId -> phone.
use Illuminate\\Http\\Request;
use Illuminate\\Support\\Facades\\Http;

function last10($p) { return substr(preg_replace('/\\D/', '', (string) $p), -10); }   // "+91 98765 43210" and "9876543210" both work

function nc(string $method, string $path, array $body = []): array {   // never throws; non-JSON or a failed call is a failure
    try {
        $r = Http::withToken(env('NACALLER_API_KEY'))->acceptJson()->timeout(10)
            ->send($method, 'https://api.nacaller.com/api/verify' . $path, $body ? ['json' => $body] : []);
        return [$r->successful(), $r->status(), is_array($r->json()) ? $r->json() : []];
    } catch (\\Throwable $e) {
        return [false, 502, ['error' => 'Verification service unreachable']];
    }
}

Route::post('/verify/start', function (Request $request) {
    $phone = last10($request->input('phone'));
    [$ok, $status, $d] = nc('POST', '/start', ['phone' => $phone, 'reference' => $phone]);
    if (!$ok) return response()->json(['error' => $d['error'] ?? 'Could not start'], $status);
    $request->session()->put('nc_issued.' . $d['requestId'], $phone);       // (a) bind it to this phone
    return response()->json(array_intersect_key($d, array_flip(['requestId', 'callNumber', 'instruction', 'expiresAt'])));
});

Route::get('/verify/status/{id}', function (Request $request, string $id) {   // the browser polls this
    if (!$request->session()->has('nc_issued.' . $id)) return response()->json(['error' => 'Unknown request'], 404);
    [$ok, $status, $d] = nc('GET', '/status/' . urlencode($id));
    return response()->json(['status' => $d['status'] ?? null, 'verified' => !empty($d['verified'])], $ok ? 200 : $status);
});

Route::post('/signup', function (Request $request) {                          // the finish step: never trust the browser
    $rid = (string) $request->input('requestId'); $phone = last10($request->input('phone'));
    if ($request->session()->get('nc_issued.' . $rid) !== $phone) {              // (b) issued for exactly this phone
        return response()->json(['error' => 'Verify this number first'], 400);
    }
    [$ok, , $d] = nc('GET', '/status/' . urlencode($rid));
    if (!$ok || empty($d['verified']) || ($d['phone'] ?? null) !== $phone) {
        return response()->json(['error' => 'Number not verified'], 400);
    }
    $request->session()->forget('nc_issued.' . $rid);                            // (c) single use
    // create the account for $phone here (make the phone column unique as a last backstop)
    return response()->json(['ok' => true]);
});`;

const html = `<!-- The page talks ONLY to your own server routes (/verify/start, /verify/status/:id, /signup).
     Never call https://api.nacaller.com/api/verify from the browser: the key would be exposed. -->
<form id="f"><input name="phone" inputmode="numeric" maxlength="13" placeholder="10-digit mobile" required>
<button>Verify</button></form><p id="msg"></p>
<script>
const post = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
f.onsubmit = async (e) => {
  e.preventDefault();
  const phone = f.phone.value;                       // the number we started with: send this same one at signup
  const r = await post("/verify/start", { phone });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return (msg.textContent = d.error || "Could not start, try again");
  msg.textContent = d.instruction;                   // "Give a missed call to <number> from <phone>..."
  const t = setInterval(async () => {
    const s = await fetch("/verify/status/" + d.requestId).then(r => r.json()).catch(() => ({}));
    if (!s.status || s.status === "pending") return;
    clearInterval(t);
    if (!s.verified) return (msg.textContent = "Expired, try again");
    // The server re-checks everything: this requestId was issued for this phone, is verified, and is unused.
    const u = await post("/signup", { phone, requestId: d.requestId });
    msg.textContent = u.ok ? "Verified, you are signed up" : ((await u.json().catch(() => ({}))).error || "Could not finish");
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
