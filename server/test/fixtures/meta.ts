// Payload webhook berbentuk persis seperti yang dikirim WhatsApp Cloud API (field yang relevan).
import { createHmac } from 'node:crypto';

export const WABA_ID = '555666777888';
export const PHONE_ID = '1149831774889027';
export const CUSTOMER = '6281234567890';

let seq = 0;
export const newWamid = () => `wamid.HBgNNjI4MTIzNDU2Nzg5MBUCABIYFjNFQjA${Date.now().toString(36)}${++seq}`;
const ts = (at = new Date()) => String(Math.floor(at.getTime() / 1000));

interface Opts {
  id?: string;
  at?: Date;
  from?: string;
  name?: string;
  context?: { from: string; id: string };
}

export function envelope(value: Record<string, unknown>, field = 'messages', wabaId = WABA_ID) {
  return { object: 'whatsapp_business_account', entry: [{ id: wabaId, changes: [{ value, field }] }] };
}

const metadata = { display_phone_number: '6281200627', phone_number_id: PHONE_ID };

function message(type: string, body: Record<string, unknown>, o: Opts = {}) {
  const from = o.from ?? CUSTOMER;
  return envelope({
    messaging_product: 'whatsapp',
    metadata,
    contacts: [{ profile: { name: o.name ?? 'Budi Santoso' }, wa_id: from }],
    messages: [{ from, id: o.id ?? newWamid(), timestamp: ts(o.at), type, ...(o.context ? { context: o.context } : {}), ...body }],
  });
}

export const inbound = {
  text: (text: string, o?: Opts) => message('text', { text: { body: text } }, o),
  image: (caption?: string, o?: Opts) =>
    message('image', { image: { id: 'media-image-1', mime_type: 'image/jpeg', sha256: 'abc=', ...(caption ? { caption } : {}) } }, o),
  document: (filename: string, o?: Opts) =>
    message('document', { document: { id: 'media-doc-1', mime_type: 'application/pdf', sha256: 'abc=', filename } }, o),
  voice: (o?: Opts) => message('audio', { audio: { id: 'media-audio-1', mime_type: 'audio/ogg; codecs=opus', sha256: 'abc=', voice: true } }, o),
  video: (o?: Opts) => message('video', { video: { id: 'media-video-1', mime_type: 'video/mp4', sha256: 'abc=' } }, o),
  sticker: (o?: Opts) => message('sticker', { sticker: { id: 'media-sticker-1', mime_type: 'image/webp', sha256: 'abc=', animated: false } }, o),
  location: (o?: Opts) =>
    message('location', { location: { latitude: -8.2192, longitude: 114.3691, name: 'KPP Pratama Banyuwangi', address: 'Jl. Adi Sucipto' } }, o),
  contacts: (o?: Opts) =>
    message('contacts', { contacts: [{ name: { formatted_name: 'Siti Aminah', first_name: 'Siti' }, phones: [{ phone: '+62 811 111 111', wa_id: '62811111111', type: 'CELL' }] }] }, o),
  buttonReply: (title: string, o?: Opts) =>
    message('interactive', { interactive: { type: 'button_reply', button_reply: { id: 'btn-1', title } } }, o),
  listReply: (title: string, description: string, o?: Opts) =>
    message('interactive', { interactive: { type: 'list_reply', list_reply: { id: 'row-1', title, description } } }, o),
  templateButton: (text: string, o?: Opts) => message('button', { button: { text, payload: text } }, o),
  reaction: (targetWamid: string, emoji: string, o?: Opts) =>
    message('reaction', { reaction: { message_id: targetWamid, emoji } }, o),
  unsupported: (o?: Opts) =>
    message('unsupported', { errors: [{ code: 131051, title: 'Message type unknown', message: 'Message type unknown', error_data: { details: 'Message type is currently not supported.' } }] }, o),
};

export function statusUpdate(
  wamid: string,
  status: 'sent' | 'delivered' | 'read' | 'failed',
  o: { at?: Date; errorCode?: number; errorTitle?: string; errorDetails?: string; category?: string; billable?: boolean } = {},
) {
  return envelope({
    messaging_product: 'whatsapp',
    metadata,
    statuses: [
      {
        id: wamid,
        status,
        timestamp: ts(o.at),
        recipient_id: CUSTOMER,
        ...(o.category ? { pricing: { billable: o.billable ?? true, pricing_model: 'PMP', category: o.category, type: 'regular' } } : {}),
        ...(o.errorCode
          ? {
              errors: [
                {
                  code: o.errorCode,
                  title: o.errorTitle ?? 'Re-engagement message',
                  message: o.errorTitle ?? 'Re-engagement message',
                  error_data: { details: o.errorDetails ?? 'Message failed to send because more than 24 hours have passed since the customer last replied to this number.' },
                },
              ],
            }
          : {}),
      },
    ],
  });
}

export function templateStatusUpdate(templateId: string, name: string, event: string, reason = 'NONE') {
  return envelope(
    { event, message_template_id: Number(templateId), message_template_name: name, message_template_language: 'id', reason },
    'message_template_status_update',
  );
}

export function sign(body: string, appSecret: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(body).digest('hex')}`;
}
