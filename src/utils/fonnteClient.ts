import {
  DEFAULT_FONNTE_CONFIG,
  clampFonntePacing,
  type FonnteConfig,
  type FonntePacingPolicy,
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
    throw new Error(
      `Respon server tidak valid (HTTP ${res.status}). Pastikan server aplikasi sedang berjalan.`
    );
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
  checkDevice = false
): Promise<FonnteStatusResponse> {
  const query = checkDevice ? '?checkDevice=1' : '';
  const res = await fetch(`/api/fonnte/status${query}`, {
    method: 'GET',
    headers: buildHeaders(role),
  });
  const data = await safeParseJson<FonnteStatusResponse & { error?: string }>(res);
  if (!res.ok) {
    throw new Error(data.error || 'Gagal memeriksa status server Fonnte.');
  }
  return data;
}

export async function fetchFonnteQueue(role: FonnteClientRole): Promise<FonnteQueueSnapshot> {
  const res = await fetch('/api/fonnte/queue', {
    method: 'GET',
    headers: buildHeaders(role),
  });
  const data = await safeParseJson<{ queue?: FonnteQueueSnapshot; error?: string }>(res);
  if (!res.ok || !data.queue) {
    throw new Error(data.error || 'Gagal memuat antrean Fonnte.');
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
  const res = await fetch('/api/fonnte/enqueue', {
    method: 'POST',
    headers: buildHeaders(params.role),
    body: JSON.stringify({
      items: params.items,
      pacing: clampFonntePacing(params.pacing),
    }),
  });
  const data = await safeParseJson<{
    enqueued?: number;
    skippedDuplicates?: number;
    skippedInvalid?: number;
    queue?: FonnteQueueSnapshot;
    error?: string;
  }>(res);
  if (!res.ok || !data.queue) {
    throw new Error(data.error || 'Gagal memasukkan pesan ke antrean Fonnte.');
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
  const res = await fetch(`/api/fonnte/queue/${action}`, {
    method: 'POST',
    headers: buildHeaders(role),
    body: JSON.stringify({}),
  });
  const data = await safeParseJson<{ queue?: FonnteQueueSnapshot; error?: string }>(res);
  if (!res.ok || !data.queue) {
    throw new Error(data.error || 'Gagal mengendalikan antrean Fonnte.');
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
