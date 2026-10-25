// Pass-through relay to Meta's Model API, so the Vultr worker reaches Meta from Cloudflare's network
// (Meta serves the worker's own address empty model catalogs and model_not_found).
// Only /<RELAY_TOKEN>/v1/* is forwarded, only to api.meta.ai. Nothing is logged or stored; the caller's
// own Meta key travels in its Authorization header. RELAY_TOKEN is set at deploy time, never committed.
const UPSTREAM = 'https://api.meta.ai';
const FORWARDED_HEADERS = ['authorization', 'content-type', 'accept'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const prefix = `/${env.RELAY_TOKEN}/v1/`;
    if (!env.RELAY_TOKEN || !url.pathname.startsWith(prefix) || !['GET', 'POST'].includes(request.method)) {
      return new Response('Not found', { status: 404 });
    }
    // Fresh headers: no client IP or forwarding headers reach Meta.
    const headers = new Headers();
    for (const name of FORWARDED_HEADERS) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    return fetch(`${UPSTREAM}/v1/${url.pathname.slice(prefix.length)}${url.search}`, {
      method: request.method,
      headers,
      body: request.method === 'POST' ? request.body : undefined,
    });
  },
};
