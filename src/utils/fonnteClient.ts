import {
  DEFAULT_FONNTE_CONFIG,
  DEFAULT_FONNTE_PACING,
  buildFonnteDedupeKey,
  clampFonntePacing,
  computeNextStaggeredDelaySec,
  estimateStaggeredDurationSec,
  maskFonnteTarget,
  normalizeFonnteTarget,
  type FonnteConfig,
  type FonntePacingPolicy,
  type FonnteQueueJob,
  type FonnteQueueJobInput,
  type FonnteQueueSnapshot,
  type FonnteStatusResponse,
} from './fonntePacing';

const FONNTE_CONFIG_KEY = 'presensiqr_fonnte_config_v1';
const FONNTE_SENT_KEYS_STORAGE = 'presensiqr_fonnte_sent_keys_v1';
const FONNTE_LAST_SCHEDULE_RUN_KEY = 'presensiqr_fonnte_last_schedule_run_v1';

export type FonnteClientRole =
  | 'master_admin'
  | 'kepala_sekolah'
  | 'wali_kelas'
  | 'guru'
  | 'scan_kiosk'
  | 'auto_scheduler';

function buildHeaders(role: FonnteClientRole): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    'X-App-Role': role,
  };
}

async function safeParseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    if (res.status === 404) {
      throw new Error(
        'Endpoint API Fonnte tidak ditemukan (HTTP 404). Pastikan konfigurasi netlify.toml & folder netlify/functions sudah ter-deploy di Netlify, atau server aplikasi sedang berjalan.'
      );
    }
    throw new Error(
      `Respon server tidak valid (HTTP ${res.status}). Pastikan server aplikasi sedang berjalan.`
    );
  }
}

interface ServerlessClientJob extends FonnteQueueJob {
  input: FonnteQueueJobInput;
  role: FonnteClientRole;
}

/**
 * Coordinates anti-ban staggered delivery when hosted on serverless platforms (e.g. Netlify Functions)
 * where backend containers freeze immediately after returning an HTTP response.
 * Tokens remain strictly on the server; this runner only dispatches 1 item per serverless call.
 */
class BrowserServerlessFonnteRunner {
  private jobs: ServerlessClientJob[] = [];
  private dedupe = new Set<string>();
  private pacing: FonntePacingPolicy = { ...DEFAULT_FONNTE_PACING };
  private paused = false;
  private processing = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextSendAtMs: number | null = null;
  private sentInCurrentBatch = 0;
  private tokenConfigured = true;

  hasJobs(): boolean {
    return this.jobs.length > 0;
  }

  setTokenConfigured(configured: boolean): void {
    this.tokenConfigured = configured;
  }

  recordRemoteJobs(remoteJobs: FonnteQueueJob[]): void {
    if (!Array.isArray(remoteJobs) || remoteJobs.length === 0) return;
    const existingIds = new Set(this.jobs.map((j) => j.id));
    for (const rj of remoteJobs) {
      if (existingIds.has(rj.id)) continue;
      if (rj.state === 'sent') {
        this.dedupe.add(rj.dedupeKey);
      }
      this.jobs.push({
        ...rj,
        input: {
          nis: rj.nis,
          studentName: rj.studentName,
          kelas: rj.kelas,
          target: '',
          status: rj.status,
          tanggal: rj.tanggal,
          message: '',
        },
        role: 'master_admin',
      });
    }
    if (this.jobs.length > 500) {
      this.jobs = this.jobs.slice(-500);
    }
  }

  getSnapshot(): FonnteQueueSnapshot {
    let pending = 0;
    let sending = 0;
    let sent = 0;
    let failed = 0;
    for (const j of this.jobs) {
      if (j.state === 'pending') pending++;
      else if (j.state === 'sending') sending++;
      else if (j.state === 'sent') sent++;
      else if (j.state === 'failed') failed++;
    }
    const remainingToSend = pending + sending;
    const baseRemainingSec = estimateStaggeredDurationSec(remainingToSend, this.pacing);
    const countdownSec =
      this.nextSendAtMs && this.nextSendAtMs > Date.now()
        ? Math.ceil((this.nextSendAtMs - Date.now()) / 1000)
        : 0;

    return {
      running: this.processing || this.timer !== null,
      paused: this.paused,
      tokenConfigured: this.tokenConfigured,
      nextSendAt: this.nextSendAtMs ? new Date(this.nextSendAtMs).toISOString() : null,
      sentInCurrentBatch: this.sentInCurrentBatch,
      counts: {
        pending,
        sending,
        sent,
        failed,
        total: this.jobs.length,
      },
      pacing: { ...this.pacing },
      estimatedRemainingSec: remainingToSend > 0 ? baseRemainingSec + countdownSec : 0,
      jobs: this.jobs.slice(-100).map(({ input: _i, role: _r, ...pub }) => pub),
    };
  }

  enqueue(
    role: FonnteClientRole,
    items: FonnteQueueJobInput[],
    pacing: FonntePacingPolicy
  ): { enqueued: number; skippedDuplicates: number; skippedInvalid: number } {
    this.pacing = clampFonntePacing(pacing);
    let enqueued = 0;
    let skippedDuplicates = 0;
    let skippedInvalid = 0;

    for (const item of items) {
      const target = normalizeFonnteTarget(item.target);
      if (!item.nis || !item.studentName || !item.tanggal || !item.message || !target) {
        skippedInvalid++;
        continue;
      }
      const dedupeKey = buildFonnteDedupeKey(item.tanggal, item.nis, item.status);
      if (this.dedupe.has(dedupeKey)) {
        skippedDuplicates++;
        continue;
      }
      this.dedupe.add(dedupeKey);
      this.jobs.push({
        id: `sfq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        dedupeKey,
        nis: item.nis,
        studentName: item.studentName,
        kelas: item.kelas || '-',
        targetMasked: maskFonnteTarget(target),
        status: item.status,
        tanggal: item.tanggal,
        state: 'pending',
        attempts: 0,
        createdAt: new Date().toISOString(),
        input: { ...item, target },
        role,
      });
      enqueued++;
    }

    if (this.jobs.length > 500) {
      this.jobs = this.jobs.slice(-500);
    }

    if (enqueued > 0 && !this.paused) {
      this.kickoff();
    }
    return { enqueued, skippedDuplicates, skippedInvalid };
  }

  pause(): void {
    this.paused = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.nextSendAtMs = null;
  }

  resume(): void {
    this.paused = false;
    this.kickoff();
  }

  clear(): void {
    this.pause();
    this.jobs = [];
    this.dedupe.clear();
    this.sentInCurrentBatch = 0;
    this.paused = false;
  }

  private kickoff(): void {
    if (this.paused || this.processing || this.timer) return;
    if (!this.jobs.some((j) => j.state === 'pending')) {
      this.nextSendAtMs = null;
      return;
    }
    void this.processNext();
  }

  private scheduleNext(): void {
    if (this.paused) {
      this.nextSendAtMs = null;
      return;
    }
    const nextPending = this.jobs.find((j) => j.state === 'pending');
    if (!nextPending) {
      this.nextSendAtMs = null;
      this.sentInCurrentBatch = 0;
      return;
    }
    const { delaySec, isBatchPause } = computeNextStaggeredDelaySec(
      this.sentInCurrentBatch,
      this.pacing
    );
    if (isBatchPause) {
      this.sentInCurrentBatch = 0;
    }
    nextPending.scheduledDelaySec = delaySec;
    this.nextSendAtMs = Date.now() + delaySec * 1000;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.nextSendAtMs = null;
      void this.processNext();
    }, delaySec * 1000);
  }

  private async processNext(): Promise<void> {
    if (this.paused || this.processing) return;
    const job = this.jobs.find((j) => j.state === 'pending');
    if (!job) {
      this.nextSendAtMs = null;
      return;
    }

    this.processing = true;
    job.state = 'sending';
    job.attempts += 1;

    try {
      const res = await fetch('/api/fonnte/enqueue', {
        method: 'POST',
        credentials: 'same-origin',
        headers: buildHeaders(job.role),
        body: JSON.stringify({
          items: [job.input],
          pacing: this.pacing,
        }),
      });
      const data = await safeParseJson<{
        queue?: FonnteQueueSnapshot;
        error?: string;
      }>(res);
      if (!res.ok) {
        job.state = 'failed';
        job.error = data.error || `Gagal mengirim pesan (HTTP ${res.status}).`;
        this.dedupe.delete(job.dedupeKey);
      } else {
        const remoteJob = data.queue?.jobs?.find((rj) => rj.dedupeKey === job.dedupeKey);
        if (remoteJob && remoteJob.state === 'failed') {
          job.state = 'failed';
          job.error = remoteJob.error || 'Pengiriman ditolak oleh Fonnte.';
          this.dedupe.delete(job.dedupeKey);
        } else {
          job.state = 'sent';
          job.sentAt = remoteJob?.sentAt || new Date().toISOString();
          job.error = undefined;
          this.sentInCurrentBatch += 1;
        }
      }
    } catch (err) {
      job.state = 'failed';
      job.error = err instanceof Error ? err.message : 'Gagal menghubungi server Fonnte.';
      this.dedupe.delete(job.dedupeKey);
    } finally {
      this.processing = false;
      this.scheduleNext();
    }
  }
}

let detectedServerMode: 'persistent' | 'serverless' | null = null;
const serverlessRunner = new BrowserServerlessFonnteRunner();

export function hasSavedFonnteConfigPreference(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return Boolean(window.localStorage.getItem(FONNTE_CONFIG_KEY));
  } catch {
    return false;
  }
}

export function loadFonnteConfig(): FonnteConfig {
  if (typeof window === 'undefined') return { ...DEFAULT_FONNTE_CONFIG };
  try {
    const raw = window.localStorage.getItem(FONNTE_CONFIG_KEY);
    if (!raw) return { ...DEFAULT_FONNTE_CONFIG };
    const parsed = JSON.parse(raw) as Partial<FonnteConfig>;
    return {
      enabled: Boolean(parsed.enabled),
      autoSendOnTime: parsed.autoSendOnTime ?? DEFAULT_FONNTE_CONFIG.autoSendOnTime,
      autoSendLate: parsed.autoSendLate ?? DEFAULT_FONNTE_CONFIG.autoSendLate,
      autoSendAbsent: parsed.autoSendAbsent ?? DEFAULT_FONNTE_CONFIG.autoSendAbsent,
      autoSendCheckoutOnTime:
        parsed.autoSendCheckoutOnTime ?? DEFAULT_FONNTE_CONFIG.autoSendCheckoutOnTime,
      autoSendCheckoutEarly:
        parsed.autoSendCheckoutEarly ?? DEFAULT_FONNTE_CONFIG.autoSendCheckoutEarly,
      autoAbsentScheduleEnabled: Boolean(parsed.autoAbsentScheduleEnabled),
      autoAbsentScheduleTime:
        typeof parsed.autoAbsentScheduleTime === 'string' &&
        /^\d{2}:\d{2}$/.test(parsed.autoAbsentScheduleTime)
          ? parsed.autoAbsentScheduleTime
          : DEFAULT_FONNTE_CONFIG.autoAbsentScheduleTime,
      includeUnrecordedAsAbsent:
        parsed.includeUnrecordedAsAbsent ?? DEFAULT_FONNTE_CONFIG.includeUnrecordedAsAbsent,
      pacing: clampFonntePacing(parsed.pacing),
      onTimeTemplate:
        typeof parsed.onTimeTemplate === 'string' && parsed.onTimeTemplate.trim()
          ? parsed.onTimeTemplate
          : DEFAULT_FONNTE_CONFIG.onTimeTemplate,
      lateTemplate:
        typeof parsed.lateTemplate === 'string' && parsed.lateTemplate.trim()
          ? parsed.lateTemplate
          : DEFAULT_FONNTE_CONFIG.lateTemplate,
      absentTemplate:
        typeof parsed.absentTemplate === 'string' && parsed.absentTemplate.trim()
          ? parsed.absentTemplate
          : DEFAULT_FONNTE_CONFIG.absentTemplate,
      checkoutOnTimeTemplate:
        typeof parsed.checkoutOnTimeTemplate === 'string' && parsed.checkoutOnTimeTemplate.trim()
          ? parsed.checkoutOnTimeTemplate
          : DEFAULT_FONNTE_CONFIG.checkoutOnTimeTemplate,
      checkoutEarlyTemplate:
        typeof parsed.checkoutEarlyTemplate === 'string' && parsed.checkoutEarlyTemplate.trim()
          ? parsed.checkoutEarlyTemplate
          : DEFAULT_FONNTE_CONFIG.checkoutEarlyTemplate,
    };
  } catch {
    return { ...DEFAULT_FONNTE_CONFIG };
  }
}

export function saveFonnteConfig(config: FonnteConfig): FonnteConfig {
  const sanitized: FonnteConfig = {
    ...config,
    pacing: clampFonntePacing(config.pacing),
  };
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(FONNTE_CONFIG_KEY, JSON.stringify(sanitized));
    } catch {
      // Ignore quota errors on non-critical preference storage
    }
  }
  return sanitized;
}

export function loadLocalFonnteSentKeys(todayDate: string): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(FONNTE_SENT_KEYS_STORAGE);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as { date?: string; keys?: string[] };
    if (parsed.date !== todayDate || !Array.isArray(parsed.keys)) {
      return new Set();
    }
    return new Set(parsed.keys.filter((k) => typeof k === 'string'));
  } catch {
    return new Set();
  }
}

export function saveLocalFonnteSentKeys(todayDate: string, keys: Iterable<string>): void {
  if (typeof window === 'undefined') return;
  try {
    const unique = Array.from(new Set(keys)).slice(-1000);
    window.localStorage.setItem(
      FONNTE_SENT_KEYS_STORAGE,
      JSON.stringify({ date: todayDate, keys: unique })
    );
  } catch {
    // ignore storage errors
  }
}

export function clearLocalFonnteSentKeys(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(FONNTE_SENT_KEYS_STORAGE);
  } catch {
    // ignore storage errors
  }
}

export function loadLastFonnteScheduleRunKey(): string {
  if (typeof window === 'undefined') return '';
  try {
    return (window.localStorage.getItem(FONNTE_LAST_SCHEDULE_RUN_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function saveLastFonnteScheduleRunKey(runKey: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (!runKey) {
      window.localStorage.removeItem(FONNTE_LAST_SCHEDULE_RUN_KEY);
    } else {
      window.localStorage.setItem(FONNTE_LAST_SCHEDULE_RUN_KEY, runKey);
    }
  } catch {
    // ignore storage errors
  }
}

export async function fetchFonnteStatus(
  role: FonnteClientRole,
  checkDevice = false,
  force = false
): Promise<FonnteStatusResponse> {
  const params = new URLSearchParams();
  if (checkDevice) params.set('checkDevice', '1');
  if (force) params.set('force', '1');
  const qs = params.toString();
  const query = qs ? `?${qs}` : '';
  const res = await fetch(`/api/fonnte/status${query}`, {
    method: 'GET',
    credentials: 'same-origin',
    headers: buildHeaders(role),
  });
  const data = await safeParseJson<FonnteStatusResponse & { error?: string }>(res);
  if (!res.ok) {
    throw new Error(data.error || 'Gagal memeriksa status server Fonnte.');
  }
  if (data.serverMode === 'serverless' || data.serverMode === 'persistent') {
    detectedServerMode = data.serverMode;
  }
  serverlessRunner.setTokenConfigured(Boolean(data.configured));
  if (detectedServerMode === 'serverless' && serverlessRunner.hasJobs()) {
    return {
      ...data,
      queue: serverlessRunner.getSnapshot(),
    };
  }
  return data;
}

export async function fetchFonnteQueue(role: FonnteClientRole): Promise<FonnteQueueSnapshot> {
  if (detectedServerMode === 'serverless' && serverlessRunner.hasJobs()) {
    return serverlessRunner.getSnapshot();
  }
  const res = await fetch('/api/fonnte/queue', {
    method: 'GET',
    credentials: 'same-origin',
    headers: buildHeaders(role),
  });
  const data = await safeParseJson<{
    serverMode?: 'persistent' | 'serverless';
    queue?: FonnteQueueSnapshot;
    error?: string;
  }>(res);
  if (!res.ok || !data.queue) {
    throw new Error(data.error || 'Gagal memuat antrean Fonnte.');
  }
  if (data.serverMode === 'serverless' || data.serverMode === 'persistent') {
    detectedServerMode = data.serverMode;
  }
  return data.queue;
}

export async function enqueueFonnteNotifications(params: {
  role: FonnteClientRole;
  items: FonnteQueueJobInput[];
  pacing: FonntePacingPolicy;
}): Promise<{
  enqueued: number;
  skippedDuplicates: number;
  skippedInvalid: number;
  queue: FonnteQueueSnapshot;
}> {
  const clampedPacing = clampFonntePacing(params.pacing);

  // If server mode is not yet known for multi-item batches, probe /api/fonnte/status first
  if (detectedServerMode === null && params.items.length > 1) {
    try {
      await fetchFonnteStatus(params.role, false);
    } catch {
      // Proceed to normal request which will report the exact network/HTTP error
    }
  }

  // On serverless platforms (Netlify), pace multi-item batches 1-by-1 via client runner
  // so every message respects anti-ban delays without hitting serverless execution timeouts.
  if (detectedServerMode === 'serverless' && params.items.length > 1) {
    const result = serverlessRunner.enqueue(params.role, params.items, clampedPacing);
    return {
      ...result,
      queue: serverlessRunner.getSnapshot(),
    };
  }

  const res = await fetch('/api/fonnte/enqueue', {
    method: 'POST',
    credentials: 'same-origin',
    headers: buildHeaders(params.role),
    body: JSON.stringify({
      items: params.items,
      pacing: clampedPacing,
    }),
  });
  const data = await safeParseJson<{
    enqueued?: number;
    skippedDuplicates?: number;
    skippedInvalid?: number;
    serverMode?: 'persistent' | 'serverless';
    queue?: FonnteQueueSnapshot;
    error?: string;
  }>(res);
  if (!res.ok || !data.queue) {
    throw new Error(data.error || 'Gagal memasukkan pesan ke antrean Fonnte.');
  }
  if (data.serverMode === 'serverless' || data.serverMode === 'persistent') {
    detectedServerMode = data.serverMode;
  }
  if (detectedServerMode === 'serverless' && serverlessRunner.hasJobs()) {
    serverlessRunner.recordRemoteJobs(data.queue.jobs);
    return {
      enqueued: data.enqueued ?? 0,
      skippedDuplicates: data.skippedDuplicates ?? 0,
      skippedInvalid: data.skippedInvalid ?? 0,
      queue: serverlessRunner.getSnapshot(),
    };
  }
  return {
    enqueued: data.enqueued ?? 0,
    skippedDuplicates: data.skippedDuplicates ?? 0,
    skippedInvalid: data.skippedInvalid ?? 0,
    queue: data.queue,
  };
}

export async function controlFonnteQueue(
  role: FonnteClientRole,
  action: 'pause' | 'resume' | 'clear'
): Promise<FonnteQueueSnapshot> {
  if (detectedServerMode === 'serverless' && serverlessRunner.hasJobs()) {
    if (action === 'pause') serverlessRunner.pause();
    else if (action === 'resume') serverlessRunner.resume();
    else if (action === 'clear') serverlessRunner.clear();
  }

  const res = await fetch(`/api/fonnte/queue/${action}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: buildHeaders(role),
    body: JSON.stringify({}),
  });
  const data = await safeParseJson<{ queue?: FonnteQueueSnapshot; error?: string }>(res);
  if (!res.ok || !data.queue) {
    throw new Error(data.error || 'Gagal mengendalikan antrean Fonnte.');
  }
  if (detectedServerMode === 'serverless' && serverlessRunner.hasJobs()) {
    return serverlessRunner.getSnapshot();
  }
  return data.queue;
}

export async function sendFonnteTestMessage(params: {
  role: FonnteClientRole;
  target: string;
  message: string;
}): Promise<{ ok: boolean; detail: string }> {
  const res = await fetch('/api/fonnte/test', {
    method: 'POST',
    credentials: 'same-origin',
    headers: buildHeaders(params.role),
    body: JSON.stringify({
      target: params.target,
      message: params.message,
    }),
  });
  const data = await safeParseJson<{ ok?: boolean; detail?: string; error?: string }>(res);
  if (!res.ok) {
    throw new Error(data.error || data.detail || 'Gagal mengirim pesan uji coba Fonnte.');
  }
  return { ok: Boolean(data.ok), detail: data.detail || 'Pesan uji coba berhasil dikirim.' };
}

export async function updateFonnteToken(params: {
  role: FonnteClientRole;
  token: string;
  label?: string;
}): Promise<FonnteStatusResponse & { message?: string }> {
  const res = await fetch('/api/fonnte/token', {
    method: 'POST',
    credentials: 'same-origin',
    headers: buildHeaders(params.role),
    body: JSON.stringify({
      token: params.token,
      label: params.label?.trim() || undefined,
    }),
  });
  const data = await safeParseJson<FonnteStatusResponse & { message?: string; error?: string }>(
    res
  );
  if (!res.ok) {
    throw new Error(data.error || 'Gagal memperbarui Token Fonnte di server.');
  }
  return data;
}

export async function switchFonnteTokenSlot(params: {
  role: FonnteClientRole;
  slot: 'primary' | 'backup_2' | 'backup_3';
}): Promise<FonnteStatusResponse & { message?: string }> {
  const res = await fetch('/api/fonnte/token', {
    method: 'POST',
    credentials: 'same-origin',
    headers: buildHeaders(params.role),
    body: JSON.stringify({
      slot: params.slot,
    }),
  });
  const data = await safeParseJson<FonnteStatusResponse & { message?: string; error?: string }>(
    res
  );
  if (!res.ok) {
    throw new Error(data.error || 'Gagal mengganti slot Token Fonnte di server.');
  }
  return data;
}

export async function resetFonnteTokenToDefault(
  role: FonnteClientRole
): Promise<FonnteStatusResponse & { message?: string }> {
  const res = await fetch('/api/fonnte/token', {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: buildHeaders(role),
  });
  const data = await safeParseJson<FonnteStatusResponse & { message?: string; error?: string }>(
    res
  );
  if (!res.ok) {
    throw new Error(data.error || 'Gagal mengembalikan Token Fonnte bawaan server.');
  }
  return data;
}
