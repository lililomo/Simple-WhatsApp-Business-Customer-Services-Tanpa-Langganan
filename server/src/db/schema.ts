import {
  bigint,
  boolean,
  char,
  customType,
  datetime,
  index,
  int,
  longtext,
  mediumtext,
  mysqlEnum,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

// MariaDB menyimpan JSON sebagai LONGTEXT dan mysql2 mengembalikannya sebagai string,
// sedangkan kolom json bawaan Drizzle tidak mem-parse. Tipe ini menangani keduanya.
const jsonText = <T>(name: string) =>
  customType<{ data: T; driverData: string }>({
    dataType: () => 'json',
    toDriver: (value) => JSON.stringify(value),
    fromDriver: (value) => (typeof value === 'string' ? (JSON.parse(value) as T) : (value as T)),
  })(name);

const id = () => bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey();
const ref = (name: string) => bigint(name, { mode: 'number', unsigned: true });
const ts = (name: string) => datetime(name, { mode: 'date', fsp: 3 });
const createdAt = () =>
  ts('created_at')
    .notNull()
    .$defaultFn(() => new Date());
const updatedAt = () =>
  ts('updated_at')
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date());

export const users = mysqlTable('users', {
  id: id(),
  name: varchar('name', { length: 120 }).notNull(),
  /** Hanya akun lokal (login darurat). Pegawai dari portal kppbwi.app dikenali lewat NIP. */
  email: varchar('email', { length: 190 }).unique(),
  passwordHash: varchar('password_hash', { length: 255 }),
  role: mysqlEnum('role', ['admin', 'agent']).notNull().default('agent'),
  isActive: boolean('is_active').notNull().default(true),
  /** local = akun darurat dengan password; portal = masuk lewat SSO kppbwi.app. */
  authSource: mysqlEnum('auth_source', ['local', 'portal']).notNull().default('local'),
  nip: varchar('nip', { length: 20 }).unique(),
  seksi: varchar('seksi', { length: 120 }),
  jabatan: varchar('jabatan', { length: 190 }),
  lastLoginAt: ts('last_login_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = mysqlTable(
  'sessions',
  {
    id: id(),
    userId: ref('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: char('token_hash', { length: 64 }).notNull().unique(),
    expiresAt: ts('expires_at').notNull(),
    /** Batas akhir yang tidak bisa diperpanjang (sesi SSO tidak boleh melewati sesi portal). */
    maxExpiresAt: ts('max_expires_at'),
    ip: varchar('ip', { length: 64 }),
    userAgent: varchar('user_agent', { length: 255 }),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const waAccounts = mysqlTable('wa_accounts', {
  id: id(),
  label: varchar('label', { length: 120 }).notNull(),
  appId: varchar('app_id', { length: 64 }).notNull(),
  appSecretEnc: text('app_secret_enc').notNull(),
  wabaId: varchar('waba_id', { length: 64 }).notNull(),
  phoneNumberId: varchar('phone_number_id', { length: 64 }).notNull().unique(),
  displayPhoneNumber: varchar('display_phone_number', { length: 32 }),
  verifiedName: varchar('verified_name', { length: 190 }),
  qualityRating: varchar('quality_rating', { length: 16 }),
  messagingLimit: varchar('messaging_limit', { length: 32 }),
  accessTokenEnc: text('access_token_enc').notNull(),
  tokenLast4: char('token_last4', { length: 4 }).notNull(),
  verifyToken: char('verify_token', { length: 32 }).notNull().unique(),
  status: mysqlEnum('status', ['active', 'error', 'disabled']).notNull().default('active'),
  lastError: text('last_error'),
  lastWebhookAt: ts('last_webhook_at'),
  subscribedAt: ts('subscribed_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const contacts = mysqlTable('contacts', {
  id: id(),
  waId: varchar('wa_id', { length: 32 }).notNull().unique(),
  profileName: varchar('profile_name', { length: 190 }),
  displayName: varchar('display_name', { length: 190 }),
  raw: jsonText<unknown>('raw'),
  firstSeenAt: ts('first_seen_at').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const media = mysqlTable(
  'media',
  {
    id: id(),
    waMediaId: varchar('wa_media_id', { length: 128 }),
    direction: mysqlEnum('direction', ['in', 'out']).notNull(),
    mimeType: varchar('mime_type', { length: 128 }),
    fileName: varchar('file_name', { length: 255 }),
    fileSize: bigint('file_size', { mode: 'number', unsigned: true }),
    sha256: char('sha256', { length: 64 }),
    storagePath: varchar('storage_path', { length: 500 }),
    status: mysqlEnum('status', ['pending', 'ready', 'failed', 'expired']).notNull().default('pending'),
    error: text('error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('media_wa_media_idx').on(t.waMediaId)],
);

export const conversations = mysqlTable(
  'conversations',
  {
    id: id(),
    waAccountId: ref('wa_account_id')
      .notNull()
      .references(() => waAccounts.id),
    contactId: ref('contact_id')
      .notNull()
      .references(() => contacts.id),
    lastMessageId: ref('last_message_id'),
    lastMessageAt: ts('last_message_at'),
    lastMessagePreview: varchar('last_message_preview', { length: 200 }),
    lastMessageDirection: mysqlEnum('last_message_direction', ['in', 'out']),
    lastInboundAt: ts('last_inbound_at'),
    cswExpiresAt: ts('csw_expires_at'),
    unreadCount: int('unread_count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('conversations_account_contact_uq').on(t.waAccountId, t.contactId),
    index('conversations_last_message_idx').on(t.waAccountId, t.lastMessageAt),
  ],
);

export const messageStatuses = ['pending', 'accepted', 'sent', 'delivered', 'read', 'failed', 'received'] as const;

export const messages = mysqlTable(
  'messages',
  {
    id: id(),
    conversationId: ref('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    wamid: varchar('wamid', { length: 128 }).unique(),
    direction: mysqlEnum('direction', ['in', 'out']).notNull(),
    type: varchar('type', { length: 32 }).notNull(),
    status: mysqlEnum('status', messageStatuses).notNull(),
    text: mediumtext('text'),
    payload: jsonText<Record<string, unknown>>('payload'),
    mediaId: ref('media_id').references(() => media.id, { onDelete: 'set null' }),
    replyToWamid: varchar('reply_to_wamid', { length: 128 }),
    reactionEmoji: varchar('reaction_emoji', { length: 16 }),
    templateName: varchar('template_name', { length: 190 }),
    templateLanguage: varchar('template_language', { length: 16 }),
    sentByUserId: ref('sent_by_user_id'),
    sentByApiKeyId: ref('sent_by_api_key_id'),
    /** Pengirim otomatis dari aplikasi sendiri, mis. 'auto_reply' untuk balasan di luar jam kerja. */
    sentBySystem: varchar('sent_by_system', { length: 32 }),
    clientRef: varchar('client_ref', { length: 64 }),
    errorCode: int('error_code'),
    errorTitle: varchar('error_title', { length: 255 }),
    errorDetail: text('error_detail'),
    pricingCategory: varchar('pricing_category', { length: 32 }),
    pricingBillable: boolean('pricing_billable'),
    waTimestamp: ts('wa_timestamp'),
    sentAt: ts('sent_at'),
    deliveredAt: ts('delivered_at'),
    readAt: ts('read_at'),
    failedAt: ts('failed_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('messages_conversation_idx').on(t.conversationId, t.id),
    index('messages_client_ref_idx').on(t.clientRef),
  ],
);

export const templates = mysqlTable(
  'templates',
  {
    id: id(),
    waAccountId: ref('wa_account_id')
      .notNull()
      .references(() => waAccounts.id, { onDelete: 'cascade' }),
    metaTemplateId: varchar('meta_template_id', { length: 64 }),
    name: varchar('name', { length: 190 }).notNull(),
    language: varchar('language', { length: 16 }).notNull(),
    category: varchar('category', { length: 32 }).notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    components: jsonText<unknown[]>('components').notNull(),
    qualityScore: varchar('quality_score', { length: 32 }),
    rejectedReason: varchar('rejected_reason', { length: 255 }),
    syncedAt: ts('synced_at').notNull(),
  },
  (t) => [uniqueIndex('templates_account_name_lang_uq').on(t.waAccountId, t.name, t.language)],
);

export const webhookEvents = mysqlTable(
  'webhook_events',
  {
    id: id(),
    receivedAt: ts('received_at').notNull(),
    payload: longtext('payload').notNull(),
    status: mysqlEnum('status', ['pending', 'processing', 'done', 'failed']).notNull().default('pending'),
    attempts: int('attempts').notNull().default(0),
    leaseUntil: ts('lease_until'),
    nextAttemptAt: ts('next_attempt_at').notNull(),
    error: text('error'),
    processedAt: ts('processed_at'),
  },
  (t) => [index('webhook_events_status_idx').on(t.status, t.nextAttemptAt)],
);

export const apiKeys = mysqlTable('api_keys', {
  id: id(),
  name: varchar('name', { length: 120 }).notNull(),
  prefix: char('prefix', { length: 12 }).notNull(),
  keyHash: char('key_hash', { length: 64 }).notNull().unique(),
  scopes: jsonText<string[]>('scopes').notNull(),
  createdBy: ref('created_by'),
  lastUsedAt: ts('last_used_at'),
  revokedAt: ts('revoked_at'),
  createdAt: createdAt(),
});

export const idempotencyKeys = mysqlTable(
  'idempotency_keys',
  {
    id: id(),
    apiKeyId: ref('api_key_id')
      .notNull()
      .references(() => apiKeys.id, { onDelete: 'cascade' }),
    idemKey: varchar('idem_key', { length: 128 }).notNull(),
    requestHash: char('request_hash', { length: 64 }).notNull(),
    responseStatus: int('response_status').notNull(),
    response: jsonText<unknown>('response').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('idempotency_key_uq').on(t.apiKeyId, t.idemKey)],
);

export const outboundWebhooks = mysqlTable('outbound_webhooks', {
  id: id(),
  name: varchar('name', { length: 120 }).notNull(),
  url: varchar('url', { length: 500 }).notNull(),
  secretEnc: text('secret_enc').notNull(),
  events: jsonText<string[]>('events').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  failureCount: int('failure_count').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const outboundWebhookDeliveries = mysqlTable(
  'outbound_webhook_deliveries',
  {
    id: id(),
    webhookId: ref('webhook_id')
      .notNull()
      .references(() => outboundWebhooks.id, { onDelete: 'cascade' }),
    eventId: char('event_id', { length: 26 }).notNull(),
    eventType: varchar('event_type', { length: 64 }).notNull(),
    payload: longtext('payload').notNull(),
    status: mysqlEnum('status', ['pending', 'success', 'failed']).notNull().default('pending'),
    attempts: int('attempts').notNull().default(0),
    nextAttemptAt: ts('next_attempt_at').notNull(),
    responseCode: int('response_code'),
    responseSnippet: varchar('response_snippet', { length: 500 }),
    createdAt: createdAt(),
    deliveredAt: ts('delivered_at'),
  },
  (t) => [index('deliveries_status_idx').on(t.status, t.nextAttemptAt)],
);

/** ID tiket SSO yang sudah dipakai, agar satu tiket tidak bisa dipakai ulang. */
export const ssoNonces = mysqlTable('sso_nonces', {
  jti: varchar('jti', { length: 64 }).primaryKey(),
  expiresAt: ts('expires_at').notNull(),
});

/** Pengaturan bersama (satu baris per kunci), mis. jam kerja dan kunci VAPID. */
export const appSettings = mysqlTable('app_settings', {
  key: varchar('key', { length: 64 }).primaryKey(),
  value: jsonText<unknown>('value').notNull(),
  updatedBy: ref('updated_by'),
  updatedAt: updatedAt(),
});

/** Balasan cepat lokal (bukan template Meta), dipakai bersama semua petugas. */
export const quickReplies = mysqlTable('quick_replies', {
  id: id(),
  title: varchar('title', { length: 100 }).notNull(),
  shortcut: varchar('shortcut', { length: 40 }).unique(),
  body: text('body').notNull(),
  usageCount: int('usage_count').notNull().default(0),
  lastUsedAt: ts('last_used_at'),
  createdBy: ref('created_by'),
  updatedBy: ref('updated_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Koleksi stiker bersama (WebP 512×512). ID media Meta disimpan agar tidak diunggah ulang setiap kirim. */
export const stickers = mysqlTable('stickers', {
  id: id(),
  sha256: char('sha256', { length: 64 }).notNull().unique(),
  storagePath: varchar('storage_path', { length: 500 }).notNull(),
  fileSize: int('file_size').notNull(),
  animated: boolean('animated').notNull().default(false),
  waMediaId: varchar('wa_media_id', { length: 128 }),
  waMediaUploadedAt: ts('wa_media_uploaded_at'),
  usageCount: int('usage_count').notNull().default(0),
  lastUsedAt: ts('last_used_at'),
  createdBy: ref('created_by'),
  createdAt: createdAt(),
});

/** Riwayat emoji bersama. Kuncinya kode titik heksadesimal (mis. "1f44d") agar tidak bergantung collation. */
export const emojiUsage = mysqlTable('emoji_usage', {
  code: varchar('code', { length: 64 }).primaryKey(),
  usageCount: int('usage_count').notNull().default(0),
  lastUsedAt: ts('last_used_at').notNull(),
});

/** Salinan hari libur dari API api.co.id, diperbarui harian. */
export const holidays = mysqlTable(
  'holidays',
  {
    id: id(),
    date: varchar('date', { length: 10 }).notNull(),
    name: varchar('name', { length: 190 }).notNull(),
    type: varchar('type', { length: 32 }).notNull(),
    fetchedAt: ts('fetched_at').notNull(),
  },
  (t) => [uniqueIndex('holidays_date_name_uq').on(t.date, t.name)],
);

/** Catatan balasan otomatis per kontak, untuk mode "sekali sehari" dan jeda antarbalasan. */
export const autoReplyLog = mysqlTable(
  'auto_reply_log',
  {
    id: id(),
    contactId: ref('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    day: varchar('day', { length: 10 }).notNull(),
    messageId: ref('message_id'),
    createdAt: createdAt(),
  },
  (t) => [index('auto_reply_contact_idx').on(t.contactId, t.day)],
);

/** Langganan Web Push per browser; ikut terhapus saat sesi login berakhir. */
export const pushSubscriptions = mysqlTable('push_subscriptions', {
  id: id(),
  userId: ref('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  sessionId: ref('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  endpointHash: char('endpoint_hash', { length: 64 }).notNull().unique(),
  endpoint: text('endpoint').notNull(),
  p256dh: varchar('p256dh', { length: 255 }).notNull(),
  auth: varchar('auth', { length: 255 }).notNull(),
  userAgent: varchar('user_agent', { length: 255 }),
  lastSuccessAt: ts('last_success_at'),
  createdAt: createdAt(),
});

export const auditLogs = mysqlTable(
  'audit_logs',
  {
    id: id(),
    actorUserId: ref('actor_user_id'),
    actorApiKeyId: ref('actor_api_key_id'),
    action: varchar('action', { length: 64 }).notNull(),
    targetType: varchar('target_type', { length: 64 }),
    targetId: varchar('target_id', { length: 64 }),
    meta: jsonText<Record<string, unknown>>('meta'),
    ip: varchar('ip', { length: 64 }),
    createdAt: createdAt(),
  },
  (t) => [index('audit_logs_created_idx').on(t.createdAt)],
);
