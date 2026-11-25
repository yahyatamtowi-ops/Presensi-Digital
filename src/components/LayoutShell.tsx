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
  BookOpenCheck,
  CalendarDays,
  CalendarRange,
  Volume2,
  WifiOff,
  Bell,
  User,
} from 'lucide-react';
import type {
  AuthSession,
  ConnectionStatus,
  LateCorrectionRequest,
  SchoolSettings,
  TabId,
  ToastMessage,
} from '../types';
import { canAccessTab } from '../utils/auth';
import { DEFAULT_APP_NAME, DEFAULT_SCHOOL_LOGO } from '../utils/seedData';
import { formatSemesterLabel } from '../utils/subjectAttendance';
import { AdminNotificationBar, AdminStorageAlertBanner } from './AdminNotificationBar';
import type { StorageAlertItem } from '../utils/storageHealth';

interface CloudSyncUiState {
  connected: boolean;
  syncing: boolean;
  email: string | null;
  onConnect: () => void;
}

interface LayoutShellProps {
  activeTab: TabId;
  onSelectTab: (tab: TabId) => void;
  settings: SchoolSettings;
  session: AuthSession | null;
  onOpenLogin: () => void;
  onLogout: () => void;
  connectionStatus: ConnectionStatus;
  isOnline?: boolean;
  pendingSyncCount?: number;
  lastSyncedAt: string | null;
  onSyncNow: () => void;
  onReplayVoice?: () => void;
  cloudSync?: CloudSyncUiState;
  pendingLateRequests?: LateCorrectionRequest[];
  onApproveLateRequest?: (requestId: string) => void;
  onRejectLateRequest?: (requestId: string) => void;
  storageAlerts?: StorageAlertItem[];
  onOpenStorageBackup?: () => void;
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
  teacherOnly?: boolean;
}> = [
  { id: 'scan', label: 'Scan QR', shortLabel: 'Scan', Icon: QrCode },
  { id: 'dashboard', label: 'Dashboard', shortLabel: 'Beranda', Icon: LayoutDashboard },
  { id: 'siswa', label: 'Data Siswa', shortLabel: 'Siswa', Icon: Users },
  { id: 'rekap', label: 'Rekap & Export', shortLabel: 'Rekap', Icon: ClipboardList },
  {
    id: 'daftar_pelajaran',
    label: 'Daftar Pelajaran',
    shortLabel: 'Pelajaran',
    Icon: BookOpenCheck,
    teacherOnly: true,
  },
  { id: 'mapel', label: 'Presensi Mapel', shortLabel: 'Mapel', Icon: BookOpen },
  {
    id: 'jadwal',
    label: 'Mapel & Jadwal',
    shortLabel: 'Jadwal',
    Icon: CalendarDays,
    masterOnly: true,
  },
  {
    id: 'pengaturan_jadwal',
    label: 'Pengaturan Jadwal',
    shortLabel: 'Atur Jadwal',
    Icon: CalendarRange,
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
    subtitle: 'Scan QR Code kamera, input NISN manual, atau cari nama siswa per kelas',
  },
  siswa: {
    title: 'Data Siswa & E-Card',
    subtitle: 'Kelola daftar siswa, import Excel/CSV, tandai data, dan cetak E-Card PDF',
  },
  rekap: {
    title: 'Rekap, Export & Notifikasi Ortu',
    subtitle: 'Filter kehadiran harian, cek siswa tidak hadir, export Excel, dan kirim ke orang tua',
  },
  daftar_pelajaran: {
    title: 'Daftar Pelajaran',
    subtitle: 'Jadwal mengajar mata pelajaran Anda sesuai hari/tanggal atau filter hari',
  },
  mapel: {
    title: 'Presensi Kehadiran Mata Pelajaran',
    subtitle: 'Rekap dan presensi masuk siswa per mata pelajaran sesuai jadwal harian',
  },
  jadwal: {
    title: 'Mapel & Jadwal Pelajaran',
    subtitle: 'Kelola daftar mata pelajaran sekolah dan jadwal mengajar guru per hari',
  },
  pengaturan_jadwal: {
    title: 'Pengaturan Jadwal Mata Pelajaran',
    subtitle: 'Atur jadwal pelajaran guru dalam bentuk tabel per hari, jam ke, waktu, istirahat manual, dan kelas',
  },
  analisis: {
    title: 'Analisis Kehadiran Siswa',
    subtitle: 'Pantau persentase kehadiran harian, mingguan, bulanan, semester, dan tahunan seluruh siswa',
  },
  pengaturan: {
    title: 'Pengaturan Sistem',
    subtitle: 'Konfigurasi Cloud Firebase, Google Sheets, tahun ajaran, semester, tema aplikasi, jadwal scan QR, dan akun login',
  },
};

function ConnectionPill({
  status,
  isOnline = true,
  pendingSyncCount = 0,
  lastSyncedAt,
  cloudSync,
}: {
  status: ConnectionStatus;
  isOnline?: boolean;
  pendingSyncCount?: number;
  lastSyncedAt: string | null;
  cloudSync?: CloudSyncUiState;
}) {
  if (!isOnline) {
    return (
      <div
        role="status"
        data-testid="header-offline-pill"
        title="Koneksi internet terputus. Presensi disimpan secara offline dan akan tersinkron otomatis saat terhubung kembali."
        className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 whitespace-nowrap shrink-0"
      >
        <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          {pendingSyncCount > 0 ? `Offline · ${pendingSyncCount} Antrean` : 'Mode Offline'}
        </span>
      </div>
    );
  }

  if (cloudSync?.syncing || status === 'syncing') {
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

  if (pendingSyncCount > 0) {
    return (
      <div
        role="status"
        data-testid="header-pending-pill"
        title={`${pendingSyncCount} data presensi/perubahan offline menunggu disinkronkan`}
        className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 whitespace-nowrap shrink-0"
      >
        <RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="font-mono tabular-nums">{pendingSyncCount} Antrean Offline</span>
      </div>
    );
  }

  if (cloudSync?.connected) {
    const bothActive = status === 'connected';
    return (
      <div
        role="status"
        data-testid="header-cloud-active-pill"
        title={
          lastSyncedAt
            ? `Sinkronisasi otomatis Firebase${bothActive ? ' & Google Sheets' : ''} aktif · Terakhir sinkron pukul ${lastSyncedAt}`
            : `Sinkronisasi otomatis Firebase${bothActive ? ' & Google Sheets' : ''} aktif`
        }
        className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap shrink-0"
      >
        <Cloud className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="hidden sm:inline">
          {bothActive ? 'Cloud & Sheets Aktif' : 'Cloud Aktif (Otomatis)'}
        </span>
        <span className="sm:hidden">Cloud Aktif</span>
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
      title="Mode Lokal"
      aria-label="Mode Lokal"
      className="inline-flex items-center gap-1.5 sm:gap-2 rounded-lg border border-slate-200 bg-slate-100 px-2 sm:px-3 py-1.5 text-xs font-medium text-slate-600 whitespace-nowrap shrink-0"
    >
      <CloudOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="hidden sm:inline">Mode Lokal</span>
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
  isOnline = true,
  pendingSyncCount = 0,
  lastSyncedAt,
  onSyncNow,
  onReplayVoice,
  cloudSync,
  pendingLateRequests = [],
  onApproveLateRequest,
  onRejectLateRequest,
  storageAlerts = [],
  onOpenStorageBackup,
  toasts,
  onDismissToast,
  children,
}: LayoutShellProps) {
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() =>
    typeof document !== 'undefined' ? Boolean(document.fullscreenElement) : false
  );
  const [showScrollTop, setShowScrollTop] = useState<boolean>(false);
  const [notifBarExpanded, setNotifBarExpanded] = useState<boolean>(false);

  useEffect(() => {
    function handleFullscreenChange() {
      const doc = document as Document & { webkitFullscreenElement?: Element | null };
      setIsFullscreen(Boolean(document.fullscreenElement || doc.webkitFullscreenElement));
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
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
      const doc = document as Document & {
        webkitFullscreenElement?: Element | null;
        webkitExitFullscreen?: () => Promise<void> | void;
      };
      const el = document.documentElement as HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void> | void;
      };
      const activeFs = document.fullscreenElement || doc.webkitFullscreenElement;
      if (!activeFs) {
        if (el.requestFullscreen) {
          await el.requestFullscreen();
        } else if (el.webkitRequestFullscreen) {
          await el.webkitRequestFullscreen();
        }
      } else if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (doc.webkitExitFullscreen) {
        await doc.webkitExitFullscreen();
      }
    } catch {
      // Ignore fullscreen browser policy restrictions
    }
  }

  const currentRole = session?.role ?? null;
  const showMenuBar = Boolean(session);
  const showCreatorCredit = settings.show_creator_credit !== false;
  const totalAdminAlertCount = pendingLateRequests.length + storageAlerts.length;
  const isKepalaSekolah = currentRole === 'kepala_sekolah';
  const showRoleProfilePhoto =
    currentRole === 'guru' ||
    currentRole === 'wali_kelas' ||
    currentRole === 'kepala_sekolah';
  const baseHeaderInfo = TAB_TITLES[activeTab];
  const headerInfo =
    activeTab === 'pengaturan' && showRoleProfilePhoto
      ? {
          title: 'Pengaturan Profil',
          subtitle: 'Upload atau perbarui foto profil akun Anda',
        }
      : isKepalaSekolah && activeTab === 'siswa'
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
    if (item.teacherOnly) {
      return currentRole === 'guru' || currentRole === 'wali_kelas';
    }
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
      {/* Desktop Sidebar (hidden on initial unauthenticated Scan QR view for wider canvas) */}
      {showMenuBar && (
        <aside
          aria-label="Navigasi utama"
          className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 bg-white border-r border-slate-200/90 z-30"
        >
        <div className="h-16 px-5 flex items-center gap-3 border-b border-slate-200/80">
          <div className="h-9 w-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center shrink-0 overflow-hidden p-0.5">
            <img
              src={settings.logo_sekolah || DEFAULT_SCHOOL_LOGO}
              alt={`Logo ${settings.nama_sekolah}`}
              className="h-full w-full object-contain rounded-lg"
            />
          </div>
          <span className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
            {DEFAULT_APP_NAME}
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
            <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3 space-y-2.5">
              {showRoleProfilePhoto && (
                <div className="flex justify-center pt-0.5">
                  <button
                    type="button"
                    onClick={() => onSelectTab('pengaturan')}
                    title="Ubah Foto Profil di Pengaturan"
                    aria-label={`Foto profil ${session.nama}`}
                    data-testid="sidebar-profile-avatar-btn"
                    className="group relative rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 cursor-pointer"
                  >
                    {session.foto_profil ? (
                      <img
                        src={session.foto_profil}
                        alt={`Foto profil ${session.nama}`}
                        data-testid="sidebar-profile-photo"
                        className="h-16 w-16 rounded-full object-cover border-2 border-indigo-200 shadow-xs bg-white group-hover:border-indigo-400 transition-colors"
                      />
                    ) : (
                      <div
                        data-testid="sidebar-profile-placeholder"
                        className="h-16 w-16 rounded-full bg-indigo-50 border-2 border-indigo-200 text-indigo-600 flex items-center justify-center shadow-xs group-hover:border-indigo-400 transition-colors"
                      >
                        <User className="h-7 w-7 opacity-80" aria-hidden="true" />
                      </div>
                    )}
                  </button>
                </div>
              )}
              <div className={`min-w-0 ${showRoleProfilePhoto ? 'text-center' : ''}`}>
                <p
                  data-testid="sidebar-profile-name"
                  className="text-xs font-semibold text-slate-900 truncate"
                >
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

          {showCreatorCredit && (
            <div
              data-testid="menu-bar-creator-credit"
              className="pt-2.5 border-t border-slate-200/80 text-[11px] text-slate-500 leading-snug"
            >
              Application Created By:{' '}
              <span className="font-semibold text-slate-700">Tamtowi Yahya</span>
            </div>
          )}
        </div>
      </aside>
      )}

      {/* Main Content Area */}
      <div className={`flex-1 flex flex-col min-w-0 ${showMenuBar ? 'lg:pl-64' : ''}`}>
        {/* Sticky Top Bar + Mobile/Tablet Top Navigation */}
        <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-slate-200/80">
          <header className="h-12 sm:h-14 lg:h-16 px-3 sm:px-6 lg:px-8 flex items-center justify-between gap-2 sm:gap-3">
            <div className="min-w-0 flex items-center gap-2.5 sm:gap-3">
              <div
                className={`${
                  showMenuBar ? 'lg:hidden' : ''
                } h-7 w-7 sm:h-8 sm:w-8 lg:h-9 lg:w-9 rounded-lg sm:rounded-xl bg-white border border-slate-200 flex items-center justify-center shrink-0 overflow-hidden p-0.5`}
              >
                <img
                  src={settings.logo_sekolah || DEFAULT_SCHOOL_LOGO}
                  alt={`Logo ${settings.nama_sekolah}`}
                  className="h-full w-full object-contain rounded-md"
                />
              </div>
              <div className="min-w-0">
                <h1 className="text-sm sm:text-lg font-semibold text-slate-900 truncate">
                  {showMenuBar ? headerInfo.title : DEFAULT_APP_NAME}
                </h1>
                <p className="hidden md:block text-xs text-slate-500 truncate">
                  {showMenuBar
                    ? headerInfo.subtitle
                    : `${settings.nama_sekolah} · TA ${settings.tahun_ajaran} · Semester ${formatSemesterLabel(settings.semester)}`}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <ConnectionPill
                status={connectionStatus}
                isOnline={isOnline}
                pendingSyncCount={pendingSyncCount}
                lastSyncedAt={lastSyncedAt}
                cloudSync={cloudSync}
              />
              <button
                type="button"
                onClick={onSyncNow}
                disabled={connectionStatus === 'syncing' || cloudSync?.syncing}
                aria-label="Segarkan sinkronisasi data"
                title="Sinkronisasi berjalan otomatis. Klik jika ingin menyegarkan ulang sekarang."
                className="inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 shrink-0 ${
                    connectionStatus === 'syncing' || cloudSync?.syncing ? 'animate-spin' : ''
                  }`}
                  aria-hidden="true"
                />
                <span className="hidden sm:inline">Segarkan</span>
              </button>

              {/* Master Admin Notification Bell for Wali Kelas Requests & Storage Alerts */}
              {currentRole === 'master_admin' &&
                onApproveLateRequest &&
                onRejectLateRequest && (
                  <button
                    type="button"
                    data-testid="admin-notif-bell"
                    onClick={() => {
                      setNotifBarExpanded((prev) => !prev);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    aria-label={
                      totalAdminAlertCount > 0
                        ? `${totalAdminAlertCount} notifikasi aktif menunggu perhatian Master Admin`
                        : 'Buka notifikasi Master Admin'
                    }
                    title={
                      totalAdminAlertCount > 0
                        ? `${totalAdminAlertCount} notifikasi aktif (${pendingLateRequests.length} permohonan, ${storageAlerts.length} peringatan storage)`
                        : 'Notifikasi Master Admin'
                    }
                    className={`relative inline-flex items-center justify-center p-1.5 sm:p-2 rounded-lg border transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                      totalAdminAlertCount > 0
                        ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-indigo-700'
                    }`}
                  >
                    <Bell className="h-4 w-4" aria-hidden="true" />
                    {totalAdminAlertCount > 0 && (
                      <span
                        data-testid="admin-notif-bell-badge"
                        className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold font-mono tabular-nums flex items-center justify-center shadow-xs"
                      >
                        {totalAdminAlertCount}
                      </span>
                    )}
                  </button>
                )}

              {/* Top-right Voice Activation / Test Button (especially helpful on Tablet & HP) */}
              {onReplayVoice && (
                <button
                  type="button"
                  data-testid="btn-replay-voice"
                  onClick={onReplayVoice}
                  aria-label="Aktifkan atau putar suara sambutan perempuan"
                  title="Aktifkan / Putar Suara"
                  className="inline-flex items-center justify-center p-1.5 sm:p-2 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-indigo-700 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <Volume2 className="h-4 w-4" aria-hidden="true" />
                </button>
              )}

              {/* Top-right Fullscreen Button (always visible on HP, Tablet, and Desktop) */}
              <button
                type="button"
                data-testid="btn-fullscreen"
                onClick={handleToggleFullscreen}
                aria-label={isFullscreen ? 'Keluar dari layar penuh' : 'Aktifkan layar penuh'}
                title={isFullscreen ? 'Keluar Layar Penuh' : 'Layar Penuh'}
                className="inline-flex items-center justify-center p-1.5 sm:p-2 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                {isFullscreen ? (
                  <Minimize2 className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Maximize2 className="h-4 w-4" aria-hidden="true" />
                )}
              </button>

              {/* Header Login / Logout Action (Login shown on all viewports when sidebar is hidden; Logout shown on Mobile/Tablet) */}
              <div className={`${showMenuBar ? 'lg:hidden' : ''} flex items-center gap-1.5 shrink-0`}>
                {session && showRoleProfilePhoto && (
                  <button
                    type="button"
                    onClick={() => onSelectTab('pengaturan')}
                    title={`${session.nama} · Ubah Foto Profil`}
                    aria-label={`Foto profil ${session.nama}`}
                    className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 shrink-0"
                  >
                    {session.foto_profil ? (
                      <img
                        src={session.foto_profil}
                        alt={`Foto profil ${session.nama}`}
                        className="h-7 w-7 sm:h-8 sm:w-8 rounded-full object-cover border border-indigo-200 bg-white"
                      />
                    ) : (
                      <span className="h-7 w-7 sm:h-8 sm:w-8 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-600 flex items-center justify-center">
                        <User className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                    )}
                  </button>
                )}
                {session ? (
                  <button
                    type="button"
                    onClick={onLogout}
                    aria-label="Keluar dari sesi login"
                    title={`Keluar (${session.nama})`}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:text-rose-700 hover:border-rose-200 hover:bg-rose-50 transition-colors whitespace-nowrap"
                  >
                    <LogOut className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="hidden sm:inline">Keluar</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid="header-login-btn"
                    onClick={onOpenLogin}
                    aria-label="Login ke aplikasi"
                    className="inline-flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors whitespace-nowrap"
                  >
                    <LogIn className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>Login</span>
                  </button>
                )}
              </div>
            </div>
          </header>

          {/* Mobile & Tablet Top Navigation Bar (shown only after login; hidden on initial Scan QR view) */}
          {showMenuBar && (
            <nav
              aria-label="Navigasi seluler"
              data-testid="mobile-top-nav"
              className="lg:hidden border-t border-slate-100 bg-white/95 px-2.5 sm:px-5 py-1.5 flex items-center gap-1 overflow-x-auto"
            >
              {visibleNavItems.map(({ id, label, shortLabel, Icon }) => {
                const isActive = activeTab === id;
                const allowed = canAccessTab(currentRole, id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onSelectTab(id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 min-h-[34px] rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                      isActive
                        ? 'text-indigo-700 bg-indigo-50 border border-indigo-200/80'
                        : allowed
                          ? 'text-slate-600 border border-transparent hover:bg-slate-50 hover:text-slate-900'
                          : 'text-slate-400 border border-transparent hover:bg-slate-50'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="sm:hidden">{shortLabel}</span>
                    <span className="hidden sm:inline">{label}</span>
                    {!allowed && (
                      <Lock className="h-3 w-3 text-slate-400 shrink-0" aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </nav>
          )}
          {showMenuBar && showCreatorCredit && (
            <div
              data-testid="mobile-menu-bar-creator-credit"
              className="lg:hidden border-t border-slate-100 bg-slate-50/70 px-3 sm:px-5 py-1 text-[10px] text-slate-500 text-center"
            >
              Application Created By:{' '}
              <span className="font-semibold text-slate-700">Tamtowi Yahya</span>
            </div>
          )}
        </div>

        {/* Page Viewport */}
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-5 sm:py-6 pb-10 lg:pb-8 max-w-7xl w-full mx-auto">
          {currentRole === 'master_admin' && storageAlerts.length > 0 && (
            <AdminStorageAlertBanner
              alerts={storageAlerts}
              onOpenStorageBackup={onOpenStorageBackup}
            />
          )}
          {currentRole === 'master_admin' &&
            onApproveLateRequest &&
            onRejectLateRequest && (
              <AdminNotificationBar
                requests={pendingLateRequests}
                expanded={notifBarExpanded}
                onClose={() => setNotifBarExpanded(false)}
                onApprove={onApproveLateRequest}
                onReject={onRejectLateRequest}
              />
            )}
          {children}
        </main>
      </div>

      {/* Auto Scroll-to-Top Button (Bottom Right) */}
      {showScrollTop && (
        <button
          type="button"
          onClick={handleScrollToTop}
          aria-label="Gulir ke atas"
          title="Gulir ke atas"
          className="fixed bottom-5 right-4 lg:bottom-6 lg:right-6 z-30 h-11 w-11 rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/25 hover:bg-indigo-700 active:scale-95 transition-all flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          <ArrowUp className="h-5 w-5" aria-hidden="true" />
        </button>
      )}

      {/* Toast Notifications */}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          className={`fixed right-4 z-50 flex flex-col gap-2 w-[calc(100%-2rem)] max-w-sm pointer-events-none ${
            showScrollTop ? 'bottom-20' : 'bottom-5'
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
