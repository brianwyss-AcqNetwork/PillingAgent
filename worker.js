/**
 * Will Pilling Deal Scout — Cloudflare Worker Proxy
 * ─────────────────────────────────────────────────────────
 * Forwards browser requests to Anthropic's Messages API
 * with the API key held as an encrypted Worker secret.
 *
 * The browser never sees the API key.
 *
 * Setup:
 *   1. Cloudflare Dashboard → Workers & Pages → Create Worker
 *   2. Name: wp-scout
 *   3. Paste this code, deploy
 *   4. Settings → Variables → Add Secret:
 *        Name:  ANTHROPIC_API_KEY
 *        Value: sk-ant-... (your Anthropic key)
 *   5. Custom domain (optional): wp-scout.brian-wyss.workers.dev
 *      already provisioned by default at *.workers.dev
 *
 * Allowed origins (CORS) configured below — add your
 * GitHub Pages domain when you publish.
 */

const ALLOWED_ORIGINS = [
  'https://brianwyss-willpilling.github.io',
  'https://brianwyss-hswpartners.github.io',
  'https://brianwyss-acqnetwork.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'null'  // file:// origins for local testing
];

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // Health check
    if (request.method === 'GET') {
      return new Response(JSON.stringify({
        service: 'Will Pilling Deal Scout Proxy',
        operator: 'Brian Wyss · Avila Phoenix Ventures, LLC',
        status: 'online'
      }), {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: cors });
    }

    // Validate API key is configured
    if (!env.ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({
        error: 'ANTHROPIC_API_KEY secret not configured on Worker'
      }), {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    try {
      const rawBody = await request.text();

      // ── Model normalisation ──────────────────────────────────────────────
      // Rewrite any stale / short-form model strings to the current canonical
      // API identifiers so the frontend doesn't need to be redeployed every
      // time Anthropic rotates model names.
      let payload;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
          status: 400,
          headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }

      const MODEL_MAP = {
        // Short/legacy strings → current canonical IDs
        'claude-opus-4-7':            'claude-opus-4-5-20251101',
        'claude-opus-4-6':            'claude-opus-4-5-20251101',
        'claude-opus-4-5':            'claude-opus-4-5-20251101',
        'claude-sonnet-4-6':          'claude-sonnet-4-5-20251015',
        'claude-sonnet-4-5':          'claude-sonnet-4-5-20251015',
        'claude-haiku-4-5':           'claude-haiku-4-5-20251001',
      };
      if (payload.model && MODEL_MAP[payload.model]) {
        payload.model = MODEL_MAP[payload.model];
      }

      // ── Web-search tool: ensure correct type string ──────────────────────
      if (Array.isArray(payload.tools)) {
        payload.tools = payload.tools.map(t => {
          if (t.name === 'web_search' && t.type !== 'web_search_20250305') {
            return { type: 'web_search_20250305', name: 'web_search' };
          }
          return t;
        });
      }

      const body = JSON.stringify(payload);

      // Forward to Anthropic
      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'web-search-2025-03-05'
        },
        body
      });

      const responseBody = await upstream.text();

      return new Response(responseBody, {
        status: upstream.status,
        headers: {
          ...cors,
          'Content-Type': upstream.headers.get('Content-Type') || 'application/json'
        }
      });
    } catch (err) {
      return new Response(JSON.stringify({
        error: 'Proxy error',
        message: err.message
      }), {
        status: 502,
        headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }
  }
};
