export interface GraphCall {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
  auth: string | undefined;
}

type Reply = { status?: number; json?: unknown; body?: Buffer; contentType?: string };
type Handler = (call: GraphCall) => Reply | Promise<Reply>;

/**
 * fetch palsu untuk Graph API. Kunci handler: "METHOD path" tanpa versi, mis. "GET 123/phone_numbers".
 * Request yang tidak punya handler dibalas error Meta 100 agar test gagal dengan jelas.
 */
export function fakeGraph(handlers: Record<string, Handler>) {
  const calls: GraphCall[] = [];
  const fetchFn = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const path = url.pathname.replace(/^\/v\d+\.\d+\//, '').replace(/^\//, '');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    let body: unknown = init?.body;
    if (typeof body === 'string') body = JSON.parse(body);
    const call: GraphCall = { method, path, query: Object.fromEntries(url.searchParams), body, auth: headers.authorization };
    calls.push(call);
    const handler = handlers[`${method} ${path}`] ?? handlers[`${method} ${url.origin}${url.pathname}`];
    if (!handler) {
      return new Response(JSON.stringify({ error: { message: `not mocked: ${method} ${path}`, code: 100 } }), { status: 400 });
    }
    const reply = await handler(call);
    if (reply.body) {
      return new Response(reply.body, { status: reply.status ?? 200, headers: { 'content-type': reply.contentType ?? 'application/octet-stream' } });
    }
    return new Response(JSON.stringify(reply.json ?? {}), {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch: fetchFn as typeof fetch, calls };
}

export const metaError = (code: number, message = 'error', status = 400): Reply => ({
  status,
  json: { error: { message, code, type: 'OAuthException', fbtrace_id: 'trace123' } },
});
