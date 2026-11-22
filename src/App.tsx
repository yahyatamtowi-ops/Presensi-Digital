import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import { auth, signInWithGoogle, signOutFirebase } from './firebase';
import {
  bulkUpsertAttendanceToCloud,
  bulkUpsertStudentsToCloud,
  bulkUpsertSubjectRecordsToCloud,
  clearAllAttendanceInCloud,
  deleteMasterSubjectFromCloud,
  deleteStudentFromCloud,
  deleteSubjectAssignmentFromCloud,
  deleteTeacherScheduleFromCloud,
  ensureSchoolWorkspaceExists,
  pushFullLocalStateToCloud,
  saveSchoolSettingsToCloud,
  subscribeToSchoolWorkspace,
  syncAllAccountsToCloud,
  upsertAttendanceToCloud,
  upsertMasterSubjectToCloud,
  upsertStudentToCloud,
  upsertSubjectAssignmentToCloud,
  upsertSubjectRecordToCloud,
  upsertTeacherScheduleToCloud,
  type FullLocalSchoolSnapshot,
} from './utils/firestoreSync';
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
  TimetableConfig,
  ToastMessage,
  UserAccount,
} from './types';
import {
  clearSyncQueue,
  enqueueSyncMutation,
  fetchAllFromGas,
  flushSyncQueue,
  hydrateSyncQueueFromOfflineStore,
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
import { isBrowserOnline } from './utils/offlineStore';
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
  initSpeechEngine,
  playWarningBeep,
  speakCheckoutSuccessNotification,
  speakDuplicateRejectedNotification,
  speakOfflineAttendanceNotification,
  speakSuccessNotification,
  speakWaliKelasReminder,
  speakWelcomeGreeting,
  unlockSpeechForMobile,
} from './utils/sound';
import {
  buildFirestoreQuotaSnapshot,
  loadFirestoreDailyUsage,
  resetFirestoreDailyUsage,
  subscribeFirestoreUsage,
} from './utils/firestoreUsage';
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
  reconcileSchedulesAndAssignments,
  saveMasterSubjects,
  saveSubjectAssignments,
  saveSubjectRecords,
  saveTeacherSchedules,
  syncAssignmentToTeacherSchedules,
  syncScheduleToSubjectAssignments,
  updateMasterSubject,
  updateTeacherSchedule,
  upsertSubjectAttendanceStatus,
  type SubjectScanOutcome,
} from './utils/subjectAttendance';
import {
  getSchoolDaysForCount,
  getTimetableConfigKey,
  loadTimetableConfigs,
  renameSubjectInTimetableConfigs,
  saveTimetableConfigs,
  syncTimetableConfigsFromSchedules,
} from './utils/timetableLogic';
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
import { TimetableMatrixView } from './components/TimetableMatrixView';
import { TeacherLessonListView } from './components/TeacherLessonListView';
import { AnalyticsView } from './components/AnalyticsView';
import { SettingsView } from './components/SettingsView';

const TAB_LABELS: Record<TabId, string> = {
  scan: 'Scan QR',
  dashboard: 'Dashboard',
  siswa: 'Data Siswa & E-Card',
  rekap: 'Rekap & Export',
  mapel: 'Presensi Mata Pelajaran',
  daftar_pelajaran: 'Daftar Pelajaran',
  jadwal: 'Mapel & Jadwal Pelajaran',
  pengaturan_jadwal: 'Pengaturan Jadwal Mata Pelajaran',
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
  const [initialReconciledAcademic] = useState(() =>
    reconcileSchedulesAndAssignments(
      loadTeacherSchedules(),
      loadSubjectAssignments(),
      normalizeSemester(initialCache.settings.semester, 'ganjil')
    )
  );
  const [teacherSchedules, setTeacherSchedules] = useState<TeacherSchedule[]>(
    initialReconciledAcademic.schedules
  );
  const [subjectAssignments, setSubjectAssignments] = useState<SubjectAssignment[]>(
    initialReconciledAcademic.assignments
  );
  const [timetableConfigs, setTimetableConfigs] = useState<
    Record<string, TimetableConfig>
  >(() => {
    const loaded = loadTimetableConfigs();
    if (initialReconciledAcademic.schedules.length === 0) return loaded;
    const synced = syncTimetableConfigsFromSchedules(
      loaded,
      initialReconciledAcademic.schedules,
      initialCache.settings.batas_jam_masuk || '07:15'
    );
    saveTimetableConfigs(synced);
    return synced;
  });
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

  const handleSplashFinish = useCallback((fromUserGesture = false) => {
    setShowSplash(false);
    if (!welcomeSpokenRef.current) {
      welcomeSpokenRef.current = true;
      speakWelcomeGreeting(latestDataRef.current.settings.nama_sekolah, fromUserGesture);
    }
  }, []);

  const handleReplayVoice = useCallback(() => {
    unlockSpeechForMobile();
    speakWelcomeGreeting(latestDataRef.current.settings.nama_sekolah, true);
  }, []);

  // Preload Indonesian female TTS voices & register mobile/tablet gesture unlock once on mount
  useEffect(() => {
    initSpeechEngine();
  }, []);

  // Scan QR is always the default initial page (accessible without login)
  const [activeTab, setActiveTab] = useState<TabId>('scan');
  const [isOnline, setIsOnline] = useState<boolean>(() => isBrowserOnline());
  const [syncingQueue, setSyncingQueue] = useState<boolean>(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(
    !isBrowserOnline()
      ? 'offline'
      : initialCache.settings.script_url
        ? 'syncing'
        : 'offline'
  );
  const [sheetsSupportsAkun, setSheetsSupportsAkun] = useState<boolean | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(
    () => loadSyncQueue().length
  );
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [firebaseAuthReady, setFirebaseAuthReady] = useState(false);
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [cloudConnected, setCloudConnected] = useState(false);
  const [firestoreDailyUsage, setFirestoreDailyUsage] = useState(() =>
    loadFirestoreDailyUsage()
  );

  const syncInFlightRef = useRef(false);
  const lastLocalSettingsSaveAtRef = useRef(0);
  const settingsSaveInFlightRef = useRef(false);
  const lastLocalAccountsSaveAtRef = useRef(0);
  const accountsSaveInFlightRef = useRef(false);
  const lastLocalRecordsSaveAtRef = useRef(0);
  const recordsSaveInFlightCountRef = useRef(0);
  const lastLocalStudentsSaveAtRef = useRef(0);
  const studentsSaveInFlightCountRef = useRef(0);
  const autoSeededAkunForUrlRef = useRef<string | null>(null);
  const lastLocalAcademicSaveAtRef = useRef(0);
  const latestDataRef = useRef({ students, records, settings });
  latestDataRef.current = { students, records, settings };
  const latestFullSnapshotRef = useRef<FullLocalSchoolSnapshot>({
    settings,
    students,
    records,
    masterSubjects,
    teacherSchedules,
    subjectAssignments,
    subjectRecords,
    accounts,
  });
  latestFullSnapshotRef.current = {
    settings,
    students,
    records,
    masterSubjects,
    teacherSchedules,
    subjectAssignments,
    subjectRecords,
    accounts,
  };

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

  const syncTimetablesWithSchedules = useCallback((nextSchedules: TeacherSchedule[]) => {
    const fallbackStart = latestDataRef.current.settings.batas_jam_masuk || '07:15';
    setTimetableConfigs((prev) => {
      const next = syncTimetableConfigsFromSchedules(prev, nextSchedules, fallbackStart);
      saveTimetableConfigs(next);
      return next;
    });
  }, []);

  useEffect(() => {
    return subscribeFirestoreUsage(() => {
      setFirestoreDailyUsage(loadFirestoreDailyUsage());
    });
  }, []);

  const firestoreQuota = useMemo(
    () =>
      buildFirestoreQuotaSnapshot(firestoreDailyUsage, {
        settings,
        students,
        records,
        masterSubjects,
        teacherSchedules,
        subjectAssignments,
        subjectRecords,
        accounts,
      }),
    [
      firestoreDailyUsage,
      settings,
      students,
      records,
      masterSubjects,
      teacherSchedules,
      subjectAssignments,
      subjectRecords,
      accounts,
    ]
  );

  const handleResetLocalQuota = useCallback(() => {
    setFirestoreDailyUsage(resetFirestoreDailyUsage());
    pushToast({
      type: 'info',
      title: 'Counter Kuota Lokal Direset',
      description:
        'Penghitung penggunaan harian di perangkat ini direset ke 0. Total resmi tetap mengacu pada Firebase Console.',
    });
  }, [pushToast]);

  const isQuotaExceededError = (err: unknown): boolean => {
    const msg = (err instanceof Error ? err.message : String(err || '')).toLowerCase();
    return msg.includes('resource-exhausted') || msg.includes('quota exceeded');
  };

  // Track Firebase Auth state for real-time cross-device cloud sync
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setFirebaseAuthReady(true);
      if (!user) {
        setCloudConnected(false);
        setCloudSyncing(false);
      }
    });
    return () => unsub();
  }, []);

  // Attach real-time Firestore workspace listeners ONLY after auth is ready & user signed in
  useEffect(() => {
    if (!firebaseAuthReady || !firebaseUser) return;
    if (!firebaseUser.emailVerified) {
      pushToast({
        type: 'warning',
        title: 'Email Google Belum Terverifikasi',
        description: 'Gunakan akun Google dengan email terverifikasi untuk sinkronisasi cloud.',
      });
      return;
    }

    let cancelled = false;
    let unsubscribeWorkspace: (() => void) | null = null;

    setCloudSyncing(true);

    const bootstrapAndListen = async () => {
      try {
        const snapshot = latestFullSnapshotRef.current;
        const { createdNew } = await ensureSchoolWorkspaceExists(
          firebaseUser.uid,
          snapshot
        );
        if (cancelled) return;

        unsubscribeWorkspace = subscribeToSchoolWorkspace(firebaseUser.uid, {
          getFallbackSettings: () => latestDataRef.current.settings,
          onSettings: (cloudSettings) => {
            if (settingsSaveInFlightRef.current) return;
            setSettings(cloudSettings);
            saveLocalSettings(cloudSettings);
            saveDefaultSchoolIdentity({
              nama_sekolah: cloudSettings.nama_sekolah,
              logo_sekolah: cloudSettings.logo_sekolah || '',
            });
          },
          onStudents: (cloudStudents) => {
            setStudents(cloudStudents);
            saveLocalStudents(cloudStudents);
          },
          onRecords: (cloudRecords) => {
            setRecords(cloudRecords);
            saveLocalRecords(cloudRecords);
          },
          onMasterSubjects: (cloudSubjects) => {
            setMasterSubjects(cloudSubjects);
            saveMasterSubjects(cloudSubjects);
          },
          onTeacherSchedules: (cloudSchedules) => {
            setTeacherSchedules(cloudSchedules);
            saveTeacherSchedules(cloudSchedules);
            syncTimetablesWithSchedules(cloudSchedules);
          },
          onSubjectAssignments: (cloudAssignments) => {
            setSubjectAssignments(cloudAssignments);
            saveSubjectAssignments(cloudAssignments);
          },
          onSubjectRecords: (cloudSubjectRecords) => {
            setSubjectRecords(cloudSubjectRecords);
            saveSubjectRecords(cloudSubjectRecords);
          },
          onAccounts: (cloudAccounts) => {
            setAccounts(cloudAccounts);
            saveUserAccounts(cloudAccounts);
            setSession((prevSession) => {
              if (!prevSession) return prevSession;
              const matched = cloudAccounts.find(
                (a) =>
                  a.id === prevSession.userId ||
                  a.username.toLowerCase() === prevSession.username.toLowerCase()
              );
              if (!matched) return prevSession;
              const syncedSession: AuthSession = {
                userId: matched.id,
                username: matched.username,
                nama: matched.nama,
                nip: matched.nip,
                role: matched.role,
                jabatan: formatRoleLabel(matched.role, matched.kelas_binaan),
                kelas_binaan: matched.kelas_binaan,
              };
              if (
                syncedSession.userId === prevSession.userId &&
                syncedSession.username === prevSession.username &&
                syncedSession.nama === prevSession.nama &&
                (syncedSession.nip || '') === (prevSession.nip || '') &&
                syncedSession.role === prevSession.role &&
                syncedSession.jabatan === prevSession.jabatan &&
                (syncedSession.kelas_binaan || '') === (prevSession.kelas_binaan || '')
              ) {
                return prevSession;
              }
              saveAuthSession(syncedSession);
              return syncedSession;
            });
          },
          onSyncActivity: () => {
            setCloudConnected(true);
            setCloudSyncing(false);
            setLastSyncedAt(getCurrentTimeString());
          },
          onError: (err, path) => {
            setCloudSyncing(false);
            if (isQuotaExceededError(err)) {
              pushToast({
                type: 'warning',
                title: 'Kuota Gratis Firestore Hari Ini Habis',
                description:
                  'Batas gratis harian Spark Plan tercapai (reset otomatis 00:00 PT / 14:00 WIB). Data lokal tetap aman digunakan.',
              });
              return;
            }
            pushToast({
              type: 'error',
              title: 'Gangguan Sinkronisasi Cloud',
              description: `Gagal memuat data cloud (${path}). Data lokal tetap aman digunakan.`,
            });
          },
        });

        setCloudConnected(true);
        setCloudSyncing(false);
        setLastSyncedAt(getCurrentTimeString());

        if (createdNew) {
          pushToast({
            type: 'success',
            title: 'Cloud Firebase Aktif',
            description: `Data lokal (${snapshot.students.length} siswa, ${snapshot.records.length} presensi) diunggah ke Cloud dan siap dibuka di perangkat lain.`,
          });
        }
      } catch (err) {
        if (cancelled) return;
        setCloudConnected(false);
        setCloudSyncing(false);
        pushToast({
          type: 'error',
          title: 'Gagal Menghubungkan Cloud Firebase',
          description:
            err instanceof Error
              ? err.message
              : 'Periksa koneksi internet dan coba hubungkan kembali.',
        });
      }
    };

    void bootstrapAndListen();

    return () => {
      cancelled = true;
      if (unsubscribeWorkspace) {
        unsubscribeWorkspace();
      }
    };
  }, [firebaseAuthReady, firebaseUser, pushToast]);

  const runCloudWrite = useCallback(
    (writer: (uid: string) => Promise<void>) => {
      const uid = firebaseUser?.uid;
      if (!uid || !firebaseUser?.emailVerified) return;
      void writer(uid)
        .then(() => {
          setLastSyncedAt(getCurrentTimeString());
        })
        .catch((err) => {
          if (isQuotaExceededError(err)) {
            pushToast({
              type: 'warning',
              title: 'Kuota Gratis Firestore Tercapai',
              description:
                'Perubahan tersimpan lokal. Kuota gratis Spark Plan akan reset otomatis besok atau cek di menu Cloud & Sheets.',
            });
            return;
          }
          pushToast({
            type: 'warning',
            title: 'Perubahan Tersimpan Lokal',
            description:
              'Sinkronisasi cloud tertunda. Pastikan perangkat terhubung ke internet.',
          });
        });
    },
    [firebaseUser, pushToast]
  );

  const handleConnectCloud = useCallback(async () => {
    setCloudSyncing(true);
    try {
      const user = await signInWithGoogle();
      pushToast({
        type: 'success',
        title: 'Terhubung ke Cloud Firebase',
        description: `Masuk sebagai ${user.email || user.displayName || 'Google'}. Data disinkronkan secara real-time lintas perangkat.`,
      });
    } catch (err) {
      setCloudSyncing(false);
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return;
      }
      pushToast({
        type: 'error',
        title: 'Gagal Masuk dengan Google',
        description:
          err instanceof Error
            ? err.message
            : 'Pastikan popup login Google diizinkan oleh browser.',
      });
    }
  }, [pushToast]);

  const handleDisconnectCloud = useCallback(async () => {
    setCloudSyncing(true);
    try {
      await signOutFirebase();
      setCloudConnected(false);
      pushToast({
        type: 'info',
        title: 'Koneksi Cloud Diputuskan',
        description: 'Aplikasi kembali ke penyimpanan lokal di perangkat ini.',
      });
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'Gagal Memutuskan Cloud',
        description: err instanceof Error ? err.message : 'Coba lagi beberapa saat.',
      });
    } finally {
      setCloudSyncing(false);
    }
  }, [pushToast]);

  const handlePushLocalToCloud = useCallback(async () => {
    const uid = firebaseUser?.uid;
    if (!uid) {
      await handleConnectCloud();
      return;
    }
    setCloudSyncing(true);
    try {
      const snapshot = latestFullSnapshotRef.current;
      await pushFullLocalStateToCloud(uid, snapshot, false);
      setLastSyncedAt(getCurrentTimeString());
      pushToast({
        type: 'success',
        title: 'Data Lokal Tersinkron ke Cloud',
        description: `${snapshot.students.length} siswa, ${snapshot.records.length} presensi, jadwal mapel, dan pengaturan berhasil dikirim ke Firebase.`,
      });
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'Gagal Mengirim ke Cloud',
        description: err instanceof Error ? err.message : 'Periksa koneksi internet Anda.',
      });
    } finally {
      setCloudSyncing(false);
    }
  }, [firebaseUser, handleConnectCloud, pushToast]);

  const syncFromGas = useCallback(
    async (
      scriptUrl: string,
      silent = false,
      options?: { forcePullRemote?: boolean }
    ): Promise<{
      ok: boolean;
      hasRemoteData: boolean;
      studentsCount: number;
      recordsCount: number;
      accountsCount: number;
      schedulesCount: number;
      subjectRecordsCount: number;
    }> => {
      const emptyResult = {
        ok: false,
        hasRemoteData: false,
        studentsCount: 0,
        recordsCount: 0,
        accountsCount: 0,
        schedulesCount: 0,
        subjectRecordsCount: 0,
      };
      const trimmed = scriptUrl.trim();
      if (!trimmed) {
        setConnectionStatus('offline');
        setSheetsSupportsAkun(null);
        if (!silent) {
          pushToast({
            type: 'info',
            title: 'Mode Offline / Cache Lokal',
            description:
              'Isi Web App URL Google Apps Script di menu Pengaturan untuk sinkronisasi ke Google Sheets.',
          });
        }
        return emptyResult;
      }

      if (!isBrowserOnline()) {
        setIsOnline(false);
        setConnectionStatus('offline');
        if (!silent) {
          pushToast({
            type: 'warning',
            title: 'Perangkat Sedang Offline',
            description:
              'Koneksi internet belum tersedia. Data tetap aman di penyimpanan offline dan akan tersinkron otomatis saat terhubung kembali.',
          });
        }
        return emptyResult;
      }

      const forcePullRemote = Boolean(options?.forcePullRemote);
      if (syncInFlightRef.current && !forcePullRemote) return emptyResult;
      syncInFlightRef.current = true;

      if (!silent || forcePullRemote) {
        setConnectionStatus('syncing');
      }

      try {
        // Flush any queued offline mutations before pulling remote state
        // (Skip flush when connecting a fresh device via forcePullRemote so stale defaults aren't pushed)
        const flushResult = forcePullRemote
          ? { flushed: 0, remaining: loadSyncQueue().length, lastError: undefined as string | undefined }
          : await flushSyncQueue(trimmed);
        setPendingSyncCount(flushResult.remaining);
        if (flushResult.flushed > 0) {
          pushToast({
            type: 'success',
            title: 'Data Offline Tersinkronisasi',
            description: `${flushResult.flushed} data yang disimpan saat offline berhasil dikirim otomatis ke Google Sheets.`,
          });
        } else if (flushResult.remaining > 0 && !silent && flushResult.lastError) {
          pushToast({
            type: 'warning',
            title: 'Sebagian Antrean Belum Tersimpan ke Sheets',
            description: `${flushResult.remaining} perubahan masih menunggu: ${flushResult.lastError}`,
          });
        }

        const fetchStartedAt = Date.now();
        const remote = await fetchAllFromGas(trimmed);
        setSheetsSupportsAkun(remote.supportsAkun);

        const canApplyRemoteStudents =
          (forcePullRemote ||
            (flushResult.remaining === 0 &&
              studentsSaveInFlightCountRef.current === 0 &&
              lastLocalStudentsSaveAtRef.current <= fetchStartedAt)) &&
          remote.students.length > 0;

        if (canApplyRemoteStudents) {
          latestDataRef.current.students = remote.students;
          latestFullSnapshotRef.current.students = remote.students;
          setStudents(remote.students);
          saveLocalStudents(remote.students);
        }

        const canApplyRemoteRecords =
          (forcePullRemote ||
            (flushResult.remaining === 0 &&
              recordsSaveInFlightCountRef.current === 0 &&
              lastLocalRecordsSaveAtRef.current <= fetchStartedAt)) &&
          remote.records.length > 0;

        if (canApplyRemoteRecords) {
          latestDataRef.current.records = remote.records;
          latestFullSnapshotRef.current.records = remote.records;
          setRecords(remote.records);
          saveLocalRecords(remote.records);
        }

        const shouldSkipSettingsMerge =
          !forcePullRemote &&
          (settingsSaveInFlightRef.current ||
            lastLocalSettingsSaveAtRef.current > fetchStartedAt);

        const hasRemoteSettingsFields =
          Boolean(remote.settings) &&
          (Boolean(remote.settings.nama_sekolah) ||
            remote.settings.nama_kepala_sekolah !== undefined ||
            remote.settings.nip_kepala_sekolah !== undefined ||
            remote.settings.ttd_kepala_sekolah !== undefined ||
            remote.settings.cap_sekolah !== undefined ||
            Boolean(remote.settings.batas_jam_masuk) ||
            Boolean(remote.settings.mode_presensi) ||
            Boolean(remote.settings.jam_pulang_standar) ||
            Boolean(remote.settings.tahun_ajaran) ||
            Boolean(remote.settings.semester) ||
            Boolean(remote.settings.tema) ||
            Boolean(remote.settings.logo_sekolah));

        if (!shouldSkipSettingsMerge && (hasRemoteSettingsFields || forcePullRemote)) {
          setSettings((prev) => {
            const merged: SchoolSettings = {
              ...prev,
              nama_sekolah: remote.settings.nama_sekolah?.trim()
                ? remote.settings.nama_sekolah.trim()
                : prev.nama_sekolah,
              nama_kepala_sekolah:
                remote.settings.nama_kepala_sekolah !== undefined
                  ? forcePullRemote
                    ? String(remote.settings.nama_kepala_sekolah).trim()
                    : remote.settings.nama_kepala_sekolah.trim() || prev.nama_kepala_sekolah
                  : prev.nama_kepala_sekolah,
              nip_kepala_sekolah:
                remote.settings.nip_kepala_sekolah !== undefined
                  ? forcePullRemote
                    ? String(remote.settings.nip_kepala_sekolah).trim()
                    : remote.settings.nip_kepala_sekolah.trim() || prev.nip_kepala_sekolah
                  : prev.nip_kepala_sekolah,
              ttd_kepala_sekolah:
                remote.settings.ttd_kepala_sekolah !== undefined
                  ? forcePullRemote
                    ? String(remote.settings.ttd_kepala_sekolah).trim()
                    : remote.settings.ttd_kepala_sekolah.trim() || prev.ttd_kepala_sekolah
                  : prev.ttd_kepala_sekolah,
              cap_sekolah:
                remote.settings.cap_sekolah !== undefined
                  ? forcePullRemote
                    ? String(remote.settings.cap_sekolah).trim()
                    : remote.settings.cap_sekolah.trim() || prev.cap_sekolah
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
              tahun_ajaran: remote.settings.tahun_ajaran?.trim() || prev.tahun_ajaran,
              semester: remote.settings.semester
                ? normalizeSemester(remote.settings.semester, prev.semester || 'ganjil')
                : prev.semester || 'ganjil',
              tema: remote.settings.tema
                ? normalizeThemeId(remote.settings.tema, prev.tema)
                : prev.tema,
              logo_sekolah: remote.settings.logo_sekolah?.trim()
                ? remote.settings.logo_sekolah.trim()
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
            latestDataRef.current.settings = merged;
            latestFullSnapshotRef.current.settings = merged;
            saveLocalSettings(merged);
            saveDefaultSchoolIdentity({
              nama_sekolah: merged.nama_sekolah,
              logo_sekolah: merged.logo_sekolah || '',
            });
            return merged;
          });
        }

        let syncedAccountsCount = remote.accounts.length;
        const canApplyRemoteAccounts =
          remote.accounts.length > 0 &&
          (forcePullRemote ||
            (!accountsSaveInFlightRef.current &&
              lastLocalAccountsSaveAtRef.current <= fetchStartedAt));

        if (canApplyRemoteAccounts) {
          latestFullSnapshotRef.current.accounts = remote.accounts;
          setAccounts(remote.accounts);
          saveUserAccounts(remote.accounts);
          setSession((prevSession) => {
            if (!prevSession) return prevSession;
            const matched = remote.accounts.find(
              (a) =>
                a.id === prevSession.userId ||
                a.username.toLowerCase() === prevSession.username.toLowerCase()
            );
            if (!matched) return prevSession;
            const syncedSession: AuthSession = {
              userId: matched.id,
              username: matched.username,
              nama: matched.nama,
              nip: matched.nip,
              role: matched.role,
              jabatan: formatRoleLabel(matched.role, matched.kelas_binaan),
              kelas_binaan: matched.kelas_binaan,
            };
            if (
              syncedSession.userId === prevSession.userId &&
              syncedSession.username === prevSession.username &&
              syncedSession.nama === prevSession.nama &&
              (syncedSession.nip || '') === (prevSession.nip || '') &&
              syncedSession.role === prevSession.role &&
              syncedSession.jabatan === prevSession.jabatan &&
              (syncedSession.kelas_binaan || '') === (prevSession.kelas_binaan || '')
            ) {
              return prevSession;
            }
            saveAuthSession(syncedSession);
            return syncedSession;
          });
        } else if (
          !forcePullRemote &&
          remote.supportsAkun &&
          remote.accounts.length === 0 &&
          !accountsSaveInFlightRef.current &&
          autoSeededAkunForUrlRef.current !== trimmed &&
          latestFullSnapshotRef.current.accounts.length > 0
        ) {
          autoSeededAkunForUrlRef.current = trimmed;
          accountsSaveInFlightRef.current = true;
          try {
            await postToGas(trimmed, 'syncAkun', {
              accounts: latestFullSnapshotRef.current.accounts,
            });
            syncedAccountsCount = latestFullSnapshotRef.current.accounts.length;
          } catch {
            // Will retry on next manual push or account edit
          } finally {
            lastLocalAccountsSaveAtRef.current = Date.now();
            accountsSaveInFlightRef.current = false;
          }
        }

        if (forcePullRemote || lastLocalAcademicSaveAtRef.current <= fetchStartedAt) {
          if (remote.masterSubjects.length > 0) {
            latestFullSnapshotRef.current.masterSubjects = remote.masterSubjects;
            setMasterSubjects(remote.masterSubjects);
            saveMasterSubjects(remote.masterSubjects);
          }
          if (remote.teacherSchedules.length > 0 || remote.subjectAssignments.length > 0) {
            const baseSchedules =
              remote.teacherSchedules.length > 0
                ? remote.teacherSchedules
                : latestFullSnapshotRef.current.teacherSchedules;
            const baseAssignments =
              remote.subjectAssignments.length > 0
                ? remote.subjectAssignments
                : latestFullSnapshotRef.current.subjectAssignments;
            const reconciled = reconcileSchedulesAndAssignments(
              baseSchedules,
              baseAssignments,
              normalizeSemester(latestDataRef.current.settings.semester, 'ganjil')
            );
            latestFullSnapshotRef.current.teacherSchedules = reconciled.schedules;
            setTeacherSchedules(reconciled.schedules);
            saveTeacherSchedules(reconciled.schedules);
            syncTimetablesWithSchedules(reconciled.schedules);
            latestFullSnapshotRef.current.subjectAssignments = reconciled.assignments;
            setSubjectAssignments(reconciled.assignments);
            saveSubjectAssignments(reconciled.assignments);
          }
          if (remote.subjectRecords.length > 0) {
            latestFullSnapshotRef.current.subjectRecords = remote.subjectRecords;
            setSubjectRecords(remote.subjectRecords);
            saveSubjectRecords(remote.subjectRecords);
          }
        }

        setConnectionStatus(flushResult.remaining > 0 ? 'error' : 'connected');
        setLastSyncedAt(getCurrentTimeString());
        if (!silent && flushResult.remaining === 0) {
          if (!remote.supportsAkun) {
            pushToast({
              type: 'warning',
              title: 'Sinkronisasi Berhasil — Sheet Akun Belum Aktif',
              description:
                'Code.gs pada Spreadsheet masih versi lama dan belum memiliki Sheet Akun. Salin Code.gs terbaru di Pengaturan → Cloud & Sheets lalu lakukan Deploy Versi Baru agar Data Akun & Akses tersinkron.',
            });
          } else {
            pushToast({
              type: 'success',
              title: 'Sinkronisasi Penuh Berhasil',
              description: `Semua data disinkronkan dari Google Sheets (${remote.students.length} siswa, ${remote.records.length} presensi, ${syncedAccountsCount} akun, ${remote.masterSubjects.length} mapel, ${remote.teacherSchedules.length} jadwal, ${remote.subjectRecords.length} presensi mapel & pengaturan sekolah).`,
            });
          }
        }
        return {
          ok: true,
          hasRemoteData: remote.hasRemoteData,
          studentsCount: remote.students.length,
          recordsCount: remote.records.length,
          accountsCount: syncedAccountsCount,
          schedulesCount: remote.teacherSchedules.length,
          subjectRecordsCount: remote.subjectRecords.length,
        };
      } catch (err) {
        setConnectionStatus(!isBrowserOnline() ? 'offline' : 'error');
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
        return emptyResult;
      } finally {
        syncInFlightRef.current = false;
      }
    },
    [pushToast]
  );

  // Hydrate offline queue from IndexedDB backup on mount
  useEffect(() => {
    let active = true;
    void hydrateSyncQueueFromOfflineStore().then((queue) => {
      if (!active) return;
      setPendingSyncCount(queue.length);
    });
    return () => {
      active = false;
    };
  }, []);

  const flushOfflineQueueNow = useCallback(
    async (opts?: { fromReconnect?: boolean; silentIfEmpty?: boolean }) => {
      if (!isBrowserOnline()) {
        setIsOnline(false);
        setConnectionStatus('offline');
        return;
      }
      const targetUrl = latestFullSnapshotRef.current.settings.script_url.trim();
      const pendingBefore = loadSyncQueue().length;

      if (targetUrl && pendingBefore > 0) {
        setSyncingQueue(true);
        setConnectionStatus('syncing');
        try {
          const flushResult = await flushSyncQueue(targetUrl);
          setPendingSyncCount(flushResult.remaining);
          if (flushResult.flushed > 0) {
            setLastSyncedAt(getCurrentTimeString());
            setConnectionStatus(flushResult.remaining > 0 ? 'error' : 'connected');
            pushToast({
              type: 'success',
              title: opts?.fromReconnect
                ? 'Koneksi Internet Kembali — Data Offline Tersinkron'
                : 'Antrean Offline Berhasil Disinkronkan',
              description:
                flushResult.remaining === 0
                  ? `${flushResult.flushed} data presensi/perubahan offline berhasil disimpan otomatis ke Google Sheets.`
                  : `${flushResult.flushed} data terkirim, ${flushResult.remaining} data masih menunggu koneksi stabil.`,
            });
            if (flushResult.remaining === 0) {
              void syncFromGas(targetUrl, true);
            }
          } else if (flushResult.remaining > 0 && flushResult.lastError) {
            setConnectionStatus('error');
            pushToast({
              type: 'warning',
              title: 'Sinkronisasi Antrean Tertunda',
              description: `${flushResult.remaining} data tetap aman di perangkat: ${flushResult.lastError}`,
            });
          }
        } finally {
          setSyncingQueue(false);
        }
        return;
      }

      if (opts?.fromReconnect) {
        if (targetUrl) {
          void syncFromGas(targetUrl, true);
        }
        if (cloudConnected) {
          pushToast({
            type: 'success',
            title: 'Koneksi Internet Kembali',
            description:
              'Data offline otomatis disinkronkan dengan Cloud Firebase & perangkat lain.',
          });
        } else if (targetUrl) {
          pushToast({
            type: 'success',
            title: 'Koneksi Internet Kembali',
            description: 'Terhubung kembali ke Google Sheets.',
          });
        }
      } else if (!opts?.silentIfEmpty && pendingBefore === 0 && targetUrl) {
        await syncFromGas(targetUrl, false);
      }
    },
    [cloudConnected, pushToast, syncFromGas]
  );

  // Global browser online / offline detection + auto-flush when connection returns
  useEffect(() => {
    const handleBrowserOffline = () => {
      setIsOnline(false);
      setConnectionStatus('offline');
      pushToast({
        type: 'warning',
        title: 'Koneksi Internet Terputus — Mode Offline Aktif',
        description:
          'Presensi siswa tetap berjalan normal. Semua data disimpan aman di perangkat dan akan tersinkron otomatis saat internet kembali.',
      });
    };

    const handleBrowserOnline = () => {
      setIsOnline(true);
      void flushOfflineQueueNow({ fromReconnect: true });
    };

    window.addEventListener('offline', handleBrowserOffline);
    window.addEventListener('online', handleBrowserOnline);
    return () => {
      window.removeEventListener('offline', handleBrowserOffline);
      window.removeEventListener('online', handleBrowserOnline);
    };
  }, [flushOfflineQueueNow, pushToast]);

  // Realtime & everytime sync: on mount/URL change, every 10s, on focus and visibility
  useEffect(() => {
    const url = settings.script_url.trim();
    if (!url) {
      setConnectionStatus('offline');
      return;
    }

    if (isBrowserOnline()) {
      void syncFromGas(url, true);
    } else {
      setConnectionStatus('offline');
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible' && isBrowserOnline()) {
        if (loadSyncQueue().length > 0) {
          void flushOfflineQueueNow({ silentIfEmpty: true });
        } else {
          void syncFromGas(url, true);
        }
      }
    }, 10000);

    const handleResumeSync = () => {
      if (document.visibilityState === 'visible' && isBrowserOnline()) {
        if (loadSyncQueue().length > 0) {
          void flushOfflineQueueNow({ silentIfEmpty: true });
        } else {
          void syncFromGas(url, true);
        }
      }
    };

    window.addEventListener('focus', handleResumeSync);
    document.addEventListener('visibilitychange', handleResumeSync);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleResumeSync);
      document.removeEventListener('visibilitychange', handleResumeSync);
    };
  }, [settings.script_url, syncFromGas, flushOfflineQueueNow]);

  const syncMutation = useCallback(
    async (
      action: Parameters<typeof postToGas>[1],
      payload: Record<string, unknown>,
      urlOverride?: string
    ): Promise<boolean> => {
      const targetUrl = (urlOverride ?? settings.script_url).trim();
      if (!targetUrl) {
        setConnectionStatus('offline');
        return false;
      }

      // Immediate zero-latency offline queueing when internet is unavailable
      if (!isBrowserOnline()) {
        setIsOnline(false);
        const updatedQueue = enqueueSyncMutation(action, payload);
        setPendingSyncCount(updatedQueue.length);
        setConnectionStatus('offline');
        return false;
      }

      setConnectionStatus('syncing');
      try {
        await postToGas(targetUrl, action, payload);
        if (action === 'syncAkun' || action === 'upsertAkun' || action === 'deleteAkun' || action === 'syncAll') {
          setSheetsSupportsAkun(true);
        }
        await flushSyncQueue(targetUrl);
        setPendingSyncCount(loadSyncQueue().length);
        setConnectionStatus('connected');
        setLastSyncedAt(getCurrentTimeString());
        return true;
      } catch (err) {
        const updatedQueue = enqueueSyncMutation(action, payload);
        setPendingSyncCount(updatedQueue.length);
        const currentlyOnline = isBrowserOnline();
        setIsOnline(currentlyOnline);
        setConnectionStatus(currentlyOnline ? 'error' : 'offline');
        const msg =
          err instanceof Error
            ? err.message
            : 'Perubahan disimpan offline dan akan disinkronkan otomatis saat terhubung.';
        if (msg.toLowerCase().includes('sheet akun')) {
          setSheetsSupportsAkun(false);
        }
        if (currentlyOnline) {
          pushToast({
            type: 'warning',
            title: 'Disimpan di Antrean Offline',
            description: `Data tetap aman di perangkat (${updatedQueue.length} antrean) dan akan disinkronkan otomatis: ${msg}`,
          });
        }
        return false;
      }
    },
    [settings.script_url, pushToast]
  );

  const syncRecordsMutation = useCallback(
    async (
      action: Parameters<typeof postToGas>[1],
      payload: Record<string, unknown>,
      urlOverride?: string
    ): Promise<boolean> => {
      recordsSaveInFlightCountRef.current += 1;
      lastLocalRecordsSaveAtRef.current = Date.now();
      try {
        return await syncMutation(action, payload, urlOverride);
      } finally {
        lastLocalRecordsSaveAtRef.current = Date.now();
        recordsSaveInFlightCountRef.current = Math.max(
          0,
          recordsSaveInFlightCountRef.current - 1
        );
      }
    },
    [syncMutation]
  );

  const syncStudentsMutation = useCallback(
    async (
      action: Parameters<typeof postToGas>[1],
      payload: Record<string, unknown>,
      urlOverride?: string
    ): Promise<boolean> => {
      studentsSaveInFlightCountRef.current += 1;
      lastLocalStudentsSaveAtRef.current = Date.now();
      try {
        return await syncMutation(action, payload, urlOverride);
      } finally {
        lastLocalStudentsSaveAtRef.current = Date.now();
        studentsSaveInFlightCountRef.current = Math.max(
          0,
          studentsSaveInFlightCountRef.current - 1
        );
      }
    },
    [syncMutation]
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
      accountsSaveInFlightRef.current = true;
      setConnectionStatus('syncing');
      try {
        const snapshot = latestFullSnapshotRef.current;
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
          accounts: snapshot.accounts,
          masterSubjects: snapshot.masterSubjects,
          teacherSchedules: snapshot.teacherSchedules,
          subjectAssignments: snapshot.subjectAssignments,
          subjectRecords: snapshot.subjectRecords,
        });
        clearSyncQueue();
        setPendingSyncCount(0);
        setSheetsSupportsAkun(true);
        setConnectionStatus('connected');
        setLastSyncedAt(getCurrentTimeString());
        pushToast({
          type: 'success',
          title: 'Seluruh Data Lokal Terkirim ke Sheets',
          description: `${snapshot.students.length} siswa, ${snapshot.records.length} presensi, ${snapshot.accounts.length} akun, ${snapshot.masterSubjects.length} mapel, ${snapshot.teacherSchedules.length} jadwal, dan ${snapshot.subjectRecords.length} presensi mapel berhasil disinkronkan.`,
        });
      } catch (err) {
        setConnectionStatus('error');
        pushToast({
          type: 'error',
          title: 'Gagal Mengirim Data ke Sheets',
          description:
            err instanceof Error ? err.message : 'Periksa kembali URL Web App Anda.',
        });
      } finally {
        lastLocalAccountsSaveAtRef.current = Date.now();
        accountsSaveInFlightRef.current = false;
      }
    },
    [pushToast]
  );

  const handlePushAccountsToSheets = useCallback(async () => {
    const targetUrl = latestFullSnapshotRef.current.settings.script_url.trim();
    if (!targetUrl) {
      pushToast({
        type: 'info',
        title: 'Spreadsheet Belum Terhubung',
        description:
          'Masukkan Web App URL Google Apps Script di Pengaturan → Cloud & Sheets terlebih dahulu.',
      });
      return;
    }
    const currentAccounts = latestFullSnapshotRef.current.accounts;
    accountsSaveInFlightRef.current = true;
    lastLocalAccountsSaveAtRef.current = Date.now();
    setConnectionStatus('syncing');
    try {
      await postToGas(targetUrl, 'syncAkun', { accounts: currentAccounts });
      setSheetsSupportsAkun(true);
      setConnectionStatus('connected');
      setLastSyncedAt(getCurrentTimeString());
      pushToast({
        type: 'success',
        title: 'Data Akun Terkirim ke Spreadsheet',
        description: `${currentAccounts.length} akun (Master Admin, Kepala Sekolah, Wali Kelas & Guru) berhasil disimpan ke Sheet Akun di Google Spreadsheet.`,
      });
    } catch (err) {
      setConnectionStatus('error');
      const msg =
        err instanceof Error
          ? err.message
          : 'Gagal mengirim Data Akun ke Google Spreadsheet.';
      if (msg.toLowerCase().includes('sheet akun')) {
        setSheetsSupportsAkun(false);
      }
      pushToast({
        type: 'error',
        title: 'Gagal Sinkronisasi Data Akun',
        description: msg,
      });
    } finally {
      lastLocalAccountsSaveAtRef.current = Date.now();
      accountsSaveInFlightRef.current = false;
    }
  }, [pushToast]);

  const handlePullAccountsFromSheets = useCallback(async () => {
    const targetUrl = latestFullSnapshotRef.current.settings.script_url.trim();
    if (!targetUrl) {
      pushToast({
        type: 'info',
        title: 'Spreadsheet Belum Terhubung',
        description:
          'Masukkan Web App URL Google Apps Script di Pengaturan → Cloud & Sheets terlebih dahulu.',
      });
      return;
    }
    lastLocalAccountsSaveAtRef.current = 0;
    await syncFromGas(targetUrl, false, { forcePullRemote: true });
  }, [pushToast, syncFromGas]);

  const handleTestAndSyncSheets = useCallback(
    async (urlInput: string) => {
      const trimmed = urlInput.trim();
      if (!trimmed) {
        pushToast({
          type: 'info',
          title: 'URL Spreadsheet Belum Diisi',
          description:
            'Tempelkan Web App URL Google Apps Script (berakhiran /exec) terlebih dahulu.',
        });
        return;
      }
      // Persist the entered URL locally so this device stays linked after reload
      if (latestFullSnapshotRef.current.settings.script_url.trim() !== trimmed) {
        const linkedSettings: SchoolSettings = {
          ...latestFullSnapshotRef.current.settings,
          script_url: trimmed,
        };
        latestDataRef.current.settings = linkedSettings;
        latestFullSnapshotRef.current.settings = linkedSettings;
        setSettings(linkedSettings);
        saveLocalSettings(linkedSettings);
      }
      lastLocalSettingsSaveAtRef.current = 0;
      lastLocalAccountsSaveAtRef.current = 0;
      lastLocalStudentsSaveAtRef.current = 0;
      lastLocalRecordsSaveAtRef.current = 0;
      lastLocalAcademicSaveAtRef.current = 0;
      await syncFromGas(trimmed, false, { forcePullRemote: true });
    },
    [pushToast, syncFromGas]
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
    lastLocalAccountsSaveAtRef.current = Date.now();
    accountsSaveInFlightRef.current = true;
    setAccounts(res.accounts);
    saveUserAccounts(res.accounts);
    void (async () => {
      try {
        await syncMutation('syncAkun', { accounts: res.accounts });
      } finally {
        lastLocalAccountsSaveAtRef.current = Date.now();
        accountsSaveInFlightRef.current = false;
      }
    })();
    runCloudWrite((uid) => syncAllAccountsToCloud(uid, res.accounts));
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
    const currentSettings = latestDataRef.current.settings;
    const currentStudents = latestDataRef.current.students;
    const currentRecords = latestDataRef.current.records;
    const currentActiveYearStudents = filterByAcademicYear(currentStudents, {
      activeAcademicYear: currentSettings.tahun_ajaran,
      isMasterAdmin: false,
    });
    const currentActiveYearRecords = filterByAcademicYear(currentRecords, {
      activeAcademicYear: currentSettings.tahun_ajaran,
      isMasterAdmin: false,
    });

    const outcome = processQrScan({
      qrRaw: rawCode,
      students: currentActiveYearStudents,
      records: currentActiveYearRecords,
      batasJamMasuk: currentSettings.batas_jam_masuk,
      modePresensi: currentSettings.mode_presensi,
      jamPulangStandar: currentSettings.jam_pulang_standar,
      scanAction,
      alasanPulangCepat,
      tahunAjaran: currentSettings.tahun_ajaran,
    });

    if (outcome.ok) {
      const offlineNow = !isBrowserOnline();
      if (offlineNow) {
        const speechStatus =
          outcome.record.status === 'Terlambat' ? 'Terlambat' : 'Hadir';
        speakOfflineAttendanceNotification(outcome.scanType, speechStatus);
      } else if (outcome.scanType === 'pulang') {
        speakCheckoutSuccessNotification();
      } else {
        speakSuccessNotification('Presensi Berhasil');
      }
      const taggedRecord: AttendanceRecord = {
        ...outcome.record,
        tahun_ajaran: outcome.record.tahun_ajaran || currentSettings.tahun_ajaran,
      };
      let nextRecords: AttendanceRecord[];
      if (outcome.scanType === 'pulang') {
        const targetNisNorm = taggedRecord.nis.trim().toLowerCase();
        let replaced = false;
        const mapped = currentRecords.map((r) => {
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
        nextRecords = replaced ? mapped : [taggedRecord, ...currentRecords];
      } else {
        nextRecords = [taggedRecord, ...currentRecords];
      }
      latestDataRef.current.records = nextRecords;
      lastLocalRecordsSaveAtRef.current = Date.now();
      setRecords(nextRecords);
      saveLocalRecords(nextRecords);

      const offlineSuffix = !isBrowserOnline()
        ? ' · Disimpan offline di perangkat, akan tersinkron otomatis saat internet kembali.'
        : '';

      if (outcome.scanType === 'pulang') {
        const earlyReason = taggedRecord.alasan_pulang_cepat?.trim();
        pushToast({
          type: earlyReason ? 'warning' : 'success',
          title: earlyReason
            ? `${outcome.student.nama} — Pulang Cepat`
            : `${outcome.student.nama} — Pulang`,
          description: earlyReason
            ? `NISN ${outcome.student.nis} (${outcome.student.kelas}) pulang cepat pukul ${taggedRecord.jam_pulang} · Alasan: ${earlyReason}${offlineSuffix}`
            : `NISN ${outcome.student.nis} (${outcome.student.kelas}) scan pulang pukul ${taggedRecord.jam_pulang}${offlineSuffix}`,
        });
      } else {
        pushToast({
          type: taggedRecord.status === 'Hadir' ? 'success' : 'warning',
          title: `${outcome.student.nama} — ${taggedRecord.status}`,
          description: `NISN ${outcome.student.nis} (${outcome.student.kelas}) dicatat masuk pukul ${taggedRecord.jam_masuk}${offlineSuffix}`,
        });
      }
      void syncRecordsMutation('recordPresensi', {
        ...taggedRecord,
        record: { ...taggedRecord },
      });
      runCloudWrite((uid) => upsertAttendanceToCloud(uid, taggedRecord));
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
        title: 'NISN Tidak Terdaftar',
        description: `Siswa dengan NISN "${outcome.nis}" tidak ditemukan pada Tahun Ajaran ${settings.tahun_ajaran}.`,
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
        error: `NISN ${student.nis} sudah terdaftar pada Tahun Ajaran ${settings.tahun_ajaran}.`,
      };
    }
    const taggedStudent: Student = {
      ...student,
      tahun_ajaran: settings.tahun_ajaran,
    };
    const nextStudents = [...students, taggedStudent];
    lastLocalStudentsSaveAtRef.current = Date.now();
    setStudents(nextStudents);
    saveLocalStudents(nextStudents);
    pushToast({
      type: 'success',
      title: 'Siswa Ditambahkan',
      description: `${taggedStudent.nama} (${taggedStudent.kelas}) berhasil disimpan.`,
    });
    void syncStudentsMutation('addSiswa', { ...taggedStudent });
    runCloudWrite((uid) => upsertStudentToCloud(uid, taggedStudent));
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
    lastLocalStudentsSaveAtRef.current = Date.now();
    setStudents(nextStudents);
    saveLocalStudents(nextStudents);
    pushToast({
      type: 'success',
      title: 'Import Siswa Berhasil',
      description: `${tagged.length} siswa baru berhasil ditambahkan ke Tahun Ajaran ${settings.tahun_ajaran}.`,
    });
    void syncStudentsMutation('bulkAddSiswa', { students: tagged });
    runCloudWrite((uid) => bulkUpsertStudentsToCloud(uid, tagged));
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
      return { ok: false, error: `NISN ${updated.nis} sudah digunakan siswa lain.` };
    }

    const nextStudents = students.map((s) =>
      s.nis === originalNis
        ? { ...updated, tahun_ajaran: s.tahun_ajaran || settings.tahun_ajaran }
        : s
    );
    lastLocalStudentsSaveAtRef.current = Date.now();
    setStudents(nextStudents);
    saveLocalStudents(nextStudents);

    const nextRecords = records.map((r) =>
      r.nis === originalNis
        ? { ...r, nis: updated.nis, nama: updated.nama, kelas: updated.kelas }
        : r
    );
    lastLocalRecordsSaveAtRef.current = Date.now();
    setRecords(nextRecords);
    saveLocalRecords(nextRecords);

    const savedStudent = nextStudents.find((s) => s.nis === updated.nis) ?? {
      ...updated,
      tahun_ajaran: settings.tahun_ajaran,
    };
    const affectedRecords = nextRecords.filter((r) => r.nis === updated.nis);
    pushToast({
      type: 'success',
      title: 'Data Siswa Diperbarui',
      description: `${updated.nama} berhasil diperbarui.`,
    });
    void syncStudentsMutation('updateSiswa', { originalNis, ...updated });
    runCloudWrite(async (uid) => {
      if (originalNis.trim().toLowerCase() !== updated.nis.trim().toLowerCase()) {
        await deleteStudentFromCloud(uid, {
          nis: originalNis,
          tahun_ajaran: savedStudent.tahun_ajaran,
        });
      }
      await upsertStudentToCloud(uid, savedStudent);
      if (affectedRecords.length > 0) {
        await bulkUpsertAttendanceToCloud(uid, affectedRecords);
      }
    });
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
    lastLocalStudentsSaveAtRef.current = Date.now();
    setStudents(nextStudents);
    saveLocalStudents(nextStudents);
    pushToast({
      type: 'info',
      title: 'Siswa Dihapus',
      description: target ? `${target.nama} dihapus dari daftar siswa.` : undefined,
    });
    void syncStudentsMutation('deleteSiswa', { nis });
    runCloudWrite((uid) =>
      deleteStudentFromCloud(uid, { nis, tahun_ajaran: targetYear })
    );
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
    lastLocalStudentsSaveAtRef.current = Date.now();
    setStudents(nextStudents);
    saveLocalStudents(nextStudents);
    pushToast({
      type: 'info',
      title: `${nisList.length} Siswa Dihapus`,
      description: 'Data siswa terpilih telah dihapus dari daftar.',
    });
    const deletedTargets = students.filter(
      (s) =>
        delSet.has(s.nis) &&
        allowedYears.has(resolveItemAcademicYear(s.tahun_ajaran))
    );
    void syncStudentsMutation('bulkDeleteSiswa', { nisList });
    runCloudWrite(async (uid) => {
      for (const s of deletedTargets) {
        await deleteStudentFromCloud(uid, s);
      }
    });
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

    latestDataRef.current.records = nextRecords;
    lastLocalRecordsSaveAtRef.current = Date.now();
    setRecords(nextRecords);
    saveLocalRecords(nextRecords);
    pushToast({
      type: 'success',
      title: 'Status Presensi Diperbarui',
      description: `${student.nama} pada ${tanggal} ditandai ${status}.`,
    });
    void syncRecordsMutation('updateStatusPresensi', {
      ...updatedRecord,
      record: { ...updatedRecord },
    });
    runCloudWrite((uid) => upsertAttendanceToCloud(uid, updatedRecord));
  }

  function handleConfirmCheckout(params: {
    tanggal: string;
    student: { nis: string; nama: string; kelas: string };
    alasanPulangCepat?: string;
  }) {
    const { tanggal, student, alasanPulangCepat } = params;
    const targetNisNorm = student.nis.trim().toLowerCase();
    const currentRecords = latestDataRef.current.records;
    const existing = currentRecords.find(
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

    const nextRecords = currentRecords.map((r) =>
      r.tanggal === tanggal && r.nis.trim().toLowerCase() === targetNisNorm
        ? updatedRecord
        : r
    );
    latestDataRef.current.records = nextRecords;
    lastLocalRecordsSaveAtRef.current = Date.now();
    setRecords(nextRecords);
    saveLocalRecords(nextRecords);
    speakCheckoutSuccessNotification();
    pushToast({
      type: trimmedReason ? 'warning' : 'success',
      title: trimmedReason
        ? `${student.nama} — Pulang Cepat Dicatat`
        : `${student.nama} — Pulang Dicatat`,
      description: trimmedReason
        ? `Jam pulang ${nowTime} (${tanggal}) dikonfirmasi · Alasan: ${trimmedReason}`
        : `Jam pulang ${nowTime} pada ${tanggal} berhasil dikonfirmasi.`,
    });
    void syncRecordsMutation('recordPresensi', {
      ...updatedRecord,
      record: { ...updatedRecord },
    });
    runCloudWrite((uid) => upsertAttendanceToCloud(uid, updatedRecord));
  }

  async function handleSaveSettings(newSettings: SchoolSettings) {
    const previousUrl = latestFullSnapshotRef.current.settings.script_url.trim();
    const nextUrl = newSettings.script_url.trim();
    const isConnectingNewSpreadsheet = Boolean(nextUrl) && nextUrl !== previousUrl;

    // Cross-Device Protection:
    // When connecting a device to a new/different Spreadsheet URL, PULL all 8 sheets first
    // so Device B's local defaults NEVER overwrite existing Pengaturan, Akun, Mapel, or Jadwal in Sheets!
    if (isConnectingNewSpreadsheet && isBrowserOnline()) {
      setPreviewTheme(null);
      const linkedLocal: SchoolSettings = {
        ...latestFullSnapshotRef.current.settings,
        script_url: nextUrl,
      };
      latestDataRef.current.settings = linkedLocal;
      latestFullSnapshotRef.current.settings = linkedLocal;
      setSettings(linkedLocal);
      saveLocalSettings(linkedLocal);

      const pullRes = await syncFromGas(nextUrl, true, { forcePullRemote: true });
      if (pullRes.ok && pullRes.hasRemoteData) {
        pushToast({
          type: 'success',
          title: 'Terhubung & Tersinkron Penuh dari Spreadsheet',
          description: `Seluruh data berhasil disamakan (${pullRes.studentsCount} siswa, ${pullRes.recordsCount} presensi, ${pullRes.accountsCount} akun, ${pullRes.schedulesCount} jadwal, pengaturan & logo) tanpa menimpa data Spreadsheet.`,
        });
        return;
      }
      // If Spreadsheet is genuinely blank (brand-new), fall through and initialize it with local settings & accounts
    }

    settingsSaveInFlightRef.current = true;
    lastLocalSettingsSaveAtRef.current = Date.now();
    try {
      setPreviewTheme(null);
      latestDataRef.current.settings = newSettings;
      latestFullSnapshotRef.current.settings = newSettings;
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

      const uid = firebaseUser?.uid;
      if (uid && firebaseUser?.emailVerified) {
        try {
          await saveSchoolSettingsToCloud(uid, newSettings);
          setLastSyncedAt(getCurrentTimeString());
        } catch (err) {
          if (isQuotaExceededError(err)) {
            pushToast({
              type: 'warning',
              title: 'Kuota Gratis Firestore Tercapai',
              description:
                'Pengaturan dan logo tersimpan lokal, namun sinkronisasi Cloud tertunda hingga kuota reset.',
            });
          } else {
            pushToast({
              type: 'warning',
              title: 'Pengaturan Tersimpan Lokal',
              description:
                'Sinkronisasi pengaturan ke Cloud Firebase tertunda. Cek koneksi internet Anda.',
            });
          }
        }
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
          accounts: latestFullSnapshotRef.current.accounts,
        },
        newSettings.script_url
      );
    } finally {
      lastLocalSettingsSaveAtRef.current = Date.now();
      settingsSaveInFlightRef.current = false;
    }
  }

  async function handleSetDefaultIdentity(namaSekolah: string, logoSekolah?: string) {
    settingsSaveInFlightRef.current = true;
    lastLocalSettingsSaveAtRef.current = Date.now();
    try {
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

      const uid = firebaseUser?.uid;
      if (uid && firebaseUser?.emailVerified) {
        try {
          await saveSchoolSettingsToCloud(uid, nextSettings);
          setLastSyncedAt(getCurrentTimeString());
        } catch {
          // Already saved locally
        }
      }

      if (nextSettings.script_url.trim()) {
        await syncMutation('savePengaturan', {
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
          accounts: latestFullSnapshotRef.current.accounts,
        });
      }
    } finally {
      lastLocalSettingsSaveAtRef.current = Date.now();
      settingsSaveInFlightRef.current = false;
    }
  }

  async function handleUpdateAccounts(nextAccounts: UserAccount[]): Promise<void> {
    accountsSaveInFlightRef.current = true;
    lastLocalAccountsSaveAtRef.current = Date.now();
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

    runCloudWrite((uid) => syncAllAccountsToCloud(uid, nextAccounts));

    try {
      const hasSheetsUrl = Boolean(settings.script_url.trim());
      if (hasSheetsUrl) {
        const synced = await syncMutation('syncAkun', { accounts: nextAccounts });
        if (synced) {
          pushToast({
            type: 'success',
            title: 'Daftar Akun Tersimpan ke Spreadsheet',
            description: `Total ${nextAccounts.length} akun aktif tersimpan lokal & disinkronkan ke Sheet Akun di Google Spreadsheet.`,
          });
        }
      } else {
        pushToast({
          type: 'success',
          title: 'Daftar Akun Diperbarui',
          description: `Total ${nextAccounts.length} akun aktif tersimpan. Hubungkan Google Spreadsheet di Cloud & Sheets untuk sinkronisasi otomatis.`,
        });
      }
    } finally {
      lastLocalAccountsSaveAtRef.current = Date.now();
      accountsSaveInFlightRef.current = false;
    }
  }

  function handleResetAllAttendance() {
    latestDataRef.current.records = [];
    lastLocalRecordsSaveAtRef.current = Date.now();
    lastLocalAcademicSaveAtRef.current = Date.now();
    setRecords([]);
    saveLocalRecords([]);
    latestFullSnapshotRef.current.subjectRecords = [];
    setSubjectRecords([]);
    saveSubjectRecords([]);
    pushToast({
      type: 'info',
      title: 'Semua Data Presensi Direset',
      description:
        'Seluruh riwayat presensi harian & mata pelajaran telah dikosongkan. Data siswa tetap tersimpan.',
    });
    void syncRecordsMutation('resetPresensi', {});
    runCloudWrite((uid) => clearAllAttendanceInCloud(uid));
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
    syncTimetablesWithSchedules(demoSchedules);
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
    if (fresh.settings.script_url.trim()) {
      void syncMutation(
        'syncAll',
        {
          students: fresh.students,
          records: fresh.records,
          settings: {
            nama_sekolah: fresh.settings.nama_sekolah,
            nama_kepala_sekolah: fresh.settings.nama_kepala_sekolah || '',
            nip_kepala_sekolah: fresh.settings.nip_kepala_sekolah || '',
            ttd_kepala_sekolah: fresh.settings.ttd_kepala_sekolah || '',
            cap_sekolah: fresh.settings.cap_sekolah || '',
            batas_jam_masuk: fresh.settings.batas_jam_masuk,
            mode_presensi: fresh.settings.mode_presensi,
            jam_pulang_standar: fresh.settings.jam_pulang_standar,
            tahun_ajaran: fresh.settings.tahun_ajaran,
            semester: normalizeSemester(fresh.settings.semester, 'ganjil'),
            tema: fresh.settings.tema,
            logo_sekolah: fresh.settings.logo_sekolah || '',
          },
          accounts,
          masterSubjects,
          teacherSchedules: demoSchedules,
          subjectAssignments: demoAssignments,
          subjectRecords: [],
        },
        fresh.settings.script_url
      );
    }
    runCloudWrite((uid) =>
      pushFullLocalStateToCloud(
        uid,
        {
          settings: fresh.settings,
          students: fresh.students,
          records: fresh.records,
          masterSubjects,
          teacherSchedules: demoSchedules,
          subjectAssignments: demoAssignments,
          subjectRecords: [],
          accounts,
        },
        true
      )
    );
  }

  function handleAddMasterSubject(input: {
    kode: string;
    nama: string;
    deskripsi?: string;
  }): { ok: boolean; error?: string } {
    const res = addMasterSubject(masterSubjects, input);
    if (!res.ok) return res;
    lastLocalAcademicSaveAtRef.current = Date.now();
    setMasterSubjects(res.subjects);
    saveMasterSubjects(res.subjects);
    void syncMutation('upsertMasterMapel', { ...res.subject, subject: res.subject });
    runCloudWrite((uid) => upsertMasterSubjectToCloud(uid, res.subject));
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
    const previous = masterSubjects.find((s) => s.id === id);
    const res = updateMasterSubject(masterSubjects, id, input);
    if (!res.ok) return res;
    lastLocalAcademicSaveAtRef.current = Date.now();
    setMasterSubjects(res.subjects);
    saveMasterSubjects(res.subjects);
    void syncMutation('upsertMasterMapel', { ...res.subject, subject: res.subject });
    runCloudWrite((uid) => upsertMasterSubjectToCloud(uid, res.subject));

    // Cascade renamed subject across schedules, assignments, and Pengaturan Jadwal matrix
    if (
      previous &&
      previous.nama.trim().toLowerCase() !== res.subject.nama.trim().toLowerCase()
    ) {
      const oldLower = previous.nama.trim().toLowerCase();
      const updatedSchedules: TeacherSchedule[] = [];
      const nextSchedules = teacherSchedules.map((sch) => {
        if (sch.mata_pelajaran.trim().toLowerCase() !== oldLower) return sch;
        const updated = { ...sch, mata_pelajaran: res.subject.nama };
        updatedSchedules.push(updated);
        return updated;
      });
      if (updatedSchedules.length > 0) {
        setTeacherSchedules(nextSchedules);
        saveTeacherSchedules(nextSchedules);
        for (const sch of updatedSchedules) {
          void syncMutation('upsertJadwalGuru', { ...sch, schedule: sch });
          runCloudWrite((uid) => upsertTeacherScheduleToCloud(uid, sch));
        }
      }

      const updatedAssignments: SubjectAssignment[] = [];
      const nextAssignments = subjectAssignments.map((asg) => {
        if (asg.mata_pelajaran.trim().toLowerCase() !== oldLower) return asg;
        const updated = { ...asg, mata_pelajaran: res.subject.nama };
        updatedAssignments.push(updated);
        return updated;
      });
      if (updatedAssignments.length > 0) {
        setSubjectAssignments(nextAssignments);
        saveSubjectAssignments(nextAssignments);
        for (const asg of updatedAssignments) {
          void syncMutation('upsertMapelKelas', { ...asg, assignment: asg });
          runCloudWrite((uid) => upsertSubjectAssignmentToCloud(uid, asg));
        }
      }

      setTimetableConfigs((prev) => {
        const renamed = renameSubjectInTimetableConfigs(
          prev,
          previous.nama,
          res.subject.nama
        );
        saveTimetableConfigs(renamed);
        return renamed;
      });
    }

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
    lastLocalAcademicSaveAtRef.current = Date.now();
    setMasterSubjects(next);
    saveMasterSubjects(next);
    void syncMutation('deleteMasterMapel', { id });
    runCloudWrite((uid) => deleteMasterSubjectFromCloud(uid, id));
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
    const activeSem = input.semester ?? normalizeSemester(settings.semester, 'ganjil');
    const res = addTeacherSchedule(teacherSchedules, {
      ...input,
      tahun_ajaran: settings.tahun_ajaran,
      semester: activeSem,
    });
    if (!res.ok) return res;
    lastLocalAcademicSaveAtRef.current = Date.now();
    setTeacherSchedules(res.schedules);
    saveTeacherSchedules(res.schedules);
    syncTimetablesWithSchedules(res.schedules);
    void syncMutation('upsertJadwalGuru', { ...res.schedule, schedule: res.schedule });
    runCloudWrite((uid) => upsertTeacherScheduleToCloud(uid, res.schedule));

    // Bidirectional sync: automatically populate the teacher's Menu Presensi Mapel
    const mirrored = syncScheduleToSubjectAssignments(
      subjectAssignments,
      res.schedule,
      activeSem
    );
    setSubjectAssignments(mirrored.assignments);
    saveSubjectAssignments(mirrored.assignments);
    void syncMutation('upsertMapelKelas', {
      ...mirrored.upsertedAssignment,
      assignment: mirrored.upsertedAssignment,
    });
    runCloudWrite((uid) =>
      upsertSubjectAssignmentToCloud(uid, mirrored.upsertedAssignment)
    );

    pushToast({
      type: 'success',
      title: 'Jadwal Guru Ditambahkan',
      description: `${res.schedule.hari} ${res.schedule.jam_mulai}–${res.schedule.jam_selesai} · ${res.schedule.mata_pelajaran} (${res.schedule.kelas}) — otomatis tampil di Menu Mapel ${res.schedule.teacher_name}.`,
    });
    return { ok: true };
  }

  function handleBulkImportTeacherSchedules(
    items: Array<{
      hari: DayOfWeek;
      teacher_user_id: string;
      teacher_name: string;
      kelas: string;
      mata_pelajaran: string;
      jam_mulai: string;
      jam_selesai: string;
      semester?: SemesterKind;
    }>
  ): { addedCount: number; skippedCount: number } {
    let nextSchedules = [...teacherSchedules];
    let nextAssignments = [...subjectAssignments];
    const addedSchedules: TeacherSchedule[] = [];
    const upsertedAssignments: SubjectAssignment[] = [];
    let skippedCount = 0;

    for (const item of items) {
      const activeSem = item.semester ?? normalizeSemester(settings.semester, 'ganjil');
      const res = addTeacherSchedule(nextSchedules, {
        ...item,
        tahun_ajaran: settings.tahun_ajaran,
        semester: activeSem,
      });
      if (!res.ok) {
        skippedCount += 1;
        continue;
      }
      nextSchedules = res.schedules;
      addedSchedules.push(res.schedule);

      const mirrored = syncScheduleToSubjectAssignments(
        nextAssignments,
        res.schedule,
        activeSem
      );
      nextAssignments = mirrored.assignments;
      upsertedAssignments.push(mirrored.upsertedAssignment);
    }

    if (addedSchedules.length > 0) {
      lastLocalAcademicSaveAtRef.current = Date.now();
      setTeacherSchedules(nextSchedules);
      saveTeacherSchedules(nextSchedules);
      setSubjectAssignments(nextAssignments);
      saveSubjectAssignments(nextAssignments);
      syncTimetablesWithSchedules(nextSchedules);

      addedSchedules.forEach((sch) => {
        void syncMutation('upsertJadwalGuru', { ...sch, schedule: sch });
        runCloudWrite((uid) => upsertTeacherScheduleToCloud(uid, sch));
      });
      upsertedAssignments.forEach((asg) => {
        void syncMutation('upsertMapelKelas', { ...asg, assignment: asg });
        runCloudWrite((uid) => upsertSubjectAssignmentToCloud(uid, asg));
      });

      pushToast({
        type: 'success',
        title: `${addedSchedules.length} Jadwal Guru Berhasil Diimpor`,
        description:
          skippedCount > 0
            ? `${skippedCount} baris dilewati (duplikat). Data tersinkron ke Pengaturan Jadwal & menu guru.`
            : 'Seluruh jadwal tersinkron otomatis ke Pengaturan Jadwal & menu Daftar Pelajaran masing-masing guru.',
      });
    } else {
      pushToast({
        type: 'info',
        title: 'Tidak Ada Jadwal Baru Diimpor',
        description: 'Seluruh baris pada file sudah ada atau dilewati.',
      });
    }

    return { addedCount: addedSchedules.length, skippedCount };
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
    const previous = teacherSchedules.find((s) => s.id === id);
    const activeSem = input.semester ?? normalizeSemester(settings.semester, 'ganjil');
    const res = updateTeacherSchedule(teacherSchedules, id, {
      ...input,
      tahun_ajaran: settings.tahun_ajaran,
      semester: activeSem,
    });
    if (!res.ok) return res;
    lastLocalAcademicSaveAtRef.current = Date.now();
    setTeacherSchedules(res.schedules);
    saveTeacherSchedules(res.schedules);
    syncTimetablesWithSchedules(res.schedules);
    void syncMutation('upsertJadwalGuru', { ...res.schedule, schedule: res.schedule });
    runCloudWrite((uid) => upsertTeacherScheduleToCloud(uid, res.schedule));

    // Bidirectional sync: update or replace mirrored assignment for the teacher
    const cleanedAssignments = previous
      ? subjectAssignments.filter(
          (a) =>
            !(
              a.id === `asg_from_${previous.id}` ||
              (a.hari === previous.hari &&
                a.teacher_user_id === previous.teacher_user_id &&
                a.kelas.trim().toLowerCase() === previous.kelas.trim().toLowerCase() &&
                a.mata_pelajaran.trim().toLowerCase() ===
                  previous.mata_pelajaran.trim().toLowerCase() &&
                resolveItemAcademicYear(a.tahun_ajaran) ===
                  resolveItemAcademicYear(previous.tahun_ajaran))
            )
        )
      : subjectAssignments;
    const mirrored = syncScheduleToSubjectAssignments(
      cleanedAssignments,
      res.schedule,
      activeSem
    );
    setSubjectAssignments(mirrored.assignments);
    saveSubjectAssignments(mirrored.assignments);
    void syncMutation('upsertMapelKelas', {
      ...mirrored.upsertedAssignment,
      assignment: mirrored.upsertedAssignment,
    });
    runCloudWrite((uid) =>
      upsertSubjectAssignmentToCloud(uid, mirrored.upsertedAssignment)
    );

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
    lastLocalAcademicSaveAtRef.current = Date.now();
    setTeacherSchedules(next);
    saveTeacherSchedules(next);
    syncTimetablesWithSchedules(next);
    void syncMutation('deleteJadwalGuru', { id });
    runCloudWrite((uid) => deleteTeacherScheduleFromCloud(uid, id));

    if (target) {
      const removedAssignments = subjectAssignments.filter(
        (a) =>
          a.id === `asg_from_${target.id}` ||
          (a.hari === target.hari &&
            a.teacher_user_id === target.teacher_user_id &&
            a.kelas.trim().toLowerCase() === target.kelas.trim().toLowerCase() &&
            a.mata_pelajaran.trim().toLowerCase() ===
              target.mata_pelajaran.trim().toLowerCase() &&
            resolveItemAcademicYear(a.tahun_ajaran) ===
              resolveItemAcademicYear(target.tahun_ajaran))
      );
      if (removedAssignments.length > 0) {
        const removedIds = new Set(removedAssignments.map((a) => a.id));
        const nextAssignments = subjectAssignments.filter((a) => !removedIds.has(a.id));
        setSubjectAssignments(nextAssignments);
        saveSubjectAssignments(nextAssignments);
        for (const rem of removedAssignments) {
          void syncMutation('deleteMapelKelas', { id: rem.id });
          runCloudWrite((uid) => deleteSubjectAssignmentFromCloud(uid, rem.id));
        }
      }
    }

    pushToast({
      type: 'info',
      title: 'Jadwal Dihapus',
      description: target
        ? `${target.hari} · ${target.mata_pelajaran} (${target.kelas}) dihapus.`
        : undefined,
    });
  }

  function handleSaveTimetable(
    config: TimetableConfig,
    syncedSchedules: TeacherSchedule[],
    activeClasses: string[],
    options?: { silent?: boolean }
  ) {
    const key = getTimetableConfigKey(config.tahun_ajaran, config.semester);
    setTimetableConfigs((prev) => {
      const nextConfigs = {
        ...prev,
        [key]: config,
      };
      saveTimetableConfigs(nextConfigs);
      return nextConfigs;
    });

    const currentSchedules = latestFullSnapshotRef.current.teacherSchedules;
    const currentAssignments = latestFullSnapshotRef.current.subjectAssignments;

    const targetYear = resolveItemAcademicYear(config.tahun_ajaran);
    const targetSem = normalizeSemester(config.semester, 'ganjil');
    const classSet = new Set(activeClasses.map((c) => c.trim().toLowerCase()));
    const daySet = new Set(getSchoolDaysForCount(config.jumlah_hari));

    const isInTimetableScope = (item: {
      tahun_ajaran: string;
      semester?: SemesterKind;
      kelas: string;
      hari?: DayOfWeek;
    }) =>
      resolveItemAcademicYear(item.tahun_ajaran) === targetYear &&
      (!item.semester || normalizeSemester(item.semester, 'ganjil') === targetSem) &&
      classSet.has(item.kelas.trim().toLowerCase()) &&
      Boolean(item.hari && daySet.has(item.hari));

    const preservedSchedules = currentSchedules.filter(
      (s) => !isInTimetableScope(s)
    );
    const removedSchedules = currentSchedules.filter((s) => isInTimetableScope(s));
    const nextSchedules = [...preservedSchedules, ...syncedSchedules];

    // Mirror every timetable schedule into SubjectAssignments so teachers see them automatically in Menu Presensi Mapel
    const preservedAssignments = currentAssignments.filter(
      (a) => !(a.source === 'schedule' && isInTimetableScope(a))
    );
    const removedAssignments = currentAssignments.filter(
      (a) => a.source === 'schedule' && isInTimetableScope(a)
    );

    let nextAssignments = [...preservedAssignments];
    const upsertedAssignments: SubjectAssignment[] = [];
    for (const sch of syncedSchedules) {
      const mirrored = syncScheduleToSubjectAssignments(
        nextAssignments,
        sch,
        targetSem
      );
      nextAssignments = mirrored.assignments;
      upsertedAssignments.push(mirrored.upsertedAssignment);
    }

    lastLocalAcademicSaveAtRef.current = Date.now();
    latestFullSnapshotRef.current.teacherSchedules = nextSchedules;
    latestFullSnapshotRef.current.subjectAssignments = nextAssignments;
    setTeacherSchedules(nextSchedules);
    saveTeacherSchedules(nextSchedules);
    setSubjectAssignments(nextAssignments);
    saveSubjectAssignments(nextAssignments);

    // Sync removed & upserted schedules/assignments to Cloud & Sheets
    const nextScheduleIds = new Set(nextSchedules.map((s) => s.id));
    for (const oldSch of removedSchedules) {
      if (!nextScheduleIds.has(oldSch.id)) {
        void syncMutation('deleteJadwalGuru', { id: oldSch.id });
        runCloudWrite((uid) => deleteTeacherScheduleFromCloud(uid, oldSch.id));
      }
    }
    for (const sch of syncedSchedules) {
      void syncMutation('upsertJadwalGuru', { ...sch, schedule: sch });
      runCloudWrite((uid) => upsertTeacherScheduleToCloud(uid, sch));
    }

    const nextAssignmentIds = new Set(nextAssignments.map((a) => a.id));
    for (const oldAsg of removedAssignments) {
      if (!nextAssignmentIds.has(oldAsg.id)) {
        void syncMutation('deleteMapelKelas', { id: oldAsg.id });
        runCloudWrite((uid) => deleteSubjectAssignmentFromCloud(uid, oldAsg.id));
      }
    }
    for (const asg of upsertedAssignments) {
      void syncMutation('upsertMapelKelas', { ...asg, assignment: asg });
      runCloudWrite((uid) => upsertSubjectAssignmentToCloud(uid, asg));
    }

    if (!options?.silent) {
      pushToast({
        type: 'success',
        title: 'Jadwal Mata Pelajaran Disimpan & Disinkronkan',
        description: `${syncedSchedules.length} sesi jadwal TA ${targetYear} Semester ${formatSemesterLabel(targetSem)} tersinkron ke Jadwal Pelajaran Guru dan Menu Mapel masing-masing guru.`,
      });
    }
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
    const activeSem = normalizeSemester(settings.semester, 'ganjil');
    const res = addSubjectAssignment(subjectAssignments, {
      teacher_user_id: session.userId,
      teacher_name: session.nama,
      kelas: input.kelas,
      mata_pelajaran: input.mata_pelajaran,
      hari: input.hari,
      jam_mulai: input.jam_mulai,
      jam_selesai: input.jam_selesai,
      tahun_ajaran: settings.tahun_ajaran,
      semester: activeSem,
    });
    if (!res.ok) return res;
    lastLocalAcademicSaveAtRef.current = Date.now();
    setSubjectAssignments(res.assignments);
    saveSubjectAssignments(res.assignments);
    void syncMutation('upsertMapelKelas', { ...res.assignment, assignment: res.assignment });
    runCloudWrite((uid) => upsertSubjectAssignmentToCloud(uid, res.assignment));

    // Bidirectional sync: automatically populate Master Admin's Sub Menu Jadwal Pelajaran Guru
    const mirrored = syncAssignmentToTeacherSchedules(
      teacherSchedules,
      res.assignment,
      activeSem
    );
    if (mirrored.upsertedSchedule) {
      const upsertedSchedule = mirrored.upsertedSchedule;
      setTeacherSchedules(mirrored.schedules);
      saveTeacherSchedules(mirrored.schedules);
      syncTimetablesWithSchedules(mirrored.schedules);
      void syncMutation('upsertJadwalGuru', {
        ...upsertedSchedule,
        schedule: upsertedSchedule,
      });
      runCloudWrite((uid) => upsertTeacherScheduleToCloud(uid, upsertedSchedule));
    }

    pushToast({
      type: 'success',
      title: 'Kelas & Mapel Ditambahkan',
      description: `${res.assignment.kelas} — ${res.assignment.mata_pelajaran} (${input.hari}) ditambahkan dan otomatis masuk ke Jadwal Pelajaran Guru.`,
    });
    return { ok: true, assignment: res.assignment };
  }

  function handleDeleteSubjectAssignment(assignmentId: string) {
    const target = subjectAssignments.find((a) => a.id === assignmentId);
    const nextAssignments = subjectAssignments.filter((a) => a.id !== assignmentId);
    lastLocalAcademicSaveAtRef.current = Date.now();
    setSubjectAssignments(nextAssignments);
    saveSubjectAssignments(nextAssignments);
    void syncMutation('deleteMapelKelas', { id: assignmentId });
    runCloudWrite((uid) => deleteSubjectAssignmentFromCloud(uid, assignmentId));

    // Bidirectional cleanup if a matching TeacherSchedule was created from this assignment
    if (target) {
      const matchingSchedules = teacherSchedules.filter(
        (s) =>
          s.id === `sch_from_${target.id}` ||
          (target.hari &&
            s.hari === target.hari &&
            s.teacher_user_id === target.teacher_user_id &&
            s.kelas.trim().toLowerCase() === target.kelas.trim().toLowerCase() &&
            s.mata_pelajaran.trim().toLowerCase() ===
              target.mata_pelajaran.trim().toLowerCase() &&
            resolveItemAcademicYear(s.tahun_ajaran) ===
              resolveItemAcademicYear(target.tahun_ajaran))
      );
      if (matchingSchedules.length > 0) {
        const removeIds = new Set(matchingSchedules.map((s) => s.id));
        const nextSchedules = teacherSchedules.filter((s) => !removeIds.has(s.id));
        setTeacherSchedules(nextSchedules);
        saveTeacherSchedules(nextSchedules);
        syncTimetablesWithSchedules(nextSchedules);
        for (const rem of matchingSchedules) {
          void syncMutation('deleteJadwalGuru', { id: rem.id });
          runCloudWrite((uid) => deleteTeacherScheduleFromCloud(uid, rem.id));
        }
      }
    }

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
    const currentSubjectRecords = latestFullSnapshotRef.current.subjectRecords;
    const outcome = processSubjectQrScan({
      qrRaw: rawCode,
      assignment,
      students: activeYearStudents,
      records: currentSubjectRecords,
      tanggal,
    });

    if (outcome.ok) {
      speakSuccessNotification('Presensi Berhasil');
      const nextRecords = [outcome.record, ...currentSubjectRecords];
      latestFullSnapshotRef.current.subjectRecords = nextRecords;
      lastLocalAcademicSaveAtRef.current = Date.now();
      setSubjectRecords(nextRecords);
      saveSubjectRecords(nextRecords);
      void syncMutation('recordPresensiMapel', {
        ...outcome.record,
        record: { ...outcome.record },
      });
      runCloudWrite((uid) => upsertSubjectRecordToCloud(uid, outcome.record));
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
          title: 'NISN Tidak Terdaftar',
          description: `Siswa dengan NISN "${outcome.nis}" tidak ditemukan pada Tahun Ajaran ${settings.tahun_ajaran}.`,
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
    const currentSubjectRecords = latestFullSnapshotRef.current.subjectRecords;
    const res = upsertSubjectAttendanceStatus({
      records: currentSubjectRecords,
      assignment: params.assignment,
      student: params.student,
      tanggal: params.tanggal,
      status: params.status,
    });
    latestFullSnapshotRef.current.subjectRecords = res.records;
    lastLocalAcademicSaveAtRef.current = Date.now();
    setSubjectRecords(res.records);
    saveSubjectRecords(res.records);
    void syncMutation('recordPresensiMapel', {
      ...res.record,
      record: { ...res.record },
    });
    runCloudWrite((uid) => upsertSubjectRecordToCloud(uid, res.record));
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
    const currentSubjectRecords = latestFullSnapshotRef.current.subjectRecords;
    // Preserve already-recorded statuses (Terlambat, Sakit, Izin, Alpa, Hadir) — only mark unrecorded students
    const recordedNisSet = new Set(
      currentSubjectRecords
        .filter(
          (r) =>
            r.tanggal === params.tanggal &&
            r.assignment_id === params.assignment.id
        )
        .map((r) => r.nis.trim().toLowerCase())
    );
    const unrecordedStudents = params.students.filter(
      (student) => !recordedNisSet.has(student.nis.trim().toLowerCase())
    );
    if (unrecordedStudents.length === 0) {
      pushToast({
        type: 'info',
        title: 'Semua Siswa Sudah Tercatat',
        description: `Seluruh siswa pada ${params.assignment.mata_pelajaran} (${params.assignment.kelas}) sudah memiliki status presensi.`,
      });
      return;
    }
    let nextRecords = [...currentSubjectRecords];
    const updatedBatch: SubjectAttendanceRecord[] = [];
    const nowTime = getCurrentTimeString();
    for (const student of unrecordedStudents) {
      const res = upsertSubjectAttendanceStatus({
        records: nextRecords,
        assignment: params.assignment,
        student,
        tanggal: params.tanggal,
        status: 'Hadir',
        currentTime: nowTime,
      });
      nextRecords = res.records;
      updatedBatch.push(res.record);
    }
    latestFullSnapshotRef.current.subjectRecords = nextRecords;
    lastLocalAcademicSaveAtRef.current = Date.now();
    setSubjectRecords(nextRecords);
    saveSubjectRecords(nextRecords);
    void syncMutation('bulkRecordPresensiMapel', { records: updatedBatch });
    runCloudWrite((uid) => bulkUpsertSubjectRecordsToCloud(uid, updatedBatch));
    speakSuccessNotification('Presensi Berhasil');
    pushToast({
      type: 'success',
      title: `${unrecordedStudents.length} Siswa Ditandai Hadir`,
      description: `${params.assignment.mata_pelajaran} — Kelas ${params.assignment.kelas} (${params.tanggal}). Status siswa yang sudah tercatat tetap dipertahankan.`,
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
      syncTimetablesWithSchedules(restoredTeacherSchedules);
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
          accounts: restoredAccounts.length > 0 ? restoredAccounts : accounts,
          masterSubjects:
            Array.isArray(restoredMasterSubjects) && restoredMasterSubjects.length > 0
              ? restoredMasterSubjects
              : masterSubjects,
          teacherSchedules: Array.isArray(restoredTeacherSchedules)
            ? restoredTeacherSchedules
            : teacherSchedules,
          subjectAssignments: Array.isArray(restoredAssignments)
            ? restoredAssignments
            : subjectAssignments,
          subjectRecords: Array.isArray(restoredSubjectRecords)
            ? restoredSubjectRecords
            : subjectRecords,
        },
        restoredSettings.script_url
      );
    }

    runCloudWrite((uid) =>
      pushFullLocalStateToCloud(
        uid,
        {
          settings: restoredSettings,
          students: restoredStudents,
          records: restoredRecords,
          masterSubjects:
            Array.isArray(restoredMasterSubjects) && restoredMasterSubjects.length > 0
              ? restoredMasterSubjects
              : masterSubjects,
          teacherSchedules: Array.isArray(restoredTeacherSchedules)
            ? restoredTeacherSchedules
            : teacherSchedules,
          subjectAssignments: Array.isArray(restoredAssignments)
            ? restoredAssignments
            : subjectAssignments,
          subjectRecords: Array.isArray(restoredSubjectRecords)
            ? restoredSubjectRecords
            : subjectRecords,
          accounts: restoredAccounts.length > 0 ? restoredAccounts : accounts,
        },
        true
      )
    );
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
        isOnline={isOnline}
        pendingSyncCount={pendingSyncCount}
        lastSyncedAt={lastSyncedAt}
        onSyncNow={() => {
          if (pendingSyncCount > 0 && settings.script_url.trim()) {
            void flushOfflineQueueNow();
            return;
          }
          if (settings.script_url.trim()) {
            void syncFromGas(settings.script_url, false, { forcePullRemote: true });
          } else if (!cloudConnected) {
            void handleConnectCloud();
          } else {
            pushToast({
              type: 'success',
              title: 'Cloud Firebase Tersinkron Real-Time',
              description:
                'Semua data pada perangkat ini aktif tersinkron otomatis melalui Cloud Firebase.',
            });
          }
        }}
        cloudSync={{
          connected: cloudConnected,
          syncing: cloudSyncing,
          email: firebaseUser?.email ?? null,
          onConnect: () => void handleConnectCloud(),
        }}
        onReplayVoice={handleReplayVoice}
        toasts={toasts}
        onDismissToast={dismissToast}
      >
        {effectiveTab === 'scan' && (
          <ScannerView
            students={activeYearStudents}
            records={activeYearRecords}
            settings={settings}
            isOnline={isOnline}
            pendingSyncCount={pendingSyncCount}
            syncingQueue={syncingQueue}
            hasRemoteSync={Boolean(settings.script_url.trim()) || cloudConnected}
            onSyncPendingNow={() => void flushOfflineQueueNow()}
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

        {effectiveTab === 'daftar_pelajaran' &&
          session &&
          (session.role === 'guru' || session.role === 'wali_kelas') && (
            <TeacherLessonListView
              session={session}
              settings={settings}
              schedules={teacherSchedules}
              assignments={subjectAssignments}
              activeTimetableConfig={
                timetableConfigs[
                  getTimetableConfigKey(
                    settings.tahun_ajaran,
                    normalizeSemester(settings.semester, 'ganjil')
                  )
                ]
              }
              onOpenSubjectAttendance={() => setActiveTab('mapel')}
            />
          )}

        {effectiveTab === 'jadwal' && session?.role === 'master_admin' && (
          <ScheduleManagementView
            settings={settings}
            accounts={accounts}
            availableClasses={availableClasses}
            masterSubjects={masterSubjects}
            schedules={teacherSchedules}
            activeTimetableConfig={
              timetableConfigs[
                getTimetableConfigKey(
                  settings.tahun_ajaran,
                  normalizeSemester(settings.semester, 'ganjil')
                )
              ]
            }
            onAddMasterSubject={handleAddMasterSubject}
            onUpdateMasterSubject={handleUpdateMasterSubject}
            onDeleteMasterSubject={handleDeleteMasterSubject}
            onAddSchedule={handleAddTeacherSchedule}
            onUpdateSchedule={handleUpdateTeacherSchedule}
            onDeleteSchedule={handleDeleteTeacherSchedule}
            onBulkImportSchedules={handleBulkImportTeacherSchedules}
            onNavigateToTimetable={() => setActiveTab('pengaturan_jadwal')}
          />
        )}

        {effectiveTab === 'pengaturan_jadwal' && session?.role === 'master_admin' && (
          <TimetableMatrixView
            settings={settings}
            accounts={accounts}
            availableClasses={availableClasses}
            availableYears={availableAcademicYears}
            masterSubjects={masterSubjects}
            schedules={teacherSchedules}
            timetableConfigs={timetableConfigs}
            onSaveTimetable={handleSaveTimetable}
            onNavigateToScheduleManagement={() => setActiveTab('jadwal')}
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
            isOnline={isOnline}
            pendingSyncCount={pendingSyncCount}
            syncingQueue={syncingQueue}
            onFlushOfflineQueue={() => flushOfflineQueueNow()}
            sheetsSupportsAkun={sheetsSupportsAkun}
            cloudSync={{
              connected: cloudConnected,
              syncing: cloudSyncing,
              email: firebaseUser?.email ?? null,
              displayName: firebaseUser?.displayName ?? null,
              lastSyncedAt,
              quota: firestoreQuota,
              onResetLocalQuota: handleResetLocalQuota,
              onConnect: handleConnectCloud,
              onDisconnect: handleDisconnectCloud,
              onPushLocalToCloud: handlePushLocalToCloud,
            }}
            onSaveSettings={handleSaveSettings}
            onSetDefaultIdentity={handleSetDefaultIdentity}
            onPreviewTheme={(tema) => setPreviewTheme(tema)}
            onUpdateAccounts={handleUpdateAccounts}
            onPushAccountsToSheets={handlePushAccountsToSheets}
            onPullAccountsFromSheets={handlePullAccountsFromSheets}
            onTestAndSync={handleTestAndSyncSheets}
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
