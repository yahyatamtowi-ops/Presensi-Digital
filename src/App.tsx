import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppThemeId,
  AttendanceRecord,
  AttendanceStatus,
  AuthSession,
  ConnectionStatus,
  DayOfWeek,
  MasterSubject,
  ScanActionMode,
  SchoolSettings,
  SemesterKind,
  Student,
  SubjectAssignment,
  SubjectAttendanceRecord,
  TabId,
  TeacherSchedule,
  ToastMessage,
  UserAccount,
} from './types';
import {
  clearSyncQueue,
  enqueueSyncMutation,
  fetchAllFromGas,
  flushSyncQueue,
  loadDefaultSchoolIdentity,
  loadLocalCache,
  loadSyncQueue,
  postToGas,
  resetLocalDemoData,
  saveDefaultSchoolIdentity,
  saveLocalRecords,
  saveLocalSettings,
  saveLocalStudents,
} from './utils/gasApi';
import {
  createAppBackupPayload,
  exportFullExcelArchive,
  saveBackupToComputer,
  type AppBackupPayload,
  type LastBackupMeta,
} from './utils/backupStorage';
import {
  authenticateUser,
  canAccessTab,
  canDeleteStudents,
  canEditStudents,
  canExportRecap,
  canModifyRecapStatus,
  canSendParentRecap,
  canViewStudentECard,
  clearAuthSession,
  formatRoleLabel,
  getDefaultTabForRole,
  loadAuthSession,
  loadUserAccounts,
  resetPasswordWithNip,
  saveAuthSession,
  saveUserAccounts,
} from './utils/auth';
import {
  collectAcademicYears,
  evaluateWaliKelasLoginReminder,
  filterByAcademicYear,
  getCurrentTimeString,
  getTodayDateString,
  normalizeScheduleMode,
  normalizeTimeHHMM,
  processQrScan,
  resolveItemAcademicYear,
  type ScanOutcome,
} from './utils/attendanceLogic';
import { isDarkTheme, normalizeThemeId } from './utils/themes';
import {
  playWarningBeep,
  speakDuplicateRejectedNotification,
  speakSuccessNotification,
  speakWaliKelasReminder,
  speakWelcomeGreeting,
} from './utils/sound';
import {
  addMasterSubject,
  addSubjectAssignment,
  addTeacherSchedule,
  formatSemesterLabel,
  generateDemoSubjectAssignments,
  generateDemoTeacherSchedules,
  loadMasterSubjects,
  loadSubjectAssignments,
  loadSubjectRecords,
  loadTeacherSchedules,
  normalizeSemester,
  processSubjectQrScan,
  saveMasterSubjects,
  saveSubjectAssignments,
  saveSubjectRecords,
  saveTeacherSchedules,
  updateMasterSubject,
  updateTeacherSchedule,
  upsertSubjectAttendanceStatus,
  type SubjectScanOutcome,
} from './utils/subjectAttendance';
import { LayoutShell } from './components/LayoutShell';
import { OpeningSplash } from './components/OpeningSplash';
import { AuthLoadingOverlay, type AuthTransitionState } from './components/AuthLoadingOverlay';
import { LoginModal } from './components/LoginModal';
import { DashboardView } from './components/DashboardView';
import { ScannerView } from './components/ScannerView';
import { StudentsView } from './components/StudentsView';
import { RecapView } from './components/RecapView';
import { SubjectAttendanceView } from './components/SubjectAttendanceView';
import { ScheduleManagementView } from './components/ScheduleManagementView';
import { AnalyticsView } from './components/AnalyticsView';
import { SettingsView } from './components/SettingsView';

const TAB_LABELS: Record<TabId, string> = {
  scan: 'Scan QR',
  dashboard: 'Dashboard',
  siswa: 'Data Siswa & E-Card',
  rekap: 'Rekap & Export',
  mapel: 'Presensi Mata Pelajaran',
  jadwal: 'Mapel & Jadwal Pelajaran',
  analisis: 'Analisis Kehadiran',
  pengaturan: 'Pengaturan Sistem',
};

export default function App() {
  const [initialCache] = useState(() => loadLocalCache());
  const [students, setStudents] = useState<Student[]>(initialCache.students);
  const [records, setRecords] = useState<AttendanceRecord[]>(initialCache.records);
  const [settings, setSettings] = useState<SchoolSettings>(initialCache.settings);
  const [masterSubjects, setMasterSubjects] = useState<MasterSubject[]>(() =>
    loadMasterSubjects()
  );
  const [teacherSchedules, setTeacherSchedules] = useState<TeacherSchedule[]>(() =>
    loadTeacherSchedules()
  );
  const [subjectAssignments, setSubjectAssignments] = useState<SubjectAssignment[]>(() =>
    loadSubjectAssignments()
  );
  const [subjectRecords, setSubjectRecords] = useState<SubjectAttendanceRecord[]>(() =>
    loadSubjectRecords()
  );
  const [previewTheme, setPreviewTheme] = useState<AppThemeId | null>(null);

  const [accounts, setAccounts] = useState<UserAccount[]>(() => loadUserAccounts());
  const [session, setSession] = useState<AuthSession | null>(() => loadAuthSession());
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [pendingTab, setPendingTab] = useState<TabId | null>(null);
  const [masterYearFilter, setMasterYearFilter] = useState<string>('ACTIVE');

  // 5-second loading transition overlay on Login & Logout
  const [authTransition, setAuthTransition] = useState<AuthTransitionState | null>(null);
  const pendingAuthCommitRef = useRef<(() => void) | null>(null);

  const [showSplash, setShowSplash] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return !new URLSearchParams(window.location.search).has('autostart');
  });
  const welcomeSpokenRef = useRef(false);

  const handleSplashFinish = useCallback(() => {
    setShowSplash(false);
    if (!welcomeSpokenRef.current) {
      welcomeSpokenRef.current = true;
      speakWelcomeGreeting(latestDataRef.current.settings.nama_sekolah);
    }
  }, []);

  // Scan QR is always the default initial page (accessible without login)
  const [activeTab, setActiveTab] = useState<TabId>('scan');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(
    initialCache.settings.script_url ? 'syncing' : 'offline'
  );
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(
    () => loadSyncQueue().length
  );
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const syncInFlightRef = useRef(false);
  const latestDataRef = useRef({ students, records, settings });
  latestDataRef.current = { students, records, settings };

  const activeTheme = previewTheme ?? settings.tema ?? 'indigo';

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.theme = activeTheme;
      document.documentElement.dataset.colorMode = isDarkTheme(activeTheme)
        ? 'dark'
        : 'light';
    }
  }, [activeTheme]);

  const pushToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev.slice(-3), { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const syncFromGas = useCallback(
    async (scriptUrl: string, silent = false) => {
      const trimmed = scriptUrl.trim();
      if (!trimmed) {
        setConnectionStatus('offline');
        if (!silent) {
          pushToast({
            type: 'info',
            title: 'Mode Offline / Cache Lokal',
            description:
              'Isi Web App URL Google Apps Script di menu Pengaturan untuk sinkronisasi ke Google Sheets.',
          });
        }
        return;
      }

      if (syncInFlightRef.current) return;
      syncInFlightRef.current = true;

      if (!silent) {
        setConnectionStatus('syncing');
      }

      try {
        // Flush any queued offline mutations before pulling remote state
        const flushResult = await flushSyncQueue(trimmed);
        setPendingSyncCount(flushResult.remaining);
        if (flushResult.remaining > 0 && !silent && flushResult.lastError) {
          pushToast({
            type: 'warning',
            title: 'Sebagian Antrean Belum Tersimpan ke Sheets',
            description: `${flushResult.remaining} perubahan masih menunggu: ${flushResult.lastError}`,
          });
        }

        const remote = await fetchAllFromGas(trimmed);

        if (remote.students.length > 0) {
          setStudents(remote.students);
          saveLocalStudents(remote.students);
          setRecords(remote.records);
          saveLocalRecords(remote.records);
        } else if (remote.records.length > 0) {
          setRecords(remote.records);
          saveLocalRecords(remote.records);
        }

        if (
          remote.settings &&
          (remote.settings.nama_sekolah ||
            remote.settings.nama_kepala_sekolah !== undefined ||
            remote.settings.nip_kepala_sekolah !== undefined ||
            remote.settings.ttd_kepala_sekolah !== undefined ||
            remote.settings.cap_sekolah !== undefined ||
            remote.settings.batas_jam_masuk ||
            remote.settings.mode_presensi ||
            remote.settings.jam_pulang_standar ||
            remote.settings.tahun_ajaran ||
            remote.settings.semester ||
            remote.settings.tema ||
            remote.settings.logo_sekolah)
        ) {
          setSettings((prev) => {
            const merged: SchoolSettings = {
              ...prev,
              nama_sekolah: remote.settings.nama_sekolah?.trim()
                ? remote.settings.nama_sekolah
                : prev.nama_sekolah,
              nama_kepala_sekolah: remote.settings.nama_kepala_sekolah?.trim()
                ? remote.settings.nama_kepala_sekolah
                : prev.nama_kepala_sekolah,
              nip_kepala_sekolah: remote.settings.nip_kepala_sekolah?.trim()
                ? remote.settings.nip_kepala_sekolah
                : prev.nip_kepala_sekolah,
              ttd_kepala_sekolah: remote.settings.ttd_kepala_sekolah?.trim()
                ? remote.settings.ttd_kepala_sekolah
                : prev.ttd_kepala_sekolah,
              cap_sekolah: remote.settings.cap_sekolah?.trim()
                ? remote.settings.cap_sekolah
                : prev.cap_sekolah,
              batas_jam_masuk: remote.settings.batas_jam_masuk
                ? normalizeTimeHHMM(remote.settings.batas_jam_masuk, prev.batas_jam_masuk)
                : prev.batas_jam_masuk,
              mode_presensi: remote.settings.mode_presensi
                ? normalizeScheduleMode(remote.settings.mode_presensi, prev.mode_presensi)
                : prev.mode_presensi,
              jam_pulang_standar: remote.settings.jam_pulang_standar
                ? normalizeTimeHHMM(
                    remote.settings.jam_pulang_standar,
                    prev.jam_pulang_standar
                  )
                : prev.jam_pulang_standar,
              tahun_ajaran: remote.settings.tahun_ajaran || prev.tahun_ajaran,
              semester: remote.settings.semester
                ? normalizeSemester(remote.settings.semester, prev.semester || 'ganjil')
                : prev.semester || 'ganjil',
              tema: remote.settings.tema
                ? normalizeThemeId(remote.settings.tema, prev.tema)
                : prev.tema,
              logo_sekolah: remote.settings.logo_sekolah
                ? remote.settings.logo_sekolah
                : prev.logo_sekolah,
              script_url: trimmed,
            };
            const unchanged =
              merged.nama_sekolah === prev.nama_sekolah &&
              (merged.nama_kepala_sekolah || '') === (prev.nama_kepala_sekolah || '') &&
              (merged.nip_kepala_sekolah || '') === (prev.nip_kepala_sekolah || '') &&
              (merged.ttd_kepala_sekolah || '') === (prev.ttd_kepala_sekolah || '') &&
              (merged.cap_sekolah || '') === (prev.cap_sekolah || '') &&
              merged.batas_jam_masuk === prev.batas_jam_masuk &&
              merged.mode_presensi === prev.mode_presensi &&
              merged.jam_pulang_standar === prev.jam_pulang_standar &&
              merged.tahun_ajaran === prev.tahun_ajaran &&
              (merged.semester || 'ganjil') === (prev.semester || 'ganjil') &&
              merged.tema === prev.tema &&
              (merged.logo_sekolah || '') === (prev.logo_sekolah || '') &&
              merged.script_url === prev.script_url;
            if (unchanged) {
              return prev;
            }
            saveLocalSettings(merged);
            return merged;
          });
        }

        setConnectionStatus(flushResult.remaining > 0 ? 'error' : 'connected');
        setLastSyncedAt(getCurrentTimeString());
        if (!silent && flushResult.remaining === 0) {
          pushToast({
            type: 'success',
            title: 'Sinkronisasi Berhasil',
            description: `Terhubung real-time ke Google Sheets (${remote.students.length} siswa, ${remote.records.length} catatan presensi).`,
          });
        }
      } catch (err) {
        setConnectionStatus('error');
        if (!silent) {
          pushToast({
            type: 'error',
            title: 'Gagal Memuat dari Google Sheets',
            description:
              err instanceof Error
                ? `${err.message}. Menggunakan data cache lokal.`
                : 'Menggunakan data cache lokal.',
          });
        }
      } finally {
        syncInFlightRef.current = false;
      }
    },
    [pushToast]
  );

  // Realtime & everytime sync: on mount/URL change, every 10s, on focus, visibility, and online events
  useEffect(() => {
    const url = settings.script_url.trim();
    if (!url) {
      setConnectionStatus('offline');
      return;
    }

    void syncFromGas(url, true);

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        void syncFromGas(url, true);
      }
    }, 10000);

    const handleResumeSync = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        void syncFromGas(url, true);
      }
    };

    window.addEventListener('focus', handleResumeSync);
    window.addEventListener('online', handleResumeSync);
    document.addEventListener('visibilitychange', handleResumeSync);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleResumeSync);
      window.removeEventListener('online', handleResumeSync);
      document.removeEventListener('visibilitychange', handleResumeSync);
    };
  }, [settings.script_url, syncFromGas]);

  const syncMutation = useCallback(
    async (
      action: Parameters<typeof postToGas>[1],
      payload: Record<string, unknown>,
      urlOverride?: string
    ) => {
      const targetUrl = (urlOverride ?? settings.script_url).trim();
      if (!targetUrl) {
        setConnectionStatus('offline');
        return;
      }
      setConnectionStatus('syncing');
      try {
        await postToGas(targetUrl, action, payload);
        await flushSyncQueue(targetUrl);
        setPendingSyncCount(loadSyncQueue().length);
        setConnectionStatus('connected');
        setLastSyncedAt(getCurrentTimeString());
      } catch (err) {
        enqueueSyncMutation(action, payload);
        setPendingSyncCount(loadSyncQueue().length);
        setConnectionStatus('error');
        pushToast({
          type: 'warning',
          title: 'Tersimpan di Antrean Sinkronisasi',
          description:
            err instanceof Error
              ? `Perubahan disimpan lokal dan akan disinkronkan otomatis: ${err.message}`
              : 'Perubahan disimpan lokal dan akan disinkronkan otomatis saat terhubung.',
        });
      }
    },
    [settings.script_url, pushToast]
  );

  const handlePushAllToSheets = useCallback(
    async (scriptUrl: string) => {
      const targetUrl = scriptUrl.trim();
      if (!targetUrl) {
        pushToast({
          type: 'info',
          title: 'URL Belum Diisi',
          description: 'Masukkan Web App URL Google Apps Script terlebih dahulu.',
        });
        return;
      }
      setConnectionStatus('syncing');
      try {
        const snapshot = latestDataRef.current;
        await postToGas(targetUrl, 'syncAll', {
          students: snapshot.students,
          records: snapshot.records,
          settings: {
            nama_sekolah: snapshot.settings.nama_sekolah,
            nama_kepala_sekolah: snapshot.settings.nama_kepala_sekolah || '',
            nip_kepala_sekolah: snapshot.settings.nip_kepala_sekolah || '',
            ttd_kepala_sekolah: snapshot.settings.ttd_kepala_sekolah || '',
            cap_sekolah: snapshot.settings.cap_sekolah || '',
            batas_jam_masuk: snapshot.settings.batas_jam_masuk,
            mode_presensi: snapshot.settings.mode_presensi,
            jam_pulang_standar: snapshot.settings.jam_pulang_standar,
            tahun_ajaran: snapshot.settings.tahun_ajaran,
            semester: normalizeSemester(snapshot.settings.semester, 'ganjil'),
            tema: snapshot.settings.tema,
            logo_sekolah: snapshot.settings.logo_sekolah || '',
          },
        });
        clearSyncQueue();
        setPendingSyncCount(0);
        setConnectionStatus('connected');
        setLastSyncedAt(getCurrentTimeString());
        pushToast({
          type: 'success',
          title: 'Data Lokal Terkirim ke Sheets',
          description: `${snapshot.students.length} siswa dan ${snapshot.records.length} presensi berhasil disinkronkan.`,
        });
      } catch (err) {
        setConnectionStatus('error');
        pushToast({
          type: 'error',
          title: 'Gagal Mengirim Data ke Sheets',
          description:
            err instanceof Error ? err.message : 'Periksa kembali URL Web App Anda.',
        });
      }
    },
    [pushToast]
  );

  const isMasterAdmin = session?.role === 'master_admin';

  const availableAcademicYears = useMemo(
    () => collectAcademicYears(students, records, settings.tahun_ajaran),
    [students, records, settings.tahun_ajaran]
  );

  // Active academic year datasets (used by Scan QR and non-Master Admin accounts)
  const activeYearStudents = useMemo(
    () =>
      filterByAcademicYear(students, {
        activeAcademicYear: settings.tahun_ajaran,
        isMasterAdmin: false,
      }),
    [students, settings.tahun_ajaran]
  );

  const activeYearRecords = useMemo(
    () =>
      filterByAcademicYear(records, {
        activeAcademicYear: settings.tahun_ajaran,
        isMasterAdmin: false,
      }),
    [records, settings.tahun_ajaran]
  );

  // Academic-year filtered datasets for logged-in views (Master Admin can switch archive years)
  const yearVisibleStudents = useMemo(
    () =>
      filterByAcademicYear(students, {
        activeAcademicYear: settings.tahun_ajaran,
        isMasterAdmin,
        masterYearFilter,
      }),
    [students, settings.tahun_ajaran, isMasterAdmin, masterYearFilter]
  );

  const yearVisibleRecords = useMemo(
    () =>
      filterByAcademicYear(records, {
        activeAcademicYear: settings.tahun_ajaran,
        isMasterAdmin,
        masterYearFilter,
      }),
    [records, settings.tahun_ajaran, isMasterAdmin, masterYearFilter]
  );

  const availableClasses = useMemo(() => {
    const set = new Set(activeYearStudents.map((s) => s.kelas));
    return Array.from(set).sort();
  }, [activeYearStudents]);

  const waliClass =
    session?.role === 'wali_kelas' ? session.kelas_binaan?.trim() || '' : undefined;

  const scopedStudents = useMemo(() => {
    if (waliClass === undefined) return yearVisibleStudents;
    if (!waliClass) return [];
    return yearVisibleStudents.filter((s) => s.kelas === waliClass);
  }, [yearVisibleStudents, waliClass]);

  const scopedRecords = useMemo(() => {
    if (waliClass === undefined) return yearVisibleRecords;
    if (!waliClass) return [];
    return yearVisibleRecords.filter((r) => r.kelas === waliClass);
  }, [yearVisibleRecords, waliClass]);

  const masterYearControl = isMasterAdmin
    ? {
        selectedYear: masterYearFilter,
        availableYears: availableAcademicYears,
        onChangeYear: (yr: string) => setMasterYearFilter(yr),
      }
    : undefined;

  const handleCompleteAuthTransition = useCallback(() => {
    const commit = pendingAuthCommitRef.current;
    pendingAuthCommitRef.current = null;
    setAuthTransition(null);
    if (commit) {
      commit();
    }
  }, []);

  function handleSelectTab(tab: TabId) {
    const role = session?.role ?? null;
    if (canAccessTab(role, tab)) {
      setActiveTab(tab);
      if (settings.script_url.trim()) {
        void syncFromGas(settings.script_url, true);
      }
      return;
    }

    if (!session) {
      setPendingTab(tab);
      setLoginModalOpen(true);
      return;
    }

    if (session.role === 'guru') {
      pushToast({
        type: 'warning',
        title: 'Akses Terbatas untuk Guru Mata Pelajaran',
        description:
          'Akun Guru Mata Pelajaran khusus mengakses Presensi Mapel, Rekap & Export, Analisis, serta Pemindai QR.',
      });
      return;
    }

    if (session.role === 'kepala_sekolah') {
      pushToast({
        type: 'warning',
        title: 'Akses Terbatas untuk Kepala Sekolah',
        description:
          'Akun Kepala Sekolah khusus mengakses Dashboard, Data Siswa, Rekap, dan Analisis.',
      });
      return;
    }

    pushToast({
      type: 'warning',
      title: 'Akses Khusus Master Admin',
      description: 'Menu Pengaturan hanya dapat diakses oleh akun Master Admin.',
    });
  }

  function handleLoginSubmit(
    username: string,
    password: string
  ): { ok: boolean; error?: string } {
    const result = authenticateUser(accounts, username, password);
    if (!result.ok) {
      return result;
    }

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.getVoices();
      } catch {
        // Ignore voice priming errors
      }
    }

    const destination = pendingTab;
    setPendingTab(null);

    pendingAuthCommitRef.current = () => {
      setSession(result.session);
      saveAuthSession(result.session);
      if (result.session.role !== 'master_admin') {
        setMasterYearFilter('ACTIVE');
      }
      pushToast({
        type: 'success',
        title: `Selamat datang, ${result.session.nama}`,
        description: `Login sebagai ${result.session.jabatan}.`,
      });

      if (result.session.role === 'wali_kelas' && result.session.kelas_binaan) {
        const snapshot = latestDataRef.current;
        const yearStudents = filterByAcademicYear(snapshot.students, {
          activeAcademicYear: snapshot.settings.tahun_ajaran,
          isMasterAdmin: false,
        });
        const yearRecords = filterByAcademicYear(snapshot.records, {
          activeAcademicYear: snapshot.settings.tahun_ajaran,
          isMasterAdmin: false,
        });
        const reminder = evaluateWaliKelasLoginReminder({
          students: yearStudents,
          records: yearRecords,
          kelasBinaan: result.session.kelas_binaan,
          targetDate: getTodayDateString(),
          modePresensi: snapshot.settings.mode_presensi,
        });

        if (reminder.messages.length > 0) {
          speakWaliKelasReminder(reminder.messages);
          const summaryParts: string[] = [];
          if (reminder.belumHadirCount > 0) {
            summaryParts.push(
              `${reminder.belumHadirCount} siswa belum presensi kehadiran`
            );
          }
          if (reminder.belumPulangCount > 0) {
            summaryParts.push(
              `${reminder.belumPulangCount} siswa belum presensi pulang`
            );
          }
          pushToast({
            type: 'warning',
            title: `Pengingat Wali Kelas ${reminder.kelasBinaan}`,
            description: `${summaryParts.join(' · ')}. Mohon cek dan konfirmasi kehadiran siswa kelas Anda.`,
          });
        }
      }

      const defaultTab = getDefaultTabForRole(result.session.role);
      if (destination && canAccessTab(result.session.role, destination)) {
        setActiveTab(destination);
      } else if (destination && !canAccessTab(result.session.role, destination)) {
        setActiveTab(defaultTab);
        pushToast({
          type: 'warning',
          title: `Dialihkan ke ${TAB_LABELS[defaultTab]}`,
          description:
            result.session.role === 'guru'
              ? 'Akun Guru Mata Pelajaran memiliki akses ke menu Presensi Mapel, Rekap & Export, dan Analisis.'
              : result.session.role === 'kepala_sekolah'
                ? 'Akun Kepala Sekolah memiliki akses ke menu Dashboard, Data Siswa, Rekap, dan Analisis.'
                : 'Menu Pengaturan hanya dapat diakses oleh Master Admin.',
        });
      } else if (!canAccessTab(result.session.role, activeTab) || activeTab === 'scan') {
        setActiveTab(defaultTab);
      }
    };

    setAuthTransition({
      mode: 'login',
      userName: result.session.nama,
      roleLabel: result.session.jabatan,
    });

    return { ok: true };
  }

  function handleResetPasswordWithNip(params: {
    username: string;
    nip: string;
    newPassword: string;
    confirmPassword: string;
  }): { ok: boolean; error?: string } {
    const res = resetPasswordWithNip(
      accounts,
      params.username,
      params.nip,
      params.newPassword,
      params.confirmPassword
    );
    if (!res.ok) {
      return res;
    }
    setAccounts(res.accounts);
    saveUserAccounts(res.accounts);
    pushToast({
      type: 'success',
      title: 'Password Diperbarui',
      description: `Password akun ${res.updatedAccount.username} berhasil direset melalui konfirmasi NIP.`,
    });
    return { ok: true };
  }

  function handleLogout() {
    pendingAuthCommitRef.current = () => {
      clearAuthSession();
      setSession(null);
      setMasterYearFilter('ACTIVE');
      setPreviewTheme(null);
      setActiveTab('scan');
      pushToast({
        type: 'info',
        title: 'Berhasil Keluar',
        description: 'Aplikasi kembali ke mode Pemindai QR Code.',
      });
    };

    setAuthTransition({
      mode: 'logout',
    });
  }

  function handleScanSubmit(
    rawCode: string,
    scanAction: ScanActionMode = 'auto',
    alasanPulangCepat?: string
  ): ScanOutcome {
    const outcome = processQrScan({
      qrRaw: rawCode,
      students: activeYearStudents,
      records: activeYearRecords,
      batasJamMasuk: settings.batas_jam_masuk,
      modePresensi: settings.mode_presensi,
      jamPulangStandar: settings.jam_pulang_standar,
      scanAction,
      alasanPulangCepat,
      tahunAjaran: settings.tahun_ajaran,
    });

    if (outcome.ok) {
      speakSuccessNotification(
        outcome.scanType === 'pulang' ? 'Presensi Pulang Berhasil' : 'Presensi Berhasil'
      );
      const taggedRecord: AttendanceRecord = {
        ...outcome.record,
        tahun_ajaran: outcome.record.tahun_ajaran || settings.tahun_ajaran,
      };
      let nextRecords: AttendanceRecord[];
      if (outcome.scanType === 'pulang') {
        const targetNisNorm = taggedRecord.nis.trim().toLowerCase();
        let replaced = false;
        const mapped = records.map((r) => {
          const matchesTarget =
            r.id === taggedRecord.id ||
            (r.tanggal === taggedRecord.tanggal &&
              r.nis.trim().toLowerCase() === targetNisNorm);
          if (!replaced && matchesTarget) {
            replaced = true;
            return taggedRecord;
          }
          return r;
        });
        nextRecords = replaced ? mapped : [taggedRecord, ...records];
      } else {
        nextRecords = [taggedRecord, ...records];
      }
      setRecords(nextRecords);
      saveLocalRecords(nextRecords);

      if (outcome.scanType === 'pulang') {
        const earlyReason = taggedRecord.alasan_pulang_cepat?.trim();
        pushToast({
          type: earlyReason ? 'warning' : 'success',
          title: earlyReason
            ? `${outcome.student.nama} — Pulang Cepat`
            : `${outcome.student.nama} — Pulang`,
          description: earlyReason
            ? `NIS ${outcome.student.nis} (${outcome.student.kelas}) pulang cepat pukul ${taggedRecord.jam_pulang} · Alasan: ${earlyReason}`
            : `NIS ${outcome.student.nis} (${outcome.student.kelas}) scan pulang pukul ${taggedRecord.jam_pulang}`,
        });
      } else {
        pushToast({
          type: taggedRecord.status === 'Hadir' ? 'success' : 'warning',
          title: `${outcome.student.nama} — ${taggedRecord.status}`,
          description: `NIS ${outcome.student.nis} (${outcome.student.kelas}) dicatat masuk pukul ${taggedRecord.jam_masuk}`,
        });
      }
      void syncMutation('recordPresensi', {
        ...taggedRecord,
        record: { ...taggedRecord },
      });
      return outcome;
    }

    if (outcome.reason === 'duplicate' || outcome.reason === 'duplicate_checkout') {
      speakDuplicateRejectedNotification('Presensi Ganda, Data Ditolak');
    } else {
      playWarningBeep();
    }

    if (outcome.reason === 'duplicate') {
      pushToast({
        type: 'warning',
        title: 'Scan Ganda Ditolak',
        description: `${outcome.student?.nama} sudah tercatat ${outcome.existingRecord?.status} hari ini.`,
      });
    } else if (outcome.reason === 'duplicate_checkout') {
      pushToast({
        type: 'warning',
        title: 'Sudah Scan Masuk & Pulang',
        description: `${outcome.student?.nama} sudah mencatat jam pulang pukul ${outcome.existingRecord?.jam_pulang}.`,
      });
    } else if (outcome.reason === 'before_checkout_time') {
      pushToast({
        type: 'warning',
        title: 'Belum Jam Pulang — Perlu Konfirmasi Alasan',
        description: `Jadwal pulang dimulai pukul ${settings.jam_pulang_standar}. Konfirmasikan alasan pulang cepat terlebih dahulu.`,
      });
    } else if (outcome.reason === 'not_checked_in') {
      pushToast({
        type: 'error',
        title: 'Belum Scan Masuk',
        description: `${outcome.student?.nama} belum melakukan scan masuk hari ini.`,
      });
    } else if (outcome.reason === 'not_found') {
      pushToast({
        type: 'error',
        title: 'NIS Tidak Terdaftar',
        description: `Siswa dengan NIS "${outcome.nis}" tidak ditemukan pada Tahun Ajaran ${settings.tahun_ajaran}.`,
      });
    } else {
      pushToast({
        type: 'error',
        title: 'QR Tidak Valid',
        description: 'Kode QR kosong atau tidak dapat dibaca.',
      });
    }
    return outcome;
  }

  function handleAddStudent(student: Student): { ok: boolean; error?: string } {
    if (!canEditStudents(session?.role ?? null)) {
      return { ok: false, error: 'Anda tidak memiliki izin menambah data siswa.' };
    }
    const duplicate = activeYearStudents.some(
      (s) => s.nis.trim().toLowerCase() === student.nis.trim().toLowerCase()
    );
    if (duplicate) {
      return {
        ok: false,
        error: `NIS ${student.nis} sudah terdaftar pada Tahun Ajaran ${settings.tahun_ajaran}.`,
      };
    }
    const taggedStudent: Student = {
      ...student,
      tahun_ajaran: settings.tahun_ajaran,
    };
    const nextStudents = [...students, taggedStudent];
    setStudents(nextStudents);
    saveLocalStudents(nextStudents);
    pushToast({
      type: 'success',
      title: 'Siswa Ditambahkan',
      description: `${taggedStudent.nama} (${taggedStudent.kelas}) berhasil disimpan.`,
    });
    void syncMutation('addSiswa', { ...taggedStudent });
    return { ok: true };
  }

  function handleBulkImportStudents(newStudents: Student[]) {
    if (!canEditStudents(session?.role ?? null)) return;
    if (newStudents.length === 0) return;
    const tagged = newStudents.map((s) => ({
      ...s,
      tahun_ajaran: settings.tahun_ajaran,
    }));
    const nextStudents = [...students, ...tagged];
    setStudents(nextStudents);
    saveLocalStudents(nextStudents);
    pushToast({
      type: 'success',
      title: 'Import Siswa Berhasil',
      description: `${tagged.length} siswa baru berhasil ditambahkan ke Tahun Ajaran ${settings.tahun_ajaran}.`,
    });
    void syncMutation('bulkAddSiswa', { students: tagged });
  }

  function handleUpdateStudent(
    originalNis: string,
    updated: Student
  ): { ok: boolean; error?: string } {
    if (!canEditStudents(session?.role ?? null)) {
      return { ok: false, error: 'Anda tidak memiliki izin mengubah data siswa.' };
    }
    const conflict = scopedStudents.some(
      (s) =>
        s.nis.trim().toLowerCase() === updated.nis.trim().toLowerCase() &&
        s.nis.trim().toLowerCase() !== originalNis.trim().toLowerCase()
    );
    if (conflict) {
      return { ok: false, error: `NIS ${updated.nis} sudah digunakan siswa lain.` };
    }

    const nextStudents = students.map((s) =>
      s.nis === originalNis
        ? { ...updated, tahun_ajaran: s.tahun_ajaran || settings.tahun_ajaran }
        : s
    );
    setStudents(nextStudents);
    saveLocalStudents(nextStudents);

    const nextRecords = records.map((r) =>
      r.nis === originalNis
        ? { ...r, nis: updated.nis, nama: updated.nama, kelas: updated.kelas }
        : r
    );
    setRecords(nextRecords);
    saveLocalRecords(nextRecords);

    pushToast({
      type: 'success',
      title: 'Data Siswa Diperbarui',
      description: `${updated.nama} berhasil diperbarui.`,
    });
    void syncMutation('updateSiswa', { originalNis, ...updated });
    return { ok: true };
  }

  function handleDeleteStudent(nis: string) {
    if (!canDeleteStudents(session?.role ?? null)) {
      pushToast({
        type: 'warning',
        title: 'Akses Ditolak',
        description: 'Hanya Master Admin yang memiliki wewenang menghapus data siswa.',
      });
      return;
    }
    const target = scopedStudents.find((s) => s.nis === nis);
    const targetYear = target
      ? resolveItemAcademicYear(target.tahun_ajaran)
      : settings.tahun_ajaran;
    const nextStudents = students.filter(
      (s) =>
        !(
          s.nis === nis &&
          resolveItemAcademicYear(s.tahun_ajaran) === targetYear
        )
    );
    setStudents(nextStudents);
    saveLocalStudents(nextStudents);
    pushToast({
      type: 'info',
      title: 'Siswa Dihapus',
      description: target ? `${target.nama} dihapus dari daftar siswa.` : undefined,
    });
    void syncMutation('deleteSiswa', { nis });
  }

  function handleBulkDeleteStudents(nisList: string[]) {
    if (!canDeleteStudents(session?.role ?? null)) {
      pushToast({
        type: 'warning',
        title: 'Akses Ditolak',
        description: 'Hanya Master Admin yang memiliki wewenang menghapus data siswa.',
      });
      return;
    }
    if (nisList.length === 0) return;
    const delSet = new Set(nisList);
    const allowedYears = new Set(
      scopedStudents
        .filter((s) => delSet.has(s.nis))
        .map((s) => resolveItemAcademicYear(s.tahun_ajaran))
    );
    const nextStudents = students.filter(
      (s) =>
        !(
          delSet.has(s.nis) &&
          allowedYears.has(resolveItemAcademicYear(s.tahun_ajaran))
        )
    );
    setStudents(nextStudents);
    saveLocalStudents(nextStudents);
    pushToast({
      type: 'info',
      title: `${nisList.length} Siswa Dihapus`,
      description: 'Data siswa terpilih telah dihapus dari daftar.',
    });
    void syncMutation('bulkDeleteSiswa', { nisList });
  }

  function handleUpdateRecapStatus(params: {
    tanggal: string;
    student: { nis: string; nama: string; kelas: string };
    status: AttendanceStatus;
  }) {
    const { tanggal, student, status } = params;
    const existing = scopedRecords.find(
      (r) =>
        r.tanggal === tanggal &&
        r.nis.trim().toLowerCase() === student.nis.trim().toLowerCase()
    );

    const isPresentStatus = status === 'Hadir' || status === 'Terlambat';
    const jam_masuk = existing
      ? existing.jam_masuk && existing.jam_masuk !== '-'
        ? existing.jam_masuk
        : isPresentStatus
          ? getCurrentTimeString()
          : '-'
      : isPresentStatus
        ? getCurrentTimeString()
        : '-';

    const studentMatch = scopedStudents.find(
      (s) => s.nis.trim().toLowerCase() === student.nis.trim().toLowerCase()
    );
    const targetAcademicYear =
      existing?.tahun_ajaran || studentMatch?.tahun_ajaran || settings.tahun_ajaran;

    const updatedRecord: AttendanceRecord = existing
      ? {
          ...existing,
          status,
          jam_masuk,
          keterangan: `Diubah manual (${status})`,
        }
      : {
          id: `${tanggal}_${student.nis}`,
          tanggal,
          nis: student.nis,
          nama: student.nama,
          kelas: student.kelas,
          jam_masuk,
          jam_pulang: '-',
          status,
          keterangan: `Diinput manual (${status})`,
          tahun_ajaran: targetAcademicYear,
        };

    const nextRecords = existing
      ? records.map((r) =>
          r.id === existing.id &&
          resolveItemAcademicYear(r.tahun_ajaran) ===
            resolveItemAcademicYear(existing.tahun_ajaran)
            ? updatedRecord
            : r
        )
      : [updatedRecord, ...records];

    setRecords(nextRecords);
    saveLocalRecords(nextRecords);
    pushToast({
      type: 'success',
      title: 'Status Presensi Diperbarui',
      description: `${student.nama} pada ${tanggal} ditandai ${status}.`,
    });
    void syncMutation('updateStatusPresensi', {
      ...updatedRecord,
      record: { ...updatedRecord },
    });
  }

  function handleConfirmCheckout(params: {
    tanggal: string;
    student: { nis: string; nama: string; kelas: string };
    alasanPulangCepat?: string;
  }) {
    const { tanggal, student, alasanPulangCepat } = params;
    const targetNisNorm = student.nis.trim().toLowerCase();
    const existing = records.find(
      (r) =>
        r.tanggal === tanggal && r.nis.trim().toLowerCase() === targetNisNorm
    );
    if (!existing) return;

    const nowTime = getCurrentTimeString();
    const trimmedReason = (alasanPulangCepat || '').trim();
    const checkoutNote = trimmedReason
      ? `Pulang cepat ${nowTime} (Alasan: ${trimmedReason})`
      : `Pulang ${nowTime}`;
    const updatedRecord: AttendanceRecord = {
      ...existing,
      jam_pulang: nowTime,
      ...(trimmedReason ? { alasan_pulang_cepat: trimmedReason } : {}),
      keterangan: existing.keterangan
        ? `${existing.keterangan} · ${checkoutNote}`
        : checkoutNote,
    };

    const nextRecords = records.map((r) =>
      r.tanggal === tanggal && r.nis.trim().toLowerCase() === targetNisNorm
        ? updatedRecord
        : r
    );
    setRecords(nextRecords);
    saveLocalRecords(nextRecords);
    speakSuccessNotification('Presensi Pulang Berhasil');
    pushToast({
      type: trimmedReason ? 'warning' : 'success',
      title: trimmedReason
        ? `${student.nama} — Pulang Cepat Dicatat`
        : `${student.nama} — Pulang Dicatat`,
      description: trimmedReason
        ? `Jam pulang ${nowTime} (${tanggal}) dikonfirmasi · Alasan: ${trimmedReason}`
        : `Jam pulang ${nowTime} pada ${tanggal} berhasil dikonfirmasi.`,
    });
    void syncMutation('recordPresensi', {
      ...updatedRecord,
      record: { ...updatedRecord },
    });
  }

  async function handleSaveSettings(newSettings: SchoolSettings) {
    setPreviewTheme(null);
    setSettings(newSettings);
    const localSaveRes = saveLocalSettings(newSettings);
    saveDefaultSchoolIdentity({
      nama_sekolah: newSettings.nama_sekolah,
      logo_sekolah: newSettings.logo_sekolah || '',
    });
    const modeLabel =
      newSettings.mode_presensi === 'masuk_pulang'
        ? `Masuk ${newSettings.batas_jam_masuk} · Pulang ${newSettings.jam_pulang_standar}`
        : `Masuk Saja · Batas ${newSettings.batas_jam_masuk}`;
    if (!localSaveRes.ok) {
      pushToast({
        type: 'error',
        title: 'Gagal Menyimpan ke Penyimpanan Lokal',
        description:
          localSaveRes.error ||
          'Ukuran file gambar terlalu besar untuk disimpan di browser.',
      });
    } else {
      pushToast({
        type: 'success',
        title: 'Pengaturan Disimpan',
        description: `${newSettings.nama_sekolah} · TA ${newSettings.tahun_ajaran} (Smt ${formatSemesterLabel(
          newSettings.semester
        )}) · ${modeLabel}`,
      });
    }
    await syncMutation(
      'savePengaturan',
      {
        nama_sekolah: newSettings.nama_sekolah,
        nama_kepala_sekolah: newSettings.nama_kepala_sekolah || '',
        nip_kepala_sekolah: newSettings.nip_kepala_sekolah || '',
        ttd_kepala_sekolah: newSettings.ttd_kepala_sekolah || '',
        cap_sekolah: newSettings.cap_sekolah || '',
        batas_jam_masuk: newSettings.batas_jam_masuk,
        mode_presensi: newSettings.mode_presensi,
        jam_pulang_standar: newSettings.jam_pulang_standar,
        tahun_ajaran: newSettings.tahun_ajaran,
        semester: normalizeSemester(newSettings.semester, 'ganjil'),
        tema: newSettings.tema,
        logo_sekolah: newSettings.logo_sekolah || '',
      },
      newSettings.script_url
    );
  }

  function handleSetDefaultIdentity(namaSekolah: string, logoSekolah?: string) {
    const saved = saveDefaultSchoolIdentity({
      nama_sekolah: namaSekolah,
      logo_sekolah: logoSekolah || '',
    });
    const nextSettings: SchoolSettings = {
      ...settings,
      nama_sekolah: saved.nama_sekolah,
      logo_sekolah: saved.logo_sekolah || '',
    };
    setSettings(nextSettings);
    saveLocalSettings(nextSettings);
    pushToast({
      type: 'success',
      title: 'Identitas Default Diperbarui',
      description: `"${saved.nama_sekolah}" dan logo saat ini telah dijadikan default aplikasi.`,
    });
    if (nextSettings.script_url.trim()) {
      void syncMutation('savePengaturan', {
        nama_sekolah: nextSettings.nama_sekolah,
        nama_kepala_sekolah: nextSettings.nama_kepala_sekolah || '',
        nip_kepala_sekolah: nextSettings.nip_kepala_sekolah || '',
        ttd_kepala_sekolah: nextSettings.ttd_kepala_sekolah || '',
        cap_sekolah: nextSettings.cap_sekolah || '',
        batas_jam_masuk: nextSettings.batas_jam_masuk,
        mode_presensi: nextSettings.mode_presensi,
        jam_pulang_standar: nextSettings.jam_pulang_standar,
        tahun_ajaran: nextSettings.tahun_ajaran,
        semester: normalizeSemester(nextSettings.semester, 'ganjil'),
        tema: nextSettings.tema,
        logo_sekolah: nextSettings.logo_sekolah || '',
      });
    }
  }

  function handleUpdateAccounts(nextAccounts: UserAccount[]) {
    setAccounts(nextAccounts);
    saveUserAccounts(nextAccounts);

    if (session) {
      const updatedCurrent = nextAccounts.find((a) => a.id === session.userId);
      if (updatedCurrent) {
        const syncedSession: AuthSession = {
          userId: updatedCurrent.id,
          username: updatedCurrent.username,
          nama: updatedCurrent.nama,
          nip: updatedCurrent.nip,
          role: updatedCurrent.role,
          jabatan: formatRoleLabel(updatedCurrent.role, updatedCurrent.kelas_binaan),
          kelas_binaan: updatedCurrent.kelas_binaan,
        };
        setSession(syncedSession);
        saveAuthSession(syncedSession);
      }
    }

    pushToast({
      type: 'success',
      title: 'Daftar Akun Diperbarui',
      description: `Total ${nextAccounts.length} akun aktif tersimpan.`,
    });
  }

  function handleResetAllAttendance() {
    setRecords([]);
    saveLocalRecords([]);
    setSubjectRecords([]);
    saveSubjectRecords([]);
    pushToast({
      type: 'info',
      title: 'Semua Data Presensi Direset',
      description:
        'Seluruh riwayat presensi harian & mata pelajaran telah dikosongkan. Data siswa tetap tersimpan.',
    });
    void syncMutation('resetPresensi', {});
  }

  function handleResetDemo() {
    const fresh = resetLocalDemoData(settings);
    const activeSem = normalizeSemester(fresh.settings.semester, 'ganjil');
    const demoAssignments = generateDemoSubjectAssignments(fresh.settings.tahun_ajaran);
    const demoSchedules = generateDemoTeacherSchedules(fresh.settings.tahun_ajaran, activeSem);
    setPreviewTheme(null);
    setStudents(fresh.students);
    setRecords(fresh.records);
    setSettings(fresh.settings);
    setTeacherSchedules(demoSchedules);
    saveTeacherSchedules(demoSchedules);
    setSubjectAssignments(demoAssignments);
    saveSubjectAssignments(demoAssignments);
    setSubjectRecords([]);
    saveSubjectRecords([]);
    pushToast({
      type: 'info',
      title: 'Data Demo Dimuat',
      description:
        'Data siswa, riwayat presensi, dan contoh jadwal pelajaran guru telah dimuat ke penyimpanan lokal.',
    });
  }

  function handleAddMasterSubject(input: {
    kode: string;
    nama: string;
    deskripsi?: string;
  }): { ok: boolean; error?: string } {
    const res = addMasterSubject(masterSubjects, input);
    if (!res.ok) return res;
    setMasterSubjects(res.subjects);
    saveMasterSubjects(res.subjects);
    pushToast({
      type: 'success',
      title: 'Mata Pelajaran Ditambahkan',
      description: `[${res.subject.kode}] ${res.subject.nama} ditambahkan ke daftar master.`,
    });
    return { ok: true };
  }

  function handleUpdateMasterSubject(
    id: string,
    input: { kode: string; nama: string; deskripsi?: string }
  ): { ok: boolean; error?: string } {
    const res = updateMasterSubject(masterSubjects, id, input);
    if (!res.ok) return res;
    setMasterSubjects(res.subjects);
    saveMasterSubjects(res.subjects);
    pushToast({
      type: 'success',
      title: 'Mata Pelajaran Diperbarui',
      description: `[${res.subject.kode}] ${res.subject.nama} berhasil disimpan.`,
    });
    return { ok: true };
  }

  function handleDeleteMasterSubject(id: string) {
    const target = masterSubjects.find((s) => s.id === id);
    const next = masterSubjects.filter((s) => s.id !== id);
    setMasterSubjects(next);
    saveMasterSubjects(next);
    pushToast({
      type: 'info',
      title: 'Mata Pelajaran Dihapus',
      description: target ? `${target.nama} telah dihapus.` : undefined,
    });
  }

  function handleAddTeacherSchedule(input: {
    hari: DayOfWeek;
    teacher_user_id: string;
    teacher_name: string;
    kelas: string;
    mata_pelajaran: string;
    jam_mulai: string;
    jam_selesai: string;
    semester?: SemesterKind;
  }): { ok: boolean; error?: string } {
    const res = addTeacherSchedule(teacherSchedules, {
      ...input,
      tahun_ajaran: settings.tahun_ajaran,
      semester: input.semester ?? normalizeSemester(settings.semester, 'ganjil'),
    });
    if (!res.ok) return res;
    setTeacherSchedules(res.schedules);
    saveTeacherSchedules(res.schedules);
    pushToast({
      type: 'success',
      title: 'Jadwal Guru Ditambahkan',
      description: `${res.schedule.hari} ${res.schedule.jam_mulai}–${res.schedule.jam_selesai} · ${res.schedule.mata_pelajaran} (${res.schedule.kelas})`,
    });
    return { ok: true };
  }

  function handleUpdateTeacherSchedule(
    id: string,
    input: {
      hari: DayOfWeek;
      teacher_user_id: string;
      teacher_name: string;
      kelas: string;
      mata_pelajaran: string;
      jam_mulai: string;
      jam_selesai: string;
      semester?: SemesterKind;
    }
  ): { ok: boolean; error?: string } {
    const res = updateTeacherSchedule(teacherSchedules, id, {
      ...input,
      tahun_ajaran: settings.tahun_ajaran,
      semester: input.semester ?? normalizeSemester(settings.semester, 'ganjil'),
    });
    if (!res.ok) return res;
    setTeacherSchedules(res.schedules);
    saveTeacherSchedules(res.schedules);
    pushToast({
      type: 'success',
      title: 'Jadwal Guru Diperbarui',
      description: `${res.schedule.hari} · ${res.schedule.mata_pelajaran} (${res.schedule.kelas})`,
    });
    return { ok: true };
  }

  function handleDeleteTeacherSchedule(id: string) {
    const target = teacherSchedules.find((s) => s.id === id);
    const next = teacherSchedules.filter((s) => s.id !== id);
    setTeacherSchedules(next);
    saveTeacherSchedules(next);
    pushToast({
      type: 'info',
      title: 'Jadwal Dihapus',
      description: target
        ? `${target.hari} · ${target.mata_pelajaran} (${target.kelas}) dihapus.`
        : undefined,
    });
  }

  function handleAddSubjectAssignment(input: {
    kelas: string;
    mata_pelajaran: string;
    hari: DayOfWeek;
    jam_mulai?: string;
    jam_selesai?: string;
  }): { ok: boolean; assignment?: SubjectAssignment; error?: string } {
    if (!session) {
      return { ok: false, error: 'Silakan login terlebih dahulu.' };
    }
    const res = addSubjectAssignment(subjectAssignments, {
      teacher_user_id: session.userId,
      teacher_name: session.nama,
      kelas: input.kelas,
      mata_pelajaran: input.mata_pelajaran,
      hari: input.hari,
      jam_mulai: input.jam_mulai,
      jam_selesai: input.jam_selesai,
      tahun_ajaran: settings.tahun_ajaran,
      semester: normalizeSemester(settings.semester, 'ganjil'),
    });
    if (!res.ok) return res;
    setSubjectAssignments(res.assignments);
    saveSubjectAssignments(res.assignments);
    pushToast({
      type: 'success',
      title: 'Kelas & Mapel Ditambahkan',
      description: `${res.assignment.kelas} — ${res.assignment.mata_pelajaran} (${input.hari}) ditambahkan ke sub menu Anda.`,
    });
    return { ok: true, assignment: res.assignment };
  }

  function handleDeleteSubjectAssignment(assignmentId: string) {
    const target = subjectAssignments.find((a) => a.id === assignmentId);
    const nextAssignments = subjectAssignments.filter((a) => a.id !== assignmentId);
    setSubjectAssignments(nextAssignments);
    saveSubjectAssignments(nextAssignments);
    pushToast({
      type: 'info',
      title: 'Kelas & Mapel Dihapus',
      description: target
        ? `${target.kelas} — ${target.mata_pelajaran} dihapus dari daftar ajar.`
        : undefined,
    });
  }

  function handleScanSubject(
    assignment: SubjectAssignment,
    rawCode: string,
    tanggal: string
  ): SubjectScanOutcome {
    const outcome = processSubjectQrScan({
      qrRaw: rawCode,
      assignment,
      students: activeYearStudents,
      records: subjectRecords,
      tanggal,
    });

    if (outcome.ok) {
      speakSuccessNotification('Presensi Berhasil');
      const nextRecords = [outcome.record, ...subjectRecords];
      setSubjectRecords(nextRecords);
      saveSubjectRecords(nextRecords);
      pushToast({
        type: outcome.record.status === 'Hadir' ? 'success' : 'warning',
        title: `${outcome.student.nama} — ${outcome.record.status}`,
        description: `${assignment.mata_pelajaran} (${assignment.kelas}) dicatat pukul ${outcome.record.jam_masuk}`,
      });
      return outcome;
    }

    if (outcome.reason === 'duplicate') {
      speakDuplicateRejectedNotification('Presensi Ganda, Data Ditolak');
      pushToast({
        type: 'warning',
        title: 'Scan Ganda Ditolak',
        description: `${outcome.student?.nama} sudah tercatat ${outcome.existingRecord?.status} pada ${assignment.mata_pelajaran}.`,
      });
    } else {
      playWarningBeep();
      if (outcome.reason === 'wrong_class') {
        pushToast({
          type: 'error',
          title: `Bukan Siswa ${assignment.kelas}`,
          description: `${outcome.student?.nama} terdaftar di kelas ${outcome.student?.kelas}.`,
        });
      } else if (outcome.reason === 'not_found') {
        pushToast({
          type: 'error',
          title: 'NIS Tidak Terdaftar',
          description: `Siswa dengan NIS "${outcome.nis}" tidak ditemukan pada Tahun Ajaran ${settings.tahun_ajaran}.`,
        });
      }
    }
    return outcome;
  }

  function handleUpdateSubjectStatus(params: {
    assignment: SubjectAssignment;
    student: Student;
    tanggal: string;
    status: AttendanceStatus;
  }) {
    const res = upsertSubjectAttendanceStatus({
      records: subjectRecords,
      assignment: params.assignment,
      student: params.student,
      tanggal: params.tanggal,
      status: params.status,
    });
    setSubjectRecords(res.records);
    saveSubjectRecords(res.records);
    pushToast({
      type: 'success',
      title: 'Status Mapel Diperbarui',
      description: `${params.student.nama} (${params.assignment.mata_pelajaran}) ditandai ${params.status}.`,
    });
  }

  function handleMarkAllSubjectPresent(params: {
    assignment: SubjectAssignment;
    students: Student[];
    tanggal: string;
  }) {
    if (params.students.length === 0) return;
    let nextRecords = [...subjectRecords];
    const nowTime = getCurrentTimeString();
    for (const student of params.students) {
      const res = upsertSubjectAttendanceStatus({
        records: nextRecords,
        assignment: params.assignment,
        student,
        tanggal: params.tanggal,
        status: 'Hadir',
        currentTime: nowTime,
      });
      nextRecords = res.records;
    }
    setSubjectRecords(nextRecords);
    saveSubjectRecords(nextRecords);
    speakSuccessNotification('Presensi Berhasil');
    pushToast({
      type: 'success',
      title: `${params.students.length} Siswa Ditandai Hadir`,
      description: `${params.assignment.mata_pelajaran} — Kelas ${params.assignment.kelas} (${params.tanggal}).`,
    });
  }

  async function handleSaveBackupToComputer(): Promise<LastBackupMeta | null> {
    if (session?.role !== 'master_admin') {
      pushToast({
        type: 'warning',
        title: 'Akses Ditolak',
        description: 'Hanya Master Admin yang dapat menyimpan backup data aplikasi.',
      });
      return null;
    }
    const payload = createAppBackupPayload({
      students,
      records,
      settings,
      accounts,
      defaultIdentity: loadDefaultSchoolIdentity(),
      subjectAssignments,
      subjectRecords,
      masterSubjects,
      teacherSchedules,
      exportedBy: session.nama,
    });
    const res = await saveBackupToComputer(payload, true);
    if (!res.ok) {
      if (!res.cancelled) {
        pushToast({
          type: 'error',
          title: 'Gagal Menyimpan Backup',
          description: res.error || 'Terjadi kesalahan saat menyimpan file backup.',
        });
      }
      return null;
    }
    pushToast({
      type: 'success',
      title: 'Backup Tersimpan ke Komputer',
      description: `File ${res.filename} (${students.length} siswa, ${records.length} presensi) berhasil disimpan.`,
    });
    return res.meta;
  }

  function handleExportExcelArchive(): LastBackupMeta | null {
    if (session?.role !== 'master_admin') {
      pushToast({
        type: 'warning',
        title: 'Akses Ditolak',
        description: 'Hanya Master Admin yang dapat mengekspor arsip Excel lengkap.',
      });
      return null;
    }
    const payload = createAppBackupPayload({
      students,
      records,
      settings,
      accounts,
      defaultIdentity: loadDefaultSchoolIdentity(),
      subjectAssignments,
      subjectRecords,
      masterSubjects,
      teacherSchedules,
      exportedBy: session.nama,
    });
    const { filename, meta } = exportFullExcelArchive(payload);
    pushToast({
      type: 'success',
      title: 'Arsip Excel Tersimpan',
      description: `File ${filename} berisi sheet Siswa, Presensi, Pengaturan, dan Presensi Mapel berhasil diunduh.`,
    });
    return meta;
  }

  async function handleRestoreBackup(backup: AppBackupPayload): Promise<void> {
    if (session?.role !== 'master_admin') {
      pushToast({
        type: 'warning',
        title: 'Akses Ditolak',
        description: 'Hanya Master Admin yang memiliki wewenang memulihkan backup data.',
      });
      return;
    }

    const {
      students: restoredStudents,
      records: restoredRecords,
      settings: restoredSettings,
      accounts: restoredAccounts,
      defaultIdentity: restoredIdentity,
      subjectAssignments: restoredAssignments,
      subjectRecords: restoredSubjectRecords,
      masterSubjects: restoredMasterSubjects,
      teacherSchedules: restoredTeacherSchedules,
    } = backup.data;

    setPreviewTheme(null);
    setStudents(restoredStudents);
    setRecords(restoredRecords);
    setSettings(restoredSettings);
    saveLocalStudents(restoredStudents);
    saveLocalRecords(restoredRecords);
    saveLocalSettings(restoredSettings);
    saveDefaultSchoolIdentity(restoredIdentity);

    if (Array.isArray(restoredAssignments)) {
      setSubjectAssignments(restoredAssignments);
      saveSubjectAssignments(restoredAssignments);
    }
    if (Array.isArray(restoredSubjectRecords)) {
      setSubjectRecords(restoredSubjectRecords);
      saveSubjectRecords(restoredSubjectRecords);
    }
    if (Array.isArray(restoredMasterSubjects) && restoredMasterSubjects.length > 0) {
      setMasterSubjects(restoredMasterSubjects);
      saveMasterSubjects(restoredMasterSubjects);
    }
    if (Array.isArray(restoredTeacherSchedules)) {
      setTeacherSchedules(restoredTeacherSchedules);
      saveTeacherSchedules(restoredTeacherSchedules);
    }

    if (restoredAccounts.length > 0) {
      setAccounts(restoredAccounts);
      saveUserAccounts(restoredAccounts);
    }

    clearSyncQueue();
    setPendingSyncCount(0);

    pushToast({
      type: 'success',
      title: 'Data Berhasil Dipulihkan',
      description: `${restoredStudents.length} siswa, ${restoredRecords.length} presensi, dan pengaturan telah dipulihkan dari file backup.`,
    });

    if (restoredSettings.script_url.trim()) {
      await syncMutation(
        'syncAll',
        {
          students: restoredStudents,
          records: restoredRecords,
          settings: {
            nama_sekolah: restoredSettings.nama_sekolah,
            nama_kepala_sekolah: restoredSettings.nama_kepala_sekolah || '',
            nip_kepala_sekolah: restoredSettings.nip_kepala_sekolah || '',
            ttd_kepala_sekolah: restoredSettings.ttd_kepala_sekolah || '',
            cap_sekolah: restoredSettings.cap_sekolah || '',
            batas_jam_masuk: restoredSettings.batas_jam_masuk,
            mode_presensi: restoredSettings.mode_presensi,
            jam_pulang_standar: restoredSettings.jam_pulang_standar,
            tahun_ajaran: restoredSettings.tahun_ajaran,
            semester: normalizeSemester(restoredSettings.semester, 'ganjil'),
            tema: restoredSettings.tema,
            logo_sekolah: restoredSettings.logo_sekolah || '',
          },
        },
        restoredSettings.script_url
      );
    }
  }

  const effectiveTab: TabId = canAccessTab(session?.role ?? null, activeTab)
    ? activeTab
    : session
      ? getDefaultTabForRole(session.role)
      : 'scan';

  return (
    <>
      {showSplash && (
        <OpeningSplash
          settings={settings}
          onFinish={handleSplashFinish}
        />
      )}

      <AuthLoadingOverlay
        transition={authTransition}
        settings={settings}
        durationMs={5000}
        onComplete={handleCompleteAuthTransition}
      />

      <LayoutShell
        activeTab={effectiveTab}
        onSelectTab={handleSelectTab}
        settings={settings}
        session={session}
        onOpenLogin={() => {
          setPendingTab(null);
          setLoginModalOpen(true);
        }}
        onLogout={handleLogout}
        connectionStatus={connectionStatus}
        lastSyncedAt={lastSyncedAt}
        onSyncNow={() => void syncFromGas(settings.script_url, false)}
        toasts={toasts}
        onDismissToast={dismissToast}
      >
        {effectiveTab === 'scan' && (
          <ScannerView
            students={activeYearStudents}
            records={activeYearRecords}
            settings={settings}
            onScanSubmit={handleScanSubmit}
          />
        )}

        {effectiveTab === 'dashboard' && (
          <DashboardView
            students={scopedStudents}
            records={scopedRecords}
            settings={settings}
            assignedClass={waliClass}
            canAccessScan={canAccessTab(session?.role ?? null, 'scan')}
            masterYearControl={masterYearControl}
            onNavigate={handleSelectTab}
          />
        )}

        {effectiveTab === 'siswa' && (
          <StudentsView
            students={scopedStudents}
            settings={settings}
            assignedClass={waliClass}
            canEdit={canEditStudents(session?.role ?? null)}
            canViewECard={canViewStudentECard(session?.role ?? null)}
            canDelete={canDeleteStudents(session?.role ?? null)}
            masterYearControl={masterYearControl}
            onAddStudent={handleAddStudent}
            onBulkImportStudents={handleBulkImportStudents}
            onUpdateStudent={handleUpdateStudent}
            onDeleteStudent={handleDeleteStudent}
            onBulkDeleteStudents={handleBulkDeleteStudents}
          />
        )}

        {effectiveTab === 'rekap' && (
          <RecapView
            students={scopedStudents}
            records={scopedRecords}
            settings={settings}
            accounts={accounts}
            currentSession={session}
            assignedClass={waliClass}
            isGuruMode={session?.role === 'guru'}
            canExport={canExportRecap(session?.role ?? null)}
            canSendParentWa={canSendParentRecap(session?.role ?? null)}
            canModifyStatus={canModifyRecapStatus(session?.role ?? null)}
            masterYearControl={masterYearControl}
            onUpdateStatus={handleUpdateRecapStatus}
            onConfirmCheckout={handleConfirmCheckout}
          />
        )}

        {effectiveTab === 'mapel' && session && (
          <SubjectAttendanceView
            session={session}
            accounts={accounts}
            students={activeYearStudents}
            settings={settings}
            assignments={subjectAssignments}
            schedules={teacherSchedules}
            masterSubjects={masterSubjects}
            records={subjectRecords}
            onAddAssignment={handleAddSubjectAssignment}
            onDeleteAssignment={handleDeleteSubjectAssignment}
            onScanSubject={handleScanSubject}
            onUpdateStudentStatus={(assignment, student, tanggal, status) =>
              handleUpdateSubjectStatus({ assignment, student, tanggal, status })
            }
            onMarkAllPresent={(assignment, classStudents, tanggal) =>
              handleMarkAllSubjectPresent({
                assignment,
                students: classStudents,
                tanggal,
              })
            }
            onNavigateToSchedule={
              session.role === 'master_admin' ? () => setActiveTab('jadwal') : undefined
            }
          />
        )}

        {effectiveTab === 'jadwal' && session?.role === 'master_admin' && (
          <ScheduleManagementView
            settings={settings}
            accounts={accounts}
            availableClasses={availableClasses}
            masterSubjects={masterSubjects}
            schedules={teacherSchedules}
            onAddMasterSubject={handleAddMasterSubject}
            onUpdateMasterSubject={handleUpdateMasterSubject}
            onDeleteMasterSubject={handleDeleteMasterSubject}
            onAddSchedule={handleAddTeacherSchedule}
            onUpdateSchedule={handleUpdateTeacherSchedule}
            onDeleteSchedule={handleDeleteTeacherSchedule}
          />
        )}

        {effectiveTab === 'analisis' && (
          <AnalyticsView
            students={scopedStudents}
            records={scopedRecords}
            settings={settings}
            assignedClass={waliClass}
            masterYearControl={masterYearControl}
          />
        )}

        {effectiveTab === 'pengaturan' && (
          <SettingsView
            settings={settings}
            accounts={accounts}
            availableClasses={availableClasses}
            totalStudentsCount={students.length}
            totalRecordsCount={records.length}
            connectionStatus={connectionStatus}
            pendingSyncCount={pendingSyncCount}
            onSaveSettings={handleSaveSettings}
            onSetDefaultIdentity={handleSetDefaultIdentity}
            onPreviewTheme={(tema) => setPreviewTheme(tema)}
            onUpdateAccounts={handleUpdateAccounts}
            onTestAndSync={(url) => syncFromGas(url, false)}
            onPushAllToSheets={handlePushAllToSheets}
            onSaveBackupToComputer={handleSaveBackupToComputer}
            onExportExcelArchive={handleExportExcelArchive}
            onRestoreBackup={handleRestoreBackup}
            onResetAllAttendance={handleResetAllAttendance}
            onResetDemo={handleResetDemo}
          />
        )}
      </LayoutShell>

      <LoginModal
        open={loginModalOpen}
        targetHint={pendingTab ? TAB_LABELS[pendingTab] : undefined}
        onClose={() => {
          setLoginModalOpen(false);
          setPendingTab(null);
        }}
        onSubmit={handleLoginSubmit}
        onResetPassword={handleResetPasswordWithNip}
      />
    </>
  );
}
