import { metaErrorMessage } from './errors';

export type FetchFn = typeof fetch;

export interface MetaErrorBody {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
  error_data?: { details?: string };
  fbtrace_id?: string;
}

export class GraphError extends Error {
  readonly code: number | undefined;
  readonly subcode: number | undefined;
  readonly title: string | undefined;
  readonly details: string | undefined;
  readonly fbtraceId: string | undefined;

  constructor(
    readonly httpStatus: number,
    body: MetaErrorBody | undefined,
  ) {
    super(metaErrorMessage(body?.code, body?.error_user_msg ?? body?.message));
    this.name = 'GraphError';
    this.code = body?.code;
    this.subcode = body?.error_subcode;
    this.title = body?.error_user_title ?? body?.message;
    this.details = body?.error_data?.details;
    this.fbtraceId = body?.fbtrace_id;
  }

  /** Error jaringan/timeout/5xx yang aman diulang (hanya untuk request baca). */
  get retryable(): boolean {
    return this.httpStatus === 0 || this.httpStatus >= 500;
  }
}

export interface GraphClientOptions {
  version: string;
  fetch?: FetchFn;
  timeoutMs?: number;
  baseUrl?: string;
}

type Query = Record<string, string | number | undefined>;

export class GraphClient {
  private readonly fetchFn: FetchFn;
  private readonly base: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly token: string,
    opts: GraphClientOptions,
  ) {
    this.fetchFn = opts.fetch ?? fetch;
    this.base = `${opts.baseUrl ?? 'https://graph.facebook.com'}/${opts.version}`;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  /** GET dengan retry maksimal 2x untuk 5xx/jaringan. */
  async get<T>(path: string, query: Query = {}): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.request<T>('GET', this.url(path, query));
      } catch (err) {
        lastErr = err;
        if (!(err instanceof GraphError) || !err.retryable) throw err;
        await sleep(300 * 2 ** attempt);
      }
    }
    throw lastErr;
  }

  /** POST tidak pernah diulang otomatis: mengirim pesan dua kali lebih buruk daripada gagal sekali. */
  post<T>(path: string, body?: Record<string, unknown> | FormData): Promise<T> {
    return this.request<T>('POST', this.url(path), body);
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', this.url(path));
  }

  /** Unduh file dari URL media Meta (URL lengkap, butuh header Authorization yang sama). */
  async download(url: string): Promise<{ data: Buffer; contentType: string | null }> {
    const res = await this.raw('GET', url);
    if (!res.ok) throw new GraphError(res.status, await readError(res));
    return { data: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') };
  }

  private url(path: string, query: Query = {}): string {
    const u = new URL(`${this.base}/${path.replace(/^\//, '')}`);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) u.searchParams.set(k, String(v));
    return u.toString();
  }

  private async request<T>(method: string, url: string, body?: Record<string, unknown> | FormData): Promise<T> {
    const res = await this.raw(method, url, body);
    if (!res.ok) throw new GraphError(res.status, await readError(res));
    return (await res.json()) as T;
  }

  private async raw(method: string, url: string, body?: Record<string, unknown> | FormData): Promise<Response> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.token}` };
    let payload: string | FormData | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    try {
      return await this.fetchFn(url, { method, headers, body: payload, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (err) {
      const reason = err instanceof Error && err.name === 'TimeoutError' ? 'Meta tidak merespons (timeout).' : 'Tidak dapat terhubung ke Meta.';
      throw new GraphError(0, { message: reason });
    }
  }
}

async function readError(res: Response): Promise<MetaErrorBody | undefined> {
  const data = (await res.json().catch(() => null)) as { error?: MetaErrorBody } | null;
  return data?.error ?? { message: `HTTP ${res.status}` };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
