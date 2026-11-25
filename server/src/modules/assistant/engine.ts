import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { AosEffort, AosProvider } from '@wa/shared';
import type { AppDeps } from '../../types';
import { readKnowledge, searchKnowledge } from '../knowledge/service';

/**
 * Mesin AOS: satu panggilan ke Claude lewat Claude Agent SDK resmi (proses anak Claude Code). SDK ini menerima
 * token langganan (CLAUDE_CODE_OAUTH_TOKEN) maupun kunci API (ANTHROPIC_API_KEY), jadi kedua jalur koneksi memakai
 * alat, instruksi, dan alur yang sama; pindah jalur cukup mengganti kredensial (lihat providers.ts).
 */

export interface EngineCredential {
  provider: AosProvider;
  secret: string;
}

export interface EngineImage {
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  /** base64 tanpa awalan data: */
  data: string;
}

export interface EngineRequest {
  model: string;
  effort?: AosEffort;
  system: string;
  prompt: string;
  images?: EngineImage[];
  /** Internet hanya ke situs dalam daftar; null = tanpa internet. */
  web?: { domains: string[]; maxSearches: number } | null;
  /** Alat cari_pustaka dan baca_pustaka. */
  library?: boolean;
  maxTurns?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Teks giliran yang sedang ditulis (lengkap sejauh ini). */
  onText?: (text: string) => void;
  /** Langkah kerja: "Mencari di Pustaka…", "Membuka pajak.go.id…". */
  onStep?: (label: string) => void;
}

export interface EngineResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Dokumen Pustaka yang benar-benar dicari/dibaca pada panggilan ini: id → judul. */
  libraryDocs: Map<number, string>;
  /** Alamat web yang dibuka. */
  webUrls: string[];
}

/** limit/billing/overloaded/auth = masalah jalur, boleh pindah ke jalur cadangan; other = bukan masalah jalur. */
export type EngineErrorKind = 'limit' | 'billing' | 'overloaded' | 'auth' | 'cancelled' | 'other';

export class EngineError extends Error {
  constructor(
    readonly kind: EngineErrorKind,
    message: string,
    /** Waktu reset batas pemakaian (jalur langganan), bila dilaporkan. */
    readonly resetsAt?: Date,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

export type Engine = (deps: AppDeps, credential: EngineCredential, request: EngineRequest) => Promise<EngineResult>;

const SDK_ERRORS: Record<string, { kind: EngineErrorKind; message: string }> = {
  rate_limit: { kind: 'limit', message: 'Batas pemakaian jalur ini tercapai.' },
  billing_error: { kind: 'billing', message: 'Saldo atau tagihan jalur ini bermasalah.' },
  overloaded: { kind: 'overloaded', message: 'Layanan Claude sedang penuh.' },
  server_error: { kind: 'overloaded', message: 'Layanan Claude sedang bermasalah.' },
  authentication_failed: { kind: 'auth', message: 'Kredensial ditolak. Hubungkan ulang jalur ini.' },
  oauth_org_not_allowed: { kind: 'auth', message: 'Akun ini tidak diizinkan dipakai untuk koneksi ini.' },
  account_on_hold: { kind: 'auth', message: 'Akun Claude ini sedang ditahan.' },
  verification_required: { kind: 'auth', message: 'Akun Claude ini perlu diverifikasi dulu.' },
  model_not_found: { kind: 'other', message: 'Model yang dipilih tidak tersedia di jalur ini.' },
  invalid_request: { kind: 'other', message: 'Permintaan ditolak Claude.' },
  max_output_tokens: { kind: 'other', message: 'Jawaban terlalu panjang dan terpotong.' },
};

/** Status HTTP dari API Claude pada hasil yang gagal (`api_error_status`), bila SDK tidak memberi jenis galatnya. */
function errorFromStatus(status: unknown): { kind: EngineErrorKind; message: string } | undefined {
  if (typeof status !== 'number') return undefined;
  if (status === 401 || status === 403) return SDK_ERRORS.authentication_failed;
  if (status === 402) return SDK_ERRORS.billing_error;
  if (status === 429) return SDK_ERRORS.rate_limit;
  if (status === 404) return SDK_ERRORS.model_not_found;
  if (status >= 500) return SDK_ERRORS.overloaded;
  return undefined;
}

/** Variabel yang tidak boleh ikut ke proses anak: rahasia aplikasi dan penanda proyek aaPanel. */
const ENV_BLOCKED = new Set([
  'DATABASE_URL',
  'DATABASE_URL_TEST',
  'APP_KEY',
  'SESSION_SECRET',
  'PORTAL_SSO_SECRET',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'NODE_PROJECT_NAME',
  'DEV_ADMIN_EMAIL',
  'DEV_ADMIN_PASSWORD',
]);

type Sdk = typeof import('@anthropic-ai/claude-agent-sdk');
let sdkLoading: Promise<Sdk> | undefined;
const SDK_LOAD_TIMEOUT_MS = 20_000;

/**
 * SDK dimuat saat AOS pertama kali dipakai, bukan saat aplikasi menyala: aplikasi inti (inbox WhatsApp) tidak
 * boleh bergantung pada paket ini untuk bisa hidup. Pemuatan diberi batas waktu agar permintaan tidak menggantung.
 */
function loadSdk(): Promise<Sdk> {
  sdkLoading ??= import('@anthropic-ai/claude-agent-sdk');
  const loading = sdkLoading;
  loading.catch(() => {
    if (sdkLoading === loading) sdkLoading = undefined;
  });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), SDK_LOAD_TIMEOUT_MS);
  });
  return Promise.race([loading, timeout])
    .catch(() => {
      throw new EngineError('other', 'Mesin AOS (Claude Agent SDK) tidak bisa dimuat di server ini.');
    })
    .finally(() => clearTimeout(timer));
}

const hostAllowed = (host: string, domains: string[]) => domains.some((d) => host === d || host.endsWith(`.${d}`));

function sdkVersion(): string | null {
  try {
    const main = fileURLToPath(import.meta.resolve('@anthropic-ai/claude-agent-sdk'));
    return (JSON.parse(readFileSync(path.join(path.dirname(main), 'package.json'), 'utf8')) as { version?: string }).version ?? null;
  } catch {
    return null;
  }
}

/**
 * Di server, biner Claude Code (±400 MB) disimpan satu salinan per versi di <APP_DIR>/vendor (lihat activate.sh),
 * bukan di node_modules tiap release. Bila tidak ada di sana, SDK memakai biner bawaannya sendiri.
 */
export function claudeExecutable(deps: AppDeps): string | undefined {
  const version = sdkVersion();
  if (!version) return undefined;
  const candidate = path.resolve(deps.config.STORAGE_DIR, '..', 'vendor', 'claude-agent-sdk', version, process.platform === 'win32' ? 'claude.exe' : 'claude');
  return existsSync(candidate) ? candidate : undefined;
}

/** Salinan environment proses ini tanpa rahasia aplikasi, untuk proses anak Claude Code. */
export function cleanProcessEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) if (!ENV_BLOCKED.has(key)) env[key] = value;
  return env;
}

function childEnv(deps: AppDeps, credential: EngineCredential): Record<string, string | undefined> {
  const env = cleanProcessEnv();
  // Folder konfigurasi sendiri: terpisah dari sesi Claude Code lain di mesin ini.
  const configDir = path.resolve(deps.config.STORAGE_DIR, 'claude');
  mkdirSync(configDir, { recursive: true });
  env.CLAUDE_CONFIG_DIR = configDir;
  env.CLAUDE_AGENT_SDK_CLIENT_APP = 'wa-inbox-aos/1';
  env.DISABLE_AUTOUPDATER = '1';
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  if (credential.provider === 'api') env.ANTHROPIC_API_KEY = credential.secret;
  else env.CLAUDE_CODE_OAUTH_TOKEN = credential.secret;
  return env;
}

export const runEngine: Engine = async (deps, credential, req) => {
  const libraryDocs = new Map<number, string>();
  const webUrls: string[] = [];
  let searches = 0;

  // Dibatalkan sebelum sempat mulai (mis. selagi menunggu giliran): jangan menjalankan apa pun.
  if (req.signal?.aborted) throw new EngineError('cancelled', 'Dibatalkan.');
  const { createSdkMcpServer, query, tool } = await loadSdk();
  if (req.signal?.aborted) throw new EngineError('cancelled', 'Dibatalkan.');
  const abort = new AbortController();
  const onAbort = () => abort.abort();
  req.signal?.addEventListener('abort', onAbort);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    abort.abort();
  }, req.timeoutMs ?? 180_000);

  // Folder kerja sementara, bukan folder proyek: aaPanel mengenali proses proyek dari cwd-nya.
  const cwd = path.join(tmpdir(), 'wa-inbox-aos');
  mkdirSync(cwd, { recursive: true });

  const library = createSdkMcpServer({
    name: 'pustaka',
    version: '1.0.0',
    tools: [
      tool(
        'cari_pustaka',
        'Mencari di Pustaka kantor (aturan, panduan, catatan yang diunggah petugas). Kembalikan potongan teks yang relevan beserta id dokumen (P<id>) dan halamannya. Boleh dipanggil beberapa kali dengan kata kunci berbeda.',
        { kata_kunci: z.string().describe('Kata kunci pencarian dalam bahasa Indonesia, 2–6 kata.') },
        async ({ kata_kunci }) => {
          req.onStep?.('Mencari di Pustaka…');
          const hits = await searchKnowledge(deps, kata_kunci, 8);
          for (const h of hits) libraryDocs.set(Number(h.documentId), h.title);
          const text = hits.length
            ? hits
                .map((h) => `[P${h.documentId}${h.page ? ` hlm ${h.page}` : ''}] ${h.title}${h.isOfficial ? ' (sumber resmi)' : ''}\n${h.snippet}`)
                .join('\n\n')
            : 'Tidak ada hasil di Pustaka untuk kata kunci ini.';
          return { content: [{ type: 'text', text }] };
        },
      ),
      tool(
        'baca_pustaka',
        'Membaca isi satu dokumen Pustaka secara utuh atau satu halamannya, untuk memastikan bunyi aturan sebelum mengutip.',
        {
          id_dokumen: z.number().int().describe('Angka id dokumen, tanpa huruf P.'),
          halaman: z.number().int().optional().describe('Nomor halaman; kosongkan untuk membaca dari awal.'),
        },
        async ({ id_dokumen, halaman }) => {
          req.onStep?.('Membaca dokumen Pustaka…');
          const doc = await readKnowledge(deps, id_dokumen, halaman ?? null);
          if (!doc) return { content: [{ type: 'text', text: 'Dokumen tidak ditemukan atau tidak aktif.' }] };
          libraryDocs.set(id_dokumen, doc.title);
          const where = doc.page ? ` hlm ${doc.page}${doc.pageCount ? ` dari ${doc.pageCount}` : ''}` : '';
          return { content: [{ type: 'text', text: `[P${id_dokumen}${where}] ${doc.title}\n\n${doc.text}` }] };
        },
      ),
    ],
  });

  const options: Options = {
    model: req.model,
    effort: req.effort,
    systemPrompt: req.system,
    // Tidak ada shell atau akses berkas; hanya pencarian dan pembuka halaman web bila diizinkan.
    tools: req.web ? ['WebSearch', 'WebFetch'] : [],
    allowedTools: req.library ? ['mcp__pustaka__cari_pustaka', 'mcp__pustaka__baca_pustaka'] : [],
    mcpServers: req.library ? { pustaka: library } : {},
    strictMcpConfig: true,
    permissionMode: 'default',
    // Daftar situs dipaksakan di sini, bukan hanya diminta lewat instruksi.
    canUseTool: async (toolName, input) => {
      const web = req.web;
      if (web && toolName === 'WebSearch') {
        if (searches >= web.maxSearches) {
          return { behavior: 'deny', message: 'Batas pencarian untuk jawaban ini sudah tercapai. Susun jawaban dari yang sudah ditemukan.' };
        }
        searches++;
        req.onStep?.('Mencari di situs resmi…');
        const { blocked_domains: _blocked, ...rest } = input;
        return { behavior: 'allow', updatedInput: { ...rest, allowed_domains: web.domains } };
      }
      if (web && toolName === 'WebFetch') {
        let host = '';
        try {
          host = new URL(String(input.url)).hostname.toLowerCase();
        } catch {
          // alamat tidak valid: ditolak di bawah
        }
        if (!host || !hostAllowed(host, web.domains)) {
          return { behavior: 'deny', message: 'Situs ini tidak ada di daftar yang diizinkan. Pakai sumber lain yang diizinkan.' };
        }
        webUrls.push(String(input.url));
        req.onStep?.(`Membuka ${host}…`);
        return { behavior: 'allow', updatedInput: input };
      }
      return { behavior: 'deny', message: 'Alat ini tidak tersedia.' };
    },
    settingSources: [],
    persistSession: false,
    includePartialMessages: !!req.onText,
    maxTurns: req.maxTurns ?? 14,
    cwd,
    env: childEnv(deps, credential),
    abortController: abort,
    pathToClaudeCodeExecutable: claudeExecutable(deps),
  };

  // Mode masukan mengalir: dibutuhkan untuk gambar dan untuk canUseTool; aliran ditutup setelah hasil datang.
  let finish: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => (finish = resolve));
  const content: unknown[] = [
    ...(req.images ?? []).map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })),
    { type: 'text', text: req.prompt },
  ];
  async function* input(): AsyncGenerator<SDKUserMessage> {
    yield { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, session_id: '' } as unknown as SDKUserMessage;
    await finished;
  }

  let turnText = '';
  let lastText = '';
  let sdkError: string | undefined;
  let rejectedUntil: Date | undefined;
  let rateLimited = false;
  let result: Record<string, unknown> | undefined;

  // Jenis galat dari SDK (pesan asisten atau status HTTP pada hasil), bila ada.
  const classified = (): EngineError | undefined => {
    const known = (sdkError ? SDK_ERRORS[sdkError] : undefined) ?? errorFromStatus(result?.api_error_status);
    if (known) return new EngineError(known.kind, known.message, rejectedUntil);
    if (rateLimited) return new EngineError('limit', SDK_ERRORS.rate_limit!.message, rejectedUntil);
    return undefined;
  };

  try {
    for await (const message of query({ prompt: input(), options })) {
      const m = message as unknown as Record<string, unknown> & { type: string };
      if (m.type === 'stream_event' && m.parent_tool_use_id === null) {
        const ev = m.event as { type: string; delta?: { type: string; text?: string } };
        if (ev.type === 'message_start') turnText = '';
        else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
          turnText += ev.delta.text;
          req.onText?.(turnText);
        }
      } else if (m.type === 'assistant' && m.parent_tool_use_id === null) {
        if (typeof m.error === 'string') sdkError = m.error;
        const blocks = ((m.message as { content?: { type: string; text?: string }[] })?.content ?? []).filter((b) => b.type === 'text');
        const text = blocks.map((b) => b.text ?? '').join('');
        if (text.trim()) lastText = text;
      } else if (m.type === 'rate_limit_event') {
        const info = m.rate_limit_info as { status?: string; resetsAt?: number };
        if (info?.status === 'rejected') {
          rateLimited = true;
          if (info.resetsAt) rejectedUntil = new Date(info.resetsAt * (info.resetsAt < 1e12 ? 1000 : 1));
        }
      } else if (m.type === 'result') {
        result = m;
        finish();
      }
    }
  } catch (err) {
    finish();
    if (req.signal?.aborted) throw new EngineError('cancelled', 'Dibatalkan.');
    if (timedOut) throw new EngineError('other', 'AOS terlalu lama menjawab dan dihentikan.');
    // Untuk hasil yang gagal, SDK melempar galat setelah mengirim pesan hasilnya; jenisnya sudah tercatat di atas.
    throw classified() ?? new EngineError('other', err instanceof Error ? err.message.slice(0, 300) : 'Gagal menjalankan Claude.');
  } finally {
    clearTimeout(timer);
    req.signal?.removeEventListener('abort', onAbort);
    finish();
  }

  if (req.signal?.aborted) throw new EngineError('cancelled', 'Dibatalkan.');
  if (timedOut) throw new EngineError('other', 'AOS terlalu lama menjawab dan dihentikan.');

  const failed = !result || result.is_error === true || result.subtype !== 'success';
  if (failed) {
    const known = classified();
    if (known) throw known;
    const detail = typeof result?.result === 'string' ? result.result : typeof result?.subtype === 'string' ? result.subtype : 'tanpa keterangan';
    throw new EngineError('other', `Claude tidak menyelesaikan jawaban (${String(detail).slice(0, 200)}).`);
  }

  const usage = (result!.usage ?? {}) as Record<string, number | undefined>;
  return {
    text: (typeof result!.result === 'string' && result!.result.trim() ? result!.result : lastText).trim(),
    inputTokens: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
    outputTokens: usage.output_tokens ?? 0,
    costUsd: typeof result!.total_cost_usd === 'number' ? result!.total_cost_usd : 0,
    libraryDocs,
    webUrls,
  };
};
