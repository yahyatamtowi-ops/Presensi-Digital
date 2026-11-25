import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  Info,
  KeyRound,
  MessageSquare,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type { AttendanceRecord, SchoolSettings, Student } from '../types';
import {
  DEFAULT_ABSENT_TEMPLATE,
  DEFAULT_LATE_TEMPLATE,
  DEFAULT_ON_TIME_TEMPLATE,
  FONNTE_PACING_BOUNDS,
  buildPendingFonnteRecipients,
  clampFonntePacing,
  estimateStaggeredDurationSec,
  evaluateScheduledFonnteRun,
  formatDurationId,
  renderFonnteMessage,
  validateFonnteTokenInput,
  type FonnteConfig,
  type FonnteNotificationCategory,
  type FonntePacingPolicy,
  type FonnteQueueJobInput,
  type FonnteQueueSnapshot,
  type FonnteStatusResponse,
} from '../utils/fonntePacing';
import {
  controlFonnteQueue,
  enqueueFonnteNotifications,
  fetchFonnteQueue,
  fetchFonnteStatus,
  resetFonnteTokenToDefault,
  sendFonnteTestMessage,
  switchFonnteTokenSlot,
  updateFonnteToken,
  type FonnteClientRole,
} from '../utils/fonnteClient';

interface FonnteSettingsPanelProps {
  config: FonnteConfig;
  settings: SchoolSettings;
  students: Student[];
  todayRecords: AttendanceRecord[];
  todayDate: string;
  sentDedupeKeys: ReadonlySet<string>;
  lastScheduleRunKey: string;
  queueSyncNonce: number;
  clientRole: FonnteClientRole;
  onChangeConfig: (next: FonnteConfig) => void;
  onMarkSentKeys: (keys: string[]) => void;
  onClearSentKeys: () => void;
  onResetScheduleToday: () => void;
  onNotifyToast: (toast: {
    type: 'success' | 'warning' | 'error' | 'info';
    title: string;
    description?: string;
  }) => void;
}

const PACING_PRESETS: Array<{
  id: string;
  label: string;
  desc: string;
  pacing: FonntePacingPolicy;
}> = [
  {
    id: 'ultra_safe',
    label: 'Sangat Aman (Nomor Baru)',
    desc: 'Jeda 30–60 dtk · 5 pesan/batch · Istirahat 5 menit',
    pacing: { minDelaySec: 30, maxDelaySec: 60, batchSize: 5, batchPauseSec: 300 },
  },
  {
    id: 'recommended',
    label: 'Standar Direkomendasikan',
    desc: 'Jeda 20–45 dtk · 10 pesan/batch · Istirahat 3 menit',
    pacing: { minDelaySec: 20, maxDelaySec: 45, batchSize: 10, batchPauseSec: 180 },
  },
  {
    id: 'controlled_fast',
    label: 'Cepat Terkendali (Nomor Lama)',
    desc: 'Jeda 15–30 dtk · 15 pesan/batch · Istirahat 2 menit',
    pacing: { minDelaySec: 15, maxDelaySec: 30, batchSize: 15, batchPauseSec: 120 },
  },
];

export function FonnteSettingsPanel({
  config,
  settings,
  students,
  todayRecords,
  todayDate,
  sentDedupeKeys,
  lastScheduleRunKey,
  queueSyncNonce,
  clientRole,
  onChangeConfig,
  onMarkSentKeys,
  onClearSentKeys,
  onResetScheduleToday,
  onNotifyToast,
}: FonnteSettingsPanelProps) {
  const [statusData, setStatusData] = useState<FonnteStatusResponse | null>(null);
  const [queueSnapshot, setQueueSnapshot] = useState<FonnteQueueSnapshot | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [enqueuingBatch, setEnqueuingBatch] = useState(false);
  const [controllingQueue, setControllingQueue] = useState(false);
  const [showSetupInfo, setShowSetupInfo] = useState(false);
  const [showTokenInfo, setShowTokenInfo] = useState(false);
  const [showAntiBanInfo, setShowAntiBanInfo] = useState(false);

  // Token switcher / runtime update state (never persisted in browser storage)
  const [tokenInput, setTokenInput] = useState('');
  const [tokenLabelInput, setTokenLabelInput] = useState('');
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [savingToken, setSavingToken] = useState(false);
  const [switchingSlot, setSwitchingSlot] = useState<'primary' | 'backup_2' | 'backup_3' | null>(null);
  const [resettingToken, setResettingToken] = useState(false);

  // Batch selection filters
  const [includeOnTimeBatch, setIncludeOnTimeBatch] = useState(config.autoSendOnTime);
  const [includeLateBatch, setIncludeLateBatch] = useState(true);
  const [includeAbsentBatch, setIncludeAbsentBatch] = useState(true);
  const [includeUnrecordedBatch, setIncludeUnrecordedBatch] = useState(
    config.includeUnrecordedAsAbsent
  );
  const [previewTab, setPreviewTab] = useState<'ontime' | 'late' | 'absent'>('ontime');

  // Test message state
  const [testTarget, setTestTarget] = useState(settings.no_wa_admin || '');
  const [testMessage, setTestMessage] = useState(
    `Uji koneksi notifikasi WhatsApp Fonnte dari ${settings.nama_sekolah || 'Presensi Digital'}. Sistem pengiriman bertahap anti-blokir siap digunakan.`
  );
  const [sendingTest, setSendingTest] = useState(false);
  const [countdownTick, setCountdownTick] = useState(0);

  const loadStatus = useCallback(
    async (checkDevice = false) => {
      setCheckingStatus(true);
      try {
        const res = await fetchFonnteStatus(clientRole, checkDevice);
        setStatusData(res);
        setQueueSnapshot(res.queue);
        if (checkDevice && res.deviceStatus) {
          onNotifyToast({
            type: res.deviceStatus.connected ? 'success' : 'warning',
            title: res.deviceStatus.connected
              ? 'Perangkat Fonnte Terhubung'
              : 'Perangkat Fonnte Belum Aktif',
            description:
              res.deviceStatus.device
                ? `Perangkat ${res.deviceStatus.device}${res.deviceStatus.quota !== undefined ? ` · Kuota: ${res.deviceStatus.quota}` : ''}`
                : res.deviceStatus.message || 'Periksa koneksi WhatsApp di dashboard Fonnte.',
          });
        }
      } catch (err) {
        if (checkDevice) {
          onNotifyToast({
            type: 'error',
            title: 'Gagal Memeriksa Status Fonnte',
            description: err instanceof Error ? err.message : 'Coba beberapa saat lagi.',
          });
        }
      } finally {
        setCheckingStatus(false);
      }
    },
    [clientRole, onNotifyToast]
  );

  useEffect(() => {
    void loadStatus(false);
  }, [loadStatus, queueSyncNonce]);

  // Poll queue progress every 4 seconds while queue is active or paused with pending items
  useEffect(() => {
    const shouldPoll = Boolean(
      queueSnapshot &&
        (queueSnapshot.running || queueSnapshot.counts.pending > 0 || queueSnapshot.counts.sending > 0)
    );
    if (!shouldPoll) return;

    const timer = window.setInterval(() => {
      void fetchFonnteQueue(clientRole)
        .then((next) => {
          setQueueSnapshot(next);
          const sentKeys = next.jobs
            .filter((j) => j.state === 'sent')
            .map((j) => j.dedupeKey);
          if (sentKeys.length > 0) {
            onMarkSentKeys(sentKeys);
          }
        })
        .catch(() => {
          // Ignore transient polling failures
        });
    }, 4000);

    return () => window.clearInterval(timer);
  }, [clientRole, queueSnapshot, onMarkSentKeys]);

  // Update 1-second local clock & countdown display when queue or daily schedule is active
  useEffect(() => {
    if (!queueSnapshot?.nextSendAt && !config.autoAbsentScheduleEnabled) return;
    const interval = window.setInterval(() => {
      setCountdownTick((v) => v + 1);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [queueSnapshot?.nextSendAt, config.autoAbsentScheduleEnabled]);

  const scheduleEvaluation = useMemo(() => {
    void countdownTick;
    return evaluateScheduledFonnteRun({
      now: new Date(),
      config,
      lastRunKey: lastScheduleRunKey,
    });
  }, [config, lastScheduleRunKey, countdownTick]);

  const combinedSentKeys = useMemo(() => {
    const set = new Set<string>(sentDedupeKeys);
    if (queueSnapshot) {
      for (const job of queueSnapshot.jobs) {
        if (job.state === 'sent' || job.state === 'pending' || job.state === 'sending') {
          set.add(job.dedupeKey);
        }
      }
    }
    return set;
  }, [sentDedupeKeys, queueSnapshot]);

  const todayCandidates = useMemo(
    () =>
      buildPendingFonnteRecipients({
        students,
        todayRecords,
        tanggal: todayDate,
        sekolah: settings.nama_sekolah,
        batasJamMasuk: settings.batas_jam_masuk,
        config,
        sentDedupeKeys: combinedSentKeys,
        includeOnTime: includeOnTimeBatch,
        includeLate: includeLateBatch,
        includeAbsent: includeAbsentBatch,
        includeUnrecorded: includeUnrecordedBatch,
      }),
    [
      students,
      todayRecords,
      todayDate,
      settings.nama_sekolah,
      settings.batas_jam_masuk,
      config,
      combinedSentKeys,
      includeOnTimeBatch,
      includeLateBatch,
      includeAbsentBatch,
      includeUnrecordedBatch,
    ]
  );

  const readyToSendCandidates = useMemo(
    () => todayCandidates.filter((c) => c.hasValidPhone && !c.alreadyNotified),
    [todayCandidates]
  );

  const estimatedBatchSec = useMemo(
    () => estimateStaggeredDurationSec(readyToSendCandidates.length, config.pacing),
    [readyToSendCandidates.length, config.pacing]
  );

  const nextSendCountdownSec = useMemo(() => {
    void countdownTick;
    if (!queueSnapshot?.nextSendAt) return 0;
    const diff = Math.ceil((new Date(queueSnapshot.nextSendAt).getTime() - Date.now()) / 1000);
    return Math.max(0, diff);
  }, [queueSnapshot?.nextSendAt, countdownTick]);

  const samplePreviewMessage = useMemo(() => {
    const statusMap: Record<'ontime' | 'late' | 'absent', FonnteNotificationCategory> = {
      ontime: 'Hadir Tepat Waktu',
      late: 'Terlambat',
      absent: 'Alpa',
    };
    const templateMap: Record<'ontime' | 'late' | 'absent', string> = {
      ontime: config.onTimeTemplate,
      late: config.lateTemplate,
      absent: config.absentTemplate,
    };
    const jamMap: Record<'ontime' | 'late' | 'absent', string> = {
      ontime: '07:02:18',
      late: '07:28:15',
      absent: '-',
    };
    return renderFonnteMessage(
      templateMap[previewTab],
      {
        nama: 'Ahmad Fauzi',
        nisn: '0081234567',
        kelas: 'X-IPA-1',
        tanggal: todayDate,
        jam_masuk: jamMap[previewTab],
        batas_jam: settings.batas_jam_masuk,
        status: statusMap[previewTab],
        sekolah: settings.nama_sekolah,
      },
      0
    );
  }, [
    previewTab,
    config.onTimeTemplate,
    config.lateTemplate,
    config.absentTemplate,
    todayDate,
    settings.batas_jam_masuk,
    settings.nama_sekolah,
  ]);

  const handleUpdatePacing = (patch: Partial<FonntePacingPolicy>) => {
    onChangeConfig({
      ...config,
      pacing: clampFonntePacing({ ...config.pacing, ...patch }),
    });
  };

  const handleEnqueueTodayBatch = async () => {
    if (readyToSendCandidates.length === 0) {
      onNotifyToast({
        type: 'info',
        title: 'Tidak Ada Pesan Baru untuk Dikirim',
        description:
          'Semua siswa terlambat/tidak hadir yang memiliki nomor WhatsApp orang tua sudah masuk antrean atau sudah terkirim hari ini.',
      });
      return;
    }

    setEnqueuingBatch(true);
    try {
      const items: FonnteQueueJobInput[] = readyToSendCandidates.map((c) => ({
        nis: c.nis,
        studentName: c.nama,
        kelas: c.kelas,
        target: c.normalizedTarget,
        status: c.status,
        tanggal: todayDate,
        message: c.message,
      }));
      const res = await enqueueFonnteNotifications({
        role: clientRole,
        items,
        pacing: config.pacing,
      });
      setQueueSnapshot(res.queue);
      onMarkSentKeys(readyToSendCandidates.map((c) => c.dedupeKey));
      onNotifyToast({
        type: 'success',
        title: `${res.enqueued} Pesan Masuk Antrean Bertahap`,
        description: `Pengiriman berjalan otomatis 1 per 1 dengan jeda acak ${config.pacing.minDelaySec}–${config.pacing.maxDelaySec} detik agar aman dari blokir WhatsApp.`,
      });
    } catch (err) {
      onNotifyToast({
        type: 'error',
        title: 'Gagal Memulai Antrean Fonnte',
        description: err instanceof Error ? err.message : 'Coba lagi beberapa saat.',
      });
    } finally {
      setEnqueuingBatch(false);
    }
  };

  const handleQueueControl = async (action: 'pause' | 'resume' | 'clear') => {
    setControllingQueue(true);
    try {
      const next = await controlFonnteQueue(clientRole, action);
      setQueueSnapshot(next);
      if (action === 'clear') {
        onClearSentKeys();
      }
      onNotifyToast({
        type: 'info',
        title:
          action === 'pause'
            ? 'Antrean Dijeda'
            : action === 'resume'
              ? 'Antrean Dilanjutkan'
              : 'Antrean & Status Kirim Hari Ini Dibersihkan',
      });
    } catch (err) {
      onNotifyToast({
        type: 'error',
        title: 'Gagal Mengatur Antrean',
        description: err instanceof Error ? err.message : 'Coba lagi.',
      });
    } finally {
      setControllingQueue(false);
    }
  };

  const handleSendTest = async () => {
    setSendingTest(true);
    try {
      const res = await sendFonnteTestMessage({
        role: clientRole,
        target: testTarget,
        message: testMessage,
      });
      onNotifyToast({
        type: 'success',
        title: 'Pesan Uji Coba Terkirim',
        description: res.detail,
      });
    } catch (err) {
      onNotifyToast({
        type: 'error',
        title: 'Uji Kirim Fonnte Gagal',
        description: err instanceof Error ? err.message : 'Periksa nomor tujuan & token server.',
      });
    } finally {
      setSendingTest(false);
    }
  };

  const handleSaveNewToken = async () => {
    const validation = validateFonnteTokenInput(tokenInput);
    if (!validation.valid) {
      onNotifyToast({
        type: 'warning',
        title: 'Format Token Fonnte Tidak Valid',
        description: validation.error || 'Periksa kembali Token Perangkat dari dashboard Fonnte.',
      });
      return;
    }

    setSavingToken(true);
    try {
      const res = await updateFonnteToken({
        role: clientRole,
        token: validation.sanitized,
        label: tokenLabelInput.trim() || undefined,
      });
      setStatusData(res);
      setQueueSnapshot(res.queue);
      // Immediately wipe token from component state after submission
      setTokenInput('');
      setTokenLabelInput('');
      setShowTokenInput(false);
      const deviceInfo = res.deviceStatus?.device
        ? ` Nomor WhatsApp aktif: ${res.deviceStatus.device}.`
        : '';
      onNotifyToast({
        type: 'success',
        title: 'Token Fonnte Berhasil Diperbarui',
        description: `${res.message || 'Nomor WhatsApp pengirim telah diganti.'}${deviceInfo}`,
      });
    } catch (err) {
      onNotifyToast({
        type: 'error',
        title: 'Gagal Mengubah Token Fonnte',
        description:
          err instanceof Error
            ? err.message
            : 'Pastikan Token Perangkat aktif di md.fonnte.com dan coba lagi.',
      });
    } finally {
      setSavingToken(false);
    }
  };

  const handleSwitchTokenSlot = async (slot: 'primary' | 'backup_2' | 'backup_3') => {
    setSwitchingSlot(slot);
    try {
      const res = await switchFonnteTokenSlot({ role: clientRole, slot });
      setStatusData(res);
      setQueueSnapshot(res.queue);
      onNotifyToast({
        type: 'success',
        title: 'Slot Token Server Diganti',
        description:
          res.deviceStatus?.device
            ? `Nomor WhatsApp aktif: ${res.deviceStatus.device}`
            : res.message || 'Slot token aktif berhasil diubah.',
      });
    } catch (err) {
      onNotifyToast({
        type: 'error',
        title: 'Gagal Mengganti Slot Token',
        description: err instanceof Error ? err.message : 'Periksa konfigurasi secret server.',
      });
    } finally {
      setSwitchingSlot(null);
    }
  };

  const handleResetTokenToDefault = async () => {
    setResettingToken(true);
    try {
      const res = await resetFonnteTokenToDefault(clientRole);
      setStatusData(res);
      setQueueSnapshot(res.queue);
      setTokenInput('');
      setTokenLabelInput('');
      onNotifyToast({
        type: 'info',
        title: 'Token Dikembalikan ke Bawaan Server',
        description:
          res.deviceStatus?.device
            ? `Nomor WhatsApp aktif: ${res.deviceStatus.device}`
            : res.message || 'Menggunakan token utama FONNTE_TOKEN dari server.',
      });
    } catch (err) {
      onNotifyToast({
        type: 'error',
        title: 'Gagal Mengembalikan Token Bawaan',
        description: err instanceof Error ? err.message : 'Coba lagi beberapa saat.',
      });
    } finally {
      setResettingToken(false);
    }
  };

  const tokenConfigured = Boolean(statusData?.configured);
  const tokenMeta = statusData?.tokenMeta;
  const configuredEnvSlots = useMemo(
    () => (tokenMeta?.availableEnvSlots || []).filter((s) => s.configured),
    [tokenMeta]
  );
  const isMasterAdmin = clientRole === 'master_admin';

  return (
    <div className="space-y-4 sm:space-y-5" data-testid="fonnte-settings-panel">
      {/* 1. Status Server Fonnte & Pengaktifan */}
      <section className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-3.5">
        <div className="space-y-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <div className="h-9 w-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                <MessageSquare className="h-4 w-4" aria-hidden="true" />
              </div>
              <h2 className="text-sm sm:text-base font-semibold text-slate-900 leading-snug min-w-0 flex-1">
                <span>Integrasi WhatsApp Fonnte (Notifikasi Orang Tua)</span>
                <button
                  type="button"
                  data-testid="btn-info-fonnte-setup"
                  aria-label="Informasi konfigurasi token server Fonnte"
                  aria-expanded={showSetupInfo}
                  title="Klik untuk melihat panduan pengaturan FONNTE_TOKEN di server"
                  onClick={() => setShowSetupInfo((v) => !v)}
                  className={`h-6 w-6 rounded-full inline-flex items-center justify-center align-middle ml-1.5 transition-colors ${
                    showSetupInfo
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600'
                  }`}
                >
                  <Info className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </h2>
            </div>

            <span
              data-testid="fonnte-token-status-badge"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border whitespace-nowrap shrink-0 self-start sm:self-auto ${
                tokenConfigured
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-amber-50 text-amber-800 border-amber-200'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  tokenConfigured ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
                aria-hidden="true"
              />
              {tokenConfigured ? 'Token Server Aktif' : 'Menunggu Secret Server'}
            </span>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">
            Kirim pesan WhatsApp otomatis kepada orang tua siswa yang hadir tepat waktu, terlambat, maupun tidak hadir secara bertahap dengan perlindungan anti-blokir.
          </p>
        </div>

        {showSetupInfo && (
          <div
            data-testid="info-panel-fonnte-setup"
            className="rounded-xl bg-indigo-50/70 border border-indigo-200/80 p-3.5 text-xs text-indigo-950 space-y-2"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold text-indigo-900">
                Cara Menghubungkan Token Fonnte Secara Aman (Sisi Server)
              </p>
              <button
                type="button"
                aria-label="Tutup panduan Fonnte"
                onClick={() => setShowSetupInfo(false)}
                className="text-indigo-500 hover:text-indigo-700 p-0.5 rounded shrink-0"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
            <p className="text-indigo-900/90 leading-relaxed">
              Demi keamanan, token API Fonnte <strong>tidak disimpan di browser</strong>. Simpan token perangkat Anda dari dashboard{' '}
              <span className="font-mono font-semibold">md.fonnte.com</span> sebagai Environment Variable server dengan nama{' '}
              <code className="px-1.5 py-0.5 rounded bg-white border border-indigo-200 font-mono font-bold text-indigo-900">
                FONNTE_TOKEN
              </code>{' '}
              (pada <strong>Settings → Secrets</strong> atau pada <strong>Netlify → Site configuration → Environment variables</strong> lalu redeploy). Semua pengiriman dijalankan melalui proxy backend/Netlify Function agar token tetap rahasia.
            </p>
          </div>
        )}

        <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <label className="flex items-center gap-2.5 cursor-pointer min-w-0">
            <input
              type="checkbox"
              data-testid="toggle-fonnte-enabled"
              checked={config.enabled}
              onChange={(e) => onChangeConfig({ ...config, enabled: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 shrink-0"
            />
            <span className="text-xs sm:text-sm font-semibold text-slate-900 leading-snug">
              Aktifkan Pengiriman Otomatis WhatsApp Fonnte
            </span>
          </label>

          <button
            type="button"
            disabled={checkingStatus}
            onClick={() => void loadStatus(true)}
            data-testid="btn-check-fonnte-device"
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors shrink-0 whitespace-nowrap"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${checkingStatus ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>{checkingStatus ? 'Memeriksa...' : 'Cek Perangkat Fonnte'}</span>
          </button>
        </div>

        {/* Bilah Ubah Token Fonnte & Ganti Nomor WhatsApp Pengirim */}
        <div
          data-testid="fonnte-token-manager"
          className="rounded-xl border border-slate-200/90 bg-slate-50/70 p-3.5 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-8 w-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                <KeyRound className="h-4 w-4" aria-hidden="true" />
              </div>
              <h3 className="text-xs font-semibold text-slate-900 leading-snug min-w-0">
                <span>Token Fonnte &amp; Nomor WhatsApp Pengirim</span>
                <button
                  type="button"
                  data-testid="btn-info-fonnte-token"
                  aria-label="Informasi pergantian Token Fonnte"
                  aria-expanded={showTokenInfo}
                  title="Klik untuk melihat penjelasan cara mengganti nomor WhatsApp pengirim"
                  onClick={() => setShowTokenInfo((v) => !v)}
                  className={`h-5 w-5 rounded-full inline-flex items-center justify-center align-middle ml-1.5 transition-colors ${
                    showTokenInfo
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white border border-slate-200 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600'
                  }`}
                >
                  <Info className="h-3 w-3" aria-hidden="true" />
                </button>
              </h3>
            </div>

            {tokenMeta?.configured && (
              <div
                data-testid="fonnte-active-token-summary"
                className="flex flex-wrap items-center gap-1.5 text-[11px]"
              >
                <span className="px-2 py-0.5 rounded-lg bg-white border border-slate-200 text-slate-700 font-medium">
                  Sumber: <strong className="text-slate-900">{tokenMeta.activeLabel}</strong>
                </span>
                <span className="px-2 py-0.5 rounded-lg bg-white border border-slate-200 font-mono text-slate-700">
                  {tokenMeta.maskedToken}
                </span>
                {statusData?.deviceStatus?.device && (
                  <span className="px-2 py-0.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-mono font-semibold">
                    WA: {statusData.deviceStatus.device}
                  </span>
                )}
              </div>
            )}
          </div>

          {showTokenInfo && (
            <div
              data-testid="info-panel-fonnte-token"
              className="rounded-lg bg-indigo-50/80 border border-indigo-200 p-3 text-[11px] text-indigo-950 space-y-1.5"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-indigo-900">
                  Cara Mengganti Nomor WhatsApp Pengirim dengan Aman
                </p>
                <button
                  type="button"
                  aria-label="Tutup informasi token Fonnte"
                  onClick={() => setShowTokenInfo(false)}
                  className="text-indigo-500 hover:text-indigo-700 p-0.5 rounded shrink-0"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
              <ul className="list-disc pl-4 space-y-1 text-indigo-900/90 leading-relaxed">
                <li>
                  Buka dashboard <span className="font-mono font-semibold">md.fonnte.com</span> → pilih perangkat WhatsApp nomor baru yang sudah terhubung (scan QR) → salin <strong>Token Perangkat</strong>.
                </li>
                <li>
                  Tempel token di bilah ini lalu klik <strong>Simpan &amp; Ganti Nomor WA</strong>. Sistem akan memverifikasi token langsung ke server Fonnte sebelum mengaktifkannya. Jika token tidak valid, nomor aktif sebelumnya tetap dipertahankan.
                </li>
                <li>
                  Token tidak disimpan di browser. Untuk penyimpanan permanen saat server dimulai ulang atau pada hosting Netlify, simpan juga pada Environment Variable <code className="font-mono font-semibold">FONNTE_TOKEN</code> (atau slot cadangan <code className="font-mono font-semibold">FONNTE_TOKEN_2</code> / <code className="font-mono font-semibold">FONNTE_TOKEN_3</code>).
                </li>
              </ul>
            </div>
          )}

          {/* Pemilih Cepat Slot Secret Server (jika tersedia > 1 slot terkonfigurasi) */}
          {isMasterAdmin && configuredEnvSlots.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <span className="text-[11px] font-semibold text-slate-600">
                Slot Secret Server:
              </span>
              {configuredEnvSlots.map((slotInfo) => {
                const isSelected =
                  !tokenMeta?.hasRuntimeOverride && tokenMeta?.activeSlot === slotInfo.slot;
                return (
                  <button
                    key={slotInfo.slot}
                    type="button"
                    disabled={switchingSlot !== null || savingToken || resettingToken}
                    data-testid={`btn-fonnte-slot-${slotInfo.slot}`}
                    onClick={() => void handleSwitchTokenSlot(slotInfo.slot)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                      isSelected
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-slate-700 border-slate-200 hover:border-indigo-300 hover:bg-indigo-50'
                    }`}
                  >
                    {switchingSlot === slotInfo.slot
                      ? 'Mengganti...'
                      : `${slotInfo.label} (${slotInfo.maskedToken})`}
                  </button>
                );
              })}
            </div>
          )}

          {/* Bilah Input Ubah Token (Khusus Master Admin) */}
          {isMasterAdmin ? (
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
              <div className="sm:col-span-5 relative">
                <label htmlFor="fonnte-new-token-input" className="sr-only">
                  Token Perangkat Fonnte Baru
                </label>
                <input
                  id="fonnte-new-token-input"
                  data-testid="input-fonnte-new-token"
                  type={showTokenInput ? 'text' : 'password'}
                  autoComplete="off"
                  spellCheck={false}
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="Tempel Token Perangkat Fonnte baru..."
                  className="w-full pl-3 pr-9 py-2 rounded-xl border border-slate-300 bg-white text-xs font-mono text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
                <button
                  type="button"
                  data-testid="btn-toggle-fonnte-token-visibility"
                  aria-label={showTokenInput ? 'Sembunyikan token' : 'Tampilkan token'}
                  onClick={() => setShowTokenInput((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-0.5"
                >
                  {showTokenInput ? (
                    <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </button>
              </div>

              <div className="sm:col-span-3">
                <label htmlFor="fonnte-token-label-input" className="sr-only">
                  Label Nomor WhatsApp (Opsional)
                </label>
                <input
                  id="fonnte-token-label-input"
                  data-testid="input-fonnte-token-label"
                  type="text"
                  maxLength={48}
                  value={tokenLabelInput}
                  onChange={(e) => setTokenLabelInput(e.target.value)}
                  placeholder="Label (opsional, mis. WA TU)"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>

              <div className="sm:col-span-4 flex flex-wrap sm:flex-nowrap items-center gap-2">
                <button
                  type="button"
                  disabled={savingToken || !tokenInput.trim()}
                  data-testid="btn-save-fonnte-token"
                  onClick={() => void handleSaveNewToken()}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  <KeyRound className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{savingToken ? 'Memverifikasi...' : 'Simpan & Ganti Nomor WA'}</span>
                </button>

                {tokenMeta?.hasRuntimeOverride && (
                  <button
                    type="button"
                    disabled={resettingToken || savingToken}
                    data-testid="btn-reset-fonnte-token"
                    onClick={() => void handleResetTokenToDefault()}
                    title="Kembalikan ke token bawaan FONNTE_TOKEN dari server"
                    className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl border border-slate-300 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-100 disabled:opacity-50 transition-colors shrink-0 whitespace-nowrap"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{resettingToken ? 'Mereset...' : 'Bawaan Server'}</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Hanya akun <strong>Master Admin</strong> yang dapat mengubah Token Fonnte dan mengganti nomor WhatsApp pengirim.
            </p>
          )}
        </div>

        {/* Trigger Otomatis */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-2.5">
          <label className="rounded-xl border border-slate-200 p-3 flex items-start gap-2.5 cursor-pointer hover:bg-slate-50/70 transition-colors">
            <input
              type="checkbox"
              data-testid="toggle-fonnte-auto-ontime"
              checked={config.autoSendOnTime}
              onChange={(e) => {
                const checked = e.target.checked;
                onChangeConfig({ ...config, autoSendOnTime: checked });
                setIncludeOnTimeBatch(checked);
              }}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 shrink-0"
            />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-900">
                Otomatis saat Hadir Tepat Waktu
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                Antrekan pesan otomatis saat siswa presensi tepat waktu.
              </p>
            </div>
          </label>

          <label className="rounded-xl border border-slate-200 p-3 flex items-start gap-2.5 cursor-pointer hover:bg-slate-50/70 transition-colors">
            <input
              type="checkbox"
              data-testid="toggle-fonnte-auto-late"
              checked={config.autoSendLate}
              onChange={(e) =>
                onChangeConfig({ ...config, autoSendLate: e.target.checked })
              }
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 shrink-0"
            />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-900">
                Otomatis saat Siswa Terlambat
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                Antrekan pesan otomatis saat presensi mencatat status Terlambat.
              </p>
            </div>
          </label>

          <label className="rounded-xl border border-slate-200 p-3 flex items-start gap-2.5 cursor-pointer hover:bg-slate-50/70 transition-colors">
            <input
              type="checkbox"
              data-testid="toggle-fonnte-auto-absent"
              checked={config.autoSendAbsent}
              onChange={(e) =>
                onChangeConfig({ ...config, autoSendAbsent: e.target.checked })
              }
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 shrink-0"
            />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-900">
                Otomatis saat Ditandai Alpa (Tidak Hadir)
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                Antrekan pesan otomatis saat status siswa diubah menjadi Alpa.
              </p>
            </div>
          </label>
        </div>

        {/* Jadwal Harian Otomatis */}
        <div className="rounded-xl border border-slate-200 p-3.5 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <label className="flex items-center gap-2.5 cursor-pointer flex-1 min-w-[200px]">
              <input
                type="checkbox"
                data-testid="toggle-fonnte-schedule-absent"
                checked={config.autoAbsentScheduleEnabled}
                onChange={(e) =>
                  onChangeConfig({
                    ...config,
                    autoAbsentScheduleEnabled: e.target.checked,
                  })
                }
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 shrink-0"
              />
              <span className="text-xs font-semibold text-slate-900 leading-snug">
                Jadwal Kirim Otomatis Harian (Hadir Tepat Waktu, Terlambat &amp; Tidak Hadir)
              </span>
            </label>

            <div className="flex items-center gap-2 shrink-0">
              <Clock className="h-4 w-4 text-slate-400" aria-hidden="true" />
              <input
                type="time"
                aria-label="Jam pengiriman otomatis siswa tidak hadir"
                data-testid="input-fonnte-absent-time"
                value={config.autoAbsentScheduleTime}
                onChange={(e) =>
                  onChangeConfig({
                    ...config,
                    autoAbsentScheduleTime: e.target.value || '08:30',
                  })
                }
                className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-mono font-semibold text-slate-800 bg-white"
              />
            </div>
          </div>

          <label className="flex items-start gap-2 text-xs text-slate-600 sm:pl-6 cursor-pointer">
            <input
              type="checkbox"
              checked={config.includeUnrecordedAsAbsent}
              onChange={(e) => {
                onChangeConfig({
                  ...config,
                  includeUnrecordedAsAbsent: e.target.checked,
                });
                setIncludeUnrecordedBatch(e.target.checked);
              }}
              className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 shrink-0"
            />
            <span>Sertakan siswa berstatus <strong>Belum Presensi</strong> pada jadwal pengiriman otomatis</span>
          </label>

          {config.autoAbsentScheduleEnabled && (
            <div
              data-testid="fonnte-schedule-status"
              className={`sm:ml-6 rounded-lg border px-3 py-2 text-[11px] flex flex-wrap items-center justify-between gap-2 ${
                !config.enabled
                  ? 'bg-amber-50 border-amber-200 text-amber-900'
                  : scheduleEvaluation.status === 'completed'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : scheduleEvaluation.status === 'due'
                      ? 'bg-indigo-50 border-indigo-200 text-indigo-900'
                      : 'bg-slate-50 border-slate-200 text-slate-700'
              }`}
            >
              <div className="min-w-0 flex-1">
                {!config.enabled ? (
                  <p className="font-medium leading-relaxed">
                    Aktifkan centang <strong>Aktifkan Pengiriman Otomatis WhatsApp Fonnte</strong> di atas agar jadwal pukul{' '}
                    <span className="font-mono font-bold">{scheduleEvaluation.targetHHMM}</span> berjalan otomatis.
                  </p>
                ) : scheduleEvaluation.status === 'completed' ? (
                  <p className="font-medium leading-relaxed">
                    Jadwal otomatis pukul{' '}
                    <span className="font-mono font-bold">{scheduleEvaluation.targetHHMM}</span> sudah dijalankan hari ini (Jam perangkat:{' '}
                    <span className="font-mono">{scheduleEvaluation.currentHHMMSS}</span>).
                  </p>
                ) : scheduleEvaluation.status === 'due' ? (
                  <p className="font-medium leading-relaxed">
                    Waktu jadwal <span className="font-mono font-bold">{scheduleEvaluation.targetHHMM}</span> tercapai (Jam:{' '}
                    <span className="font-mono">{scheduleEvaluation.currentHHMMSS}</span>) ·{' '}
                    {readyToSendCandidates.length > 0
                      ? `Memproses pengiriman otomatis untuk ${readyToSendCandidates.length} siswa...`
                      : 'Belum ada siswa baru yang memiliki nomor WA orang tua.'}
                  </p>
                ) : (
                  <p className="font-medium leading-relaxed">
                    Menunggu jadwal pukul{' '}
                    <span className="font-mono font-bold">{scheduleEvaluation.targetHHMM}</span> (dalam{' '}
                    <strong>{formatDurationId(scheduleEvaluation.secondsUntil)}</strong> · Jam:{' '}
                    <span className="font-mono">{scheduleEvaluation.currentHHMMSS}</span> ·{' '}
                    <strong>{readyToSendCandidates.length}</strong> siap kirim).
                  </p>
                )}
              </div>

              {config.enabled && scheduleEvaluation.status === 'completed' && (
                <button
                  type="button"
                  data-testid="btn-reset-fonnte-schedule"
                  onClick={onResetScheduleToday}
                  className="px-2.5 py-1 rounded-md bg-white border border-emerald-300 text-emerald-800 text-[11px] font-semibold hover:bg-emerald-100 transition-colors shrink-0 whitespace-nowrap"
                >
                  Reset Jadwal Hari Ini
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* 2. Pengaturan Pengiriman Bertahap (Anti-Blokir WhatsApp) */}
      <section className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-3.5">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          </div>
          <h2 className="text-sm sm:text-base font-semibold text-slate-900 leading-snug min-w-0 flex-1">
            <span>Pengiriman Bertahap &amp; Perlindungan Anti-Blokir WhatsApp</span>
            <button
              type="button"
              data-testid="btn-info-fonnte-antiban"
              aria-label="Informasi mekanisme anti-blokir WhatsApp"
              aria-expanded={showAntiBanInfo}
              title="Klik untuk melihat penjelasan perlindungan anti-blokir WhatsApp"
              onClick={() => setShowAntiBanInfo((v) => !v)}
              className={`h-6 w-6 rounded-full inline-flex items-center justify-center align-middle ml-1.5 transition-colors ${
                showAntiBanInfo
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600'
              }`}
            >
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </h2>
        </div>

        {showAntiBanInfo && (
          <div
            data-testid="info-panel-fonnte-antiban"
            className="rounded-xl bg-emerald-50/70 border border-emerald-200 p-3.5 text-xs text-emerald-950 space-y-1.5"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold text-emerald-900">
                4 Lapisan Perlindungan Anti-Blokir WhatsApp
              </p>
              <button
                type="button"
                aria-label="Tutup informasi anti-blokir"
                onClick={() => setShowAntiBanInfo(false)}
                className="text-emerald-600 hover:text-emerald-800 p-0.5 rounded shrink-0"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
            <ul className="list-disc pl-4 space-y-1 text-emerald-900/90 leading-relaxed">
              <li>
                <strong>Jeda Acak (Random Jitter):</strong> Setiap pesan menunggu durasi acak antara batas minimum (min. 15 detik) hingga maksimum agar pola kirim menyerupai manusia.
              </li>
              <li>
                <strong>Istirahat Antar Batch (Cool-down):</strong> Setelah sejumlah pesan terkirim (misal 10 pesan), sistem otomatis beristirahat beberapa menit sebelum lanjut ke gelombang berikutnya.
              </li>
              <li>
                <strong>Variasi Salam Alami:</strong> Placeholder <code className="font-mono">{'{salam}'}</code> merotasi kalimat pembuka agar isi pesan tidak terdeteksi identik massal.
              </li>
              <li>
                <strong>Anti-Duplikat Harian:</strong> Satu siswa hanya dikirim maksimal 1 kali per kategori (Hadir / Terlambat / Tidak Hadir) pada tanggal yang sama.
              </li>
            </ul>
          </div>
        )}

        {/* Preset Keamanan */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-2.5">
          {PACING_PRESETS.map((preset) => {
            const isActive =
              config.pacing.minDelaySec === preset.pacing.minDelaySec &&
              config.pacing.maxDelaySec === preset.pacing.maxDelaySec &&
              config.pacing.batchSize === preset.pacing.batchSize &&
              config.pacing.batchPauseSec === preset.pacing.batchPauseSec;
            return (
              <button
                key={preset.id}
                type="button"
                data-testid={`preset-fonnte-${preset.id}`}
                onClick={() => handleUpdatePacing(preset.pacing)}
                className={`text-left rounded-xl border p-3 transition-all ${
                  isActive
                    ? 'border-indigo-500 bg-indigo-50/70 ring-1 ring-indigo-500/20'
                    : 'border-slate-200 bg-white hover:border-indigo-300 hover:bg-slate-50'
                }`}
              >
                <p className="text-xs font-bold text-slate-900">{preset.label}</p>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{preset.desc}</p>
              </button>
            );
          })}
        </div>

        {/* Fine-Grained Inputs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
            <label
              htmlFor="fonnte-min-delay"
              className="block text-[11px] font-semibold text-slate-600"
            >
              Jeda Minimal (dtk)
            </label>
            <input
              id="fonnte-min-delay"
              data-testid="input-fonnte-min-delay"
              type="number"
              min={FONNTE_PACING_BOUNDS.MIN_DELAY_SEC}
              max={FONNTE_PACING_BOUNDS.MAX_DELAY_SEC}
              value={config.pacing.minDelaySec}
              onChange={(e) => handleUpdatePacing({ minDelaySec: Number(e.target.value) })}
              className="mt-1.5 w-full px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 text-sm font-mono font-bold text-slate-900"
            />
            <p className="text-[10px] text-slate-500 mt-1">Min. 15 detik</p>
          </div>

          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
            <label
              htmlFor="fonnte-max-delay"
              className="block text-[11px] font-semibold text-slate-600"
            >
              Jeda Maksimal (dtk)
            </label>
            <input
              id="fonnte-max-delay"
              data-testid="input-fonnte-max-delay"
              type="number"
              min={config.pacing.minDelaySec}
              max={FONNTE_PACING_BOUNDS.MAX_DELAY_SEC}
              value={config.pacing.maxDelaySec}
              onChange={(e) => handleUpdatePacing({ maxDelaySec: Number(e.target.value) })}
              className="mt-1.5 w-full px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 text-sm font-mono font-bold text-slate-900"
            />
            <p className="text-[10px] text-slate-500 mt-1">Diacak tiap pesan</p>
          </div>

          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
            <label
              htmlFor="fonnte-batch-size"
              className="block text-[11px] font-semibold text-slate-600"
            >
              Pesan / Gelombang
            </label>
            <input
              id="fonnte-batch-size"
              data-testid="input-fonnte-batch-size"
              type="number"
              min={FONNTE_PACING_BOUNDS.MIN_BATCH_SIZE}
              max={FONNTE_PACING_BOUNDS.MAX_BATCH_SIZE}
              value={config.pacing.batchSize}
              onChange={(e) => handleUpdatePacing({ batchSize: Number(e.target.value) })}
              className="mt-1.5 w-full px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 text-sm font-mono font-bold text-slate-900"
            />
            <p className="text-[10px] text-slate-500 mt-1">3–20 pesan/batch</p>
          </div>

          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
            <label
              htmlFor="fonnte-batch-pause"
              className="block text-[11px] font-semibold text-slate-600"
            >
              Istirahat Batch (dtk)
            </label>
            <input
              id="fonnte-batch-pause"
              data-testid="input-fonnte-batch-pause"
              type="number"
              min={FONNTE_PACING_BOUNDS.MIN_BATCH_PAUSE_SEC}
              max={FONNTE_PACING_BOUNDS.MAX_BATCH_PAUSE_SEC}
              value={config.pacing.batchPauseSec}
              onChange={(e) => handleUpdatePacing({ batchPauseSec: Number(e.target.value) })}
              className="mt-1.5 w-full px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 text-sm font-mono font-bold text-slate-900"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              ≈ {formatDurationId(config.pacing.batchPauseSec)}
            </p>
          </div>
        </div>
      </section>

      {/* 3. Kirim Bertahap Hari Ini & Monitor Antrean Server */}
      <section
        className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-3.5"
        data-testid="fonnte-batch-dispatch-section"
      >
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
              <Users className="h-4 w-4" aria-hidden="true" />
            </div>
            <h2 className="text-sm sm:text-base font-semibold text-slate-900 leading-snug">
              Pengiriman Bertahap Hari Ini ({todayDate})
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs font-semibold whitespace-nowrap">
              Siap Kirim: {readyToSendCandidates.length}
            </span>
            {readyToSendCandidates.length > 1 && (
              <span
                data-testid="fonnte-estimated-duration"
                className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold whitespace-nowrap"
              >
                Estimasi: ~{formatDurationId(estimatedBatchSec)}
              </span>
            )}
          </div>
        </div>

        {/* Filter Kategori Kirim */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-700 whitespace-nowrap">
            <input
              type="checkbox"
              data-testid="filter-fonnte-batch-ontime"
              checked={includeOnTimeBatch}
              onChange={(e) => setIncludeOnTimeBatch(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600"
            />
            <span>Hadir Tepat Waktu</span>
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-700 whitespace-nowrap">
            <input
              type="checkbox"
              checked={includeLateBatch}
              onChange={(e) => setIncludeLateBatch(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
            />
            <span>Terlambat</span>
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-700 whitespace-nowrap">
            <input
              type="checkbox"
              checked={includeAbsentBatch}
              onChange={(e) => setIncludeAbsentBatch(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
            />
            <span>Alpa (Tidak Hadir)</span>
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-700 whitespace-nowrap">
            <input
              type="checkbox"
              checked={includeUnrecordedBatch}
              onChange={(e) => setIncludeUnrecordedBatch(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
            />
            <span>Belum Presensi</span>
          </label>
        </div>

        {/* Daftar Penerima */}
        {todayCandidates.length === 0 ? (
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 text-xs text-slate-500 text-center">
            Belum ada siswa sesuai kategori terpilih pada tanggal {todayDate}.
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <div className="max-h-56 overflow-y-auto divide-y divide-slate-100">
              {todayCandidates.map((c) => (
                <div
                  key={`${c.nis}-${c.status}`}
                  className="px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs bg-white"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 truncate">
                      {c.nama}{' '}
                      <span className="font-normal text-slate-500">
                        ({c.kelas} · NISN {c.nis})
                      </span>
                    </p>
                    <p className="text-[11px] font-mono text-slate-500">
                      WA Ortu: {c.hasValidPhone ? c.normalizedTarget : 'Belum diisi / tidak valid'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border whitespace-nowrap ${
                        c.status === 'Hadir Tepat Waktu'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : c.status === 'Terlambat'
                            ? 'bg-amber-50 text-amber-800 border-amber-200'
                            : 'bg-rose-50 text-rose-700 border-rose-200'
                      }`}
                    >
                      {c.status}
                    </span>
                    {c.alreadyNotified ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-semibold whitespace-nowrap">
                        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                        Terkirim/Antre
                      </span>
                    ) : !c.hasValidPhone ? (
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 text-[11px] font-medium whitespace-nowrap">
                        No. WA Kosong
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 text-[11px] font-semibold whitespace-nowrap">
                        Siap Kirim
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end pt-0.5">
          <button
            type="button"
            disabled={enqueuingBatch || readyToSendCandidates.length === 0}
            onClick={() => void handleEnqueueTodayBatch()}
            data-testid="btn-enqueue-fonnte-batch"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
            <span>
              {enqueuingBatch
                ? 'Memasukkan ke Antrean...'
                : `Kirim Bertahap Sekarang (${readyToSendCandidates.length})`}
            </span>
          </button>
        </div>

        {/* Monitor Antrean Server Aktif */}
        {queueSnapshot && queueSnapshot.counts.total > 0 && (
          <div
            data-testid="fonnte-queue-monitor"
            className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-900">
                  Status Antrean Bertahap Server
                  {queueSnapshot.paused && (
                    <span className="ml-2 px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px]">
                      DIJEDA
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  Terkirim: <strong>{queueSnapshot.counts.sent}</strong> · Menunggu:{' '}
                  <strong>{queueSnapshot.counts.pending + queueSnapshot.counts.sending}</strong> · Gagal:{' '}
                  <strong>{queueSnapshot.counts.failed}</strong>
                  {nextSendCountdownSec > 0 && !queueSnapshot.paused && (
                    <> · Berikutnya <strong>{nextSendCountdownSec} dtk</strong></>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {queueSnapshot.paused ? (
                  <button
                    type="button"
                    disabled={controllingQueue}
                    onClick={() => void handleQueueControl('resume')}
                    data-testid="btn-resume-fonnte-queue"
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <Play className="h-3 w-3" aria-hidden="true" />
                    <span>Lanjutkan</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={controllingQueue || queueSnapshot.counts.pending === 0}
                    onClick={() => void handleQueueControl('pause')}
                    data-testid="btn-pause-fonnte-queue"
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 text-xs font-semibold hover:bg-amber-100 disabled:opacity-50"
                  >
                    <Pause className="h-3 w-3" aria-hidden="true" />
                    <span>Jeda</span>
                  </button>
                )}
                <button
                  type="button"
                  disabled={controllingQueue}
                  onClick={() => void handleQueueControl('clear')}
                  data-testid="btn-clear-fonnte-queue"
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-rose-200 bg-white text-rose-700 text-xs font-semibold hover:bg-rose-50 disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                  <span>Bersihkan</span>
                </button>
              </div>
            </div>

            <div className="max-h-40 overflow-y-auto space-y-1.5">
              {queueSnapshot.jobs.slice(-15).reverse().map((job) => (
                <div
                  key={job.id}
                  className="px-3 py-2 rounded-lg bg-white border border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[11px]"
                >
                  <div className="min-w-0">
                    <span className="font-semibold text-slate-800">{job.studentName}</span>{' '}
                    <span className="text-slate-500">
                      ({job.kelas} · {job.status} · {job.targetMasked})
                    </span>
                    {job.error && (
                      <p className="text-rose-600 mt-0.5 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span>{job.error}</span>
                      </p>
                    )}
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded font-semibold uppercase text-[10px] shrink-0 ${
                      job.state === 'sent'
                        ? 'bg-emerald-50 text-emerald-700'
                        : job.state === 'failed'
                          ? 'bg-rose-50 text-rose-700'
                          : job.state === 'sending'
                            ? 'bg-indigo-50 text-indigo-700'
                            : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {job.state === 'sent'
                      ? 'Terkirim'
                      : job.state === 'failed'
                        ? 'Gagal'
                        : job.state === 'sending'
                          ? 'Mengirim...'
                          : 'Menunggu'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 4. Template Pesan Orang Tua */}
      <section className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm sm:text-base font-semibold text-slate-900">
            Template Pesan WhatsApp Orang Tua
          </h2>
          <button
            type="button"
            onClick={() =>
              onChangeConfig({
                ...config,
                onTimeTemplate: DEFAULT_ON_TIME_TEMPLATE,
                lateTemplate: DEFAULT_LATE_TEMPLATE,
                absentTemplate: DEFAULT_ABSENT_TEMPLATE,
              })
            }
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 whitespace-nowrap"
          >
            Reset Template Bawaan
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-stretch">
          <div className="flex flex-col space-y-1.5">
            <label
              htmlFor="fonnte-ontime-template"
              className="block text-xs font-semibold text-emerald-700"
            >
              Template Hadir Tepat Waktu
            </label>
            <textarea
              id="fonnte-ontime-template"
              data-testid="textarea-fonnte-ontime-template"
              rows={5}
              value={config.onTimeTemplate}
              onChange={(e) => onChangeConfig({ ...config, onTimeTemplate: e.target.value })}
              className="w-full flex-1 px-3 py-2 rounded-xl border border-slate-300 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
          </div>

          <div className="flex flex-col space-y-1.5">
            <label
              htmlFor="fonnte-late-template"
              className="block text-xs font-semibold text-amber-800"
            >
              Template Siswa Terlambat
            </label>
            <textarea
              id="fonnte-late-template"
              data-testid="textarea-fonnte-late-template"
              rows={5}
              value={config.lateTemplate}
              onChange={(e) => onChangeConfig({ ...config, lateTemplate: e.target.value })}
              className="w-full flex-1 px-3 py-2 rounded-xl border border-slate-300 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
          </div>

          <div className="flex flex-col space-y-1.5">
            <label
              htmlFor="fonnte-absent-template"
              className="block text-xs font-semibold text-rose-700"
            >
              Template Tidak Hadir (Alpa / Belum)
            </label>
            <textarea
              id="fonnte-absent-template"
              data-testid="textarea-fonnte-absent-template"
              rows={5}
              value={config.absentTemplate}
              onChange={(e) => onChangeConfig({ ...config, absentTemplate: e.target.value })}
              className="w-full flex-1 px-3 py-2 rounded-xl border border-slate-300 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
          </div>
        </div>

        <div className="rounded-xl bg-emerald-50/60 border border-emerald-200/80 p-3.5 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-semibold text-emerald-800">
              Pratinjau Pesan WhatsApp:
            </p>
            <div className="flex flex-wrap items-center gap-1">
              {(
                [
                  { id: 'ontime', label: 'Hadir Tepat Waktu' },
                  { id: 'late', label: 'Terlambat' },
                  { id: 'absent', label: 'Tidak Hadir' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  data-testid={`btn-preview-fonnte-${tab.id}`}
                  onClick={() => setPreviewTab(tab.id)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors whitespace-nowrap ${
                    previewTab === tab.id
                      ? 'bg-emerald-600 text-white'
                      : 'bg-white text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          <pre
            data-testid="fonnte-message-preview"
            className="text-xs text-slate-800 whitespace-pre-wrap font-sans leading-relaxed"
          >
            {samplePreviewMessage}
          </pre>
        </div>
      </section>

      {/* 5. Uji Kirim 1 Pesan Tes */}
      <section className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-3">
        <h2 className="text-sm sm:text-base font-semibold text-slate-900">
          Uji Kirim Pesan WhatsApp (1 Nomor Tes)
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label
              htmlFor="fonnte-test-target"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Nomor WhatsApp Tujuan
            </label>
            <input
              id="fonnte-test-target"
              data-testid="input-fonnte-test-target"
              type="text"
              value={testTarget}
              onChange={(e) => setTestTarget(e.target.value)}
              placeholder="081234567890"
              className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono text-slate-800"
            />
          </div>
          <div className="sm:col-span-2">
            <label
              htmlFor="fonnte-test-message"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Isi Pesan Uji Coba
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                id="fonnte-test-message"
                type="text"
                value={testMessage}
                onChange={(e) => setTestMessage(e.target.value)}
                className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-slate-300 text-xs text-slate-800"
              />
              <button
                type="button"
                disabled={sendingTest || !testTarget.trim()}
                onClick={() => void handleSendTest()}
                data-testid="btn-send-fonnte-test"
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 shrink-0 transition-colors whitespace-nowrap"
              >
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{sendingTest ? 'Mengirim...' : 'Kirim Tes'}</span>
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
