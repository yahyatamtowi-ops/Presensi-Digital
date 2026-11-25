import crypto from 'node:crypto';
import process from 'node:process';
import {
  DEFAULT_FONNTE_PACING,
  buildFonnteDedupeKey,
  clampFonntePacing,
  maskFonnteTarget,
  maskFonnteToken,
  normalizeFonnteTarget,
  validateFonnteTokenInput,
  type FonnteEnvSlotInfo,
  type FonnteNotificationCategory,
  type FonntePacingPolicy,
  type FonnteQueueJob,
  type FonnteQueueSnapshot,
  type FonnteTokenMeta,
} from '../../src/utils/fonntePacing';
import {
  BACKUP_2_FONNTE_ENV_KEYS,
  BACKUP_3_FONNTE_ENV_KEYS,
  PRIMARY_FONNTE_ENV_KEYS,
  readServerFonnteEnvToken,
} from '../../src/utils/fonnteAutoConnect';

// Hardcoded official Fonnte API endpoints (never user-supplied)
const FONNTE_SEND_URL = 'https://api.fonnte.com/send';
const FONNTE_DEVICE_URL = 'https://api.fonnte.com/device';

const STAFF_ROLES = new Set(['master_admin', 'kepala_sekolah', 'wali_kelas']);
const ALLOWED_ROLES = new Set([
  'master_admin',
  'kepala_sekolah',
  'wali_kelas',
  'guru',
  'scan_kiosk',
  'auto_scheduler',
]);
const ALLOWED_STATUSES = new Set<FonnteNotificationCategory>([
  'Hadir Tepat Waktu',
  'Terlambat',
  'Alpa',
  'Belum Presensi',
]);

// Module-level warm-instance state (persists across warm invocations; env secrets + encrypted HttpOnly cookie handle cold starts)
let activeEnvSlot: 'primary' | 'backup_2' | 'backup_3' = 'primary';
let runtimeTokenOverride: string | null = null;
let runtimeTokenLabel = 'Nomor WA Kustom (Aktif)';
let recentJobs: FonnteQueueJob[] = [];
const dedupeRegistry = new Set<string>();
let lastPacing: FonntePacingPolicy = { ...DEFAULT_FONNTE_PACING };

const RUNTIME_TOKEN_COOKIE = 'presensi_fonnte_rtok';
const EPHEMERAL_FALLBACK_KEY = crypto.randomBytes(32);

interface StoredTokenOverride {
  token: string;
  label: string;
}

function getNetlifyEnvGetter(): ((key: string) => string | undefined) | undefined {
  const g = globalThis as { Netlify?: { env?: { get?: (key: string) => string | undefined } } };
  return typeof g.Netlify?.env?.get === 'function' ? g.Netlify.env.get.bind(g.Netlify.env) : undefined;
}

function readServerEnvVar(key: string): string {
  const netlifyGet = getNetlifyEnvGetter();
  if (netlifyGet) {
    try {
      const val = (netlifyGet(key) || '').trim();
      if (val) return val;
    } catch {
      // Fall through to process.env
    }
  }
  return (process.env[key] || '').trim();
}

function getCookieCipherKey(): Buffer {
  const seed =
    readServerEnvVar('FONNTE_SESSION_SECRET') ||
    readServerEnvVar('SITE_ID') ||
    getEnvSlotValue('primary');
  if (!seed) return EPHEMERAL_FALLBACK_KEY;
  return crypto.createHash('sha256').update(`presensi-fonnte-v1:${seed}`).digest();
}

function encryptTokenOverride(payload: StoredTokenOverride): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getCookieCipherKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64url');
}

function decryptTokenOverride(rawCookieValue: string): StoredTokenOverride | null {
  try {
    const buf = Buffer.from(rawCookieValue, 'base64url');
    if (buf.length < 12 + 16 + 2) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', getCookieCipherKey(), iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(plain) as { token?: unknown; label?: unknown };
    const validation = validateFonnteTokenInput(parsed.token);
    if (!validation.valid) return null;
    const label =
      typeof parsed.label === 'string' && parsed.label.trim()
        ? parsed.label.trim().slice(0, 60)
        : 'Nomor WA Kustom (Aktif)';
    return { token: validation.sanitized, label };
  } catch {
    return null;
  }
}

function readTokenOverrideFromRequest(request: Request): StoredTokenOverride | null {
  const cookieHeader = request.headers.get('cookie') || '';
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name === RUNTIME_TOKEN_COOKIE) {
      const value = part.slice(eq + 1).trim();
      if (!value) return null;
      return decryptTokenOverride(value);
    }
  }
  return null;
}

function buildRuntimeTokenSetCookieHeader(
  request: Request,
  payload: StoredTokenOverride | null
): string {
  const isHttps = request.url.startsWith('https://');
  const attrs = [
    'Path=/api/fonnte',
    'HttpOnly',
    isHttps ? 'SameSite=None; Secure; Partitioned' : 'SameSite=Lax',
  ];
  if (!payload) {
    return `${RUNTIME_TOKEN_COOKIE}=; Max-Age=0; ${attrs.join('; ')}`;
  }
  const encoded = encryptTokenOverride(payload);
  // 30-day persistence across serverless cold starts (strictly HttpOnly + AES-256-GCM encrypted)
  return `${RUNTIME_TOKEN_COOKIE}=${encoded}; Max-Age=2592000; ${attrs.join('; ')}`;
}

function jsonResponse(body: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(extraHeaders || {}),
    },
  });
}

function getEnvSlotValue(slot: 'primary' | 'backup_2' | 'backup_3'): string {
  const reader = {
    processEnv: process.env,
    netlifyEnvGet: getNetlifyEnvGetter(),
  };
  if (slot === 'backup_2') {
    return readServerFonnteEnvToken(BACKUP_2_FONNTE_ENV_KEYS, reader);
  }
  if (slot === 'backup_3') {
    return readServerFonnteEnvToken(BACKUP_3_FONNTE_ENV_KEYS, reader);
  }
  return readServerFonnteEnvToken(PRIMARY_FONNTE_ENV_KEYS, reader);
}

function getAvailableEnvSlots(): FonnteEnvSlotInfo[] {
  const defs: Array<{
    slot: 'primary' | 'backup_2' | 'backup_3';
    envName: 'FONNTE_TOKEN' | 'FONNTE_TOKEN_2' | 'FONNTE_TOKEN_3';
    label: string;
  }> = [
    { slot: 'primary', envName: 'FONNTE_TOKEN', label: 'Token Utama Server' },
    { slot: 'backup_2', envName: 'FONNTE_TOKEN_2', label: 'Nomor Cadangan 2' },
    { slot: 'backup_3', envName: 'FONNTE_TOKEN_3', label: 'Nomor Cadangan 3' },
  ];
  return defs.map((d) => {
    const val = getEnvSlotValue(d.slot);
    return {
      ...d,
      configured: val.length > 0,
      maskedToken: maskFonnteToken(val),
    };
  });
}

function getActiveToken(cookieOverride?: StoredTokenOverride | null): string {
  if (cookieOverride?.token) return cookieOverride.token;
  if (runtimeTokenOverride) return runtimeTokenOverride;
  const selected = getEnvSlotValue(activeEnvSlot);
  if (selected) return selected;
  for (const fallback of ['primary', 'backup_2', 'backup_3'] as const) {
    const val = getEnvSlotValue(fallback);
    if (val) return val;
  }
  return '';
}

function getTokenMeta(cookieOverride?: StoredTokenOverride | null): FonnteTokenMeta {
  const availableEnvSlots = getAvailableEnvSlots();
  const effectiveOverride = cookieOverride?.token
    ? cookieOverride
    : runtimeTokenOverride
      ? { token: runtimeTokenOverride, label: runtimeTokenLabel }
      : null;

  if (effectiveOverride) {
    return {
      configured: true,
      activeSlot: 'custom',
      activeLabel: effectiveOverride.label,
      maskedToken: maskFonnteToken(effectiveOverride.token),
      hasRuntimeOverride: true,
      availableEnvSlots,
    };
  }

  const activeEnv =
    availableEnvSlots.find((s) => s.slot === activeEnvSlot && s.configured) ||
    availableEnvSlots.find((s) => s.configured);

  if (activeEnv) {
    return {
      configured: true,
      activeSlot: activeEnv.slot,
      activeLabel: activeEnv.label,
      maskedToken: activeEnv.maskedToken,
      hasRuntimeOverride: false,
      availableEnvSlots,
    };
  }

  return {
    configured: false,
    activeSlot: 'none',
    activeLabel: 'Belum Dikonfigurasi',
    maskedToken: '',
    hasRuntimeOverride: false,
    availableEnvSlots,
  };
}

function getQueueSnapshot(cookieOverride?: StoredTokenOverride | null): FonnteQueueSnapshot {
  let pending = 0;
  let sending = 0;
  let sent = 0;
  let failed = 0;
  for (const job of recentJobs) {
    if (job.state === 'pending') pending++;
    else if (job.state === 'sending') sending++;
    else if (job.state === 'sent') sent++;
    else if (job.state === 'failed') failed++;
  }
  return {
    running: false,
    paused: false,
    tokenConfigured: getActiveToken(cookieOverride).length > 0,
    nextSendAt: null,
    sentInCurrentBatch: 0,
    counts: {
      pending,
      sending,
      sent,
      failed,
      total: recentJobs.length,
    },
    pacing: { ...lastPacing },
    estimatedRemainingSec: 0,
    jobs: recentJobs.slice(-100),
  };
}

async function sendSingleFonnteRequest(
  token: string,
  target: string,
  message: string,
  nativeDelay?: { minDelaySec: number; maxDelaySec: number }
): Promise<{ ok: boolean; detail: string }> {
  const form = new URLSearchParams();
  form.set('target', target);
  form.set('message', message);
  form.set('countryCode', '62');
  if (nativeDelay) {
    form.set('delay', `${nativeDelay.minDelaySec}-${nativeDelay.maxDelaySec}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(FONNTE_SEND_URL, {
      method: 'POST',
      headers: {
        Authorization: token,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
      signal: controller.signal,
    });

    const payload = (await response.json().catch(() => ({}))) as {
      status?: boolean;
      detail?: string;
      reason?: string;
    };

    if (!response.ok || payload.status === false) {
      return {
        ok: false,
        detail:
          payload.reason ||
          payload.detail ||
          `Fonnte menolak pengiriman (HTTP ${response.status}).`,
      };
    }

    return {
      ok: true,
      detail: payload.detail || 'Pesan WhatsApp berhasil diterima Fonnte.',
    };
  } finally {
    clearTimeout(timeout);
  }
}

interface FonnteDeviceCheckResult {
  checked: boolean;
  connected: boolean;
  device?: string;
  name?: string;
  quota?: string | number;
  message?: string;
}

const DEVICE_STATUS_CACHE_TTL_MS = 45_000;
const deviceStatusCache = new Map<string, { expiresAt: number; result: FonnteDeviceCheckResult }>();

function hashTokenForCache(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function checkFonnteDeviceStatus(
  token: string,
  options?: { force?: boolean }
): Promise<FonnteDeviceCheckResult> {
  const cacheKey = hashTokenForCache(token);
  const now = Date.now();
  if (!options?.force) {
    const cached = deviceStatusCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.result;
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(FONNTE_DEVICE_URL, {
      method: 'POST',
      headers: {
        Authorization: token,
      },
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => ({}))) as {
      status?: boolean;
      device_status?: string;
      device?: string;
      name?: string;
      quota?: string | number;
      reason?: string;
    };
    const isConnected =
      response.ok &&
      payload.status !== false &&
      String(payload.device_status || '').toLowerCase() !== 'disconnect';
    const result: FonnteDeviceCheckResult = {
      checked: true,
      connected: isConnected,
      device: payload.device,
      name: payload.name,
      quota: payload.quota,
      message: payload.reason || payload.device_status || (isConnected ? 'Terhubung' : 'Terputus'),
    };
    deviceStatusCache.set(cacheKey, {
      expiresAt: Date.now() + DEVICE_STATUS_CACHE_TTL_MS,
      result,
    });
    return result;
  } catch (err) {
    return {
      checked: true,
      connected: false,
      message: err instanceof Error ? err.message : 'Gagal menghubungi server Fonnte.',
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function extractFonnteSubpath(pathname: string): string {
  const cleaned = pathname.replace(/\/+$/, '') || '/';
  const prefixes = ['/api/fonnte', '/.netlify/functions/fonnte'];
  for (const prefix of prefixes) {
    if (cleaned === prefix) return '/';
    if (cleaned.startsWith(`${prefix}/`)) {
      return cleaned.slice(prefix.length);
    }
  }
  return cleaned;
}

async function parseJsonBody(request: Request): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false }> {
  try {
    const text = await request.text();
    if (!text.trim()) return { ok: true, data: {} };
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false };
    }
    return { ok: true, data: parsed as Record<string, unknown> };
  } catch {
    return { ok: false };
  }
}

export function resetServerlessStateForTest(): void {
  activeEnvSlot = 'primary';
  runtimeTokenOverride = null;
  runtimeTokenLabel = 'Nomor WA Kustom (Aktif)';
  recentJobs = [];
  dedupeRegistry.clear();
  deviceStatusCache.clear();
  lastPacing = { ...DEFAULT_FONNTE_PACING };
}

export async function handleFonnteServerlessRequest(request: Request): Promise<Response> {
  const method = request.method.toUpperCase();
  const url = new URL(request.url);
  const subpath = extractFonnteSubpath(url.pathname);

  // Enforce standard application headers & RBAC
  const xrw = (request.headers.get('x-requested-with') || '').trim();
  const role = (request.headers.get('x-app-role') || '').trim();
  if (xrw !== 'XMLHttpRequest' || !ALLOWED_ROLES.has(role)) {
    return jsonResponse({ error: 'Akses API ditolak: header aplikasi tidak valid.' }, 403);
  }

  const cookieOverride = readTokenOverrideFromRequest(request);

  // GET /api/fonnte/status
  if (method === 'GET' && (subpath === '/status' || subpath === '/')) {
    try {
      const token = getActiveToken(cookieOverride);
      const configured = token.length > 0;
      const primaryConfigured = getEnvSlotValue('primary').length > 0;
      const shouldCheckDevice = url.searchParams.get('checkDevice') === '1';
      const forceCheck = url.searchParams.get('force') === '1';
      let deviceStatus = undefined;

      if (configured && shouldCheckDevice) {
        deviceStatus = await checkFonnteDeviceStatus(token, { force: forceCheck });
      }

      return jsonResponse({
        configured,
        primaryConfigured,
        autoConnected: Boolean(configured && (!deviceStatus || deviceStatus.connected)),
        serverMode: 'serverless',
        tokenMeta: getTokenMeta(cookieOverride),
        deviceStatus,
        queue: getQueueSnapshot(cookieOverride),
      });
    } catch (err) {
      return jsonResponse(
        { error: err instanceof Error ? err.message : 'Gagal memeriksa status server Fonnte.' },
        500
      );
    }
  }

  // POST /api/fonnte/token (Master Admin only)
  if (method === 'POST' && subpath === '/token') {
    if (role !== 'master_admin') {
      return jsonResponse(
        { error: 'Perubahan Token Fonnte hanya diizinkan untuk akun Master Admin.' },
        403
      );
    }
    const parsed = await parseJsonBody(request);
    if (!parsed.ok) {
      return jsonResponse({ error: 'Format JSON permintaan tidak valid.' }, 400);
    }
    const body = parsed.data;

    try {
      // Mode 1: Switch between pre-configured server environment slots
      if (body.slot === 'primary' || body.slot === 'backup_2' || body.slot === 'backup_3') {
        const val = getEnvSlotValue(body.slot);
        if (!val) {
          return jsonResponse(
            { error: 'Slot token server tersebut belum dikonfigurasi pada Environment Variables Netlify.' },
            400
          );
        }
        runtimeTokenOverride = null;
        activeEnvSlot = body.slot;
        const deviceStatus = await checkFonnteDeviceStatus(getActiveToken(null), { force: true });
        const configured = getActiveToken(null).length > 0;
        return jsonResponse(
          {
            configured,
            primaryConfigured: getEnvSlotValue('primary').length > 0,
            autoConnected: Boolean(configured && deviceStatus.connected),
            serverMode: 'serverless',
            tokenMeta: getTokenMeta(null),
            deviceStatus,
            queue: getQueueSnapshot(null),
            message: deviceStatus.device
              ? `Nomor pengirim berhasil dialihkan ke perangkat ${deviceStatus.device}.`
              : 'Slot Token Fonnte berhasil diganti.',
          },
          200,
          { 'Set-Cookie': buildRuntimeTokenSetCookieHeader(request, null) }
        );
      }

      // Mode 2: Update active Fonnte token (stored in warm memory + AES-256-GCM encrypted HttpOnly cookie for cold-start continuity)
      const validation = validateFonnteTokenInput(body.token);
      if (!validation.valid) {
        return jsonResponse({ error: validation.error || 'Format Token Fonnte tidak valid.' }, 400);
      }

      const label = typeof body.label === 'string' ? body.label.trim().slice(0, 60) : '';
      const deviceStatus = await checkFonnteDeviceStatus(validation.sanitized, { force: true });

      const msgLower = String(deviceStatus.message || '').toLowerCase();
      if (
        !deviceStatus.connected &&
        (msgLower.includes('invalid') ||
          msgLower.includes('token') ||
          msgLower.includes('unauthorized') ||
          msgLower.includes('not found'))
      ) {
        return jsonResponse(
          {
            error: `Token Fonnte ditolak oleh server Fonnte (${deviceStatus.message || 'token tidak valid'}). Token aktif sebelumnya tetap dipertahankan.`,
            deviceStatus,
          },
          400
        );
      }

      const nextOverride: StoredTokenOverride = {
        token: validation.sanitized,
        label: label || 'Nomor WA Kustom (Aktif)',
      };
      runtimeTokenOverride = nextOverride.token;
      runtimeTokenLabel = nextOverride.label;

      return jsonResponse(
        {
          configured: true,
          primaryConfigured: getEnvSlotValue('primary').length > 0,
          autoConnected: Boolean(deviceStatus.connected),
          serverMode: 'serverless',
          tokenMeta: getTokenMeta(nextOverride),
          deviceStatus,
          queue: getQueueSnapshot(nextOverride),
          message: deviceStatus.device
            ? `Token Fonnte diperbarui. Nomor WhatsApp pengirim aktif: ${deviceStatus.device}${deviceStatus.name ? ` (${deviceStatus.name})` : ''}.`
            : 'Token Fonnte berhasil diperbarui pada sesi server aktif.',
        },
        200,
        { 'Set-Cookie': buildRuntimeTokenSetCookieHeader(request, nextOverride) }
      );
    } catch (err) {
      return jsonResponse(
        { error: err instanceof Error ? err.message : 'Gagal memperbarui Token Fonnte.' },
        500
      );
    }
  }

  // DELETE /api/fonnte/token (Master Admin only)
  if (method === 'DELETE' && subpath === '/token') {
    if (role !== 'master_admin') {
      return jsonResponse(
        { error: 'Perubahan Token Fonnte hanya diizinkan untuk akun Master Admin.' },
        403
      );
    }
    try {
      runtimeTokenOverride = null;
      activeEnvSlot = 'primary';
      const token = getActiveToken(null);
      const configured = token.length > 0;
      const deviceStatus = configured
        ? await checkFonnteDeviceStatus(token, { force: true })
        : undefined;
      return jsonResponse(
        {
          configured,
          primaryConfigured: getEnvSlotValue('primary').length > 0,
          autoConnected: Boolean(configured && (!deviceStatus || deviceStatus.connected)),
          serverMode: 'serverless',
          tokenMeta: getTokenMeta(null),
          deviceStatus,
          queue: getQueueSnapshot(null),
          message: configured
            ? 'Berhasil kembali menggunakan Token Utama Server (FONNTE_TOKEN).'
            : 'Token sementara dihapus. Saat ini belum ada FONNTE_TOKEN pada Environment Variables server.',
        },
        200,
        { 'Set-Cookie': buildRuntimeTokenSetCookieHeader(request, null) }
      );
    } catch (err) {
      return jsonResponse(
        { error: err instanceof Error ? err.message : 'Gagal mereset Token Fonnte.' },
        500
      );
    }
  }

  // GET /api/fonnte/queue
  if (method === 'GET' && subpath === '/queue') {
    return jsonResponse({ serverMode: 'serverless', queue: getQueueSnapshot(cookieOverride) });
  }

  // POST /api/fonnte/enqueue
  // On Netlify serverless, background setTimeout cannot survive after response returns.
  // Therefore, each enqueue call dispatches immediately (single-item calls from Scan QR or client-paced staggered batches).
  if (method === 'POST' && subpath === '/enqueue') {
    const parsed = await parseJsonBody(request);
    if (!parsed.ok) {
      return jsonResponse({ error: 'Format JSON permintaan tidak valid.' }, 400);
    }
    const body = parsed.data as {
      items?: unknown;
      pacing?: Partial<FonntePacingPolicy>;
    };

    if (!Array.isArray(body.items) || body.items.length === 0) {
      return jsonResponse({ error: 'Daftar penerima pesan tidak boleh kosong.' }, 400);
    }
    if (body.items.length > 200) {
      return jsonResponse({ error: 'Maksimal 200 penerima per permintaan antrean.' }, 400);
    }

    if (role === 'scan_kiosk') {
      if (body.items.length !== 1) {
        return jsonResponse(
          {
            error:
              'Mode Scan QR hanya dapat mengantrekan 1 notifikasi kehadiran/keterlambatan per pemindaian.',
          },
          403
        );
      }
      const single = body.items[0] as { status?: unknown };
      if (single?.status !== 'Terlambat' && single?.status !== 'Hadir Tepat Waktu') {
        return jsonResponse(
          {
            error:
              'Mode Scan QR hanya mendukung notifikasi otomatis hadir tepat waktu atau terlambat.',
          },
          403
        );
      }
    } else if (!STAFF_ROLES.has(role) && role !== 'auto_scheduler') {
      return jsonResponse({ error: 'Peran Anda tidak memiliki izin mengirim notifikasi Fonnte.' }, 403);
    }

    lastPacing = clampFonntePacing(body.pacing ?? lastPacing);
    const token = getActiveToken(cookieOverride);

    let enqueued = 0;
    let skippedDuplicates = 0;
    let skippedInvalid = 0;

    // Cap synchronous dispatch per serverless invocation to avoid Netlify 10s timeout
    const MAX_SYNC_PER_CALL = 5;
    const rawItems = body.items.slice(0, MAX_SYNC_PER_CALL) as Array<Record<string, unknown>>;

    for (const raw of rawItems) {
      const nis = typeof raw.nis === 'string' ? raw.nis.trim().slice(0, 64) : '';
      const studentName =
        typeof raw.studentName === 'string' ? raw.studentName.trim().slice(0, 160) : '';
      const kelas = typeof raw.kelas === 'string' ? raw.kelas.trim().slice(0, 64) : '';
      const tanggal = typeof raw.tanggal === 'string' ? raw.tanggal.trim().slice(0, 10) : '';
      const message = typeof raw.message === 'string' ? raw.message.trim().slice(0, 2000) : '';
      const status =
        typeof raw.status === 'string' && ALLOWED_STATUSES.has(raw.status as FonnteNotificationCategory)
          ? (raw.status as FonnteNotificationCategory)
          : null;
      const target = normalizeFonnteTarget(typeof raw.target === 'string' ? raw.target : '');

      if (!nis || !studentName || !tanggal || !message || !status || !target) {
        skippedInvalid++;
        continue;
      }

      const dedupeKey = buildFonnteDedupeKey(tanggal, nis, status);
      if (dedupeRegistry.has(dedupeKey)) {
        skippedDuplicates++;
        continue;
      }

      const job: FonnteQueueJob = {
        id: `fq_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        dedupeKey,
        nis,
        studentName,
        kelas: kelas || '-',
        targetMasked: maskFonnteTarget(target),
        status,
        tanggal,
        state: 'sending',
        attempts: 1,
        createdAt: new Date().toISOString(),
      };

      if (!token) {
        job.state = 'failed';
        job.error = 'FONNTE_TOKEN belum dikonfigurasi pada Environment Variables Netlify.';
      } else {
        try {
          const result = await sendSingleFonnteRequest(token, target, message, {
            minDelaySec: Math.min(10, lastPacing.minDelaySec),
            maxDelaySec: Math.min(20, lastPacing.maxDelaySec),
          });
          if (result.ok) {
            job.state = 'sent';
            job.sentAt = new Date().toISOString();
            dedupeRegistry.add(dedupeKey);
          } else {
            job.state = 'failed';
            job.error = result.detail;
          }
        } catch (err) {
          job.state = 'failed';
          job.error = err instanceof Error ? err.message : 'Gagal menghubungi server API Fonnte.';
        }
      }

      recentJobs.push(job);
      enqueued++;
    }

    if (recentJobs.length > 500) {
      recentJobs = recentJobs.slice(-500);
    }

    return jsonResponse({
      enqueued,
      skippedDuplicates,
      skippedInvalid,
      serverMode: 'serverless',
      queue: getQueueSnapshot(cookieOverride),
    });
  }

  // POST /api/fonnte/queue/pause | resume | clear (Staff only)
  if (
    method === 'POST' &&
    (subpath === '/queue/pause' || subpath === '/queue/resume' || subpath === '/queue/clear')
  ) {
    if (!STAFF_ROLES.has(role)) {
      return jsonResponse(
        { error: 'Aksi ini hanya diizinkan untuk Master Admin, Kepala Sekolah, atau Wali Kelas.' },
        403
      );
    }
    if (subpath === '/queue/clear') {
      recentJobs = [];
      dedupeRegistry.clear();
    }
    return jsonResponse({ serverMode: 'serverless', queue: getQueueSnapshot(cookieOverride) });
  }

  // POST /api/fonnte/test (Staff only)
  if (method === 'POST' && subpath === '/test') {
    if (!STAFF_ROLES.has(role)) {
      return jsonResponse(
        { error: 'Aksi ini hanya diizinkan untuk Master Admin, Kepala Sekolah, atau Wali Kelas.' },
        403
      );
    }

    const token = getActiveToken(cookieOverride);
    if (!token) {
      return jsonResponse(
        {
          error:
            'FONNTE_TOKEN belum dikonfigurasi di server (Netlify Environment Variables / Secrets).',
        },
        503
      );
    }

    const parsed = await parseJsonBody(request);
    if (!parsed.ok) {
      return jsonResponse({ error: 'Format JSON permintaan tidak valid.' }, 400);
    }
    const body = parsed.data;
    const target = normalizeFonnteTarget(typeof body.target === 'string' ? body.target : '');
    const message = typeof body.message === 'string' ? body.message.trim().slice(0, 1500) : '';

    if (!target) {
      return jsonResponse(
        {
          error:
            'Nomor WhatsApp tujuan tidak valid. Gunakan format Indonesia (contoh: 081234567890).',
        },
        400
      );
    }
    if (!message) {
      return jsonResponse({ error: 'Isi pesan uji coba tidak boleh kosong.' }, 400);
    }

    try {
      const result = await sendSingleFonnteRequest(token, target, message);
      if (!result.ok) {
        return jsonResponse({ ok: false, error: result.detail }, 502);
      }
      return jsonResponse(result);
    } catch (err) {
      return jsonResponse(
        {
          ok: false,
          error: err instanceof Error ? err.message : 'Gagal menghubungi server API Fonnte.',
        },
        502
      );
    }
  }

  return jsonResponse({ error: 'Endpoint Fonnte tidak ditemukan.' }, 404);
}

export default async function handler(request: Request): Promise<Response> {
  return handleFonnteServerlessRequest(request);
}

// Netlify Functions v2 native route binding (handles /api/fonnte and every /api/fonnte/* subpath)
export const config = {
  path: ['/api/fonnte', '/api/fonnte/*'],
};
