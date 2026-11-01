// Kirim webhook palsu bertanda tangan ke server lokal, untuk uji tanpa Meta.
//   npm run simulate -- text "Halo, mau tanya NPWP"
//   npm run simulate -- image | document | voice | location | contacts | button | reaction <wamid> | read <wamid>
// Membuat akun WhatsApp palsu di database dev bila belum ada. Tidak berjalan di produksi.
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { loadConfig } from '../server/src/config';
import { createDatabase } from '../server/src/db/client';
import { waAccounts } from '../server/src/db/schema';
import { decrypt, encrypt, randomBase62 } from '../server/src/lib/crypto';
import { inbound, PHONE_ID, sign, statusUpdate, WABA_ID } from '../server/test/fixtures/meta';

process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
const config = loadConfig();
if (config.NODE_ENV === 'production') {
  console.error('Simulasi webhook tidak boleh dijalankan di produksi.');
  process.exit(1);
}

const [kind = 'text', ...rest] = process.argv.slice(2);
const arg = rest.join(' ');
const builders: Record<string, () => unknown> = {
  text: () => inbound.text(arg || 'Halo, saya mau tanya soal NPWP.'),
  image: () => inbound.image(arg || 'Bukti setor'),
  document: () => inbound.document(arg || 'SPT-Tahunan.pdf'),
  voice: () => inbound.voice(),
  location: () => inbound.location(),
  contacts: () => inbound.contacts(),
  button: () => inbound.buttonReply(arg || 'Ya, lanjut'),
  reaction: () => inbound.reaction(rest[0] ?? '', rest[1] ?? '👍'),
  read: () => statusUpdate(rest[0] ?? '', 'read'),
  delivered: () => statusUpdate(rest[0] ?? '', 'delivered'),
};
const build = builders[kind];
if (!build) {
  console.error(`Jenis tidak dikenal. Pilihan: ${Object.keys(builders).join(', ')}`);
  process.exit(1);
}

const database = createDatabase(config.DATABASE_URL, 1);
let [account] = await database.db.select().from(waAccounts).where(eq(waAccounts.phoneNumberId, PHONE_ID));
if (!account) {
  await database.db.insert(waAccounts).values({
    label: 'Akun simulasi (dev)',
    appId: '100000000000001',
    appSecretEnc: encrypt('dev-app-secret-simulasi', config.appKey),
    wabaId: WABA_ID,
    phoneNumberId: PHONE_ID,
    displayPhoneNumber: '+62 812-0000-0000',
    verifiedName: 'KPP Simulasi',
    accessTokenEnc: encrypt('dev-token-simulasi', config.appKey),
    tokenLast4: 'ulas',
    verifyToken: randomBase62(32),
  });
  [account] = await database.db.select().from(waAccounts).where(eq(waAccounts.phoneNumberId, PHONE_ID));
  console.log('Akun WhatsApp simulasi dibuat di database dev.');
}
const secret = decrypt(account!.appSecretEnc, config.appKey);
await database.close();

const body = JSON.stringify(build());
const res = await fetch(`http://127.0.0.1:${config.PORT}/webhooks/meta`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body, secret) },
  body,
});
console.log(`${kind}: HTTP ${res.status}`);
