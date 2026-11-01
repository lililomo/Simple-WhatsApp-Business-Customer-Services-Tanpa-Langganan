import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';
import { loadConfig, type Config } from './config';
import { EventBus } from './lib/bus';
import { getAccount } from './modules/connection/service';
import { syncTemplates } from './modules/templates/service';
import { runHousekeeping } from './modules/housekeeping/service';
import { and, eq, isNull } from 'drizzle-orm';
import { getBusinessHours, saveBusinessHours, syncHolidays } from './modules/business-hours/service';
import { createApiKey } from './modules/api-keys/service';
import { apiKeys, outboundWebhooks } from './db/schema';
import { encrypt, randomBase62 } from './lib/crypto';
import { createDatabase, type Database } from './db/client';
import { runMigrations } from './db/migrate';
import { createUser } from './modules/users/service';
import { AppError } from './lib/errors';

type Command = (database: Database, args: string[], config: Config) => Promise<void>;

const commands: Record<string, Command> = {
  // Dijalankan cron aaPanel "WA Inbox – Housekeeping" setiap hari.
  housekeeping: async (database, _args, config) => {
    const deps = { config, database, bus: new EventBus() };
    const r = await runHousekeeping(deps);
    console.log(
      `Housekeeping: ${r.sessions} sesi, ${r.webhookEvents} event webhook, ${r.deliveries} delivery, ` +
        `${r.idempotencyKeys} idempotency key, ${r.mediaFiles} file media dihapus.`,
    );
    // Hari libur diperbarui sekalian setiap hari (bila API key api.co.id sudah diisi).
    const holidays = await syncHolidays(deps);
    console.log(holidays.error ? `Hari libur: ${holidays.error}` : `Hari libur disinkronkan: ${holidays.synced}.`);
  },

  // Dijalankan cron aaPanel "WA Inbox – Sinkron template".
  'templates:sync': async (database, _args, config) => {
    const deps = { config, database, bus: new EventBus() };
    const account = await getAccount(deps);
    if (!account) {
      console.log('Nomor WhatsApp belum terhubung; sinkron template dilewati.');
      return;
    }
    const result = await syncTemplates(deps, account);
    console.log(`Template disinkronkan: ${result.synced}, ditandai terhapus: ${result.deleted}.`);
  },

  // Integrasi portal kppbwi.app pengganti Kirimdev: API key (kirim pesan) + webhook keluar (pesan masuk ke
  // webhook billing portal). Mencetak baris .env portal ke stdout untuk langsung dialirkan ke berkas, tidak
  // untuk ditampilkan. Dijalankan ulang = kunci & secret lama dicabut/diganti.
  'portal:provision': async (database, _args, config) => {
    const { db } = database;
    const name = 'Portal kppbwi.app';
    await db.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.name, name), isNull(apiKeys.revokedAt)));
    const { key } = await createApiKey(db, name, ['messages:send', 'messages:read', 'media:write'], null);
    const url = `${config.PORTAL_URL.replace(/\/$/, '')}/WhatsApp/webhook/wa-inbox`;
    const secret = `whsec_${randomBase62(32)}`;
    await db.delete(outboundWebhooks).where(eq(outboundWebhooks.url, url));
    await db.insert(outboundWebhooks).values({ name: `${name} (billing)`, url, secretEnc: encrypt(secret, config.appKey), events: ['message.received'] });
    process.stdout.write(`WA_INBOX_URL=${config.APP_URL}\nWA_INBOX_API_KEY=${key}\nWA_INBOX_WEBHOOK_SECRET=${secret}\n`);
  },

  // API key api.co.id untuk hari libur, dibaca dari stdin agar tidak muncul di riwayat terminal.
  'holiday-key:set': async (database, _args, config) => {
    const key = (await readStdinLine()).trim();
    if (key.length < 8) throw new Error('API key kosong atau terlalu pendek.');
    const deps = { config, database, bus: new EventBus() };
    await saveBusinessHours(deps, await getBusinessHours(deps), key);
    const result = await syncHolidays(deps);
    console.log(result.error ? `API key disimpan, tetapi sinkron gagal: ${result.error}` : `API key disimpan; ${result.synced} hari libur disinkronkan.`);
  },

  'db:migrate': async ({ db }) => {
    await runMigrations(db);
    console.log('Migrasi database selesai.');
  },

  'user:create': async ({ db }, args) => {
    const { values } = parseArgs({
      args,
      options: {
        name: { type: 'string' },
        email: { type: 'string' },
        admin: { type: 'boolean', default: false },
        'password-stdin': { type: 'boolean', default: false },
      },
    });
    const name = values.name ?? (await ask('Nama: '));
    const email = values.email ?? (await ask('Email: '));
    const password = values['password-stdin'] ? await readStdinLine() : await askPassword();
    const user = await createUser(db, { name, email, password, role: values.admin ? 'admin' : 'agent' });
    console.log(`Pengguna dibuat: ${user.email} (${user.role}).`);
  },
};

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    }),
  );
}

async function readStdinLine(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0] ?? '';
}

// Membaca password tanpa menampilkannya di terminal.
async function askPassword(): Promise<string> {
  if (!process.stdin.isTTY) throw new Error('Terminal tidak interaktif. Pakai --password-stdin.');
  const first = await readHidden('Password: ');
  const second = await readHidden('Ulangi password: ');
  if (first !== second) throw new Error('Password tidak sama.');
  return first;
}

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    let value = '';
    const onData = (buf: Buffer) => {
      for (const ch of buf.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          cleanup();
          process.stdout.write('\n');
          return resolve(value);
        }
        if (ch === '\u0003') {
          cleanup();
          return reject(new Error('Dibatalkan.'));
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    const cleanup = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const [name, ...args] = process.argv.slice(2);
  const command = name ? commands[name] : undefined;
  if (!command) {
    console.error(`Perintah: ${Object.keys(commands).join(', ')}`);
    process.exit(1);
  }
  const config = loadConfig();
  const database = createDatabase(config.DATABASE_URL, 2);
  try {
    await command(database, args, config);
  } finally {
    await database.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof AppError || err instanceof Error ? err.message : err);
  process.exit(1);
});
