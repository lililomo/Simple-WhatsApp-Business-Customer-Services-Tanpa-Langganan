import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { BookOpen, BookPlus, ImageIcon, MoreHorizontal, ThumbsDown, ThumbsUp, Zap } from 'lucide-react';
import {
  AOS_MODELS,
  AOS_PROVIDER_LABEL,
  draftPartsForWhatsApp,
  parseAosAnswer,
  splitForWhatsApp,
  type AosAnswer,
  type AosAskBody,
  type AosConfidence,
  type AosMessageDTO,
  type AosSource,
  type AosThreadDTO,
} from '@wa/shared';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { formatDateTime, formatTime } from '@/lib/format';
import { FormattedText } from '@/lib/whatsapp-format';
import { AosLogo } from './AosLogo';
import { InfographicCard, InfographicPending } from './InfographicCard';
import { useAosLive } from './live';
import { isAosRunning, type AosSaveTarget } from './queries';

/** Yang bisa dilakukan petugas dari dalam linimasa; disediakan panel. */
export interface AosActions {
  /** Permintaan ke AOS sedang dikirim: tombol yang memicu permintaan baru dimatikan. */
  busy: boolean;
  ask: (body: AosAskBody) => void;
  cancel: (message: AosMessageDTO) => void;
  dismiss: (message: AosMessageDTO) => void;
  feedback: (message: AosMessageDTO, value: 1 | -1 | null) => void;
  /** Masukkan draf ke kotak balas WhatsApp. AOS sendiri tidak pernah mengirim pesan. */
  use: (message: AosMessageDTO, draft: string) => void;
  copy: (text: string) => void;
  save: (message: AosMessageDTO, target: AosSaveTarget) => void;
  /** Lampirkan berkas (gambar infografis) ke kotak balas WhatsApp; petugas sendiri yang mengirim. */
  attach: (file: File) => void;
}

interface MessageProps {
  message: AosMessageDTO;
  actions: AosActions;
}

/** Jam saja untuk hari ini; sesi bisa berumur berhari-hari, jadi pesan dari hari lain diberi tanggal. */
export function aosTime(iso: string): string {
  return new Date(iso).toDateString() === new Date().toDateString() ? formatTime(iso) : formatDateTime(iso);
}

/** Gelembung putih AOS dengan avatar di kiri bawah. */
export function AosBubble({ tone, children }: { tone?: 'error' | 'quiet'; children: ReactNode }) {
  return (
    <div className="aos-line">
      <span className="aos-who">
        <AosLogo />
      </span>
      <div className="aos-bub" data-tone={tone}>
        {children}
      </div>
    </div>
  );
}

function Time({ iso }: { iso: string }) {
  return (
    <time className="aos-time" dateTime={iso}>
      {aosTime(iso)}
    </time>
  );
}

function Offer({ message, actions }: MessageProps) {
  const open = message.offerState === 'open';
  const options = message.options ?? [];
  // Pilihan utama berwarna navy; bila server tidak menandai satu pun, yang pertama dianggap utama.
  const flagged = options.some((o) => o.primary);
  return (
    <AosBubble>
      {message.text && (
        <p>
          <FormattedText text={message.text} />
        </p>
      )}
      {options.length > 0 && (
        <div className="aos-opts">
          {options.map((option, i) => (
            <button
              key={i}
              type="button"
              className="aos-opt"
              data-primary={option.primary || (!flagged && i === 0)}
              disabled={!open || actions.busy}
              onClick={() => actions.ask({ offerId: message.id, optionIndex: i })}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
      <div className="aos-foot">
        {open ? (
          <button type="button" className="aos-link" onClick={() => actions.dismiss(message)}>
            Tidak perlu
          </button>
        ) : (
          message.offerState === 'dismissed' && <span className="aos-quiet">Tawaran ditutup</span>
        )}
        <Time iso={message.createdAt} />
      </div>
    </AosBubble>
  );
}

function UserMessage({ message }: { message: AosMessageDTO }) {
  return (
    <div className="aos-me">
      {message.author && <small>{message.author.name}</small>}
      <span className="whitespace-pre-wrap">{message.text}</span>
      <time dateTime={message.createdAt}>{aosTime(message.createdAt)}</time>
    </div>
  );
}

function Draft({ text, part, of }: { text: string; part?: number; of?: number }) {
  return (
    <>
      <p className="aos-label">
        {of && of > 1 ? `Draf balasan · bagian ${part} dari ${of}` : 'Draf balasan'}
        {of && of > 1 && <span className="aos-label-hint"> · {text.length.toLocaleString('id-ID')} karakter</span>}
      </p>
      <div className="aos-draft">
        <FormattedText text={text} />
      </div>
    </>
  );
}

const BULLET = /^[-*•]\s+/;

function Notes({ text }: { text: string }) {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const bullets = lines.length > 0 && lines.every((l) => BULLET.test(l));
  return (
    <div className="aos-note">
      <b>Catatan untuk petugas</b>
      {bullets ? (
        <ul>
          {lines.map((l, i) => (
            <li key={i}>
              <FormattedText text={l.replace(BULLET, '')} />
            </li>
          ))}
        </ul>
      ) : (
        <div>
          <FormattedText text={text} />
        </div>
      )}
    </div>
  );
}

/** Nama situs untuk chip sumber web. Hanya http(s) yang dijadikan tautan. */
function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.hostname.replace(/^www\./, '') : null;
  } catch {
    return null;
  }
}

function SourceChip({ source }: { source: AosSource }) {
  if (source.type === 'library') {
    const label = `Pustaka · ${source.title}${source.page ? ` · hlm. ${source.page}` : ''}`;
    return source.documentId ? (
      <Link className="aos-source" data-type="library" to={`/pustaka?doc=${encodeURIComponent(source.documentId)}`}>
        {label}
      </Link>
    ) : (
      <span className="aos-source" data-type="library">
        {label}
      </span>
    );
  }
  const host = source.url ? hostOf(source.url) : null;
  return host ? (
    <a className="aos-source" data-type="web" href={source.url} target="_blank" rel="noreferrer" title={source.title}>
      {host}
    </a>
  ) : (
    <span className="aos-source" data-type="web">
      {source.title}
    </span>
  );
}

const CONFIDENCE_LABEL: Record<AosConfidence, string> = {
  tinggi: 'Keyakinan tinggi',
  sedang: 'Keyakinan sedang',
  rendah: 'Keyakinan rendah · cek dulu sebelum dikirim',
};

/** "Langganan · Opus 5.5 · 14 dtk": jalur, model, dan lama pengerjaan, sejauh tersedia. */
function metaLine(m: AosMessageDTO): string {
  const model = m.model ? (AOS_MODELS.find((x) => x.id === m.model)?.label ?? m.model).replace(/^Claude\s+/, '') : null;
  const seconds = m.durationMs != null ? `${Math.max(1, Math.round(m.durationMs / 1000))} dtk` : null;
  return [m.provider && AOS_PROVIDER_LABEL[m.provider], model, seconds].filter(Boolean).join(' · ');
}

function Feedback({ message, actions }: MessageProps) {
  const toggle = (value: 1 | -1) => actions.feedback(message, message.feedback === value ? null : value);
  return (
    <>
      <button type="button" className="aos-thumb" aria-label="Jawaban ini membantu" aria-pressed={message.feedback === 1} onClick={() => toggle(1)}>
        <ThumbsUp />
      </button>
      <button
        type="button"
        className="aos-thumb"
        aria-label="Jawaban ini kurang membantu"
        aria-pressed={message.feedback === -1}
        onClick={() => toggle(-1)}
      >
        <ThumbsDown />
      </button>
    </>
  );
}

function UseButtons({ message, text, actions, part }: MessageProps & { text: string; part?: number }) {
  return (
    <>
      <button type="button" className="aos-pill" data-primary="true" onClick={() => actions.use(message, text)}>
        {part ? `Pakai bagian ${part}` : 'Pakai'}
      </button>
      <button type="button" className="aos-pill" onClick={() => actions.copy(text)}>
        Salin
      </button>
    </>
  );
}

function RefineButtons({ message, actions }: MessageProps) {
  const refine = (action: 'shorten' | 'friendlier' | 'regenerate') => actions.ask({ action, targetId: message.id });
  return (
    <>
      <button type="button" className="aos-pill" disabled={actions.busy} onClick={() => refine('shorten')}>
        Perpendek
      </button>
      <button type="button" className="aos-pill" disabled={actions.busy} onClick={() => refine('friendlier')}>
        Lebih ramah
      </button>
      <button type="button" className="aos-pill" disabled={actions.busy} onClick={() => refine('regenerate')}>
        Buat ulang
      </button>
      {/* modal={false}: menu ini membuka dialog judul; menu modal yang menutup bersamaan bisa mengunci klik halaman. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button type="button" className="aos-pill" aria-label="Tindakan lain">
            <MoreHorizontal />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem disabled={actions.busy} onSelect={() => actions.ask({ action: 'infographic', targetId: message.id })}>
            <ImageIcon /> Jadikan infografis
          </DropdownMenuItem>
          {message.savedDocumentId ? (
            <DropdownMenuItem asChild>
              <Link to={`/pustaka?doc=${encodeURIComponent(message.savedDocumentId)}`}>
                <BookOpen /> Buka di Pustaka
              </Link>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => actions.save(message, 'library')}>
              <BookPlus /> Simpan ke Pustaka
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => actions.save(message, 'quick-reply')}>
            <Zap /> Simpan sebagai balasan cepat
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/**
 * Isi jawaban yang bisa dipakai: draf (atau teks biasa bila AOS tidak menulis draf), dipecah per bagian yang
 * masing-masing muat dalam satu pesan WhatsApp. Setiap bagian punya tombol Pakai/Salin sendiri, urut sesuai urutan
 * kirim; tombol perbaikan berlaku untuk seluruh jawaban.
 */
function UsableText({ message, actions, parts, asDraft }: MessageProps & { parts: string[]; asDraft: boolean }) {
  if (parts.length === 1) {
    return (
      <>
        {asDraft ? <Draft text={parts[0]!} /> : <FormattedText text={parts[0]!} />}
        <div className="aos-acts">
          <UseButtons message={message} text={parts[0]!} actions={actions} />
          <RefineButtons message={message} actions={actions} />
        </div>
      </>
    );
  }
  return (
    <>
      {!asDraft && (
        <p className="aos-split-note">Teksnya melebihi batas satu pesan WhatsApp, jadi dibagi {parts.length} bagian. Kirim berurutan.</p>
      )}
      {parts.map((part, i) => (
        <div key={i} className="aos-part">
          <Draft text={part} part={i + 1} of={parts.length} />
          <div className="aos-acts">
            <UseButtons message={message} text={part} actions={actions} part={i + 1} />
          </div>
        </div>
      ))}
      <div className="aos-acts">
        <RefineButtons message={message} actions={actions} />
      </div>
    </>
  );
}

function DoneAnswer({ message, actions }: MessageProps) {
  const parsed = parseAosAnswer(message.text ?? '');
  const answer: AosAnswer = message.answer ?? {
    draft: parsed.draft,
    notes: parsed.notes,
    confidence: parsed.confidence,
    sources: [],
  };
  const { draft, notes, confidence, sources } = answer;
  const infographic = answer.infographic ?? null;
  // Jawaban tanpa draf (ringkasan chat, penjelasan) tetap bisa dipakai, disalin, dan diperbaiki seperti draf.
  const plain = draft ? null : parsed.plain;
  // Pada jawaban infografis, teks di luar draf hanya pengantar untuk petugas: tidak perlu tombol Pakai.
  const introOnly = !!infographic && !draft;
  const parts = introOnly
    ? []
    : draft
    ? answer.parts?.length
      ? answer.parts
      : draftPartsForWhatsApp(parsed.draftParts.length ? parsed.draftParts : [draft])
    : plain
      ? splitForWhatsApp(plain)
      : [];
  const meta = metaLine(message);
  return (
    <AosBubble>
      {infographic && <InfographicCard html={infographic} onAttach={actions.attach} />}
      {parts.length > 0 ? (
        <UsableText message={message} actions={actions} parts={parts} asDraft={!!draft} />
      ) : (
        !notes && !infographic && <p>AOS tidak memberikan jawaban.</p>
      )}
      {introOnly && plain && <FormattedText text={plain} />}
      {infographic && parts.length === 0 && (
        <div className="aos-acts">
          <RefineButtons message={message} actions={actions} />
        </div>
      )}
      {notes && <Notes text={notes} />}
      {sources.length > 0 && (
        <div className="aos-sources">
          {sources.map((source, i) => (
            <SourceChip key={i} source={source} />
          ))}
        </div>
      )}
      {(confidence || meta || message.usedAt) && (
        <div className="aos-meta">
          {confidence && (
            <span className="aos-conf" data-level={confidence}>
              {CONFIDENCE_LABEL[confidence]}
            </span>
          )}
          {meta && <span>{meta}</span>}
          {message.usedAt && <span title={`Dipakai ${aosTime(message.usedAt)}`}>✓ Dipakai</span>}
        </div>
      )}
      <div className="aos-foot">
        <Feedback message={message} actions={actions} />
        <Time iso={message.createdAt} />
      </div>
    </AosBubble>
  );
}

/** Tanda bagian yang baru separuh tertulis di ujung teks mengalir ("<dra", "</cat") tidak ikut ditampilkan. */
const withoutPartialTag = (text: string) => text.replace(/<\/?[a-z]*$/, '');

/** Jawaban yang sedang dikerjakan: teks dari event delta (bagian yang belum ditutup ikut tampil) dan langkah terakhir. */
function RunningAnswer({ message, actions }: MessageProps) {
  const live = useAosLive(message.id);
  const { draft, plain, notes, infographic, infographicPending } = parseAosAnswer(withoutPartialTag(live?.text ?? message.text ?? ''));
  const steps = live?.steps.length ? live.steps : message.steps;
  const drawing = infographicPending || !!infographic;
  return (
    <>
      {(draft || plain || notes || drawing) && (
        <AosBubble>
          {drawing && <InfographicPending />}
          {draft ? <Draft text={draft} /> : plain && <FormattedText text={plain} />}
          {notes && <Notes text={notes} />}
        </AosBubble>
      )}
      <div className="aos-steps" role="status">
        <span className="aos-dot" />
        <span className="aos-steps-text">{steps.at(-1) ?? 'Menyiapkan jawaban…'}</span>
        <button type="button" className="aos-cancel" onClick={() => actions.cancel(message)}>
          Batalkan
        </button>
      </div>
    </>
  );
}

function ErrorMessage({ message }: { message: AosMessageDTO }) {
  return (
    <AosBubble tone="error">
      <p>{message.error ?? message.text ?? 'AOS tidak dapat menyelesaikan permintaan ini.'}</p>
      <div className="aos-foot">
        <Time iso={message.createdAt} />
      </div>
    </AosBubble>
  );
}

function AosMessage({ message, actions }: MessageProps) {
  switch (message.kind) {
    case 'offer':
      return <Offer message={message} actions={actions} />;
    case 'user':
      return <UserMessage message={message} />;
    case 'answer':
      if (isAosRunning(message)) return <RunningAnswer message={message} actions={actions} />;
      if (message.status === 'error') return <ErrorMessage message={message} />;
      if (message.status === 'cancelled') {
        return (
          <AosBubble tone="quiet">
            <p>Permintaan dibatalkan.</p>
          </AosBubble>
        );
      }
      return <DoneAnswer message={message} actions={actions} />;
    case 'error':
      return <ErrorMessage message={message} />;
    default:
      return null;
  }
}

/** Linimasa sesi. Setelah "Topik baru", pesan sebelumnya disembunyikan di balik tombol dan diredupkan saat ditampilkan. */
export function AosThread({ thread, actions }: { thread: AosThreadDTO; actions: AosActions }) {
  const [showOld, setShowOld] = useState(false);
  const since = thread.topicStartedAt;
  const sinceMs = since ? Date.parse(since) : Number.NaN;
  const firstCurrent = since ? thread.messages.findIndex((m) => Date.parse(m.createdAt) >= sinceMs) : 0;
  const cut = firstCurrent < 0 ? thread.messages.length : firstCurrent;
  const old = thread.messages.slice(0, cut);
  const current = thread.messages.slice(cut);
  const render = (m: AosMessageDTO) => <AosMessage key={m.id} message={m} actions={actions} />;
  return (
    <div className="aos-thread-list">
      {old.length > 0 && (
        <button type="button" className="aos-chip" aria-expanded={showOld} onClick={() => setShowOld((v) => !v)}>
          {showOld ? 'Sembunyikan sesi sebelumnya' : 'Tampilkan sesi sebelumnya'}
        </button>
      )}
      {showOld && old.length > 0 && <div className="aos-old">{old.map(render)}</div>}
      {since && (
        <div className="aos-divider" role="separator">
          <span className="aos-chip">Topik baru sejak {aosTime(since)}</span>
        </div>
      )}
      {current.length === 0 && (
        <AosBubble>
          <p>Halo, saya AOS. Mau dibantu apa untuk chat ini? Pilih tombol cepat di bawah atau ketik pertanyaan Anda.</p>
        </AosBubble>
      )}
      {current.map(render)}
    </div>
  );
}
