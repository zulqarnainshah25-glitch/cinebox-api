// Supabase Edge Function: supabase/functions/cors-proxy/index.ts
// Deployed at: https://myeammfiwahmmemkoqif.supabase.co/functions/v1/cors-proxy
// Usage: GET https://myeammfiwahmmemkoqif.supabase.co/functions/v1/cors-proxy?target={original_url}
//
// Deploy command:
//   supabase functions deploy cors-proxy

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, range, x-requested-with',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const url = new URL(req.url);
    const target = (url.searchParams.get('target') || '').trim();

    if (!target || (!target.startsWith('https://') && !target.startsWith('http://'))) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid ?target=https://... URL parameter.' }),
        {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        }
      );
    }

    const forwardHeaders: Record<string, string> = {
      'User-Agent':
        req.headers.get('user-agent') ||
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
      Accept: req.headers.get('accept') || '*/*',
    };

    const rangeHeader = req.headers.get('range');
    if (rangeHeader) {
      forwardHeaders['Range'] = rangeHeader;
    }

    const upstreamRes = await fetch(target, {
      method: req.method === 'HEAD' ? 'HEAD' : 'GET',
      headers: forwardHeaders,
      redirect: 'follow',
    });

    const responseHeaders = new Headers(CORS_HEADERS);
    const contentType = upstreamRes.headers.get('content-type');
    if (contentType) responseHeaders.set('Content-Type', contentType);
    const contentLength = upstreamRes.headers.get('content-length');
    if (contentLength) responseHeaders.set('Content-Length', contentLength);
    const contentRange = upstreamRes.headers.get('content-range');
    if (contentRange) responseHeaders.set('Content-Range', contentRange);

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: responseHeaders,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unexpected CORS proxy error';
    return new Response(JSON.stringify({ error: message }), {
      status: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
