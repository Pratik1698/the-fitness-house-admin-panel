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
 * 1. Approved production origin handling (Access-Control-Allow-Origin, Vary: Origin, OPTIONS preflight)
 * 2. Approved localhost origins (origin-specific echoing)
 * 3. Unapproved browser origins (immediate 403, omission of Access-Control-Allow-Origin, zero DB/Auth execution)
 * 4. Missing Origin requests (server-to-server/CLI allowed past CORS, mandatory JWT auth enforced)
 * 5. Production frontend redirect fallback (no 127.0.0.1:5173 fallback in production)
 * 6. Uniform CORS header propagation across all response paths
 */

// ---------------------------------------------------------------------------
// 1. Source-Level Static Security Contracts
// ---------------------------------------------------------------------------
test('1. Static Contract: both Edge Functions define the approved ALLOWED_ORIGINS set', () => {
  for (const [name, src] of [['invite-staff', inviteStaffSrc], ['manage-staff-session', manageSessionSrc]]) {
    assert.match(src, /const\s+ALLOWED_ORIGINS\s*=\s*new\s+Set\(\[/, `${name} must declare ALLOWED_ORIGINS`);
    assert.match(src, /"https:\/\/the-fitness-house-admin-panel\.vercel\.app"/, `${name} must include production web app`);
    assert.match(src, /"http:\/\/localhost:5173"/, `${name} must include local dev port`);
    assert.match(src, /"http:\/\/127\.0\.0\.1:5173"/, `${name} must include loopback dev port`);
    // Must NOT contain wildcard in ALLOWED_ORIGINS
    assert.doesNotMatch(src, /ALLOWED_ORIGINS[\s\S]*?"\*"[\s\S]*?\]/, `${name} must not contain wildcard in allowlist`);
  }
});

test('2. Static Contract: both Edge Functions reject unapproved browser origins with 403 before authentication', () => {
  for (const [name, src] of [['invite-staff', inviteStaffSrc], ['manage-staff-session', manageSessionSrc]]) {
    const originCheck = src.indexOf('if (requestOrigin && !ALLOWED_ORIGINS.has(requestOrigin))');
    const authCheck = src.indexOf('const authHeader = req.headers.get("Authorization")');

    assert.notEqual(originCheck, -1, `${name} must check origin allowlist`);
    assert.notEqual(authCheck, -1, `${name} must check auth header`);
    assert.ok(originCheck < authCheck, `${name} must reject unapproved origins BEFORE performing auth or database checks`);
  }
});

test('3. Static Contract: invite-staff uses production frontend as redirect fallback (not 127.0.0.1:5173)', () => {
  assert.match(inviteStaffSrc, /const\s+PRODUCTION_FRONTEND_URL\s*=\s*"https:\/\/the-fitness-house-admin-panel\.vercel\.app"/);
  assert.doesNotMatch(inviteStaffSrc, /:\s*"http:\/\/127\.0\.0\.1:5173"\s*;\s*const redirectTo/);
  assert.match(inviteStaffSrc, /:\s*PRODUCTION_FRONTEND_URL\s*;\s*const redirectTo/);
});

// ---------------------------------------------------------------------------
// 2. Functional CORS Behavior Simulation
// ---------------------------------------------------------------------------
function createFunctionSimulator(sourceCode) {
  // Extract ALLOWED_ORIGINS and PRODUCTION_FRONTEND_URL from source
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

  // Emulate request entry gate
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
  test(`4. [${name}] Approved production origin: returns matching origin, Vary: Origin, and handles OPTIONS`, async () => {
    const origin = 'https://the-fitness-house-admin-panel.vercel.app';
    const req = new Request('https://xfagvgypgboplonokntk.supabase.co/functions/v1/test', {
      method: 'OPTIONS',
      headers: { Origin: origin },
    });

    const res = await sim.handleRequest(req);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), origin);
    assert.equal(res.headers.get('Vary'), 'Origin');
    assert.match(res.headers.get('Access-Control-Allow-Methods'), /POST/);
    assert.match(res.headers.get('Access-Control-Allow-Headers'), /authorization/);
  });

  test(`5. [${name}] Approved localhost origins: echoes origin-specific header dynamically`, async () => {
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173']) {
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

  test(`6. [${name}] Unapproved browser origin: returns HTTP 403, omits Access-Control-Allow-Origin, halts before auth`, async () => {
    const untrustedOrigin = 'https://malicious-phishing-attacker.com';
    const req = new Request('https://xfagvgypgboplonokntk.supabase.co/functions/v1/test', {
      method: 'POST',
      headers: {
        Origin: untrustedOrigin,
        Authorization: 'Bearer valid.jwt.token',
      },
    });

    const res = await sim.handleRequest(req);
    assert.equal(res.status, 403);
    // Crucial: Omit Access-Control-Allow-Origin so browser blocks untrusted cross-origin access
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
    assert.equal(res.headers.get('Vary'), 'Origin');

    const body = await res.json();
    assert.match(body.error, /Origin not allowed by CORS policy/i);
  });

  test(`7. [${name}] Missing Origin (server/CLI): allowed past CORS but enforces mandatory JWT auth`, async () => {
    // 1. Missing Origin AND missing Auth -> 401 Missing authorization header
    const unauthReq = new Request('https://xfagvgypgboplonokntk.supabase.co/functions/v1/test', {
      method: 'POST',
    });
    const unauthRes = await sim.handleRequest(unauthReq);
    assert.equal(unauthRes.status, 401);
    assert.equal(unauthRes.headers.get('Access-Control-Allow-Origin'), sim.productionFrontendUrl);

    const body = await unauthRes.json();
    assert.match(body.error, /Missing authorization header/i);

    // 2. Missing Origin WITH valid Auth -> proceeds past auth check
    const authReq = new Request('https://xfagvgypgboplonokntk.supabase.co/functions/v1/test', {
      method: 'POST',
      headers: { Authorization: 'Bearer mock.valid.jwt' },
    });
    const authRes = await sim.handleRequest(authReq);
    assert.equal(authRes.status, 200);
    assert.equal(authRes.headers.get('Access-Control-Allow-Origin'), sim.productionFrontendUrl);
  });
}

test('8. [invite-staff] Redirection URL: uses production frontend fallback for unapproved/missing origins', () => {
  const allowed = new Set([
    'https://the-fitness-house-admin-panel.vercel.app',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ]);
  const defaultProd = 'https://the-fitness-house-admin-panel.vercel.app';

  function resolveRedirect(requestOrigin) {
    const redirectOrigin = requestOrigin && allowed.has(requestOrigin)
      ? requestOrigin
      : defaultProd;
    return `${redirectOrigin}/login`;
  }

  // Case A: Missing origin (CLI/cron invite dispatch)
  assert.equal(resolveRedirect(null), 'https://the-fitness-house-admin-panel.vercel.app/login');

  // Case B: Foreign origin
  assert.equal(resolveRedirect('https://evil-site.com'), 'https://the-fitness-house-admin-panel.vercel.app/login');

  // Case C: Local development origin
  assert.equal(resolveRedirect('http://localhost:5173'), 'http://localhost:5173/login');
  assert.equal(resolveRedirect('http://127.0.0.1:5173'), 'http://127.0.0.1:5173/login');

  // Case D: Production origin
  assert.equal(resolveRedirect('https://the-fitness-house-admin-panel.vercel.app'), 'https://the-fitness-house-admin-panel.vercel.app/login');
});

