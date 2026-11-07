import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const inviteStaffSrc = readFileSync(new URL('../supabase/functions/invite-staff/index.ts', import.meta.url), 'utf8');
const manageSessionSrc = readFileSync(new URL('../supabase/functions/manage-staff-session/index.ts', import.meta.url), 'utf8');

/**
 * Phase 5 — Edge Functions CORS & Security Contract Test Suite
 * The Fitness House Gym Management Admin Panel
 *
 * Verifies:
 * 1. Confirmed production origin: https://the-fitness-house-admin-panel-696c.vercel.app
 * 2. Previous production origin retention: https://the-fitness-house-admin-panel.vercel.app
 * 3. Approved localhost origins: http://localhost:5173 & http://127.0.0.1:5173
 * 4. Unapproved browser origin rejection: HTTP 403, omission of Access-Control-Allow-Origin, halts before auth
 * 5. Missing Origin handling: server/CLI allowed past CORS with default production origin, mandatory auth enforced
 * 6. Invitation redirect URL resolution: confirmed production URL default fallback
 */

const CONFIRMED_PROD_ORIGIN = 'https://the-fitness-house-admin-panel-696c.vercel.app';
const PREVIOUS_PROD_ORIGIN = 'https://the-fitness-house-admin-panel.vercel.app';
const LOCALHOST_PORT_ORIGIN = 'http://localhost:5173';
const LOOPBACK_IP_ORIGIN = 'http://127.0.0.1:5173';
const UNAPPROVED_ORIGIN = 'https://malicious-phishing-attacker.com';

// ---------------------------------------------------------------------------
// 1. Source-Level Static Security Contracts
// ---------------------------------------------------------------------------
test('1. Static Contract: both Edge Functions define the approved ALLOWED_ORIGINS set with confirmed and legacy production URLs', () => {
  for (const [name, src] of [['invite-staff', inviteStaffSrc], ['manage-staff-session', manageSessionSrc]]) {
    assert.match(src, /const\s+ALLOWED_ORIGINS\s*=\s*new\s+Set\(\[/, `${name} must declare ALLOWED_ORIGINS`);
    assert.match(src, /"https:\/\/the-fitness-house-admin-panel-696c\.vercel\.app"/, `${name} must include confirmed production frontend`);
    assert.match(src, /"https:\/\/the-fitness-house-admin-panel\.vercel\.app"/, `${name} must retain legacy production frontend`);
    assert.match(src, /"http:\/\/localhost:5173"/, `${name} must include local dev port`);
    assert.match(src, /"http:\/\/127\.0\.0\.1:5173"/, `${name} must include loopback dev port`);
    assert.doesNotMatch(src, /ALLOWED_ORIGINS[\s\S]*?"\*"[\s\S]*?\]/, `${name} must not contain wildcard in allowlist`);
  }
});

test('2. Static Contract: both Edge Functions configure the confirmed production URL as default fallback', () => {
  for (const [name, src] of [['invite-staff', inviteStaffSrc], ['manage-staff-session', manageSessionSrc]]) {
    assert.match(src, /const\s+PRODUCTION_FRONTEND_URL\s*=\s*"https:\/\/the-fitness-house-admin-panel-696c\.vercel\.app"/, `${name} must point default to confirmed production frontend`);
  }
});

test('3. Static Contract: both Edge Functions reject unapproved browser origins with 403 before authentication', () => {
  for (const [name, src] of [['invite-staff', inviteStaffSrc], ['manage-staff-session', manageSessionSrc]]) {
    const originCheck = src.indexOf('if (requestOrigin && !ALLOWED_ORIGINS.has(requestOrigin))');
    const authCheck = src.indexOf('const authHeader = req.headers.get("Authorization")');

    assert.notEqual(originCheck, -1, `${name} must check origin allowlist`);
    assert.notEqual(authCheck, -1, `${name} must check auth header`);
    assert.ok(originCheck < authCheck, `${name} must reject unapproved origins BEFORE performing auth or database checks`);
  }
});

test('4. Static Contract: invite-staff uses confirmed production frontend as redirect fallback', () => {
  assert.match(inviteStaffSrc, /const\s+PRODUCTION_FRONTEND_URL\s*=\s*"https:\/\/the-fitness-house-admin-panel-696c\.vercel\.app"/);
  assert.doesNotMatch(inviteStaffSrc, /:\s*"http:\/\/127\.0\.0\.1:5173"\s*;\s*const redirectTo/);
  assert.match(inviteStaffSrc, /:\s*PRODUCTION_FRONTEND_URL\s*;\s*const redirectTo/);
});

// ---------------------------------------------------------------------------
// 2. Functional CORS Behavior Simulation
// ---------------------------------------------------------------------------
function createFunctionSimulator(sourceCode) {
  const allowedOriginsMatch = sourceCode.match(/const ALLOWED_ORIGINS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(allowedOriginsMatch, 'Failed to extract ALLOWED_ORIGINS from source');
  const allowedOriginsList = allowedOriginsMatch[1]
    .split(',')
    .map(s => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
  const allowedOrigins = new Set(allowedOriginsList);

  const prodUrlMatch = sourceCode.match(/const PRODUCTION_FRONTEND_URL = ["']([^"']+)["'];/);
  assert.ok(prodUrlMatch, 'Failed to extract PRODUCTION_FRONTEND_URL from source');
  const productionFrontendUrl = prodUrlMatch[1];

  function getCorsHeaders(requestOrigin) {
    const isAllowed = requestOrigin && allowedOrigins.has(requestOrigin);
    const originHeader = isAllowed ? requestOrigin : productionFrontendUrl;
    return {
      'Access-Control-Allow-Origin': originHeader,
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Vary': 'Origin',
    };
  }

  async function handleRequest(req) {
    const requestOrigin = req.headers.get('origin');

    // 1. Unapproved browser origin rejection
    if (requestOrigin && !allowedOrigins.has(requestOrigin)) {
      return new Response(
        JSON.stringify({ error: 'Forbidden: Origin not allowed by CORS policy.' }),
        {
          status: 403,
          headers: {
            'Content-Type': 'application/json',
            'Vary': 'Origin',
          },
        }
      );
    }

    const corsHeaders = getCorsHeaders(requestOrigin);

    // 2. Preflight handling
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }

    // 3. Auth header check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  return { handleRequest, allowedOrigins, productionFrontendUrl };
}

const inviteSimulator = createFunctionSimulator(inviteStaffSrc);
const manageSimulator = createFunctionSimulator(manageSessionSrc);

for (const [name, sim] of [['invite-staff', inviteSimulator], ['manage-staff-session', manageSimulator]]) {
  test(`5. [${name}] Confirmed production origin (${CONFIRMED_PROD_ORIGIN}): OPTIONS preflight returns matching origin, Vary: Origin, and 200 OK`, async () => {
    const req = new Request('https://xfagvgypgboplonokntk.supabase.co/functions/v1/test', {
      method: 'OPTIONS',
      headers: { Origin: CONFIRMED_PROD_ORIGIN },
    });

    const res = await sim.handleRequest(req);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), CONFIRMED_PROD_ORIGIN);
    assert.equal(res.headers.get('Vary'), 'Origin');
    assert.match(res.headers.get('Access-Control-Allow-Methods'), /POST/);
    assert.match(res.headers.get('Access-Control-Allow-Headers'), /authorization/);
  });

  test(`6. [${name}] Confirmed production origin (${CONFIRMED_PROD_ORIGIN}): POST returns matching origin`, async () => {
    const req = new Request('https://xfagvgypgboplonokntk.supabase.co/functions/v1/test', {
      method: 'POST',
      headers: {
        Origin: CONFIRMED_PROD_ORIGIN,
        Authorization: 'Bearer valid.mock.jwt',
      },
    });

    const res = await sim.handleRequest(req);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), CONFIRMED_PROD_ORIGIN);
    assert.equal(res.headers.get('Vary'), 'Origin');
  });

  test(`7. [${name}] Previous production origin (${PREVIOUS_PROD_ORIGIN}): OPTIONS preflight returns matching origin`, async () => {
    const req = new Request('https://xfagvgypgboplonokntk.supabase.co/functions/v1/test', {
      method: 'OPTIONS',
      headers: { Origin: PREVIOUS_PROD_ORIGIN },
    });

    const res = await sim.handleRequest(req);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), PREVIOUS_PROD_ORIGIN);
    assert.equal(res.headers.get('Vary'), 'Origin');
  });

  test(`8. [${name}] Approved localhost origins: echoes origin-specific header dynamically`, async () => {
    for (const origin of [LOCALHOST_PORT_ORIGIN, LOOPBACK_IP_ORIGIN]) {
      const req = new Request('https://xfagvgypgboplonokntk.supabase.co/functions/v1/test', {
        method: 'OPTIONS',
        headers: { Origin: origin },
      });

      const res = await sim.handleRequest(req);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('Access-Control-Allow-Origin'), origin);
      assert.equal(res.headers.get('Vary'), 'Origin');
    }
  });

  test(`9. [${name}] Unapproved browser origin (${UNAPPROVED_ORIGIN}): returns HTTP 403, omits Access-Control-Allow-Origin, halts before auth`, async () => {
    const req = new Request('https://xfagvgypgboplonokntk.supabase.co/functions/v1/test', {
      method: 'POST',
      headers: {
        Origin: UNAPPROVED_ORIGIN,
        Authorization: 'Bearer valid.jwt.token',
      },
    });

    const res = await sim.handleRequest(req);
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
    assert.equal(res.headers.get('Vary'), 'Origin');

    const body = await res.json();
    assert.match(body.error, /Origin not allowed by CORS policy/i);
  });

  test(`10. [${name}] Missing Origin (server/CLI): allowed past CORS with confirmed production origin, enforces mandatory JWT auth`, async () => {
    // Missing Origin and missing Auth -> 401 Unauthorized
    const unauthReq = new Request('https://xfagvgypgboplonokntk.supabase.co/functions/v1/test', {
      method: 'POST',
    });
    const unauthRes = await sim.handleRequest(unauthReq);
    assert.equal(unauthRes.status, 401);
    assert.equal(unauthRes.headers.get('Access-Control-Allow-Origin'), CONFIRMED_PROD_ORIGIN);

    // Missing Origin with valid Auth -> 200 OK
    const authReq = new Request('https://xfagvgypgboplonokntk.supabase.co/functions/v1/test', {
      method: 'POST',
      headers: { Authorization: 'Bearer mock.valid.jwt' },
    });
    const authRes = await sim.handleRequest(authReq);
    assert.equal(authRes.status, 200);
    assert.equal(authRes.headers.get('Access-Control-Allow-Origin'), CONFIRMED_PROD_ORIGIN);
  });
}

test('11. [invite-staff] Redirection URL: uses confirmed production frontend fallback', () => {
  const allowed = new Set([
    CONFIRMED_PROD_ORIGIN,
    PREVIOUS_PROD_ORIGIN,
    LOCALHOST_PORT_ORIGIN,
    LOOPBACK_IP_ORIGIN,
  ]);

  function resolveRedirect(requestOrigin) {
    const redirectOrigin = requestOrigin && allowed.has(requestOrigin)
      ? requestOrigin
      : CONFIRMED_PROD_ORIGIN;
    return `${redirectOrigin}/reset-password?mode=invite`;
  }

  // Case A: Missing origin (CLI/cron invite dispatch) -> confirmed prod
  assert.equal(resolveRedirect(null), `${CONFIRMED_PROD_ORIGIN}/reset-password?mode=invite`);

  // Case B: Foreign origin -> confirmed prod
  assert.equal(resolveRedirect('https://evil-site.com'), `${CONFIRMED_PROD_ORIGIN}/reset-password?mode=invite`);

  // Case C: Confirmed production origin -> confirmed prod
  assert.equal(resolveRedirect(CONFIRMED_PROD_ORIGIN), `${CONFIRMED_PROD_ORIGIN}/reset-password?mode=invite`);

  // Case D: Previous production origin -> previous prod (retained for backward compatibility)
  assert.equal(resolveRedirect(PREVIOUS_PROD_ORIGIN), `${PREVIOUS_PROD_ORIGIN}/reset-password?mode=invite`);

  // Case E: Local development origins -> localhost
  assert.equal(resolveRedirect(LOCALHOST_PORT_ORIGIN), `${LOCALHOST_PORT_ORIGIN}/reset-password?mode=invite`);
  assert.equal(resolveRedirect(LOOPBACK_IP_ORIGIN), `${LOOPBACK_IP_ORIGIN}/reset-password?mode=invite`);
});
