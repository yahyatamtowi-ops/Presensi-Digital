export type FonnteNotificationCategory =
  | 'Hadir Tepat Waktu'
  | 'Terlambat'
  | 'Alpa'
  | 'Belum Presensi';

export interface FonntePacingPolicy {
  /** Minimum randomized delay between consecutive messages (seconds, floor 15s) */
  minDelaySec: number;
  /** Maximum randomized delay between consecutive messages (seconds, cap 180s) */
  maxDelaySec: number;
  /** Number of messages sent before taking a longer anti-ban cool-down pause */
  batchSize: number;
  /** Cool-down pause duration after each batch completes (seconds, floor 60s) */
  batchPauseSec: number;
}

export interface FonnteConfig {
  enabled: boolean;
  autoSendOnTime: boolean;
  autoSendLate: boolean;
  autoSendAbsent: boolean;
  autoAbsentScheduleEnabled: boolean;
  autoAbsentScheduleTime: string; // HH:MM e.g. '08:30'
  includeUnrecordedAsAbsent: boolean;
  pacing: FonntePacingPolicy;
  onTimeTemplate: string;
  lateTemplate: string;
  absentTemplate: string;
}

export interface FonnteQueueJobInput {
  nis: string;
  studentName: string;
  kelas: string;
  target: string;
  status: FonnteNotificationCategory;
  tanggal: string; // YYYY-MM-DD
  message: string;
}

export type FonnteJobState = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped';

export interface FonnteQueueJob {
  id: string;
  dedupeKey: string;
  nis: string;
  studentName: string;
  kelas: string;
  targetMasked: string;
  status: FonnteNotificationCategory;
  tanggal: string;
  state: FonnteJobState;
  attempts: number;
  createdAt: string;
  sentAt?: string;
  error?: string;
  scheduledDelaySec?: number;
}

export interface FonnteQueueSnapshot {
  running: boolean;
  paused: boolean;
  tokenConfigured: boolean;
  nextSendAt: string | null;
  sentInCurrentBatch: number;
  counts: {
    pending: number;
    sending: number;
    sent: number;
    failed: number;
    total: number;
  };
  pacing: FonntePacingPolicy;
  estimatedRemainingSec: number;
  jobs: FonnteQueueJob[];
}

export type FonnteTokenSlotId = 'primary' | 'backup_2' | 'backup_3' | 'custom';

export interface FonnteEnvSlotInfo {
  slot: 'primary' | 'backup_2' | 'backup_3';
  envName: 'FONNTE_TOKEN' | 'FONNTE_TOKEN_2' | 'FONNTE_TOKEN_3';
  label: string;
  configured: boolean;
  maskedToken: string;
}

export interface FonnteTokenMeta {
  configured: boolean;
  activeSlot: FonnteTokenSlotId | 'none';
  activeLabel: string;
  maskedToken: string;
  hasRuntimeOverride: boolean;
  availableEnvSlots: FonnteEnvSlotInfo[];
}

export interface FonnteStatusResponse {
  configured: boolean;
  primaryConfigured?: boolean;
  autoConnected?: boolean;
  serverMode?: 'persistent' | 'serverless';
  tokenMeta?: FonnteTokenMeta;
  deviceStatus?: {
    checked: boolean;
    connected: boolean;
    device?: string;
    name?: string;
    quota?: string | number;
    message?: string;
  };
  queue: FonnteQueueSnapshot;
}

export const FONNTE_PACING_BOUNDS = {
  MIN_DELAY_SEC: 15,
  MAX_DELAY_SEC: 180,
  MIN_BATCH_SIZE: 3,
  MAX_BATCH_SIZE: 20,
  MIN_BATCH_PAUSE_SEC: 60,
  MAX_BATCH_PAUSE_SEC: 600,
} as const;

export const DEFAULT_FONNTE_PACING: FonntePacingPolicy = {
  minDelaySec: 20,
  maxDelaySec: 45,
  batchSize: 10,
  batchPauseSec: 180,
};

export const DEFAULT_ON_TIME_TEMPLATE =
  '{salam}\n\nYth. Bapak/Ibu Orang Tua/Wali dari *{nama}* (NISN: {nisn}, Kelas {kelas}).\n\nKami informasikan bahwa ananda telah hadir dan melakukan *PRESENSI TEPAT WAKTU* di {sekolah} pada tanggal *{tanggal}* pukul *{jam_masuk}* (batas masuk {batas_jam}).\n\nTerima kasih atas dukungan Bapak/Ibu dalam menumbuhkan kedisiplinan ananda.';

export const DEFAULT_LATE_TEMPLATE =
  '{salam}\n\nYth. Bapak/Ibu Orang Tua/Wali dari *{nama}* (NISN: {nisn}, Kelas {kelas}).\n\nKami informasikan bahwa ananda tercatat *TERLAMBAT* hadir di {sekolah} pada tanggal *{tanggal}* pukul *{jam_masuk}* (batas masuk {batas_jam}).\n\nMohon kerja sama Bapak/Ibu untuk mengingatkan ananda agar hadir tepat waktu pada hari berikutnya. Terima kasih.';

export const DEFAULT_ABSENT_TEMPLATE =
  '{salam}\n\nYth. Bapak/Ibu Orang Tua/Wali dari *{nama}* (NISN: {nisn}, Kelas {kelas}).\n\nKami informasikan bahwa hingga pengecekan hari ini tanggal *{tanggal}*, ananda tercatat *{status} (Tidak Hadir)* di {sekolah}.\n\nApabila ananda sedang sakit atau ada keperluan izin, mohon menginformasikan kepada Wali Kelas. Terima kasih.';

export const DEFAULT_FONNTE_CONFIG: FonnteConfig = {
  enabled: false,
  autoSendOnTime: false,
  autoSendLate: true,
  autoSendAbsent: true,
  autoAbsentScheduleEnabled: false,
  autoAbsentScheduleTime: '08:30',
  includeUnrecordedAsAbsent: true,
  pacing: { ...DEFAULT_FONNTE_PACING },
  onTimeTemplate: DEFAULT_ON_TIME_TEMPLATE,
  lateTemplate: DEFAULT_LATE_TEMPLATE,
  absentTemplate: DEFAULT_ABSENT_TEMPLATE,
};

const NATURAL_GREETINGS = [
  "Assalamu'alaikum Wr. Wb. & Salam sejahtera,",
  "Selamat pagi/siang, Assalamu'alaikum Wr. Wb.,",
  "Salam hormat & Assalamu'alaikum Wr. Wb.,",
  "Halo Bapak/Ibu Wali Murid, Assalamu'alaikum Wr. Wb.,",
] as const;

/**
 * Normalizes an Indonesian WhatsApp number into Fonnte's canonical `628...` format.
 * Returns empty string if the input is not a valid 10-15 digit Indonesian number.
 */
export function normalizeFonnteTarget(raw: string | undefined | null): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  let normalized = digits;
  if (normalized.startsWith('0')) {
    normalized = `62${normalized.slice(1)}`;
  } else if (normalized.startsWith('8')) {
    normalized = `62${normalized}`;
  }
  if (!normalized.startsWith('62')) return '';
  if (normalized.length < 10 || normalized.length > 15) return '';
  return normalized;
}

/**
 * Masks a normalized WhatsApp number for logs/UI (e.g. 62812****7890).
 */
export function maskFonnteTarget(target: string): string {
  const clean = normalizeFonnteTarget(target) || String(target || '').replace(/\D/g, '');
  if (clean.length <= 7) return clean;
  return `${clean.slice(0, 5)}****${clean.slice(-4)}`;
}

/**
 * Validates a Fonnte device token before using it in an HTTP Authorization header.
 * Rejects empty values, overly short/long tokens, whitespace, and control characters
 * to prevent malformed requests or header injection.
 */
export function validateFonnteTokenInput(raw: unknown): {
  valid: boolean;
  sanitized: string;
  error?: string;
} {
  if (typeof raw !== 'string') {
    return { valid: false, sanitized: '', error: 'Token Fonnte harus berupa teks.' };
  }
  const sanitized = raw.trim();
  if (!sanitized) {
    return { valid: false, sanitized: '', error: 'Token Fonnte tidak boleh kosong.' };
  }
  if (sanitized.length < 8 || sanitized.length > 256) {
    return {
      valid: false,
      sanitized: '',
      error: 'Panjang Token Fonnte harus antara 8 hingga 256 karakter.',
    };
  }
  // Printable non-whitespace ASCII only (prevents CR/LF HTTP header injection)
  if (!/^[\x21-\x7E]+$/.test(sanitized)) {
    return {
      valid: false,
      sanitized: '',
      error: 'Token Fonnte tidak boleh mengandung spasi, baris baru, atau karakter tidak valid.',
    };
  }
  return { valid: true, sanitized };
}

/**
 * Produces a non-sensitive masked preview of a Fonnte device token (e.g. ab12••••xy89).
 */
export function maskFonnteToken(token: string): string {
  const clean = String(token || '').trim();
  if (!clean) return '';
  if (clean.length <= 8) return `${clean.slice(0, 2)}••••`;
  return `${clean.slice(0, 4)}••••${clean.slice(-4)}`;
}

/**
 * Enforces anti-ban safety bounds so neither UI mistakes nor client overrides can burst-send messages.
 */
export function clampFonntePacing(
  policy?: Partial<FonntePacingPolicy> | null
): FonntePacingPolicy {
  const rawMin = Number(policy?.minDelaySec ?? DEFAULT_FONNTE_PACING.minDelaySec);
  const rawMax = Number(policy?.maxDelaySec ?? DEFAULT_FONNTE_PACING.maxDelaySec);
  const rawBatch = Number(policy?.batchSize ?? DEFAULT_FONNTE_PACING.batchSize);
  const rawPause = Number(policy?.batchPauseSec ?? DEFAULT_FONNTE_PACING.batchPauseSec);

  const minDelaySec = Math.min(
    FONNTE_PACING_BOUNDS.MAX_DELAY_SEC,
    Math.max(
      FONNTE_PACING_BOUNDS.MIN_DELAY_SEC,
      Number.isFinite(rawMin) ? Math.round(rawMin) : DEFAULT_FONNTE_PACING.minDelaySec
    )
  );

  const maxDelaySec = Math.min(
    FONNTE_PACING_BOUNDS.MAX_DELAY_SEC,
    Math.max(
      minDelaySec,
      Number.isFinite(rawMax) ? Math.round(rawMax) : DEFAULT_FONNTE_PACING.maxDelaySec
    )
  );

  const batchSize = Math.min(
    FONNTE_PACING_BOUNDS.MAX_BATCH_SIZE,
    Math.max(
      FONNTE_PACING_BOUNDS.MIN_BATCH_SIZE,
      Number.isFinite(rawBatch) ? Math.round(rawBatch) : DEFAULT_FONNTE_PACING.batchSize
    )
  );

  const batchPauseSec = Math.min(
    FONNTE_PACING_BOUNDS.MAX_BATCH_PAUSE_SEC,
    Math.max(
      FONNTE_PACING_BOUNDS.MIN_BATCH_PAUSE_SEC,
      Number.isFinite(rawPause) ? Math.round(rawPause) : DEFAULT_FONNTE_PACING.batchPauseSec
    )
  );

  return { minDelaySec, maxDelaySec, batchSize, batchPauseSec };
}

/**
 * Computes the next staggered wait duration (in seconds) before sending the next message.
 * When a batch finishes (`sentInCurrentBatch >= batchSize`), returns the longer cool-down pause.
 * Otherwise returns a randomized human-like jitter within `[minDelaySec, maxDelaySec]`.
 */
export function computeNextStaggeredDelaySec(
  sentInCurrentBatch: number,
  policy: FonntePacingPolicy,
  randomUnit = Math.random()
): { delaySec: number; isBatchPause: boolean } {
  const safe = clampFonntePacing(policy);
  if (sentInCurrentBatch > 0 && sentInCurrentBatch >= safe.batchSize) {
    return {
      delaySec: safe.batchPauseSec,
      isBatchPause: true,
    };
  }
  const clampedUnit = Math.min(1, Math.max(0, Number.isFinite(randomUnit) ? randomUnit : 0.5));
  const span = safe.maxDelaySec - safe.minDelaySec;
  const delaySec = safe.minDelaySec + Math.round(span * clampedUnit);
  return {
    delaySec,
    isBatchPause: false,
  };
}

/**
 * Estimates total staggered delivery time (in seconds) for `messageCount` messages using average jitter + batch pauses.
 */
export function estimateStaggeredDurationSec(
  messageCount: number,
  policy: FonntePacingPolicy
): number {
  const count = Math.max(0, Math.floor(messageCount));
  if (count <= 1) return 0;
  const safe = clampFonntePacing(policy);
  const avgDelay = (safe.minDelaySec + safe.maxDelaySec) / 2;
  const batchPauses = Math.floor((count - 1) / safe.batchSize);
  const regularGaps = count - 1 - batchPauses;
  return Math.round(regularGaps * avgDelay + batchPauses * safe.batchPauseSec);
}

/**
 * Formats seconds into readable Indonesian duration string (e.g. "4 menit 30 detik").
 */
export function formatDurationId(totalSeconds: number): string {
  const sec = Math.max(0, Math.round(totalSeconds));
  if (sec < 60) return `${sec} detik`;
  const hours = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const remSec = sec % 60;
  if (hours > 0) {
    return mins > 0 ? `${hours} jam ${mins} menit` : `${hours} jam`;
  }
  return remSec > 0 ? `${mins} menit ${remSec} detik` : `${mins} menit`;
}

/**
 * Daily deduplication key ensuring the same parent does not receive duplicate automated
 * alerts for the same student + date + status.
 */
export function buildFonnteDedupeKey(
  tanggal: string,
  nis: string,
  status: FonnteNotificationCategory
): string {
  const normalizedGroup =
    status === 'Hadir Tepat Waktu'
      ? 'HADIR_TEPAT_WAKTU'
      : status === 'Terlambat'
        ? 'TERLAMBAT'
        : 'TIDAK_HADIR';
  return `${String(tanggal || '').trim()}|${String(nis || '').trim()}|${normalizedGroup}`;
}

export interface FonnteTemplateVars {
  nama: string;
  nisn: string;
  kelas: string;
  tanggal: string;
  jam_masuk: string;
  batas_jam: string;
  status: FonnteNotificationCategory;
  sekolah: string;
}

/**
 * Renders a parent WhatsApp message from template with subtle natural greeting variation
 * to prevent identical bulk-text spam fingerprints.
 */
export function renderFonnteMessage(
  template: string,
  vars: FonnteTemplateVars,
  variationIndex = 0
): string {
  const greeting =
    NATURAL_GREETINGS[Math.abs(Math.floor(variationIndex)) % NATURAL_GREETINGS.length];
  const fallbackTemplate =
    vars.status === 'Hadir Tepat Waktu'
      ? DEFAULT_ON_TIME_TEMPLATE
      : vars.status === 'Terlambat'
        ? DEFAULT_LATE_TEMPLATE
        : DEFAULT_ABSENT_TEMPLATE;
  const base = (template || '').trim() || fallbackTemplate;

  return base
    .replace(/\{salam\}/gi, greeting)
    .replace(/\{nama\}/gi, vars.nama)
    .replace(/\{nisn\}/gi, vars.nisn)
    .replace(/\{nis\}/gi, vars.nisn)
    .replace(/\{kelas\}/gi, vars.kelas)
    .replace(/\{tanggal\}/gi, vars.tanggal)
    .replace(/\{jam_masuk\}/gi, vars.jam_masuk || '-')
    .replace(/\{batas_jam\}/gi, vars.batas_jam || '07:15')
    .replace(/\{status\}/gi, vars.status)
    .replace(/\{sekolah\}/gi, vars.sekolah || 'Sekolah');
}

export interface FonnteCandidateRecipient {
  nis: string;
  nama: string;
  kelas: string;
  no_wa_ortu: string;
  normalizedTarget: string;
  status: FonnteNotificationCategory;
  jam_masuk: string;
  dedupeKey: string;
  alreadyNotified: boolean;
  hasValidPhone: boolean;
  message: string;
}

/**
 * Collects today's late and absent (Alpa / optional Belum Presensi) students ready
 * for staggered Fonnte WhatsApp delivery, marking invalid numbers and duplicates cleanly.
 */
export function buildPendingFonnteRecipients(params: {
  students: Array<{ nis: string; nama: string; kelas: string; no_wa_ortu: string }>;
  todayRecords: Array<{ nis: string; status: string; jam_masuk?: string }>;
  tanggal: string;
  sekolah: string;
  batasJamMasuk: string;
  config: FonnteConfig;
  sentDedupeKeys: ReadonlySet<string>;
  includeOnTime?: boolean;
  includeLate?: boolean;
  includeAbsent?: boolean;
  includeUnrecorded?: boolean;
}): FonnteCandidateRecipient[] {
  const includeOnTime = params.includeOnTime ?? params.config.autoSendOnTime;
  const includeLate = params.includeLate ?? true;
  const includeAbsent = params.includeAbsent ?? true;
  const includeUnrecorded =
    params.includeUnrecorded ?? params.config.includeUnrecordedAsAbsent;

  const recordByNis = new Map<string, { status: string; jam_masuk?: string }>();
  for (const r of params.todayRecords) {
    recordByNis.set(r.nis, r);
  }

  const results: FonnteCandidateRecipient[] = [];
  let variationCounter = 0;

  for (const student of params.students) {
    const rec = recordByNis.get(student.nis);
    let category: FonnteNotificationCategory | null = null;

    if (rec) {
      if (rec.status === 'Hadir' && includeOnTime) {
        category = 'Hadir Tepat Waktu';
      } else if (rec.status === 'Terlambat' && includeLate) {
        category = 'Terlambat';
      } else if (rec.status === 'Alpa' && includeAbsent) {
        category = 'Alpa';
      }
    } else if (includeAbsent && includeUnrecorded) {
      category = 'Belum Presensi';
    }

    if (!category) continue;

    const normalizedTarget = normalizeFonnteTarget(student.no_wa_ortu);
    const dedupeKey = buildFonnteDedupeKey(params.tanggal, student.nis, category);
    const alreadyNotified = params.sentDedupeKeys.has(dedupeKey);
    const template =
      category === 'Hadir Tepat Waktu'
        ? params.config.onTimeTemplate
        : category === 'Terlambat'
          ? params.config.lateTemplate
          : params.config.absentTemplate;

    const message = renderFonnteMessage(
      template,
      {
        nama: student.nama,
        nisn: student.nis,
        kelas: student.kelas,
        tanggal: params.tanggal,
        jam_masuk: rec?.jam_masuk || '-',
        batas_jam: params.batasJamMasuk,
        status: category,
        sekolah: params.sekolah,
      },
      variationCounter++
    );

    results.push({
      nis: student.nis,
      nama: student.nama,
      kelas: student.kelas,
      no_wa_ortu: student.no_wa_ortu,
      normalizedTarget,
      status: category,
      jam_masuk: rec?.jam_masuk || '-',
      dedupeKey,
      alreadyNotified,
      hasValidPhone: Boolean(normalizedTarget),
      message,
    });
  }

  return results;
}

export type FonnteScheduleEvaluationStatus = 'disabled' | 'waiting' | 'due' | 'completed';

export interface FonnteScheduleEvaluation {
  status: FonnteScheduleEvaluationStatus;
  shouldRun: boolean;
  runKey: string;
  todayDate: string;
  currentHHMM: string;
  currentHHMMSS: string;
  targetHHMM: string;
  secondsUntil: number;
}

/**
 * Formats a Date into local YYYY-MM-DD calendar date.
 */
export function formatLocalDateYYYYMMDD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Parses an HH:MM time string into seconds since midnight (0..86340).
 */
export function parseHHMMToSeconds(hhmm: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return null;
  }
  return h * 3600 + m * 60;
}

/**
 * Builds the execution key for a scheduled Fonnte run.
 * Including `targetHHMM` ensures that changing the scheduled time on the same day
 * (e.g. from default 08:30 to 16:17) automatically re-arms the scheduler for the new time.
 */
export function buildFonnteScheduleRunKey(dateYYYYMMDD: string, targetHHMM: string): string {
  return `${String(dateYYYYMMDD || '').trim()}|${String(targetHHMM || '').trim()}`;
}

/**
 * Pure deterministic evaluator for daily scheduled Fonnte auto-send.
 */
export function evaluateScheduledFonnteRun(params: {
  now: Date;
  config: Pick<FonnteConfig, 'enabled' | 'autoAbsentScheduleEnabled' | 'autoAbsentScheduleTime'>;
  lastRunKey: string;
}): FonnteScheduleEvaluation {
  const { now, config, lastRunKey } = params;
  const todayDate = formatLocalDateYYYYMMDD(now);
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const currentHHMM = `${hh}:${mm}`;
  const currentHHMMSS = `${hh}:${mm}:${ss}`;
  const targetHHMM =
    parseHHMMToSeconds(config.autoAbsentScheduleTime) !== null
      ? config.autoAbsentScheduleTime.trim()
      : DEFAULT_FONNTE_CONFIG.autoAbsentScheduleTime;
  const runKey = buildFonnteScheduleRunKey(todayDate, targetHHMM);

  if (!config.enabled || !config.autoAbsentScheduleEnabled) {
    return {
      status: 'disabled',
      shouldRun: false,
      runKey,
      todayDate,
      currentHHMM,
      currentHHMMSS,
      targetHHMM,
      secondsUntil: 0,
    };
  }

  if (lastRunKey === runKey) {
    return {
      status: 'completed',
      shouldRun: false,
      runKey,
      todayDate,
      currentHHMM,
      currentHHMMSS,
      targetHHMM,
      secondsUntil: 0,
    };
  }

  const targetSec = parseHHMMToSeconds(targetHHMM) ?? 8 * 3600 + 30 * 60;
  const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

  if (nowSec >= targetSec) {
    return {
      status: 'due',
      shouldRun: true,
      runKey,
      todayDate,
      currentHHMM,
      currentHHMMSS,
      targetHHMM,
      secondsUntil: 0,
    };
  }

  return {
    status: 'waiting',
    shouldRun: false,
    runKey,
    todayDate,
    currentHHMM,
    currentHHMMSS,
    targetHHMM,
    secondsUntil: targetSec - nowSec,
  };
}

