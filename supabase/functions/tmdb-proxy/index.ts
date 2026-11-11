/**
 * CineBox Server-Side TMDB API v3 Proxy (Supabase Edge Function / Cloudflare Worker compatible)
 *
 * Why this exists:
 * - Prevents shipping the TMDB API key inside the Android APK or web client bundle.
 * - Enforces an allowlist of read-only TMDB v3 endpoints (`/trending`, `/discover`, `/search`, `/movie`, `/tv`).
 *
 * Deployment (Supabase Edge Function):
 *   1. supabase secrets set TMDB_API_KEY="your_real_tmdb_v3_key"
 *   2. supabase functions deploy tmdb-proxy --no-verify-jwt
 *   3. Set VITE_TMDB_PROXY_URL="https://<project-ref>.supabase.co/functions/v1/tmdb-proxy" in .env
 */

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

const ALLOWED_PATH_PREFIXES = [
  '/trending/',
  '/discover/',
  '/search/',
  '/movie/',
  '/tv/',
  '/genre/',
];

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Cache-Control': 'public, max-age=300, s-maxage=600',
};

export async function handleTmdbProxyRequest(req: Request, tmdbApiKey: string): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed. Only GET is supported.' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  if (!tmdbApiKey || !tmdbApiKey.trim()) {
    return new Response(
      JSON.stringify({ error: 'Server TMDB_API_KEY secret is not configured on proxy.' }),
      {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      }
    );
  }

  const incomingUrl = new URL(req.url);
  // Support either ?endpoint=/trending/all/week or sub-path after /tmdb-proxy
  let endpoint = incomingUrl.searchParams.get('endpoint') || '';
  if (!endpoint) {
    const markerIdx = incomingUrl.pathname.indexOf('/tmdb-proxy');
    if (markerIdx !== -1) {
      endpoint = incomingUrl.pathname.slice(markerIdx + '/tmdb-proxy'.length);
    } else {
      endpoint = incomingUrl.pathname;
    }
  }

  if (!endpoint.startsWith('/')) {
    endpoint = `/${endpoint}`;
  }

  // Block path traversal or non-allowlisted endpoints
  if (
    endpoint.includes('..') ||
    !ALLOWED_PATH_PREFIXES.some((prefix) => endpoint.startsWith(prefix))
  ) {
    return new Response(
      JSON.stringify({ error: 'Forbidden TMDB endpoint path.', endpoint }),
      {
        status: 403,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      }
    );
  }

  const upstreamUrl = new URL(`${TMDB_BASE_URL}${endpoint}`);
  incomingUrl.searchParams.forEach((value, key) => {
    if (key !== 'endpoint' && key !== 'api_key') {
      upstreamUrl.searchParams.set(key, value);
    }
  });
  upstreamUrl.searchParams.set('api_key', tmdbApiKey.trim());

  try {
    const upstreamRes = await fetch(upstreamUrl.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    const bodyText = await upstreamRes.text();
    return new Response(bodyText, {
      status: upstreamRes.status,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
      },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        error: 'Upstream TMDB request failed',
        details: err?.message || 'Unknown error',
      }),
      {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      }
    );
  }
}

// Auto-register on Deno (Supabase Edge Functions) or Cloudflare Worker runtime if available
declare const Deno: any;
if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function') {
  Deno.serve((req: Request) => {
    const key = Deno.env.get('TMDB_API_KEY') || '';
    return handleTmdbProxyRequest(req, key);
  });
}
