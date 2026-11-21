import { useEffect, useState, type ReactNode } from 'react';
import {
  LayoutDashboard,
  QrCode,
  Users,
  ClipboardList,
  Settings,
  RefreshCw,
  Cloud,
  CloudOff,
  AlertTriangle,
  CheckCircle2,
  X,
  Lock,
  LogIn,
  LogOut,
  Maximize2,
  Minimize2,
  BarChart3,
  ArrowUp,
  BookOpen,
  CalendarDays,
} from 'lucide-react';
import type {
  AuthSession,
  ConnectionStatus,
  SchoolSettings,
  TabId,
  ToastMessage,
} from '../types';
import { canAccessTab } from '../utils/auth';
import { formatSemesterLabel } from '../utils/subjectAttendance';

interface LayoutShellProps {
  activeTab: TabId;
  onSelectTab: (tab: TabId) => void;
  settings: SchoolSettings;
  session: AuthSession | null;
  onOpenLogin: () => void;
  onLogout: () => void;
  connectionStatus: ConnectionStatus;
  lastSyncedAt: string | null;
  onSyncNow: () => void;
  toasts: ToastMessage[];
  onDismissToast: (id: string) => void;
  children: ReactNode;
}

const NAV_ITEMS: Array<{
  id: TabId;
  label: string;
  shortLabel: string;
  Icon: typeof LayoutDashboard;
  masterOnly?: boolean;
}> = [
  { id: 'scan', label: 'Scan QR', shortLabel: 'Scan', Icon: QrCode },
  { id: 'dashboard', label: 'Dashboard', shortLabel: 'Beranda', Icon: LayoutDashboard },
  { id: 'siswa', label: 'Data Siswa', shortLabel: 'Siswa', Icon: Users },
  { id: 'rekap', label: 'Rekap & Export', shortLabel: 'Rekap', Icon: ClipboardList },
  { id: 'mapel', label: 'Presensi Mapel', shortLabel: 'Mapel', Icon: BookOpen },
  {
    id: 'jadwal',
    label: 'Mapel & Jadwal',
    shortLabel: 'Jadwal',
    Icon: CalendarDays,
    masterOnly: true,
  },
  { id: 'analisis', label: 'Analisis', shortLabel: 'Analisis', Icon: BarChart3 },
  { id: 'pengaturan', label: 'Pengaturan', shortLabel: 'Setelan', Icon: Settings },
];

const TAB_TITLES: Record<TabId, { title: string; subtitle: string }> = {
  dashboard: {
    title: 'Ringkasan Presensi',
    subtitle: 'Pantau kehadiran harian dan aktivitas scan kartu siswa',
  },
  scan: {
    title: 'Pemindai Kartu Siswa',
    subtitle: 'Scan QR Code kamera atau masukkan NIS siswa secara manual',
  },
  siswa: {
    title: 'Data Siswa & E-Card',
    subtitle: 'Kelola daftar siswa, import Excel/CSV, tandai data, dan cetak E-Card PDF',
  },
  rekap: {
    title: 'Rekap, Export & Notifikasi Ortu',
    subtitle: 'Filter kehadiran harian, cek siswa tidak hadir, export Excel, dan kirim ke orang tua',
  },
  mapel: {
    title: 'Presensi Kehadiran Mata Pelajaran',
    subtitle: 'Rekap dan presensi masuk siswa per mata pelajaran sesuai jadwal harian',
  },
  jadwal: {
    title: 'Mapel & Jadwal Pelajaran',
    subtitle: 'Kelola daftar mata pelajaran sekolah dan jadwal mengajar guru per hari',
  },
  analisis: {
    title: 'Analisis Kehadiran Siswa',
    subtitle: 'Pantau persentase kehadiran harian, mingguan, bulanan, semester, dan tahunan seluruh siswa',
  },
  pengaturan: {
    title: 'Pengaturan Sistem',
    subtitle: 'Konfigurasi Google Apps Script, tahun ajaran, semester, tema aplikasi, jadwal scan QR, dan akun login',
  },
};

function ConnectionPill({
  status,
  lastSyncedAt,
}: {
  status: ConnectionStatus;
  lastSyncedAt: string | null;
}) {
  if (status === 'syncing') {
    return (
      <div
        role="status"
        className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 whitespace-nowrap shrink-0"
      >
        <RefreshCw className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden="true" />
        <span>Sinkronisasi...</span>
      </div>
    );
  }

  if (status === 'connected') {
    return (
      <div
        role="status"
        title={lastSyncedAt ? `Terakhir sinkron pukul ${lastSyncedAt}` : 'Terhubung ke Google Sheets'}
        className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap shrink-0"
      >
        <Cloud className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="hidden sm:inline">Terhubung ke Google Sheets</span>
        <span className="sm:hidden">Sheets Aktif</span>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div
        role="status"
        className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 whitespace-nowrap shrink-0"
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="hidden sm:inline">Gagal Sinkron (Cache Lokal)</span>
        <span className="sm:hidden">Gagal Sinkron</span>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 whitespace-nowrap shrink-0"
    >
      <CloudOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="hidden sm:inline">Mode Offline/Cache</span>
      <span className="sm:hidden">Offline</span>
    </div>
  );
}

export function LayoutShell({
  activeTab,
  onSelectTab,
  settings,
  session,
  onOpenLogin,
  onLogout,
  connectionStatus,
  lastSyncedAt,
  onSyncNow,
  toasts,
  onDismissToast,
  children,
}: LayoutShellProps) {
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() =>
    typeof document !== 'undefined' ? Boolean(document.fullscreenElement) : false
  );
  const [showScrollTop, setShowScrollTop] = useState<boolean>(false);

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    function handleScroll() {
      setShowScrollTop(window.scrollY > 180);
    }
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  function handleScrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleToggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        if (document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
        }
      } else if (document.exitFullscreen) {
        await document.exitFullscreen();
      }
    } catch {
      // Ignore fullscreen browser policy restrictions
    }
  }

  const currentRole = session?.role ?? null;
  const isKepalaSekolah = currentRole === 'kepala_sekolah';
  const baseHeaderInfo = TAB_TITLES[activeTab];
  const headerInfo =
    isKepalaSekolah && activeTab === 'siswa'
      ? {
          title: 'Data Siswa',
          subtitle: 'Daftar siswa aktif per kelas (mode pantau Kepala Sekolah)',
        }
      : isKepalaSekolah && activeTab === 'rekap'
        ? {
            title: 'Rekap Kehadiran',
            subtitle: 'Pantau rekap kehadiran harian, mingguan, bulanan, dan semester',
          }
        : baseHeaderInfo;
  const visibleNavItems = NAV_ITEMS.filter((item) => {
    if (isKepalaSekolah) {
      return canAccessTab('kepala_sekolah', item.id);
    }
    return !item.masterOnly || currentRole === 'master_admin';
  }).map((item) =>
    isKepalaSekolah && item.id === 'rekap'
      ? { ...item, label: 'Rekap', shortLabel: 'Rekap' }
      : item
  );

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 flex">
      {/* Desktop Sidebar */}
      <aside
        aria-label="Navigasi utama"
        className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 bg-white border-r border-slate-200/90 z-30"
      >
        <div className="h-16 px-5 flex items-center gap-3 border-b border-slate-200/80">
          <div className="h-9 w-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 overflow-hidden">
            {settings.logo_sekolah ? (
              <img
                src={settings.logo_sekolah}
                alt={`Logo ${settings.nama_sekolah}`}
                className="h-full w-full object-contain bg-white p-0.5 rounded-xl border border-slate-200"
              />
            ) : (
              <QrCode className="h-5 w-5" aria-hidden="true" />
            )}
          </div>
          <span className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
            PresensiQR
          </span>
        </div>

        <nav className="flex-1 px-3 py-5 space-y-1 overflow-y-auto">
          {visibleNavItems.map(({ id, label, Icon }) => {
            const isActive = activeTab === id;
            const allowed = canAccessTab(currentRole, id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelectTab(id)}
                aria-current={isActive ? 'page' : undefined}
                className={`w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700'
                    : allowed
                      ? 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                      : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'
                }`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <Icon
                    className={`h-4.5 w-4.5 shrink-0 ${
                      isActive
                        ? 'text-indigo-600'
                        : allowed
                          ? 'text-slate-400'
                          : 'text-slate-300'
                    }`}
                    aria-hidden="true"
                  />
                  <span className="truncate">{label}</span>
                </span>
                {!allowed && (
                  <Lock className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 pb-5 border-t border-slate-200/80 space-y-3">
          {session ? (
            <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3 space-y-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-900 truncate">
                  {session.nama}
                </p>
                <p className="text-[11px] text-indigo-700 font-medium truncate">
                  {session.jabatan}
                </p>
              </div>
              <button
                type="button"
                onClick={onLogout}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:text-rose-700 hover:border-rose-200 hover:bg-rose-50 transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Keluar</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onOpenLogin}
              className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors"
            >
              <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Login</span>
            </button>
          )}

          <div className="space-y-1">
            <p className="text-xs font-semibold text-slate-900 truncate" title={settings.nama_sekolah}>
              {settings.nama_sekolah}
            </p>
            <p className="text-[11px] font-mono text-indigo-700 font-medium">
              TA {settings.tahun_ajaran} · Smt {formatSemesterLabel(settings.semester)}
            </p>
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <span>Masuk</span>
              <span className="font-mono tabular-nums font-medium text-slate-700">
                {settings.batas_jam_masuk}
              </span>
              {settings.mode_presensi === 'masuk_pulang' && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Pulang</span>
                  <span className="font-mono tabular-nums font-medium text-slate-700">
                    {settings.jam_pulang_standar}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="sticky top-0 z-20 h-14 lg:h-16 bg-white/95 backdrop-blur-sm border-b border-slate-200/80 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-3">
            <div className="lg:hidden h-8 w-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0 overflow-hidden">
              {settings.logo_sekolah ? (
                <img
                  src={settings.logo_sekolah}
                  alt={`Logo ${settings.nama_sekolah}`}
                  className="h-full w-full object-contain bg-white p-0.5 rounded-lg"
                />
              ) : (
                <QrCode className="h-4.5 w-4.5" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-semibold text-slate-900 truncate">
                {headerInfo.title}
              </h1>
              <p className="hidden md:block text-xs text-slate-500 truncate">
                {headerInfo.subtitle}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <ConnectionPill status={connectionStatus} lastSyncedAt={lastSyncedAt} />
            <button
              type="button"
              onClick={onSyncNow}
              disabled={connectionStatus === 'syncing'}
              aria-label="Sinkronkan data dengan Google Sheets"
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 shrink-0 ${
                  connectionStatus === 'syncing' ? 'animate-spin' : ''
                }`}
                aria-hidden="true"
              />
              <span className="hidden sm:inline">Sinkronkan</span>
            </button>

            {/* Top-right Fullscreen Button */}
            <button
              type="button"
              onClick={handleToggleFullscreen}
              aria-label={isFullscreen ? 'Keluar dari layar penuh' : 'Aktifkan layar penuh'}
              title={isFullscreen ? 'Keluar Layar Penuh' : 'Layar Penuh'}
              className="inline-flex items-center justify-center p-2 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              {isFullscreen ? (
                <Minimize2 className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Maximize2 className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </header>

        {/* Page Viewport */}
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 pb-24 lg:pb-8 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <nav
        aria-label="Navigasi seluler"
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 px-1 py-1 flex items-center gap-0.5 overflow-x-auto"
      >
        {visibleNavItems.map(({ id, shortLabel, Icon }) => {
          const isActive = activeTab === id;
          const allowed = canAccessTab(currentRole, id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelectTab(id)}
              aria-current={isActive ? 'page' : undefined}
              className={`relative flex-1 min-w-[52px] flex flex-col items-center justify-center min-h-[46px] rounded-lg text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                isActive
                  ? 'text-indigo-600 bg-indigo-50/70'
                  : allowed
                    ? 'text-slate-500 hover:text-slate-900'
                    : 'text-slate-400'
              }`}
            >
              <Icon className="h-4 w-4 mb-0.5 shrink-0" aria-hidden="true" />
              <span className="truncate max-w-full px-0.5">{shortLabel}</span>
              {!allowed && (
                <Lock className="h-2.5 w-2.5 absolute top-1.5 right-1.5 text-slate-400" aria-hidden="true" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Mobile Bottom-Left Login / Logout Action */}
      <div className="lg:hidden fixed bottom-[62px] left-3 z-30">
        {session ? (
          <button
            type="button"
            onClick={onLogout}
            aria-label="Keluar dari sesi login"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white/95 backdrop-blur-sm shadow-md text-xs font-semibold text-slate-700 hover:text-rose-700"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Keluar</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onOpenLogin}
            aria-label="Login ke aplikasi"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 text-white shadow-md text-xs font-semibold hover:bg-indigo-700"
          >
            <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Login</span>
          </button>
        )}
      </div>

      {/* Auto Scroll-to-Top Button (Bottom Right) */}
      {showScrollTop && (
        <button
          type="button"
          onClick={handleScrollToTop}
          aria-label="Gulir ke atas"
          title="Gulir ke atas"
          className="fixed bottom-[64px] lg:bottom-6 right-4 lg:right-6 z-30 h-11 w-11 rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/25 hover:bg-indigo-700 active:scale-95 transition-all flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          <ArrowUp className="h-5 w-5" aria-hidden="true" />
        </button>
      )}

      {/* Toast Notifications */}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          className={`fixed right-4 z-50 flex flex-col gap-2 w-[calc(100%-2rem)] max-w-sm pointer-events-none ${
            showScrollTop ? 'bottom-32 lg:bottom-20' : 'bottom-20 lg:bottom-6'
          }`}
        >
          {toasts.map((toast) => {
            const styles =
              toast.type === 'success'
                ? 'border-emerald-200 bg-white text-slate-900'
                : toast.type === 'warning'
                  ? 'border-amber-200 bg-white text-slate-900'
                  : toast.type === 'error'
                    ? 'border-rose-200 bg-white text-slate-900'
                    : 'border-indigo-200 bg-white text-slate-900';
            const iconColor =
              toast.type === 'success'
                ? 'text-emerald-600'
                : toast.type === 'warning'
                  ? 'text-amber-600'
                  : toast.type === 'error'
                    ? 'text-rose-600'
                    : 'text-indigo-600';

            return (
              <div
                key={toast.id}
                role="alert"
                className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-2xl border shadow-lg ${styles}`}
              >
                {toast.type === 'success' ? (
                  <CheckCircle2 className={`h-5 w-5 shrink-0 mt-0.5 ${iconColor}`} aria-hidden="true" />
                ) : (
                  <AlertTriangle className={`h-5 w-5 shrink-0 mt-0.5 ${iconColor}`} aria-hidden="true" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{toast.title}</p>
                  {toast.description && (
                    <p className="text-xs text-slate-600 mt-0.5">{toast.description}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onDismissToast(toast.id)}
                  aria-label="Tutup notifikasi"
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
