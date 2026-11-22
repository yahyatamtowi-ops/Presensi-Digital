import { useEffect, useMemo, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import {
  Camera,
  CameraOff,
  Keyboard,
  QrCode,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  SwitchCamera,
  LogOut,
  UserCheck,
  Search,
  WifiOff,
  RefreshCw,
  HardDrive,
} from 'lucide-react';
import type {
  AttendanceRecord,
  ScanActionMode,
  SchoolSettings,
  Student,
} from '../types';
import {
  getTodayDateString,
  hasScannedOnDate,
  type ScanOutcome,
} from '../utils/attendanceLogic';
import { StatusBadge } from './StatusBadge';
import {
  EarlyCheckoutModal,
  type EarlyCheckoutStudentInfo,
} from './EarlyCheckoutModal';

interface ScannerViewProps {
  students: Student[];
  records: AttendanceRecord[];
  settings: SchoolSettings;
  isOnline?: boolean;
  pendingSyncCount?: number;
  syncingQueue?: boolean;
  hasRemoteSync?: boolean;
  onSyncPendingNow?: () => void;
  onScanSubmit: (
    rawCode: string,
    scanAction?: ScanActionMode,
    alasanPulangCepat?: string
  ) => ScanOutcome;
}

const SCANNER_ELEMENT_ID = 'presensi-qr-reader';

export function ScannerView({
  students,
  records,
  settings,
  isOnline = true,
  pendingSyncCount = 0,
  syncingQueue = false,
  hasRemoteSync = false,
  onSyncPendingNow,
  onScanSubmit,
}: ScannerViewProps) {
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [scanAction, setScanAction] = useState<ScanActionMode>('auto');
  const [manualNis, setManualNis] = useState('');
  const [selectedClass, setSelectedClass] = useState('');
  const [studentNameQuery, setStudentNameQuery] = useState('');
  const [selectedStudentNis, setSelectedStudentNis] = useState('');
  const [lastOutcome, setLastOutcome] = useState<ScanOutcome | null>(null);
  const [pendingEarlyCheckout, setPendingEarlyCheckout] = useState<{
    student: EarlyCheckoutStudentInfo;
    source: 'camera' | 'manual' | 'forgot';
  } | null>(null);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastScanCooldownRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const isDualMode = settings.mode_presensi === 'masuk_pulang';
  const effectiveScanAction: ScanActionMode = isDualMode ? scanAction : 'masuk';
  const effectiveScanActionRef = useRef<ScanActionMode>(effectiveScanAction);
  effectiveScanActionRef.current = effectiveScanAction;
  const onScanSubmitRef = useRef(onScanSubmit);
  onScanSubmitRef.current = onScanSubmit;

  const today = getTodayDateString();
  const todayRecords = records
    .filter((r) => r.tanggal === today)
    .sort((a, b) => {
      const timeA = a.jam_pulang && a.jam_pulang !== '-' ? a.jam_pulang : a.jam_masuk;
      const timeB = b.jam_pulang && b.jam_pulang !== '-' ? b.jam_pulang : b.jam_masuk;
      return timeB.localeCompare(timeA);
    });

  const checkedInCount = todayRecords.filter(
    (r) =>
      (r.status === 'Hadir' || r.status === 'Terlambat') &&
      r.jam_masuk &&
      r.jam_masuk !== '-'
  ).length;
  const checkedOutCount = todayRecords.filter(
    (r) => r.jam_pulang && r.jam_pulang !== '-'
  ).length;
  const pendingCheckoutCount = todayRecords.filter(
    (r) =>
      (r.status === 'Hadir' || r.status === 'Terlambat') &&
      r.jam_masuk &&
      r.jam_masuk !== '-' &&
      (!r.jam_pulang || r.jam_pulang === '-')
  ).length;

  const showCheckoutColumn =
    isDualMode || checkedOutCount > 0;

  const uniqueClasses = useMemo(() => {
    return Array.from(
      new Set(students.map((s) => s.kelas.trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));
  }, [students]);

  const studentsInSelectedClass = useMemo(() => {
    if (!selectedClass) return [];
    const q = studentNameQuery.trim().toLowerCase();
    return students
      .filter((s) => s.kelas.trim() === selectedClass)
      .filter((s) =>
        !q ? true : s.nama.toLowerCase().includes(q) || s.nis.toLowerCase().includes(q)
      )
      .sort((a, b) => a.nama.localeCompare(b.nama));
  }, [students, selectedClass, studentNameQuery]);

  useEffect(() => {
    if (selectedClass && !uniqueClasses.includes(selectedClass)) {
      setSelectedClass('');
      setSelectedStudentNis('');
    }
  }, [selectedClass, uniqueClasses]);

  useEffect(() => {
    if (
      selectedStudentNis &&
      !studentsInSelectedClass.some((s) => s.nis === selectedStudentNis)
    ) {
      setSelectedStudentNis('');
    }
  }, [selectedStudentNis, studentsInSelectedClass]);

  async function stopCamera() {
    const instance = scannerRef.current;
    if (instance) {
      try {
        if (instance.isScanning) {
          await instance.stop();
        }
        instance.clear();
      } catch {
        // Ignore cleanup errors
      }
      scannerRef.current = null;
    }
    setCameraActive(false);
    setCameraStarting(false);
  }

  async function startCamera(mode: 'environment' | 'user' = facingMode) {
    setCameraError(null);
    setCameraStarting(true);

    try {
      await stopCamera();
      const instance = new Html5Qrcode(SCANNER_ELEMENT_ID);
      scannerRef.current = instance;

      await instance.start(
        { facingMode: mode },
        {
          fps: 10,
          qrbox: { width: 240, height: 240 },
          aspectRatio: 1.333334,
        },
        (decodedText) => {
          const nowMs = Date.now();
          const trimmed = decodedText.trim();
          if (
            lastScanCooldownRef.current.code === trimmed &&
            nowMs - lastScanCooldownRef.current.at < 2500
          ) {
            return;
          }
          lastScanCooldownRef.current = { code: trimmed, at: nowMs };
          const outcome = onScanSubmitRef.current(trimmed, effectiveScanActionRef.current);
          setLastOutcome(outcome);
          if (
            !outcome.ok &&
            outcome.reason === 'before_checkout_time' &&
            outcome.student
          ) {
            setPendingEarlyCheckout({
              student: {
                nis: outcome.student.nis,
                nama: outcome.student.nama,
                kelas: outcome.student.kelas,
                jamMasuk: outcome.existingRecord?.jam_masuk,
              },
              source: 'camera',
            });
          }
        },
        () => {
          // Ignore per-frame decode misses
        }
      );

      setCameraActive(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('denied')) {
        setCameraError(
          'Akses kamera ditolak. Berikan izin kamera pada browser atau gunakan input NIS manual di samping.'
        );
      } else {
        setCameraError(
          'Perangkat kamera tidak ditemukan atau sedang digunakan aplikasi lain. Gunakan input NIS manual untuk mencatat presensi.'
        );
      }
      setCameraActive(false);
    } finally {
      setCameraStarting(false);
    }
  }

  async function handleSwitchCamera() {
    const nextMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextMode);
    if (cameraActive) {
      await startCamera(nextMode);
    }
  }

  useEffect(() => {
    return () => {
      const instance = scannerRef.current;
      if (instance) {
        if (instance.isScanning) {
          instance.stop().catch(() => {});
        }
      }
    };
  }, []);

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = manualNis.trim();
    if (!trimmed) return;
    const outcome = onScanSubmit(trimmed, effectiveScanAction);
    setLastOutcome(outcome);
    if (outcome.ok) {
      setManualNis('');
    } else if (outcome.reason === 'before_checkout_time' && outcome.student) {
      setPendingEarlyCheckout({
        student: {
          nis: outcome.student.nis,
          nama: outcome.student.nama,
          kelas: outcome.student.kelas,
          jamMasuk: outcome.existingRecord?.jam_masuk,
        },
        source: 'manual',
      });
    }
  }

  function handleForgotCardSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedStudentNis) return;
    const outcome = onScanSubmit(selectedStudentNis, effectiveScanAction);
    setLastOutcome(outcome);
    if (outcome.ok) {
      setSelectedStudentNis('');
      setStudentNameQuery('');
    } else if (outcome.reason === 'before_checkout_time' && outcome.student) {
      setPendingEarlyCheckout({
        student: {
          nis: outcome.student.nis,
          nama: outcome.student.nama,
          kelas: outcome.student.kelas,
          jamMasuk: outcome.existingRecord?.jam_masuk,
        },
        source: 'forgot',
      });
    }
  }

  function handleConfirmEarlyCheckout(alasan: string) {
    if (!pendingEarlyCheckout) return;
    const { student, source } = pendingEarlyCheckout;
    const confirmed = onScanSubmit(student.nis, 'pulang', alasan);
    setLastOutcome(confirmed);
    setPendingEarlyCheckout(null);
    if (confirmed.ok) {
      if (source === 'manual') {
        setManualNis('');
      } else if (source === 'forgot') {
        setSelectedStudentNis('');
        setStudentNameQuery('');
      }
    }
  }

  return (
    <div className="space-y-6">
      {/* Offline Storage & Auto-Sync Status Banner */}
      {(!isOnline || pendingSyncCount > 0) && (
        <section
          role="status"
          data-testid="scanner-offline-banner"
          className={`rounded-2xl border p-4 sm:px-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
            !isOnline
              ? 'bg-amber-50/90 border-amber-300 text-amber-950'
              : 'bg-indigo-50/80 border-indigo-200 text-indigo-950'
          }`}
        >
          <div className="flex items-start gap-3 min-w-0">
            <div
              className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${
                !isOnline
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-indigo-100 text-indigo-700'
              }`}
            >
              {!isOnline ? (
                <WifiOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <HardDrive className="h-4 w-4" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-semibold">
                {!isOnline
                  ? 'Mode Penyimpanan Offline Aktif — Koneksi Internet Terputus'
                  : `${pendingSyncCount} Data Presensi Offline Siap Disinkronkan`}
              </p>
              <p
                className={`text-xs mt-0.5 ${
                  !isOnline ? 'text-amber-800/90' : 'text-indigo-800/90'
                }`}
              >
                {!isOnline
                  ? hasRemoteSync
                    ? 'Scan presensi tetap berjalan normal dan disimpan aman di perangkat ini. Semua data akan tersinkron otomatis begitu internet kembali.'
                    : 'Scan presensi tetap berjalan normal dan tersimpan aman di penyimpanan lokal perangkat (IndexedDB & localStorage).'
                  : 'Koneksi internet aktif. Data yang dicatat selama offline sedang atau siap dikirim otomatis ke Google Sheets.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {pendingSyncCount > 0 && (
              <span
                data-testid="scanner-pending-count"
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-mono font-semibold tabular-nums ${
                  !isOnline
                    ? 'bg-white/90 border-amber-300 text-amber-800'
                    : 'bg-white border-indigo-200 text-indigo-700'
                }`}
              >
                {pendingSyncCount} antrean offline
              </span>
            )}
            {isOnline && pendingSyncCount > 0 && onSyncPendingNow && (
              <button
                type="button"
                disabled={syncingQueue}
                onClick={onSyncPendingNow}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-60 transition-colors"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${syncingQueue ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>{syncingQueue ? 'Menyinkronkan...' : 'Sinkronkan Sekarang'}</span>
              </button>
            )}
          </div>
        </section>
      )}

      {/* Top Dual-Mode Schedule & Action Switcher Bar (Masuk & Pulang) */}
      {isDualMode && (
        <section
          aria-label="Kontrol Mode Presensi Masuk dan Pulang"
          className="bg-white rounded-2xl border border-indigo-200 p-4 sm:px-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] flex flex-col lg:flex-row lg:items-center justify-between gap-3"
        >
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 text-[11px] font-semibold text-indigo-700">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Mode Masuk &amp; Pulang Aktif</span>
              </span>
              <span className="text-xs font-mono tabular-nums text-slate-600">
                Batas Masuk <strong className="text-slate-900">{settings.batas_jam_masuk}</strong> · Jam Pulang{' '}
                <strong className="text-slate-900">{settings.jam_pulang_standar}</strong>
              </span>
            </div>
            <p className="text-xs text-slate-500 font-mono tabular-nums">
              Sudah Masuk: <strong className="text-emerald-700">{checkedInCount}</strong> · Sudah Pulang:{' '}
              <strong className="text-indigo-700">{checkedOutCount}</strong> · Belum Pulang:{' '}
              <strong className="text-amber-700">{pendingCheckoutCount}</strong>
            </p>
          </div>

          <div
            role="group"
            aria-label="Pilih mode scan masuk atau pulang"
            className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100 border border-slate-200/80 self-start lg:self-auto"
          >
            {(
              [
                { id: 'auto', label: 'Otomatis' },
                { id: 'masuk', label: 'Presensi Masuk' },
                { id: 'pulang', label: 'Presensi Pulang' },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={scanAction === item.id}
                onClick={() => setScanAction(item.id)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                  scanAction === item.id
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Camera QR Scanner */}
        <section className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/80 p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-900">
                Pemindai QR Kamera
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {isDualMode ? (
                  <>
                    Jadwal Masuk{' '}
                    <span className="font-mono tabular-nums font-medium text-slate-700">
                      {settings.batas_jam_masuk}
                    </span>{' '}
                    · Pulang{' '}
                    <span className="font-mono tabular-nums font-medium text-slate-700">
                      {settings.jam_pulang_standar}
                    </span>
                  </>
                ) : (
                  <>
                    Mode Masuk Saja · Batas{' '}
                    <span className="font-mono tabular-nums font-medium text-slate-700">
                      {settings.batas_jam_masuk}
                    </span>
                  </>
                )}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleSwitchCamera}
                aria-label="Ganti kamera depan atau belakang"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
              >
                <SwitchCamera className="h-4 w-4 text-slate-500" aria-hidden="true" />
                <span>{facingMode === 'environment' ? 'Belakang' : 'Depan'}</span>
              </button>

              {cameraActive ? (
                <button
                  type="button"
                  onClick={stopCamera}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 transition-colors whitespace-nowrap"
                >
                  <CameraOff className="h-4 w-4" aria-hidden="true" />
                  <span>Hentikan Kamera</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => startCamera(facingMode)}
                  disabled={cameraStarting}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-60 transition-colors whitespace-nowrap"
                >
                  <Camera className="h-4 w-4" aria-hidden="true" />
                  <span>{cameraStarting ? 'Membuka Kamera...' : 'Mulai Kamera'}</span>
                </button>
              )}
            </div>
          </div>

          {/* Camera Viewport */}
          <div className="relative rounded-2xl bg-slate-950 overflow-hidden min-h-[280px] sm:min-h-[340px] flex items-center justify-center border border-slate-200">
            <div id={SCANNER_ELEMENT_ID} className="w-full" />

            {!cameraActive && !cameraStarting && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 bg-slate-900 text-slate-200">
                <div className="h-14 w-14 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center mb-3">
                  <QrCode className="h-7 w-7 text-indigo-400" aria-hidden="true" />
                </div>
                <p className="text-sm font-semibold text-white">
                  Kamera Pemindai Belum Aktif
                </p>
                <p className="text-xs text-slate-400 mt-1 max-w-sm">
                  Klik tombol &ldquo;Mulai Kamera&rdquo; untuk memindai kartu QR siswa secara langsung, atau masukkan NIS pada panel di samping.
                </p>
              </div>
            )}
          </div>

          {cameraError && (
            <div
              role="alert"
              className="flex items-start gap-3 p-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-xs"
            >
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
              <p>{cameraError}</p>
            </div>
          )}
        </section>

        {/* Right Column: Manual NIS Backup & Scan Feedback */}
        <div className="lg:col-span-5 space-y-6">
          {/* Manual Input Card */}
          <section className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                <Keyboard className="h-4 w-4" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Input NIS Manual
                </h2>
                <p className="text-xs text-slate-500">
                  Cadangan jika kamera tidak tersedia atau QR kartu rusak
                </p>
              </div>
            </div>

            <form onSubmit={handleManualSubmit} className="space-y-3">
              <div>
                <label
                  htmlFor="manual-nis-input"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Nomor Induk Siswa (NIS)
                </label>
                <div className="flex gap-2">
                  <input
                    id="manual-nis-input"
                    type="text"
                    value={manualNis}
                    onChange={(e) => setManualNis(e.target.value)}
                    placeholder="Contoh: 2026005"
                    className="flex-1 min-w-0 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-mono text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    {effectiveScanAction === 'pulang' ? 'Catat Pulang' : 'Catat Presensi'}
                  </button>
                </div>
              </div>
            </form>
          </section>

          {/* Forgot Card: Input Nama Berdasarkan Kelas */}
          <section className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                <UserCheck className="h-4 w-4" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Lupa Kartu? Input Nama per Kelas
                </h2>
                <p className="text-xs text-slate-500">
                  Pilih kelas lalu pilih nama siswa yang lupa membawa kartu tanda siswa
                </p>
              </div>
            </div>

            {uniqueClasses.length === 0 ? (
              <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200/70 rounded-xl px-3.5 py-3">
                Belum ada data siswa pada Tahun Ajaran {settings.tahun_ajaran}. Tambahkan atau import siswa terlebih dahulu di menu Data Siswa.
              </p>
            ) : (
              <form onSubmit={handleForgotCardSubmit} className="space-y-3">
                <div>
                  <label
                    htmlFor="forgot-card-class"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    1. Pilih Kelas
                  </label>
                  <select
                    id="forgot-card-class"
                    value={selectedClass}
                    onChange={(e) => {
                      setSelectedClass(e.target.value);
                      setSelectedStudentNis('');
                      setStudentNameQuery('');
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    <option value="">-- Pilih Kelas --</option>
                    {uniqueClasses.map((kelas) => {
                      const count = students.filter((s) => s.kelas.trim() === kelas).length;
                      return (
                        <option key={kelas} value={kelas}>
                          {kelas} ({count} siswa)
                        </option>
                      );
                    })}
                  </select>
                </div>

                {selectedClass && (
                  <>
                    <div>
                      <label
                        htmlFor="forgot-card-search"
                        className="block text-xs font-medium text-slate-700 mb-1.5"
                      >
                        Cari Nama di {selectedClass} (Opsional)
                      </label>
                      <div className="relative">
                        <Search
                          className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                          aria-hidden="true"
                        />
                        <input
                          id="forgot-card-search"
                          type="text"
                          value={studentNameQuery}
                          onChange={(e) => setStudentNameQuery(e.target.value)}
                          placeholder="Ketik sebagian nama siswa..."
                          className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                        />
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="forgot-card-student"
                        className="block text-xs font-medium text-slate-700 mb-1.5"
                      >
                        2. Pilih Nama Siswa
                      </label>
                      <select
                        id="forgot-card-student"
                        value={selectedStudentNis}
                        onChange={(e) => setSelectedStudentNis(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                      >
                        <option value="">
                          {studentsInSelectedClass.length === 0
                            ? 'Tidak ada siswa cocok dengan pencarian'
                            : `-- Pilih Nama Siswa (${studentsInSelectedClass.length}) --`}
                        </option>
                        {studentsInSelectedClass.map((s) => {
                          const rec = hasScannedOnDate(records, s.nis, today);
                          const statusHint = !rec
                            ? 'Belum Presensi'
                            : rec.jam_pulang && rec.jam_pulang !== '-'
                              ? `${rec.status} & Pulang (${rec.jam_pulang})`
                              : isDualMode &&
                                  (rec.status === 'Hadir' || rec.status === 'Terlambat')
                                ? `${rec.status} — Belum Pulang`
                                : rec.status;
                          return (
                            <option key={s.nis} value={s.nis}>
                              {s.nama} ({s.nis}) — {statusHint}
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    <button
                      type="submit"
                      disabled={!selectedStudentNis}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                    >
                      <UserCheck className="h-4 w-4" aria-hidden="true" />
                      <span>
                        {effectiveScanAction === 'pulang'
                          ? 'Catat Presensi Pulang Siswa'
                          : 'Catat Presensi Siswa (Tanpa Kartu)'}
                      </span>
                    </button>
                  </>
                )}
              </form>
            )}
          </section>

          {/* Latest Scan Result Feedback */}
          {lastOutcome && (
            <section
              aria-live="polite"
              data-testid="scan-result-card"
              className={`rounded-2xl border p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] ${
                lastOutcome.ok
                  ? lastOutcome.scanType === 'pulang'
                    ? 'bg-indigo-50/70 border-indigo-200'
                    : lastOutcome.record.status === 'Hadir'
                      ? 'bg-emerald-50/70 border-emerald-200'
                      : 'bg-amber-50/70 border-amber-200'
                  : lastOutcome.reason === 'duplicate' ||
                      lastOutcome.reason === 'duplicate_checkout' ||
                      lastOutcome.reason === 'before_checkout_time'
                    ? 'bg-amber-50/70 border-amber-200'
                    : 'bg-rose-50/70 border-rose-200'
              }`}
            >
              {lastOutcome.ok ? (
                <div className="flex items-start gap-3.5">
                  <div
                    className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
                      lastOutcome.scanType === 'pulang'
                        ? 'bg-indigo-100 text-indigo-700'
                        : lastOutcome.record.status === 'Hadir'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {lastOutcome.scanType === 'pulang' ? (
                      <LogOut className="h-5 w-5" aria-hidden="true" />
                    ) : lastOutcome.record.status === 'Hadir' ? (
                      <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                    ) : (
                      <Clock className="h-5 w-5" aria-hidden="true" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-slate-600">
                        {lastOutcome.scanType === 'pulang'
                          ? 'Presensi Pulang Dicatat'
                          : 'Presensi Masuk Dicatat'}
                      </p>
                      <StatusBadge status={lastOutcome.record.status} />
                    </div>
                    <p className="text-base font-bold text-slate-900 mt-1 truncate">
                      {lastOutcome.student.nama}
                    </p>
                    <p className="text-xs text-slate-600 mt-0.5 font-mono tabular-nums">
                      NIS {lastOutcome.student.nis} · {lastOutcome.student.kelas} ·{' '}
                      {lastOutcome.scanType === 'pulang'
                        ? `Pulang ${lastOutcome.record.jam_pulang}`
                        : `Masuk ${lastOutcome.record.jam_masuk}`}
                    </p>
                    {lastOutcome.scanType === 'pulang' &&
                      lastOutcome.record.alasan_pulang_cepat && (
                        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mt-2">
                          <span className="font-semibold">Pulang Cepat:</span>{' '}
                          {lastOutcome.record.alasan_pulang_cepat}
                        </p>
                      )}
                  </div>
                </div>
              ) : lastOutcome.reason === 'duplicate' ||
                lastOutcome.reason === 'duplicate_checkout' ||
                lastOutcome.reason === 'before_checkout_time' ? (
                <div className="flex items-start gap-3.5">
                  <div className="h-10 w-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                    <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-amber-900">
                      {lastOutcome.reason === 'duplicate_checkout'
                        ? 'Sudah Tercatat Masuk & Pulang'
                        : lastOutcome.reason === 'before_checkout_time'
                          ? 'Belum Memasuki Jam Pulang'
                          : 'Scan Ganda Ditolak'}
                    </p>
                    <div className="text-xs text-amber-800 mt-1">
                      {lastOutcome.reason === 'duplicate_checkout' ? (
                        <p>
                          {lastOutcome.student?.nama} sudah scan masuk ({lastOutcome.existingRecord?.jam_masuk}) dan pulang ({lastOutcome.existingRecord?.jam_pulang}) hari ini.
                        </p>
                      ) : lastOutcome.reason === 'before_checkout_time' ? (
                        <div className="space-y-2">
                          <p>
                            {lastOutcome.student?.nama} sudah tercatat masuk pukul{' '}
                            {lastOutcome.existingRecord?.jam_masuk}. Jadwal pulang standar dimulai pukul{' '}
                            <strong>{settings.jam_pulang_standar}</strong>. Konfirmasikan alasan pulang cepat jika siswa izin pulang lebih awal.
                          </p>
                          {lastOutcome.student && (
                            <button
                              type="button"
                              onClick={() =>
                                setPendingEarlyCheckout({
                                  student: {
                                    nis: lastOutcome.student!.nis,
                                    nama: lastOutcome.student!.nama,
                                    kelas: lastOutcome.student!.kelas,
                                    jamMasuk: lastOutcome.existingRecord?.jam_masuk,
                                  },
                                  source: 'manual',
                                })
                              }
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 transition-colors"
                            >
                              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Konfirmasi Alasan Pulang Cepat</span>
                            </button>
                          )}
                        </div>
                      ) : (
                        <p>
                          {lastOutcome.student?.nama} (NIS{' '}
                          <span className="font-mono tabular-nums">{lastOutcome.nis}</span>) sudah tercatat{' '}
                          <span className="font-semibold">{lastOutcome.existingRecord?.status}</span> hari ini
                          {lastOutcome.existingRecord?.jam_masuk &&
                          lastOutcome.existingRecord.jam_masuk !== '-'
                            ? ` pada pukul ${lastOutcome.existingRecord.jam_masuk}`
                            : ''}
                          .
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3.5">
                  <div className="h-10 w-10 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                    <XCircle className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-rose-900">
                      {lastOutcome.reason === 'invalid_qr'
                        ? 'Format QR Tidak Valid'
                        : lastOutcome.reason === 'not_checked_in'
                          ? 'Belum Scan Masuk Hari Ini'
                          : 'Siswa Tidak Ditemukan'}
                    </p>
                    <p className="text-xs text-rose-800 mt-1">
                      {lastOutcome.reason === 'invalid_qr'
                        ? 'QR Code kosong atau tidak terbaca.'
                        : lastOutcome.reason === 'not_checked_in'
                          ? `${lastOutcome.student?.nama} belum melakukan scan masuk hari ini.`
                          : `NIS "${lastOutcome.nis}" belum terdaftar di menu Data Siswa.`}
                    </p>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      {/* Today's Scan Log */}
      <section className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Log Presensi Hari Ini
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
              {todayRecords.length} siswa tercatat pada {today}
            </p>
          </div>
        </div>

        {todayRecords.length === 0 ? (
          <p className="text-sm text-slate-500 py-6 text-center">
            Belum ada catatan presensi pada hari ini.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                  <th className="py-2.5 pr-4">Jam Masuk</th>
                  {showCheckoutColumn && <th className="py-2.5 px-4">Jam Pulang</th>}
                  <th className="py-2.5 px-4">NIS</th>
                  <th className="py-2.5 px-4">Nama Siswa</th>
                  <th className="py-2.5 px-4">Kelas</th>
                  <th className="py-2.5 pl-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {todayRecords.map((rec) => (
                  <tr key={rec.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-2.5 pr-4 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                      {rec.jam_masuk}
                    </td>
                    {showCheckoutColumn && (
                      <td className="py-2.5 px-4 text-xs text-slate-600">
                        <div className="font-mono tabular-nums whitespace-nowrap">
                          {rec.jam_pulang || '-'}
                        </div>
                        {rec.alasan_pulang_cepat && (
                          <div className="text-[11px] text-amber-700 font-medium mt-0.5 max-w-[220px] truncate" title={rec.alasan_pulang_cepat}>
                            Pulang cepat: {rec.alasan_pulang_cepat}
                          </div>
                        )}
                      </td>
                    )}
                    <td className="py-2.5 px-4 font-mono tabular-nums text-xs font-medium text-slate-800 whitespace-nowrap">
                      {rec.nis}
                    </td>
                    <td className="py-2.5 px-4 font-medium text-slate-900">{rec.nama}</td>
                    <td className="py-2.5 px-4 text-slate-600 whitespace-nowrap">{rec.kelas}</td>
                    <td className="py-2.5 pl-4 text-right">
                      <StatusBadge status={rec.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <EarlyCheckoutModal
        open={Boolean(pendingEarlyCheckout)}
        student={pendingEarlyCheckout?.student ?? null}
        jamPulangStandar={settings.jam_pulang_standar}
        onCancel={() => setPendingEarlyCheckout(null)}
        onConfirm={handleConfirmEarlyCheckout}
      />
    </div>
  );
}
