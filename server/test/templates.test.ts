import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { normalizePhone, templateVariables, type TemplateComponent, type TemplateDTO } from '@wa/shared';
import { contacts, messages, templates } from '../src/db/schema';
import type { AppInstance } from '../src/types';
import { seedAccount } from './helpers/account';
import { buildTestApp, loginAs, ORIGIN, seedUser } from './helpers/app';
import { useTestDatabase } from './helpers/db';
import { fakeGraph, type GraphCall } from './helpers/graph';
import { PHONE_ID, WABA_ID } from './fixtures/meta';

const t = useTestDatabase();
let app: AppInstance;
let cookie: string;
afterEach(async () => {
  await app?.close();
});

const SPT: TemplateComponent[] = [
  { type: 'HEADER', format: 'TEXT', text: 'Pengingat {{1}}' },
  { type: 'BODY', text: 'Kepada Yth. {{1}}, jangan lupa laporkan SPT Tahunan {{2}} melalui Coretax.' },
  { type: 'FOOTER', text: 'KPP Pratama Banyuwangi' },
  { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Buka Coretax', url: 'https://coretaxdjp.pajak.go.id/{{1}}' }, { type: 'QUICK_REPLY', text: 'Hubungi petugas' }] },
];
const NAMED: TemplateComponent[] = [{ type: 'BODY', text: 'Halo {{nama}}, antrean Anda nomor {{nomor}}.' }];

let pages: Record<string, unknown>[] = [];
const graph = fakeGraph({
  [`GET ${WABA_ID}/message_templates`]: (c) => ({ json: pages[c.query.after ? Number(c.query.after) : 0] }),
  [`POST ${PHONE_ID}/messages`]: () => ({ json: { messages: [{ id: 'wamid.TPL' }] } }),
});
const sent = (): GraphCall[] => graph.calls.filter((c) => c.path === `${PHONE_ID}/messages`);

async function setup() {
  app = await buildTestApp(t.get(), {}, graph.fetch);
  await seedAccount(t.get());
  await seedUser(t.get(), 'agent', 'petugas@kpp.test');
  cookie = await loginAs(app, 'petugas@kpp.test');
  pages = [
    {
      data: [{ id: '901', name: 'penyampaian_spt', language: 'id', status: 'APPROVED', category: 'UTILITY', components: SPT }],
      paging: { cursors: { after: '1' }, next: 'https://graph.facebook.com/next' },
    },
    {
      data: [
        { id: '902', name: 'antrean', language: 'id', status: 'APPROVED', category: 'UTILITY', components: NAMED, parameter_format: 'NAMED' },
        { id: '903', name: 'promo', language: 'id', status: 'REJECTED', category: 'MARKETING', components: [{ type: 'BODY', text: 'x' }], rejected_reason: 'PROMOTIONAL' },
      ],
    },
  ];
  graph.calls.length = 0;
  const sync = await app.inject({ method: 'POST', url: '/api/templates/sync', headers: { cookie, origin: ORIGIN } });
  expect(sync.json()).toEqual({ synced: 3, deleted: 0 });
  const list = await app.inject({ url: '/api/templates?status=APPROVED', headers: { cookie } });
  return Object.fromEntries((list.json().templates as TemplateDTO[]).map((tpl) => [tpl.name, tpl]));
}

describe('template variables', () => {
  it('detects positional, named, header and URL button variables', () => {
    expect(templateVariables(SPT)).toEqual({
      header: { format: 'TEXT', keys: ['1'] },
      body: ['1', '2'],
      buttons: [{ index: 0, text: 'Buka Coretax', keys: ['1'] }],
      named: false,
    });
    expect(templateVariables(NAMED)).toMatchObject({ body: ['nama', 'nomor'], named: true });
  });

  it('normalizes Indonesian phone numbers', () => {
    expect(normalizePhone('0812-3456-7890')).toBe('6281234567890');
    expect(normalizePhone('+62 812 3456 7890')).toBe('6281234567890');
    expect(normalizePhone('812 3456 7890')).toBe('6281234567890');
    expect(normalizePhone('12345')).toBeNull();
  });
});

describe('templates', () => {
  it('syncs all pages and marks templates removed from Meta as deleted', async () => {
    const byName = await setup();
    expect(Object.keys(byName).sort()).toEqual(['antrean', 'penyampaian_spt']);
    pages = [{ data: [{ id: '901', name: 'penyampaian_spt', language: 'id', status: 'APPROVED', category: 'UTILITY', components: SPT }] }];
    const again = await app.inject({ method: 'POST', url: '/api/templates/sync', headers: { cookie, origin: ORIGIN } });
    expect(again.json()).toEqual({ synced: 1, deleted: 2 });
    const [antrean] = await t.get().db.select().from(templates).where(eq(templates.name, 'antrean'));
    expect(antrean!.status).toBe('DELETED');
  });

  it('starts a new conversation with a template, building all components', async () => {
    const byName = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/conversations/start',
      headers: { cookie, origin: ORIGIN },
      payload: {
        phone: '0812-3456-7890',
        templateId: byName.penyampaian_spt!.id,
        params: { header: { '1': 'SPT' }, body: { '1': 'Bapak Budi', '2': '2025' }, buttons: { '1': 'login' } },
        clientRef: 'ref-template-01',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().conversation.contact.waId).toBe('6281234567890');
    expect(res.json().message).toMatchObject({
      type: 'template',
      status: 'accepted',
      templateName: 'penyampaian_spt',
      text: '*Pengingat SPT*\n\nKepada Yth. Bapak Budi, jangan lupa laporkan SPT Tahunan 2025 melalui Coretax.\n\n_KPP Pratama Banyuwangi_',
    });
    expect(sent()[0]!.body).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '6281234567890',
      type: 'template',
      template: {
        name: 'penyampaian_spt',
        language: { code: 'id' },
        components: [
          { type: 'header', parameters: [{ type: 'text', text: 'SPT' }] },
          { type: 'body', parameters: [{ type: 'text', text: 'Bapak Budi' }, { type: 'text', text: '2025' }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'login' }] },
        ],
      },
    });
    expect(await t.get().db.$count(contacts)).toBe(1);
  });

  it('sends named-parameter templates with parameter_name, even outside the 24h window', async () => {
    const byName = await setup();
    const start = await app.inject({
      method: 'POST',
      url: '/api/conversations/start',
      headers: { cookie, origin: ORIGIN },
      payload: { phone: '6281111111111', templateId: byName.antrean!.id, params: { body: { nama: 'Siti', nomor: 'A12' } }, clientRef: 'ref-named-001' },
    });
    expect(start.statusCode).toBe(201);
    expect((sent()[0]!.body as { template: { components: unknown[] } }).template.components).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: 'Siti', parameter_name: 'nama' }, { type: 'text', text: 'A12', parameter_name: 'nomor' }] },
    ]);
  });

  it('rejects missing variables, unapproved templates and invalid numbers', async () => {
    const byName = await setup();
    const missing = await app.inject({
      method: 'POST',
      url: '/api/conversations/start',
      headers: { cookie, origin: ORIGIN },
      payload: { phone: '081234567890', templateId: byName.penyampaian_spt!.id, params: { body: { '1': 'Budi' } }, clientRef: 'ref-missing-01' },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.message).toMatch(/\{\{1\}\}/);

    const [rejected] = await t.get().db.select().from(templates).where(eq(templates.name, 'promo'));
    const notApproved = await app.inject({
      method: 'POST',
      url: '/api/conversations/start',
      headers: { cookie, origin: ORIGIN },
      payload: { phone: '081234567890', templateId: String(rejected!.id), clientRef: 'ref-rejected-1' },
    });
    expect(notApproved.json().error.code).toBe('template_not_approved');

    const badPhone = await app.inject({
      method: 'POST',
      url: '/api/conversations/start',
      headers: { cookie, origin: ORIGIN },
      payload: { phone: '12345678', templateId: byName.antrean!.id, params: { body: { nama: 'a', nomor: 'b' } }, clientRef: 'ref-badphone1' },
    });
    expect(badPhone.json().error.code).toBe('invalid_phone');
    expect(sent()).toHaveLength(0);
    expect(await t.get().db.$count(messages)).toBe(0);
  });
});
