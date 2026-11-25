import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AosLoginStartDTO } from '@wa/shared';
import { AppError } from '../../lib/errors';
import type { AppDeps } from '../../types';
import { claudeExecutable, cleanProcessEnv } from './engine';
import { setCredential } from './settings';

/**
 * Menghubungkan langganan Claude tanpa terminal: admin menekan tombol, membuka tautan login Claude, lalu menempel
 * kode yang ditampilkan Claude. Di belakangnya server menjalankan perintah resmi `claude setup-token` (CLI Claude
 * Code yang sama dengan yang dipakai AOS) di terminal semu: CLI itulah yang membuat tautan, menukar kode, dan
 * menghasilkan token berumur satu tahun. Aplikasi hanya meneruskan tautan dan kode, lalu menyimpan tokennya
 * terenkripsi. Tokennya sendiri tidak pernah dikirim ke browser.
 */

/** Perintah yang dijalankan; diganti tiruan di test lewat `AppDeps.aosLoginCommand`. */
export interface LoginCommand {
  command: string;
  args: string[];
}

interface LoginSession {
  child: ChildProcess;
  /** Keluaran mentah CLI (dengan kode kendali terminal). Tidak pernah dicatat ke log. */
  raw: string;
  dir: string;
  expiresAt: Date;
  timer: NodeJS.Timeout;
  submitting: boolean;
}

const SESSION_TTL_MS = 10 * 60_000;
const URL_TIMEOUT_MS = 25_000;
const TOKEN_TIMEOUT_MS = 60_000;
/** Jeda antara mengetik kode dan menekan Enter; lihat finishSubscriptionLogin. */
const ENTER_DELAY_MS = 600;
const MAX_OUTPUT = 400_000;
/** Tautan hanya diteruskan ke browser bila menuju halaman login milik Anthropic. */
// eslint-disable-next-line no-control-regex
const LOGIN_URL = /https:\/\/(?:claude\.ai|claude\.com|platform\.claude\.com|console\.anthropic\.com)\/[^\s\x07\x1b"'<>]*oauth\/authorize[^\s\x07\x1b"'<>]*/;
const TOKEN = /sk-ant-oat\d{2}-[A-Za-z0-9_-]{20,}/;
const CODE = /^[A-Za-z0-9_\-#.~+=/%:]{8,2000}$/;

const sessions = new WeakMap<AppDeps, LoginSession>();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Teks yang terlihat di terminal: kode kendali dibuang, perpindahan kolom dijadikan spasi. */
export function visibleText(raw: string): string {
  return (
    raw
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[\d*[GC]/g, ' ')
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b[()][A-Za-z0-9]/g, '')
      .replace(/\r/g, '')
  );
}

function defaultCommand(deps: AppDeps): LoginCommand {
  if (process.platform !== 'linux') {
    throw new AppError(501, 'aos_login_unavailable', 'Masuk lewat tautan hanya tersedia di server. Di sini, tempel token secara manual.');
  }
  const bin = claudeExecutable(deps);
  if (!bin) {
    throw new AppError(501, 'aos_login_unavailable', 'Biner Claude Code tidak ditemukan di server. Tempel token secara manual.');
  }
  // CLI ini butuh terminal; `script` (util-linux) menyediakan terminal semu. Lebar 4000 kolom agar tautan dan
  // token tidak terpotong menjadi beberapa baris.
  return { command: 'script', args: ['-qfc', `stty cols 4000 rows 50 2>/dev/null; exec '${bin.replace(/'/g, `'\\''`)}' setup-token`, '/dev/null'] };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Hentikan proses beserta anaknya (`script` menjalankan CLI sebagai anak di sesi terminal tersendiri). */
function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  const children: number[] = [];
  if (process.platform === 'linux') {
    try {
      const out = execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8', timeout: 3000 });
      children.push(...out.split('\n').map(Number).filter((n) => Number.isInteger(n) && n > 1));
    } catch {
      // Tidak ada anak (pgrep keluar 1) atau pgrep tidak tersedia.
    }
  }
  const signal = (sig: NodeJS.Signals) => {
    for (const p of [...children, pid]) {
      try {
        process.kill(p, sig);
      } catch {
        // sudah berhenti
      }
    }
  };
  signal('SIGTERM');
  setTimeout(() => {
    if ([...children, pid].some(alive)) signal('SIGKILL');
  }, 2500).unref();
}

async function endSession(deps: AppDeps, session: LoginSession): Promise<void> {
  if (sessions.get(deps) === session) sessions.delete(deps);
  clearTimeout(session.timer);
  killTree(session.child);
  session.raw = '';
  await rm(session.dir, { recursive: true, force: true }).catch(() => undefined);
}

export async function cancelSubscriptionLogin(deps: AppDeps): Promise<void> {
  const session = sessions.get(deps);
  if (session) await endSession(deps, session);
}

/** Mulai login: jalankan CLI, tunggu sampai tautan loginnya muncul, kembalikan tautan itu. */
export async function startSubscriptionLogin(deps: AppDeps): Promise<AosLoginStartDTO> {
  await cancelSubscriptionLogin(deps);
  const dir = await mkdtemp(path.join(tmpdir(), 'wa-inbox-aos-login-'));
  let child: ChildProcess;
  try {
    const { command, args } = deps.aosLoginCommand?.(dir) ?? defaultCommand(deps);
    child = spawn(command, args, {
      cwd: dir,
      stdio: ['pipe', 'pipe', 'pipe'],
      // Folder konfigurasi sekali pakai: login ini tidak menyentuh konfigurasi Claude Code lain di mesin ini.
      env: { ...cleanProcessEnv(), HOME: dir, CLAUDE_CONFIG_DIR: path.join(dir, 'cfg'), TERM: 'xterm-256color', DISABLE_AUTOUPDATER: '1' },
      windowsHide: true,
    });
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }

  const session: LoginSession = {
    child,
    raw: '',
    dir,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    timer: setTimeout(() => void endSession(deps, session), SESSION_TTL_MS),
    submitting: false,
  };
  session.timer.unref();
  const collect = (chunk: Buffer) => {
    session.raw = (session.raw + chunk.toString('utf8')).slice(-MAX_OUTPUT);
  };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);
  let failed: string | null = null;
  child.on('error', (err) => {
    failed = err.message;
  });
  // Galat menulis ke proses yang sudah berhenti tidak boleh menjatuhkan aplikasi.
  child.stdin?.on('error', () => undefined);
  sessions.set(deps, session);

  const deadline = Date.now() + URL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const url = LOGIN_URL.exec(session.raw)?.[0];
    // Tautan dianggap lengkap setelah ada keluaran lain sesudahnya (CLI menulisnya dalam beberapa potong).
    if (url && session.raw.length > session.raw.indexOf(url) + url.length) {
      return { url, expiresAt: session.expiresAt.toISOString() };
    }
    if (failed !== null || child.exitCode !== null || child.signalCode !== null) break;
    await sleep(150);
  }
  await endSession(deps, session);
  deps.log?.warn({ spawnError: failed, exitCode: child.exitCode }, 'aos: subscription login did not produce a link');
  throw new AppError(502, 'aos_login_failed', 'Tidak bisa menyiapkan tautan login Claude di server. Coba lagi, atau tempel token secara manual.');
}

/** Teruskan kode dari halaman login ke CLI, tunggu tokennya, lalu simpan sebagai kredensial jalur langganan. */
export async function finishSubscriptionLogin(deps: AppDeps, rawCode: string, userId: number): Promise<void> {
  const session = sessions.get(deps);
  if (!session || session.child.exitCode !== null || session.child.signalCode !== null) {
    if (session) await endSession(deps, session);
    throw new AppError(409, 'aos_login_expired', 'Sesi login sudah berakhir. Buat tautan baru lalu ulangi.');
  }
  const code = rawCode.replace(/\s+/g, '');
  // Pemeriksaan bentuk dilakukan di sini (sama dengan yang dilakukan CLI) supaya salah salin tidak menghabiskan
  // sesi login: admin cukup menyalin ulang kodenya dari halaman Claude yang masih terbuka.
  if (/^https?:\/\//i.test(code)) {
    throw new AppError(400, 'aos_login_code_format', 'Itu alamat web, bukan kodenya. Tempel kode yang ditampilkan halaman Claude setelah Anda masuk.');
  }
  // Hanya karakter yang wajar untuk sebuah kode: tidak boleh ada karakter kendali yang ikut diketik ke terminal.
  if (!CODE.test(code)) {
    throw new AppError(400, 'aos_login_code_format', 'Kode tidak dikenali. Salin seluruh kode dari halaman Claude, tanpa tambahan apa pun.');
  }
  const [authCode, state] = code.split('#');
  if (!authCode || !state) {
    throw new AppError(400, 'aos_login_code_format', 'Kode belum lengkap. Salin seluruhnya dari halaman Claude, termasuk tanda # di tengahnya.');
  }
  if (session.submitting) throw new AppError(409, 'aos_login_busy', 'Kode sebelumnya masih diproses. Tunggu sebentar.');
  session.submitting = true;

  const from = session.raw.length;
  const stdin = session.child.stdin;
  // Kode dan Enter harus dikirim terpisah. Bila sekaligus, CLI menganggap semuanya tempelan dan Enter-nya tidak
  // pernah dihitung sebagai penekanan tombol: kode hanya mengisi kotaknya dan CLI menunggu tanpa akhir.
  stdin?.write(code);
  await sleep(ENTER_DELAY_MS);
  stdin?.write('\r');

  const exited = () => session.child.exitCode !== null || session.child.signalCode !== null;
  const deadline = Date.now() + TOKEN_TIMEOUT_MS;
  let token = '';
  let shown: string | null = null;
  let nudged = false;
  const sentAt = Date.now();
  while (Date.now() < deadline) {
    token = TOKEN.exec(session.raw)?.[0] ?? '';
    if (token) {
      // Beri waktu sejenak agar token yang ditulis bertahap tidak terpotong.
      await sleep(400);
      token = TOKEN.exec(session.raw)?.[0] ?? token;
      break;
    }
    const since = visibleText(session.raw.slice(from));
    shown = cliProblem(since);
    if (shown) break;
    if (exited()) {
      // Keluaran terakhir bisa tiba sesaat setelah proses berhenti.
      await sleep(400);
      token = TOKEN.exec(session.raw)?.[0] ?? '';
      break;
    }
    // Belum ada tanda kode diproses: tekan Enter sekali lagi (aman selama CLI masih di kotak kode).
    if (!nudged && Date.now() - sentAt > 6000 && !/Finishing sign/i.test(since)) {
      nudged = true;
      stdin?.write('\r');
    }
    await sleep(200);
  }

  const lastLines = token || shown ? null : cliLastLines(visibleText(session.raw.slice(from)), [code, authCode, state]);
  await endSession(deps, session);
  if (token) {
    await setCredential(deps, 'subscription', token, userId);
    return;
  }
  // Tidak memuat rahasia: hanya teks galat yang ditampilkan CLI (kode dan token sudah disaring).
  deps.log?.warn({ shown: shown ?? lastLines }, 'aos: subscription login did not produce a token');
  if (shown && /wasn't accepted|Invalid state/i.test(shown)) {
    throw new AppError(400, 'aos_login_code', 'Kode tidak diterima Claude: mungkin kedaluwarsa, sudah pernah dipakai, atau berasal dari tautan sebelumnya. Buat tautan baru lalu ulangi.');
  }
  if (shown && /full code|# in the middle/i.test(shown)) {
    throw new AppError(400, 'aos_login_code', 'Claude menilai kodenya belum lengkap. Buat tautan baru, lalu salin seluruh kode termasuk tanda # di tengahnya.');
  }
  if (shown) {
    throw new AppError(400, 'aos_login_code', `Claude menolak login ini: "${shown}". Buat tautan baru lalu ulangi, atau tempel token secara manual.`);
  }
  throw new AppError(
    504,
    'aos_login_timeout',
    `Claude tidak menjawab setelah kode dikirim${lastLines ? ` (tampilan terakhir: "${lastLines}")` : ''}. Buat tautan baru lalu ulangi, atau tempel token secara manual.`,
  );
}

/** Baris yang hanya berisi bingkai, animasi tunggu, atau isi kotak kode yang disamarkan. */
const NOISE = /^[\s╭╮╰╯│─━·*✢✶✻✽✳∗]*$|^\*+[A-Za-z0-9_#-]{0,12}$/;

function cliLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/[╭╮╰╯│─━]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((line) => line && !NOISE.test(line));
}

/**
 * Pesan galat yang ditampilkan CLI setelah kode dikirim (ditandai ✘ atau diikuti "Press Enter to retry"), atau null
 * bila belum ada. Baris lanjutannya ikut diambil.
 */
export function cliProblem(text: string): string | null {
  const lines = cliLines(text);
  const at = lines.findIndex((line) => /^[✘✗×]/.test(line) || /OAuth error/i.test(line));
  if (at < 0) return /Press Enter to retry/i.test(text) ? 'Claude meminta login diulang.' : null;
  const message = [lines[at]!.replace(/^[✘✗×]\s*/, ''), ...lines.slice(at + 1, at + 3).filter((line) => !/Press Enter|Esc\b/i.test(line))].join(' ');
  return redact(message, []).slice(0, 300);
}

/** Beberapa baris terakhir yang terlihat, untuk menjelaskan kenapa tidak ada jawaban. Kode dan token disaring. */
function cliLastLines(text: string, secrets: string[]): string | null {
  const lines = [...new Set(cliLines(text))].filter((line) => !/Finishing sign/i.test(line)).slice(-2);
  const joined = redact(lines.join(' / '), secrets).slice(0, 200);
  return joined || null;
}

function redact(text: string, secrets: string[]): string {
  let out = text.replace(/sk-ant-[A-Za-z0-9_-]+/g, '[token]').replace(/\*{3,}[A-Za-z0-9_#-]*/g, '');
  for (const secret of secrets) if (secret.length >= 6) out = out.split(secret).join('[kode]');
  return out.replace(/"/g, "'").replace(/\s+/g, ' ').trim();
}
