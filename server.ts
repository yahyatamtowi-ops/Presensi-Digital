import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import {
  DEFAULT_FONNTE_PACING,
  buildFonnteDedupeKey,
  clampFonntePacing,
  computeNextStaggeredDelaySec,
  estimateStaggeredDurationSec,
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
} from './src/utils/fonntePacing.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

// Hardcoded official Fonnte API endpoints (never user-supplied -> zero SSRF surface)
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

interface InternalQueueJob extends FonnteQueueJob {
  target: string;
  message: string;
}

class FonnteStaggeredQueueEngine {
  private jobs: InternalQueueJob[] = [];
  private dedupeRegistry = new Set<string>();
  private pacing: FonntePacingPolicy = { ...DEFAULT_FONNTE_PACING };
  private paused = false;
  private autoPausedForMissingToken = false;
  private processing = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextSendAtMs: number | null = null;
  private sentInCurrentBatch = 0;
  private activeEnvSlot: 'primary' | 'backup_2' | 'backup_3' = 'primary';
  private runtimeTokenOverride: string | null = null;
  private runtimeTokenLabel = 'Nomor WA Kustom (Aktif)';

  private getEnvSlotValue(slot: 'primary' | 'backup_2' | 'backup_3'): string {
    if (slot === 'backup_2') return (process.env.FONNTE_TOKEN_2 || '').trim();
    if (slot === 'backup_3') return (process.env.FONNTE_TOKEN_3 || '').trim();
    return (process.env.FONNTE_TOKEN || '').trim();
  }

  getAvailableEnvSlots(): FonnteEnvSlotInfo[] {
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
      const val = this.getEnvSlotValue(d.slot);
      return {
        ...d,
        configured: val.length > 0,
        maskedToken: maskFonnteToken(val),
      };
    });
  }

  getToken(): string {
    if (this.runtimeTokenOverride) return this.runtimeTokenOverride;
    const selected = this.getEnvSlotValue(this.activeEnvSlot);
    if (selected) return selected;
    for (const fallback of ['primary', 'backup_2', 'backup_3'] as const) {
      const val = this.getEnvSlotValue(fallback);
      if (val) return val;
    }
    return '';
  }

  getTokenMeta(): FonnteTokenMeta {
    const availableEnvSlots = this.getAvailableEnvSlots();
    if (this.runtimeTokenOverride) {
      return {
        configured: true,
        activeSlot: 'custom',
        activeLabel: this.runtimeTokenLabel,
        maskedToken: maskFonnteToken(this.runtimeTokenOverride),
        hasRuntimeOverride: true,
        availableEnvSlots,
      };
    }

    const activeEnv =
      availableEnvSlots.find((s) => s.slot === this.activeEnvSlot && s.configured) ||
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

  setRuntimeToken(token: string, label?: string): void {
    this.runtimeTokenOverride = token;
    this.runtimeTokenLabel = (label || '').trim().slice(0, 60) || 'Nomor WA Kustom (Aktif)';
    if (this.paused && this.autoPausedForMissingToken) {
      this.resume();
    }
  }

  selectEnvSlot(slot: 'primary' | 'backup_2' | 'backup_3'): boolean {
    const val = this.getEnvSlotValue(slot);
    if (!val) return false;
    this.runtimeTokenOverride = null;
    this.activeEnvSlot = slot;
    if (this.paused && this.autoPausedForMissingToken) {
      this.resume();
    }
    return true;
  }

  clearRuntimeToken(): void {
    this.runtimeTokenOverride = null;
    this.activeEnvSlot = 'primary';
  }

  isConfigured(): boolean {
    return this.getToken().length > 0;
  }

  getSnapshot(): FonnteQueueSnapshot {
    let pending = 0;
    let sending = 0;
    let sent = 0;
    let failed = 0;
    for (const job of this.jobs) {
      if (job.state === 'pending') pending++;
      else if (job.state === 'sending') sending++;
      else if (job.state === 'sent') sent++;
      else if (job.state === 'failed') failed++;
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
      tokenConfigured: this.isConfigured(),
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
      jobs: this.jobs.slice(-100).map(({ target: _t, message: _m, ...publicJob }) => publicJob),
    };
  }

  enqueue(
    rawItems: Array<{
      nis?: unknown;
      studentName?: unknown;
      kelas?: unknown;
      target?: unknown;
      status?: unknown;
      tanggal?: unknown;
      message?: unknown;
    }>,
    requestedPacing?: Partial<FonntePacingPolicy>
  ): { enqueued: number; skippedDuplicates: number; skippedInvalid: number } {
    this.pacing = clampFonntePacing(requestedPacing ?? this.pacing);

    let enqueued = 0;
    let skippedDuplicates = 0;
    let skippedInvalid = 0;

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
      if (this.dedupeRegistry.has(dedupeKey)) {
        skippedDuplicates++;
        continue;
      }

      this.dedupeRegistry.add(dedupeKey);
      this.jobs.push({
        id: `fq_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        dedupeKey,
        nis,
        studentName,
        kelas: kelas || '-',
        target,
        targetMasked: maskFonnteTarget(target),
        status,
        tanggal,
        message,
        state: 'pending',
        attempts: 0,
        createdAt: new Date().toISOString(),
      });
      enqueued++;
    }

    // Keep memory bounded to last 500 queue records
    if (this.jobs.length > 500) {
      this.jobs = this.jobs.slice(-500);
    }

    if (enqueued > 0) {
      // Auto-resume if previously paused solely because token was missing and token is now configured
      if (this.paused && this.autoPausedForMissingToken && this.isConfigured()) {
        this.paused = false;
        this.autoPausedForMissingToken = false;
      }
      if (!this.paused) {
        this.kickoffWorker();
      }
    }

    return { enqueued, skippedDuplicates, skippedInvalid };
  }

  pause(): void {
    this.paused = true;
    this.autoPausedForMissingToken = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.nextSendAtMs = null;
  }

  resume(): void {
    this.paused = false;
    this.autoPausedForMissingToken = false;
    this.kickoffWorker();
  }

  clear(): void {
    this.pause();
    this.jobs = [];
    this.dedupeRegistry.clear();
    this.sentInCurrentBatch = 0;
    this.paused = false;
    this.autoPausedForMissingToken = false;
  }

  private kickoffWorker(): void {
    if (this.paused || this.processing || this.timer) return;
    const hasPending = this.jobs.some((j) => j.state === 'pending');
    if (!hasPending) {
      this.nextSendAtMs = null;
      return;
    }
    void this.processNextJob().catch((err) => {
      console.error('[FonnteQueue] Unexpected worker error:', err);
      this.processing = false;
    });
  }

  private scheduleNextStep(): void {
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
      void this.processNextJob().catch((err) => {
        console.error('[FonnteQueue] Scheduled worker error:', err);
        this.processing = false;
      });
    }, delaySec * 1000);
  }

  private async processNextJob(): Promise<void> {
    if (this.paused || this.processing) return;
    const job = this.jobs.find((j) => j.state === 'pending');
    if (!job) {
      this.nextSendAtMs = null;
      return;
    }

    const token = this.getToken();
    if (!token) {
      job.state = 'failed';
      job.error =
        'FONNTE_TOKEN belum dikonfigurasi pada Secrets / Environment Server.';
      this.dedupeRegistry.delete(job.dedupeKey);
      this.pause();
      this.autoPausedForMissingToken = true;
      return;
    }

    this.processing = true;
    job.state = 'sending';
    job.attempts += 1;

    try {
      const result = await sendSingleFonnteRequest(token, job.target, job.message, {
        minDelaySec: Math.min(10, this.pacing.minDelaySec),
        maxDelaySec: Math.min(20, this.pacing.maxDelaySec),
      });
      if (result.ok) {
        job.state = 'sent';
        job.sentAt = new Date().toISOString();
        job.error = undefined;
        this.sentInCurrentBatch += 1;
      } else {
        job.state = 'failed';
        job.error = result.detail;
        this.dedupeRegistry.delete(job.dedupeKey);
      }
    } catch (err) {
      job.state = 'failed';
      job.error =
        err instanceof Error ? err.message : 'Gagal menghubungi server API Fonnte.';
      this.dedupeRegistry.delete(job.dedupeKey);
    } finally {
      this.processing = false;
      this.scheduleNextStep();
    }
  }
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
  const timeout = setTimeout(() => controller.abort(), 15000);
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

async function checkFonnteDeviceStatus(token: string): Promise<{
  checked: boolean;
  connected: boolean;
  device?: string;
  name?: string;
  quota?: string | number;
  message?: string;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
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
    return {
      checked: true,
      connected: isConnected,
      device: payload.device,
      name: payload.name,
      quota: payload.quota,
      message: payload.reason || payload.device_status || (isConnected ? 'Terhubung' : 'Terputus'),
    };
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

const fonnteQueue = new FonnteStaggeredQueueEngine();

function requireAppClientHeaders(req: Request, res: Response, next: NextFunction): void {
  const xrw = String(req.headers['x-requested-with'] || '');
  const role = String(req.headers['x-app-role'] || '').trim();
  if (xrw !== 'XMLHttpRequest' || !ALLOWED_ROLES.has(role)) {
    res.status(403).json({ error: 'Akses API ditolak: header aplikasi tidak valid.' });
    return;
  }
  next();
}

function requireStaffRole(req: Request, res: Response, next: NextFunction): void {
  const role = String(req.headers['x-app-role'] || '').trim();
  if (!STAFF_ROLES.has(role)) {
    res.status(403).json({
      error: 'Aksi ini hanya diizinkan untuk Master Admin, Kepala Sekolah, atau Wali Kelas.',
    });
    return;
  }
  next();
}

function requireMasterAdminRole(req: Request, res: Response, next: NextFunction): void {
  const role = String(req.headers['x-app-role'] || '').trim();
  if (role !== 'master_admin') {
    res.status(403).json({
      error: 'Perubahan Token Fonnte hanya diizinkan untuk akun Master Admin.',
    });
    return;
  }
  next();
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '512kb' }));

  // =========================================================================
  // Fonnte WhatsApp Anti-Ban Proxy & Staggered Queue API
  // =========================================================================

  app.get('/api/fonnte/status', requireAppClientHeaders, async (req, res) => {
    try {
      const configured = fonnteQueue.isConfigured();
      const shouldCheckDevice = req.query.checkDevice === '1';
      let deviceStatus = undefined;

      if (configured && shouldCheckDevice) {
        deviceStatus = await checkFonnteDeviceStatus(fonnteQueue.getToken());
      }

      res.json({
        configured,
        serverMode: 'persistent',
        tokenMeta: fonnteQueue.getTokenMeta(),
        deviceStatus,
        queue: fonnteQueue.getSnapshot(),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Gagal memeriksa status server Fonnte.',
      });
    }
  });

  app.post('/api/fonnte/token', requireAppClientHeaders, requireMasterAdminRole, async (req, res) => {
    try {
      const body = req.body as {
        token?: unknown;
        label?: unknown;
        slot?: unknown;
      };

      // Mode 1: Switch between pre-configured server Secrets slots
      if (body?.slot === 'primary' || body?.slot === 'backup_2' || body?.slot === 'backup_3') {
        const switched = fonnteQueue.selectEnvSlot(body.slot);
        if (!switched) {
          res.status(400).json({
            error: 'Slot token server tersebut belum dikonfigurasi pada Secrets / Environment.',
          });
          return;
        }
        const deviceStatus = await checkFonnteDeviceStatus(fonnteQueue.getToken());
        res.json({
          configured: fonnteQueue.isConfigured(),
          serverMode: 'persistent',
          tokenMeta: fonnteQueue.getTokenMeta(),
          deviceStatus,
          queue: fonnteQueue.getSnapshot(),
          message: deviceStatus.device
            ? `Nomor pengirim berhasil dialihkan ke perangkat ${deviceStatus.device}.`
            : 'Slot Token Fonnte berhasil diganti.',
        });
        return;
      }

      // Mode 2: Update active Fonnte token in server memory (never written to disk or browser)
      const validation = validateFonnteTokenInput(body?.token);
      if (!validation.valid) {
        res.status(400).json({ error: validation.error || 'Format Token Fonnte tidak valid.' });
        return;
      }

      const label = typeof body?.label === 'string' ? body.label.trim().slice(0, 60) : '';
      const deviceStatus = await checkFonnteDeviceStatus(validation.sanitized);

      // Reject explicitly invalid tokens from Fonnte so working token is preserved
      const msgLower = String(deviceStatus.message || '').toLowerCase();
      if (
        !deviceStatus.connected &&
        (msgLower.includes('invalid') ||
          msgLower.includes('token') ||
          msgLower.includes('unauthorized') ||
          msgLower.includes('not found'))
      ) {
        res.status(400).json({
          error: `Token Fonnte ditolak oleh server Fonnte (${deviceStatus.message || 'token tidak valid'}). Token aktif sebelumnya tetap dipertahankan.`,
          deviceStatus,
        });
        return;
      }

      fonnteQueue.setRuntimeToken(validation.sanitized, label);

      res.json({
        configured: true,
        serverMode: 'persistent',
        tokenMeta: fonnteQueue.getTokenMeta(),
        deviceStatus,
        queue: fonnteQueue.getSnapshot(),
        message: deviceStatus.device
          ? `Token Fonnte diperbarui. Nomor WhatsApp pengirim aktif: ${deviceStatus.device}${deviceStatus.name ? ` (${deviceStatus.name})` : ''}.`
          : 'Token Fonnte berhasil diperbarui di server.',
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Gagal memperbarui Token Fonnte.',
      });
    }
  });

  app.delete('/api/fonnte/token', requireAppClientHeaders, requireMasterAdminRole, async (_req, res) => {
    try {
      fonnteQueue.clearRuntimeToken();
      const configured = fonnteQueue.isConfigured();
      const deviceStatus = configured
        ? await checkFonnteDeviceStatus(fonnteQueue.getToken())
        : undefined;
      res.json({
        configured,
        serverMode: 'persistent',
        tokenMeta: fonnteQueue.getTokenMeta(),
        deviceStatus,
        queue: fonnteQueue.getSnapshot(),
        message: configured
          ? 'Berhasil kembali menggunakan Token Utama Server (FONNTE_TOKEN).'
          : 'Token sementara dihapus. Saat ini belum ada FONNTE_TOKEN di Secrets server.',
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Gagal mereset Token Fonnte.',
      });
    }
  });

  app.get('/api/fonnte/queue', requireAppClientHeaders, (_req, res) => {
    res.json({ queue: fonnteQueue.getSnapshot() });
  });

  app.post('/api/fonnte/enqueue', requireAppClientHeaders, (req, res) => {
    const role = String(req.headers['x-app-role'] || '').trim();
    const body = req.body as {
      items?: unknown;
      pacing?: Partial<FonntePacingPolicy>;
    };

    if (!Array.isArray(body?.items) || body.items.length === 0) {
      res.status(400).json({ error: 'Daftar penerima pesan tidak boleh kosong.' });
      return;
    }

    if (body.items.length > 200) {
      res.status(400).json({ error: 'Maksimal 200 penerima per permintaan antrean.' });
      return;
    }

    // Kiosk mode (pre-login Scan QR) may ONLY enqueue 1 single 'Hadir Tepat Waktu' or 'Terlambat' notification per scan
    if (role === 'scan_kiosk') {
      if (body.items.length !== 1) {
        res.status(403).json({
          error: 'Mode Scan QR hanya dapat mengantrekan 1 notifikasi kehadiran/keterlambatan per pemindaian.',
        });
        return;
      }
      const single = body.items[0] as { status?: unknown };
      if (single?.status !== 'Terlambat' && single?.status !== 'Hadir Tepat Waktu') {
        res.status(403).json({
          error: 'Mode Scan QR hanya mendukung notifikasi otomatis hadir tepat waktu atau terlambat.',
        });
        return;
      }
    } else if (!STAFF_ROLES.has(role) && role !== 'auto_scheduler') {
      res.status(403).json({ error: 'Peran Anda tidak memiliki izin mengirim notifikasi Fonnte.' });
      return;
    }

    const result = fonnteQueue.enqueue(
      body.items as Array<Record<string, unknown>>,
      body.pacing
    );

    res.json({
      ...result,
      serverMode: 'persistent',
      queue: fonnteQueue.getSnapshot(),
    });
  });

  app.post('/api/fonnte/queue/pause', requireAppClientHeaders, requireStaffRole, (_req, res) => {
    fonnteQueue.pause();
    res.json({ queue: fonnteQueue.getSnapshot() });
  });

  app.post('/api/fonnte/queue/resume', requireAppClientHeaders, requireStaffRole, (_req, res) => {
    fonnteQueue.resume();
    res.json({ queue: fonnteQueue.getSnapshot() });
  });

  app.post('/api/fonnte/queue/clear', requireAppClientHeaders, requireStaffRole, (_req, res) => {
    fonnteQueue.clear();
    res.json({ queue: fonnteQueue.getSnapshot() });
  });

  app.post('/api/fonnte/test', requireAppClientHeaders, requireStaffRole, async (req, res) => {
    const token = fonnteQueue.getToken();
    if (!token) {
      res.status(503).json({
        error:
          'FONNTE_TOKEN belum dikonfigurasi di server (Secrets / Environment Variables).',
      });
      return;
    }

    const body = req.body as { target?: unknown; message?: unknown };
    const target = normalizeFonnteTarget(typeof body?.target === 'string' ? body.target : '');
    const message = typeof body?.message === 'string' ? body.message.trim().slice(0, 1500) : '';

    if (!target) {
      res.status(400).json({
        error: 'Nomor WhatsApp tujuan tidak valid. Gunakan format Indonesia (contoh: 081234567890).',
      });
      return;
    }
    if (!message) {
      res.status(400).json({ error: 'Isi pesan uji coba tidak boleh kosong.' });
      return;
    }

    try {
      const result = await sendSingleFonnteRequest(token, target, message);
      if (!result.ok) {
        res.status(502).json({ ok: false, error: result.detail });
        return;
      }
      res.json(result);
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Gagal menghubungi server API Fonnte.',
      });
    }
  });

  // =========================================================================
  // Frontend Serving (Vite Middleware in Dev, Static dist/ in Production)
  // =========================================================================

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    const indexHtml = path.resolve(distDir, 'index.html');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build belum tersedia. Jalankan npm run build terlebih dahulu.');
      }
    });
  }

  // Express JSON / route error handler so malformed JSON or unexpected throws never crash or leak stack traces
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const isJsonSyntaxError =
      err instanceof SyntaxError && 'status' in err && Number((err as { status?: number }).status) === 400;
    if (req.path.startsWith('/api/')) {
      res.status(isJsonSyntaxError ? 400 : 500).json({
        error: isJsonSyntaxError
          ? 'Format JSON permintaan tidak valid.'
          : 'Terjadi kesalahan internal pada server API.',
      });
      return;
    }
    res.status(500).send('Terjadi kesalahan pada server.');
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT} (${IS_PROD ? 'prod' : 'dev'})`);
  });
}

process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled promise rejection prevented crash:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception intercepted:', err);
});

void startServer().catch((err) => {
  console.error('[Server] Fatal startup error:', err);
  process.exitCode = 1;
});
