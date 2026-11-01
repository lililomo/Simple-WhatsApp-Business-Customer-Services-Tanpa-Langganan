import { z } from 'zod';

const digits = (label: string) => z.string().trim().regex(/^\d{5,32}$/, `${label} harus berupa angka`);

export const validateConnectionBody = z.object({
  appId: digits('App ID'),
  appSecret: z.string().trim().min(16, 'App Secret tidak valid'),
  wabaId: digits('WABA ID'),
  accessToken: z.string().trim().min(20, 'Token tidak valid'),
});

/** Menyimpan koneksi. Saat memperbarui, appSecret/accessToken boleh dikosongkan agar nilai lama dipakai. */
export const saveConnectionBody = z.object({
  label: z.string().trim().max(120).optional(),
  appId: digits('App ID'),
  appSecret: z.string().trim().optional(),
  wabaId: digits('WABA ID'),
  accessToken: z.string().trim().optional(),
  phoneNumberId: digits('Phone Number ID'),
});

export const registerPhoneBody = z.object({
  pin: z.string().regex(/^\d{6}$/, 'PIN harus 6 digit angka'),
});

export interface PhoneNumberInfo {
  id: string;
  displayPhoneNumber: string;
  verifiedName: string | null;
  qualityRating: string | null;
  codeVerificationStatus: string | null;
  platformType: string | null;
  status: string | null;
}

export interface WabaInfo {
  id: string;
  name: string | null;
  currency: string | null;
  timezoneId: string | null;
}

export interface ValidateConnectionResult {
  app: { id: string; name: string | null };
  waba: WabaInfo;
  phoneNumbers: PhoneNumberInfo[];
}

export type ConnectionStatus = 'active' | 'error' | 'disabled';

export interface ConnectionDTO {
  id: string;
  label: string;
  appId: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
  messagingLimit: string | null;
  tokenLast4: string;
  status: ConnectionStatus;
  lastError: string | null;
  lastWebhookAt: string | null;
  subscribedAt: string | null;
  callbackUrl: string;
  verifyToken: string;
}

/** Ringkasan untuk semua pengguna (banner status). */
export interface ConnectionStatusDTO {
  connected: boolean;
  status: ConnectionStatus | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  lastError: string | null;
  lastWebhookAt: string | null;
}

export interface ConnectionCheckItem {
  key: 'credentials' | 'subscription' | 'phone' | 'webhook';
  ok: boolean;
  warning?: boolean;
  message: string;
}
