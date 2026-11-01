import { eq } from 'drizzle-orm';
import type { Database } from '../../src/db/client';
import { waAccounts } from '../../src/db/schema';
import { encrypt } from '../../src/lib/crypto';
import { PHONE_ID, WABA_ID } from '../fixtures/meta';
import { testConfig } from './app';

export const APP_SECRET = 'appsecret-uji-0123456789';
export const VERIFY_TOKEN = 'VerifyTokenUji0123456789abcdefgh';
export const ACCESS_TOKEN = 'EAAGtokenuji1234567890';

/** Akun WhatsApp yang sudah "terhubung" tanpa lewat Graph API. */
export async function seedAccount(database: Database) {
  const key = testConfig().appKey;
  await database.db.insert(waAccounts).values({
    label: 'KPP Uji',
    appId: '111222333444',
    appSecretEnc: encrypt(APP_SECRET, key),
    wabaId: WABA_ID,
    phoneNumberId: PHONE_ID,
    displayPhoneNumber: '+62 812-200-627',
    verifiedName: 'KPP Pratama Banyuwangi',
    accessTokenEnc: encrypt(ACCESS_TOKEN, key),
    tokenLast4: ACCESS_TOKEN.slice(-4),
    verifyToken: VERIFY_TOKEN,
  });
  const [row] = await database.db.select().from(waAccounts).where(eq(waAccounts.phoneNumberId, PHONE_ID));
  return row!;
}
