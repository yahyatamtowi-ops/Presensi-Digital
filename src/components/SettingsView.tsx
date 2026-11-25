import { useEffect, useState } from 'react';
import {
  Cloud,
  RefreshCw,
  Save,
  RotateCcw,
  Code2,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  ImagePlus,
  Trash2,
  QrCode,
  ShieldCheck,
  UserPlus,
  Pencil,
  X,
  Eye,
  EyeOff,
  Palette,
  GraduationCap,
  AlertTriangle,
  UploadCloud,
  BookmarkCheck,
  HardDrive,
  Download,
  Upload,
  FileSpreadsheet,
  Sun,
  Moon,
  Clock,
  Building2,
  PenTool,
  Stamp,
  Database,
  ExternalLink,
  Info,
  MessageSquare,
} from 'lucide-react';
import type {
  AppThemeId,
  AttendanceRecord,
  AttendanceScheduleMode,
  ConnectionStatus,
  SchoolSettings,
  SemesterKind,
  Student,
  UserAccount,
  UserRole,
} from '../types';
import { normalizeScheduleMode, normalizeTimeHHMM } from '../utils/attendanceLogic';
import { formatRoleLabel } from '../utils/auth';
import {
  loadLastBackupMeta,
  parseAndValidateBackupJson,
  type AppBackupPayload,
  type LastBackupMeta,
} from '../utils/backupStorage';
import { DEFAULT_SCRIPT_URL, GOOGLE_APPS_SCRIPT_TEMPLATE } from '../utils/gasApi';
import { DEFAULT_SCHOOL_LOGO, DEFAULT_SCHOOL_NAME } from '../utils/seedData';
import { normalizeSemester, validateTransparentPngFile } from '../utils/subjectAttendance';
import { normalizeThemeId, THEME_PRESETS } from '../utils/themes';

import {
  formatBytesReadable,
  type FirestoreQuotaSnapshot,
  type QuotaMetricSummary,
} from '../utils/firestoreUsage';
import type {
  AcademicYearAttendanceStat,
  ClearStorageScope,
  ExternalStorageSnapshot,
} from '../utils/storageHealth';
import {
  buildFirebaseAuthorizedDomainsUrl,
  type FirebaseAuthErrorDetail,
} from '../utils/firebaseAuthErrors';
import type { FonnteConfig } from '../utils/fonntePacing';
import type { FonnteClientRole } from '../utils/fonnteClient';
import { FonnteSettingsPanel } from './FonnteSettingsPanel';
import firebaseConfig from '../../firebase-applet-config.json';

interface CloudSyncSettingsProps {
  connected: boolean;
  syncing: boolean;
  email: string | null;
  displayName: string | null;
  lastSyncedAt: string | null;
  quota: FirestoreQuotaSnapshot;
  authError?: FirebaseAuthErrorDetail | null;
  onDismissAuthError?: () => void;
  onResetLocalQuota: () => void;
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  onPushLocalToCloud: () => Promise<void>;
}

interface SettingsViewProps {
  settings: SchoolSettings;
  accounts: UserAccount[];
  availableClasses: string[];
  totalStudentsCount: number;
  totalRecordsCount: number;
  connectionStatus: ConnectionStatus;
  isOnline?: boolean;
  pendingSyncCount?: number;
  syncingQueue?: boolean;
  onFlushOfflineQueue?: () => Promise<void> | void;
  sheetsSupportsAkun?: boolean | null;
  cloudSync?: CloudSyncSettingsProps;
  initialSubMenu?: SettingsSubMenuId;
  initialSubMenuNonce?: number;
  academicYearAttendanceStats?: AcademicYearAttendanceStat[];
  externalStorage?: ExternalStorageSnapshot;
  onRefreshStorageEstimate?: () => void;
  onClearStorage?: (scope: ClearStorageScope) => Promise<void> | void;
  onDeleteAttendanceByAcademicYear?: (tahunAjaran: string) => void;
  onSaveSettings: (newSettings: SchoolSettings) => Promise<void>;
  onSetDefaultIdentity: (namaSekolah: string, logoSekolah?: string) => void;
  onPreviewTheme: (tema: AppThemeId) => void;
  onUpdateAccounts: (nextAccounts: UserAccount[]) => Promise<void> | void;
  onPushAccountsToSheets?: () => Promise<void>;
  onPullAccountsFromSheets?: () => Promise<void>;
  onTestAndSync: (scriptUrl: string) => Promise<void>;
  onPushAllToSheets: (scriptUrl: string) => Promise<void>;
  onSaveBackupToComputer: () => Promise<LastBackupMeta | null>;
  onExportExcelArchive: () => LastBackupMeta | null;
  onRestoreBackup: (backup: AppBackupPayload) => Promise<void>;
  onResetAllAttendance: () => void;
  onResetDemo: () => void;
  fonnte?: {
    config: FonnteConfig;
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
  };
}

const LIGHT_THEMES = THEME_PRESETS.filter((t) => t.mode === 'light');
const DARK_THEMES = THEME_PRESETS.filter((t) => t.mode === 'dark');

export type SettingsSubMenuId =
  | 'profil'
  | 'jadwal'
  | 'tema'
  | 'koneksi'
  | 'fonnte'
  | 'akun'
  | 'backup';

const SETTINGS_SUBMENUS: Array<{
  id: SettingsSubMenuId;
  label: string;
  desc: string;
  Icon: typeof Building2;
  usesFormSave: boolean;
}> = [
  {
    id: 'profil',
    label: 'Profil & Sekolah',
    desc: 'Nama, logo, kepsek, TTD & cap',
    Icon: Building2,
    usesFormSave: true,
  },
  {
    id: 'jadwal',
    label: 'Jadwal Presensi',
    desc: 'Masuk, pulang & batas jam',
    Icon: Clock,
    usesFormSave: true,
  },
  {
    id: 'tema',
    label: 'Tampilan & Tema',
    desc: '14 warna terang & gelap',
    Icon: Palette,
    usesFormSave: true,
  },
  {
    id: 'koneksi',
    label: 'Cloud & Sheets',
    desc: 'Sinkron Firebase & Sheets',
    Icon: Cloud,
    usesFormSave: true,
  },
  {
    id: 'fonnte',
    label: 'WhatsApp Fonnte',
    desc: 'Notifikasi ortu & anti-blokir',
    Icon: MessageSquare,
    usesFormSave: false,
  },
  {
    id: 'akun',
    label: 'Akun & Akses',
    desc: 'Admin, Kepsek, Wali Kelas & Guru',
    Icon: ShieldCheck,
    usesFormSave: false,
  },
  {
    id: 'backup',
    label: 'Backup & Reset',
    desc: 'Simpan ke komputer & reset',
    Icon: HardDrive,
    usesFormSave: false,
  },
];

const ACADEMIC_YEAR_PRESETS = [
  '2024/2025',
  '2025/2026',
  '2026/2027',
  '2027/2028',
  '2028/2029',
];

function resizeLogoFileToDataUrl(
  file: File,
  maxSize = 240,
  maxChars = 42000
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result) {
        reject(new Error('Gagal membaca file gambar.'));
        return;
      }
      const img = new Image();
      img.onload = () => {
        const naturalW = img.naturalWidth || img.width || 128;
        const naturalH = img.naturalHeight || img.height || 128;
        let targetMax = maxSize;
        let bestDataUrl = '';

        // Step 1: Try transparent PNG with progressive downscaling so logo stays crisp and <= 42k chars
        // (guarantees safe storage in localStorage, Google Sheets 50k cell limit, and Firestore)
        for (let attempt = 0; attempt < 6; attempt++) {
          const ratio = Math.min(1, targetMax / Math.max(naturalW, naturalH));
          const w = Math.max(1, Math.round(naturalW * ratio));
          const h = Math.max(1, Math.round(naturalH * ratio));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(result.length <= maxChars ? result : '');
            return;
          }
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          bestDataUrl = canvas.toDataURL('image/png');
          if (bestDataUrl.length <= maxChars) {
            resolve(bestDataUrl);
            return;
          }
          targetMax = Math.max(72, Math.round(targetMax * 0.78));
        }

        // Step 2: Fallback to WebP / JPEG compression for high-detail photographic logos
        const fallbackSizes = [192, 144, 112, 96];
        for (const sz of fallbackSizes) {
          const ratio = Math.min(1, sz / Math.max(naturalW, naturalH));
          const w = Math.max(1, Math.round(naturalW * ratio));
          const h = Math.max(1, Math.round(naturalH * ratio));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);

          const webpUrl = canvas.toDataURL('image/webp', 0.82);
          if (webpUrl.startsWith('data:image/webp') && webpUrl.length <= maxChars) {
            resolve(webpUrl);
            return;
          }

          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          const jpegUrl = canvas.toDataURL('image/jpeg', 0.8);
          if (jpegUrl.length <= maxChars) {
            resolve(jpegUrl);
            return;
          }
        }

        if (bestDataUrl && bestDataUrl.length <= 120000) {
          resolve(bestDataUrl);
          return;
        }
        reject(new Error('Ukuran gambar logo terlalu besar. Gunakan file gambar yang lebih ringan.'));
      };
      img.onerror = () => reject(new Error('Format gambar logo tidak didukung.'));
      img.src = result;
    };
    reader.onerror = () => reject(new Error('Gagal membaca file logo.'));
    reader.readAsDataURL(file);
  });
}

function areSettingsEqual(a: SchoolSettings, b: SchoolSettings): boolean {
  return (
    (a.nama_sekolah || '').trim() === (b.nama_sekolah || '').trim() &&
    (a.nama_kepala_sekolah || '').trim() === (b.nama_kepala_sekolah || '').trim() &&
    (a.nip_kepala_sekolah || '').trim() === (b.nip_kepala_sekolah || '').trim() &&
    (a.ttd_kepala_sekolah || '') === (b.ttd_kepala_sekolah || '') &&
    (a.cap_sekolah || '') === (b.cap_sekolah || '') &&
    (a.logo_sekolah || '') === (b.logo_sekolah || '') &&
    normalizeTimeHHMM(a.batas_jam_masuk, '07:15') ===
      normalizeTimeHHMM(b.batas_jam_masuk, '07:15') &&
    normalizeScheduleMode(a.mode_presensi, 'masuk_saja') ===
      normalizeScheduleMode(b.mode_presensi, 'masuk_saja') &&
    normalizeTimeHHMM(a.jam_pulang_standar, '15:00') ===
      normalizeTimeHHMM(b.jam_pulang_standar, '15:00') &&
    (a.tahun_ajaran || '2026/2027').trim() === (b.tahun_ajaran || '2026/2027').trim() &&
    normalizeSemester(a.semester, 'ganjil') === normalizeSemester(b.semester, 'ganjil') &&
    normalizeThemeId(a.tema, 'indigo') === normalizeThemeId(b.tema, 'indigo') &&
    (a.script_url || '').trim() === (b.script_url || '').trim() &&
    (a.no_wa_admin || '').trim() === (b.no_wa_admin || '').trim() &&
    (a.show_creator_credit !== false) === (b.show_creator_credit !== false)
  );
}

function trimTransparentBounds(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number
): { sx: number; sy: number; sw: number; sh: number } {
  try {
    const data = ctx.getImageData(0, 0, w, h).data;
    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < h; y++) {
      const rowOffset = y * w * 4;
      for (let x = 0; x < w; x++) {
        if (data[rowOffset + x * 4 + 3] > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX >= minX && maxY >= minY) {
      const pad = 4;
      const sx = Math.max(0, minX - pad);
      const sy = Math.max(0, minY - pad);
      const ex = Math.min(w - 1, maxX + pad);
      const ey = Math.min(h - 1, maxY + pad);
      return { sx, sy, sw: ex - sx + 1, sh: ey - sy + 1 };
    }
  } catch {
    // Fallback to full bounds
  }
  return { sx: 0, sy: 0, sw: w, sh: h };
}

function resizeTransparentPngToDataUrl(
  file: File,
  maxSize = 320,
  maxChars = 42000
): Promise<string> {
  return new Promise((resolve, reject) => {
    const check = validateTransparentPngFile(file);
    if (!check.ok) {
      reject(new Error(check.error));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result) {
        reject(new Error('Gagal membaca file PNG.'));
        return;
      }
      const img = new Image();
      img.onload = () => {
        const naturalW = img.naturalWidth || img.width || 128;
        const naturalH = img.naturalHeight || img.height || 128;

        // First draw onto a working canvas to trim huge transparent margins
        const workScale = Math.min(1, 720 / Math.max(naturalW, naturalH));
        const workW = Math.max(1, Math.round(naturalW * workScale));
        const workH = Math.max(1, Math.round(naturalH * workScale));
        const workCanvas = document.createElement('canvas');
        workCanvas.width = workW;
        workCanvas.height = workH;
        const workCtx = workCanvas.getContext('2d');
        if (!workCtx) {
          resolve(result);
          return;
        }
        workCtx.clearRect(0, 0, workW, workH);
        workCtx.drawImage(img, 0, 0, workW, workH);

        const bounds = trimTransparentBounds(workCtx, workW, workH);
        let targetMax = maxSize;
        let dataUrl = '';

        // Iteratively fit within targetMax and keep base64 under Google Sheets 50k cell limit & localStorage budget
        for (let attempt = 0; attempt < 5; attempt++) {
          const ratio = Math.min(1, targetMax / Math.max(bounds.sw, bounds.sh));
          const outW = Math.max(1, Math.round(bounds.sw * ratio));
          const outH = Math.max(1, Math.round(bounds.sh * ratio));
          const outCanvas = document.createElement('canvas');
          outCanvas.width = outW;
          outCanvas.height = outH;
          const outCtx = outCanvas.getContext('2d');
          if (!outCtx) {
            resolve(result);
            return;
          }
          outCtx.clearRect(0, 0, outW, outH);
          outCtx.drawImage(
            workCanvas,
            bounds.sx,
            bounds.sy,
            bounds.sw,
            bounds.sh,
            0,
            0,
            outW,
            outH
          );
          dataUrl = outCanvas.toDataURL('image/png');
          if (dataUrl.length <= maxChars || targetMax <= 110) {
            break;
          }
          targetMax = Math.max(96, Math.round(targetMax * 0.78));
        }

        resolve(dataUrl || result);
      };
      img.onerror = () => reject(new Error('File PNG tidak valid atau rusak.'));
      img.src = result;
    };
    reader.onerror = () => reject(new Error('Gagal membaca file PNG.'));
    reader.readAsDataURL(file);
  });
}

export function SettingsView({
  settings,
  accounts,
  availableClasses,
  totalStudentsCount,
  totalRecordsCount,
  connectionStatus,
  isOnline = true,
  pendingSyncCount = 0,
  syncingQueue = false,
  onFlushOfflineQueue,
  sheetsSupportsAkun = null,
  cloudSync,
  initialSubMenu,
  initialSubMenuNonce,
  academicYearAttendanceStats = [],
  externalStorage,
  onRefreshStorageEstimate,
  onClearStorage,
  onDeleteAttendanceByAcademicYear,
  onSaveSettings,
  onSetDefaultIdentity,
  onPreviewTheme,
  onUpdateAccounts,
  onPushAccountsToSheets,
  onPullAccountsFromSheets,
  onTestAndSync,
  onPushAllToSheets,
  onSaveBackupToComputer,
  onExportExcelArchive,
  onRestoreBackup,
  onResetAllAttendance,
  onResetDemo,
  fonnte,
}: SettingsViewProps) {
  const [formState, setFormState] = useState<SchoolSettings>({
    ...settings,
    batas_jam_masuk: normalizeTimeHHMM(settings.batas_jam_masuk, '07:15'),
    mode_presensi: normalizeScheduleMode(settings.mode_presensi, 'masuk_saja'),
    jam_pulang_standar: normalizeTimeHHMM(settings.jam_pulang_standar, '15:00'),
    tahun_ajaran: settings.tahun_ajaran || '2026/2027',
    semester: normalizeSemester(settings.semester, 'ganjil'),
    tema: normalizeThemeId(settings.tema, 'indigo'),
    show_creator_credit: settings.show_creator_credit !== false,
  });
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pushingAll, setPushingAll] = useState(false);
  const [syncingAccounts, setSyncingAccounts] = useState(false);
  const [savingBackup, setSavingBackup] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [lastBackupMeta, setLastBackupMeta] = useState<LastBackupMeta | null>(() =>
    loadLastBackupMeta()
  );
  const [pendingRestore, setPendingRestore] = useState<{
    filename: string;
    backup: AppBackupPayload;
  } | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [savedAsDefaultNotice, setSavedAsDefaultNotice] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [ttdError, setTtdError] = useState<string | null>(null);
  const [capError, setCapError] = useState<string | null>(null);
  const [showScriptGuide, setShowScriptGuide] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [activeSubMenu, setActiveSubMenu] = useState<SettingsSubMenuId>(
    initialSubMenu || 'profil'
  );
  const [confirmResetDemo, setConfirmResetDemo] = useState(false);
  const [confirmResetAttendance, setConfirmResetAttendance] = useState(false);
  const [selectedDeleteYear, setSelectedDeleteYear] = useState<string>(
    () => academicYearAttendanceStats[0]?.tahun_ajaran || ''
  );
  const [confirmDeleteYearModal, setConfirmDeleteYearModal] =
    useState<AcademicYearAttendanceStat | null>(null);
  const [showDeviceStorageInfo, setShowDeviceStorageInfo] = useState(false);
  const [showLocalStorageInfo, setShowLocalStorageInfo] = useState(false);
  const [showCloudStorageInfo, setShowCloudStorageInfo] = useState(false);
  const [showFirebaseDomainInfo, setShowFirebaseDomainInfo] = useState(false);
  const [copiedFirebaseDomain, setCopiedFirebaseDomain] = useState(false);
  const [confirmClearStorageScope, setConfirmClearStorageScope] =
    useState<ClearStorageScope | null>(null);
  const [clearingStorage, setClearingStorage] = useState(false);

  useEffect(() => {
    if (initialSubMenu) {
      setActiveSubMenu(initialSubMenu);
    }
  }, [initialSubMenu, initialSubMenuNonce]);

  useEffect(() => {
    if (academicYearAttendanceStats.length === 0) {
      setSelectedDeleteYear('');
      return;
    }
    const stillExists = academicYearAttendanceStats.some(
      (item) => item.tahun_ajaran === selectedDeleteYear
    );
    if (!stillExists) {
      setSelectedDeleteYear(academicYearAttendanceStats[0].tahun_ajaran);
    }
  }, [academicYearAttendanceStats, selectedDeleteYear]);

  // Sync external settings updates (e.g. cloud sync / backup restore) ONLY when user has no unsaved edits
  useEffect(() => {
    if (hasUnsavedChanges) return;
    setFormState({
      ...settings,
      nama_kepala_sekolah: settings.nama_kepala_sekolah || '',
      nip_kepala_sekolah: settings.nip_kepala_sekolah || '',
      ttd_kepala_sekolah: settings.ttd_kepala_sekolah || '',
      cap_sekolah: settings.cap_sekolah || '',
      logo_sekolah: settings.logo_sekolah || DEFAULT_SCHOOL_LOGO,
      batas_jam_masuk: normalizeTimeHHMM(settings.batas_jam_masuk, '07:15'),
      mode_presensi: normalizeScheduleMode(settings.mode_presensi, 'masuk_saja'),
      jam_pulang_standar: normalizeTimeHHMM(settings.jam_pulang_standar, '15:00'),
      tahun_ajaran: settings.tahun_ajaran || '2026/2027',
      semester: normalizeSemester(settings.semester, 'ganjil'),
      tema: normalizeThemeId(settings.tema, 'indigo'),
      no_wa_admin: settings.no_wa_admin || '',
      show_creator_credit: settings.show_creator_credit !== false,
    });
  }, [settings, hasUnsavedChanges]);

  const isDirty = hasUnsavedChanges && !areSettingsEqual(formState, settings);

  function updateFormField(patch: Partial<SchoolSettings>) {
    setFormState((prev) => {
      const next = { ...prev, ...patch };
      setHasUnsavedChanges(!areSettingsEqual(next, settings));
      return next;
    });
  }

  async function handleSelectRestoreFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBackupError(null);
    setPendingRestore(null);
    try {
      const text = await file.text();
      const parsed = parseAndValidateBackupJson(text, accounts);
      if (!parsed.ok) {
        setBackupError(parsed.error);
        return;
      }
      setPendingRestore({
        filename: file.name,
        backup: parsed.backup,
      });
    } catch {
      setBackupError('Gagal membaca file backup dari perangkat.');
    }
  }

  // Add account state
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newNama, setNewNama] = useState('');
  const [newNip, setNewNip] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('wali_kelas');
  const [newKelasBinaan, setNewKelasBinaan] = useState(availableClasses[0] || '');
  const [accountError, setAccountError] = useState<string | null>(null);

  // Edit account modal state
  const [editingAccount, setEditingAccount] = useState<UserAccount | null>(null);
  const [editUsername, setEditUsername] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [editNama, setEditNama] = useState('');
  const [editNip, setEditNip] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('wali_kelas');
  const [editKelasBinaan, setEditKelasBinaan] = useState('');
  const [editAccountError, setEditAccountError] = useState<string | null>(null);

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setLogoError(null);
    try {
      const dataUrl = await resizeLogoFileToDataUrl(file);
      updateFormField({ logo_sekolah: dataUrl });
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : 'Gagal memuat logo.');
    }
  }

  async function handleTtdUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    setTtdError(null);
    try {
      const dataUrl = await resizeTransparentPngToDataUrl(file, 320, 42000);
      updateFormField({ ttd_kepala_sekolah: dataUrl });
    } catch (err) {
      setTtdError(err instanceof Error ? err.message : 'Gagal memuat file TTD PNG.');
    } finally {
      input.value = '';
    }
  }

  async function handleCapUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    setCapError(null);
    try {
      const dataUrl = await resizeTransparentPngToDataUrl(file, 260, 42000);
      updateFormField({ cap_sekolah: dataUrl });
    } catch (err) {
      setCapError(err instanceof Error ? err.message : 'Gagal memuat file Cap PNG.');
    } finally {
      input.value = '';
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const normalizedPayload: SchoolSettings = {
        nama_sekolah: formState.nama_sekolah.trim() || DEFAULT_SCHOOL_NAME,
        nama_kepala_sekolah: (formState.nama_kepala_sekolah || '').trim(),
        nip_kepala_sekolah: (formState.nip_kepala_sekolah || '').trim(),
        ttd_kepala_sekolah: formState.ttd_kepala_sekolah || '',
        cap_sekolah: formState.cap_sekolah || '',
        batas_jam_masuk: normalizeTimeHHMM(formState.batas_jam_masuk, '07:15'),
        mode_presensi: normalizeScheduleMode(formState.mode_presensi, 'masuk_saja'),
        jam_pulang_standar: normalizeTimeHHMM(formState.jam_pulang_standar, '15:00'),
        tahun_ajaran: formState.tahun_ajaran.trim() || '2026/2027',
        semester: normalizeSemester(formState.semester, 'ganjil'),
        tema: normalizeThemeId(formState.tema, 'indigo'),
        script_url: formState.script_url.trim(),
        logo_sekolah: formState.logo_sekolah || DEFAULT_SCHOOL_LOGO,
        no_wa_admin: (formState.no_wa_admin || '').trim(),
        show_creator_credit: formState.show_creator_credit !== false,
      };
      setFormState(normalizedPayload);
      await onSaveSettings(normalizedPayload);
      setHasUnsavedChanges(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleAddAccount(e: React.FormEvent) {
    e.preventDefault();
    const u = newUsername.trim();
    const p = newPassword.trim();
    const n = newNama.trim();
    const nip = newNip.trim();
    const kelas = newRole === 'wali_kelas' ? newKelasBinaan.trim() : '';

    if (!u || !p || !n) {
      setAccountError('Username, password, dan nama lengkap wajib diisi.');
      return;
    }
    if (newRole === 'wali_kelas' && !kelas) {
      setAccountError('Kelas binaan wajib diisi untuk akun Wali Kelas.');
      return;
    }
    if (accounts.some((a) => a.username.toLowerCase() === u.toLowerCase())) {
      setAccountError(`Username "${u}" sudah digunakan.`);
      return;
    }
    const created: UserAccount = {
      id: `usr_${Date.now()}`,
      username: u,
      password: p,
      nama: n,
      nip: nip || undefined,
      role: newRole,
      jabatan: formatRoleLabel(newRole, kelas),
      kelas_binaan: kelas || undefined,
    };
    setNewUsername('');
    setNewPassword('');
    setNewNama('');
    setNewNip('');
    setAccountError(null);
    setSyncingAccounts(true);
    try {
      await onUpdateAccounts([...accounts, created]);
    } finally {
      setSyncingAccounts(false);
    }
  }

  function openEditAccountModal(acc: UserAccount) {
    setEditingAccount(acc);
    setEditUsername(acc.username);
    setEditPassword(acc.password);
    setShowEditPassword(false);
    setEditNama(acc.nama);
    setEditNip(acc.nip || '');
    setEditRole(acc.role);
    setEditKelasBinaan(acc.kelas_binaan || availableClasses[0] || '');
    setEditAccountError(null);
  }

  async function handleSaveEditedAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!editingAccount) return;

    const u = editUsername.trim();
    const p = editPassword.trim();
    const n = editNama.trim();
    const nip = editNip.trim();
    const kelas = editRole === 'wali_kelas' ? editKelasBinaan.trim() : '';

    if (!u || !p || !n) {
      setEditAccountError('Username, password, dan nama lengkap wajib diisi.');
      return;
    }
    if (editRole === 'wali_kelas' && !kelas) {
      setEditAccountError('Kelas binaan wajib diisi untuk akun Wali Kelas.');
      return;
    }
    if (
      accounts.some(
        (a) => a.id !== editingAccount.id && a.username.toLowerCase() === u.toLowerCase()
      )
    ) {
      setEditAccountError(`Username "${u}" sudah digunakan akun lain.`);
      return;
    }

    const masterCount = accounts.filter((a) => a.role === 'master_admin').length;
    if (
      editingAccount.role === 'master_admin' &&
      editRole !== 'master_admin' &&
      masterCount <= 1
    ) {
      setEditAccountError('Minimal harus ada satu akun Master Admin aktif.');
      return;
    }

    const updatedAccount: UserAccount = {
      ...editingAccount,
      username: u,
      password: p,
      nama: n,
      nip: nip || undefined,
      role: editRole,
      jabatan: formatRoleLabel(editRole, kelas),
      kelas_binaan: kelas || undefined,
    };

    const nextList = accounts.map((a) =>
      a.id === editingAccount.id ? updatedAccount : a
    );
    setEditingAccount(null);
    setEditAccountError(null);
    setSyncingAccounts(true);
    try {
      await onUpdateAccounts(nextList);
    } finally {
      setSyncingAccounts(false);
    }
  }

  async function handleRemoveAccount(id: string) {
    const target = accounts.find((a) => a.id === id);
    if (!target) return;
    const masterCount = accounts.filter((a) => a.role === 'master_admin').length;
    if (target.role === 'master_admin' && masterCount <= 1) {
      setAccountError('Minimal harus ada satu akun Master Admin.');
      return;
    }
    setAccountError(null);
    setSyncingAccounts(true);
    try {
      await onUpdateAccounts(accounts.filter((a) => a.id !== id));
    } finally {
      setSyncingAccounts(false);
    }
  }

  async function handleCopyTemplate() {
    try {
      await navigator.clipboard.writeText(GOOGLE_APPS_SCRIPT_TEMPLATE);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      // Fallback ignored
    }
  }

  const currentSubMenuMeta =
    SETTINGS_SUBMENUS.find((item) => item.id === activeSubMenu) ?? SETTINGS_SUBMENUS[0];

  const renderSaveFooter = () => (
    <div className="pt-4 mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100">
      <p className="text-xs text-slate-500">
        {isDirty
          ? 'Ada perubahan pengaturan yang belum disimpan.'
          : 'Semua pengaturan sudah tersimpan.'}
      </p>
      <button
        type="submit"
        disabled={saving}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60 transition-colors"
      >
        <Save className="h-4 w-4" aria-hidden="true" />
        <span>{saving ? 'Menyimpan...' : 'Simpan Pengaturan'}</span>
      </button>
    </div>
  );

  return (
    <div className="space-y-4 sm:space-y-5">
      <datalist id="class-suggestions">
        {availableClasses.map((cls) => (
          <option key={cls} value={cls} />
        ))}
      </datalist>

      <datalist id="academic-year-presets">
        {ACADEMIC_YEAR_PRESETS.map((yr) => (
          <option key={yr} value={yr} />
        ))}
      </datalist>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5 items-start">
        {/* Sub-Menu Navigation Rail */}
        <aside
          aria-label="Sub menu pengaturan"
          className="lg:col-span-3 lg:sticky lg:top-20 bg-white rounded-2xl border border-slate-200/80 p-2.5 sm:p-3 shadow-[0_1px_3px_rgba(15,23,42,0.04)]"
        >
          <div className="px-2 pt-0.5 pb-2 border-b border-slate-100 mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Kategori Pengaturan
            </p>
            {isDirty && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap">
                Belum disimpan
              </span>
            )}
          </div>

          <div
            role="tablist"
            aria-label="Daftar sub menu pengaturan"
            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-1 gap-1.5"
          >
            {SETTINGS_SUBMENUS.map(({ id, label, desc, Icon, usesFormSave }) => {
              const isActive = activeSubMenu === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  data-settings-submenu={id}
                  onClick={() => setActiveSubMenu(id)}
                  className={`flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                    isActive
                      ? 'bg-indigo-50 text-indigo-700 border border-indigo-200 shadow-xs'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 border border-transparent'
                  }`}
                >
                  <div
                    className={`h-7 w-7 sm:h-8 sm:w-8 rounded-lg flex items-center justify-center shrink-0 ${
                      isActive
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold truncate">{label}</span>
                      {usesFormSave && isDirty && (
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0"
                          aria-hidden="true"
                        />
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 truncate hidden lg:block">
                      {desc}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Active Sub-Menu Content Area */}
        <div
          role="tabpanel"
          aria-label={currentSubMenuMeta.label}
          className="lg:col-span-9 space-y-4 sm:space-y-5 min-w-0"
        >
          {currentSubMenuMeta.usesFormSave && (
            <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
              {/* SUB-MENU: KONEKSI CLOUD FIREBASE & GOOGLE SHEETS */}
              {activeSubMenu === 'koneksi' && (
                <div className="space-y-4 sm:space-y-5">
                  {cloudSync && (
                    <section className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-3.5">
                      <div className="space-y-1.5">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <div className="h-9 w-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                              <Cloud className="h-4 w-4" aria-hidden="true" />
                            </div>
                            <h2 className="text-sm sm:text-base font-semibold text-slate-900 leading-snug min-w-0 flex-1">
                              <span>Sinkronisasi Cloud Lintas Perangkat (Firebase)</span>
                              <button
                                type="button"
                                data-testid="btn-info-firebase-domain"
                                aria-label="Informasi domain resmi Firebase Auth"
                                aria-expanded={showFirebaseDomainInfo}
                                title="Klik untuk melihat domain aplikasi & panduan Authorized Domains Firebase"
                                onClick={() => setShowFirebaseDomainInfo((v) => !v)}
                                className={`h-6 w-6 rounded-full inline-flex items-center justify-center align-middle ml-1.5 transition-colors ${
                                  showFirebaseDomainInfo
                                    ? 'bg-indigo-600 text-white'
                                    : 'bg-slate-100 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600'
                                }`}
                              >
                                <Info className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            </h2>
                          </div>
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border whitespace-nowrap shrink-0 self-start sm:self-auto ${
                              cloudSync.connected
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-slate-50 text-slate-600 border-slate-200'
                            }`}
                          >
                            <span
                              className={`h-2 w-2 rounded-full ${
                                cloudSync.connected ? 'bg-emerald-500' : 'bg-slate-400'
                              }`}
                              aria-hidden="true"
                            />
                            {cloudSync.connected ? 'Terhubung Real-Time' : 'Belum Terhubung'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 leading-relaxed">
                          Hubungkan dengan akun Google yang sama di komputer, tablet, atau HP lain agar data tersinkron secara real-time.
                        </p>
                      </div>

                      {showFirebaseDomainInfo && (
                        <div
                          data-testid="info-panel-firebase-domain"
                          className="rounded-xl bg-indigo-50/70 border border-indigo-200/80 p-3.5 text-xs text-indigo-950 space-y-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-semibold text-indigo-900">
                              Domain Aplikasi &amp; Authorized Domains Firebase
                            </p>
                            <button
                              type="button"
                              aria-label="Tutup informasi domain Firebase"
                              onClick={() => setShowFirebaseDomainInfo(false)}
                              className="text-indigo-500 hover:text-indigo-700 p-0.5 rounded"
                            >
                              <X className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </div>
                          <p className="text-indigo-900/90 leading-relaxed">
                            Jika membuka aplikasi dari alamat domain baru atau kustom dan muncul{' '}
                            <code className="font-mono font-semibold">auth/unauthorized-domain</code>,
                            tambahkan domain aktif di bawah ini ke menu{' '}
                            <strong>Firebase Console → Authentication → Settings → Authorized domains</strong>.
                          </p>
                          <div className="flex flex-wrap items-center gap-2 pt-0.5">
                            <code className="px-2.5 py-1.5 rounded-lg bg-white border border-indigo-200 font-mono text-[11px] font-semibold text-slate-900">
                              {typeof window !== 'undefined' ? window.location.hostname : 'localhost'}
                            </code>
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  const host =
                                    typeof window !== 'undefined'
                                      ? window.location.hostname
                                      : 'localhost';
                                  await navigator.clipboard.writeText(host);
                                  setCopiedFirebaseDomain(true);
                                  window.setTimeout(() => setCopiedFirebaseDomain(false), 2000);
                                } catch {
                                  // ignore clipboard failure
                                }
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-indigo-200 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors"
                            >
                              {copiedFirebaseDomain ? (
                                <>
                                  <Check className="h-3 w-3" aria-hidden="true" />
                                  <span>Tersalin</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3 w-3" aria-hidden="true" />
                                  <span>Salin Domain</span>
                                </>
                              )}
                            </button>
                            <a
                              href={buildFirebaseAuthorizedDomainsUrl(firebaseConfig.projectId)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white text-[11px] font-semibold hover:bg-indigo-700 transition-colors"
                            >
                              <ExternalLink className="h-3 w-3" aria-hidden="true" />
                              <span>Buka Authorized Domains</span>
                            </a>
                          </div>
                        </div>
                      )}

                      {cloudSync.authError && !cloudSync.connected && (
                        <div
                          data-testid="firebase-auth-error-panel"
                          className="rounded-xl bg-amber-50 border border-amber-200 p-4 space-y-2.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2.5 min-w-0">
                              <AlertTriangle
                                className="h-4 w-4 text-amber-600 shrink-0 mt-0.5"
                                aria-hidden="true"
                              />
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-amber-900">
                                  {cloudSync.authError.title}{' '}
                                  <span className="font-mono font-normal text-[11px] text-amber-700">
                                    ({cloudSync.authError.code})
                                  </span>
                                </p>
                                <p className="text-xs text-amber-800 mt-0.5 leading-relaxed">
                                  {cloudSync.authError.description}
                                </p>
                              </div>
                            </div>
                            {cloudSync.onDismissAuthError && (
                              <button
                                type="button"
                                aria-label="Tutup peringatan login Firebase"
                                onClick={cloudSync.onDismissAuthError}
                                className="text-amber-600 hover:text-amber-800 p-0.5 rounded shrink-0"
                              >
                                <X className="h-4 w-4" aria-hidden="true" />
                              </button>
                            )}
                          </div>
                          {cloudSync.authError.isUnauthorizedDomain && (
                            <div className="flex flex-wrap items-center gap-2 pl-6">
                              <code className="px-2.5 py-1 rounded-lg bg-white border border-amber-200 font-mono text-[11px] font-semibold text-slate-900">
                                {cloudSync.authError.hostname}
                              </code>
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard.writeText(
                                      cloudSync.authError?.hostname || ''
                                    );
                                    setCopiedFirebaseDomain(true);
                                    window.setTimeout(
                                      () => setCopiedFirebaseDomain(false),
                                      2000
                                    );
                                  } catch {
                                    // ignore
                                  }
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-amber-300 text-[11px] font-semibold text-amber-900 hover:bg-amber-100 transition-colors"
                              >
                                {copiedFirebaseDomain ? (
                                  <>
                                    <Check className="h-3 w-3" aria-hidden="true" />
                                    <span>Tersalin</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="h-3 w-3" aria-hidden="true" />
                                    <span>Salin Domain</span>
                                  </>
                                )}
                              </button>
                              <a
                                href={cloudSync.authError.consoleAuthorizedDomainsUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-600 text-white text-[11px] font-semibold hover:bg-amber-700 transition-colors"
                              >
                                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                                <span>Tambahkan di Firebase Console</span>
                              </a>
                            </div>
                          )}
                        </div>
                      )}

                      {cloudSync.connected ? (
                        <div className="rounded-xl bg-emerald-50/70 border border-emerald-200/80 p-3.5 sm:p-4 flex flex-col gap-3">
                          <div className="min-w-0 w-full">
                            <p className="text-xs font-semibold text-emerald-900 truncate">
                              {cloudSync.displayName || 'Akun Google Terhubung'}
                            </p>
                            <p className="text-xs font-mono text-emerald-700 truncate mt-0.5">
                              {cloudSync.email}
                            </p>
                            {cloudSync.lastSyncedAt && (
                              <p className="text-[11px] text-emerald-700/85 mt-1 leading-relaxed">
                                Pembaruan terakhir pukul {cloudSync.lastSyncedAt} · Seluruh data siswa, presensi, jadwal, pengaturan &amp; akun tersinkron otomatis.
                              </p>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              disabled={cloudSync.syncing}
                              onClick={() => void cloudSync.onPushLocalToCloud()}
                              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-emerald-300 bg-white text-xs font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50 transition-colors whitespace-nowrap"
                            >
                              <UploadCloud className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>{cloudSync.syncing ? 'Menyinkronkan...' : 'Kirim Data Lokal ke Cloud'}</span>
                            </button>
                            <button
                              type="button"
                              disabled={cloudSync.syncing}
                              onClick={() => void cloudSync.onDisconnect()}
                              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-rose-200 bg-white text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50 transition-colors whitespace-nowrap"
                            >
                              <span>Putuskan Cloud</span>
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3.5 sm:p-4 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
                          <p className="text-xs text-slate-600 leading-relaxed flex-1 min-w-0">
                            Data saat ini tersimpan lokal di browser ini. Masuk dengan akun Google sekolah untuk mengaktifkan penyimpanan cloud Firebase dan sinkronisasi lintas perangkat.
                          </p>
                          <button
                            type="button"
                            disabled={cloudSync.syncing}
                            onClick={() => void cloudSync.onConnect()}
                            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors shrink-0 self-start xl:self-auto whitespace-nowrap"
                          >
                            <Cloud className="h-4 w-4" aria-hidden="true" />
                            <span>{cloudSync.syncing ? 'Menghubungkan...' : 'Hubungkan Akun Google (Firebase)'}</span>
                          </button>
                        </div>
                      )}
                    </section>
                  )}

                  {/* PENGGUNAAN POIN / KUOTA GRATIS FIRESTORE (SPARK PLAN) */}
                  {cloudSync && (
                    <section
                      aria-label="Penggunaan Kuota Gratis Firestore"
                      className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-3.5"
                    >
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="h-9 w-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                              <Database className="h-4 w-4" aria-hidden="true" />
                            </div>
                            <h2 className="text-sm sm:text-base font-semibold text-slate-900 leading-snug">
                              Penggunaan Poin Gratis Firestore (Spark Plan)
                            </h2>
                          </div>
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-mono font-medium bg-slate-50 text-slate-600 border border-slate-200 whitespace-nowrap shrink-0">
                            Periode: {cloudSync.quota.quotaDate} (PT)
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 leading-relaxed">
                          Pantau estimasi pemakaian harian (Baca, Tulis, Hapus) dan kapasitas penyimpanan gratis Cloud Firestore.
                        </p>
                      </div>

                      {(() => {
                        const renderQuotaCard = (
                          label: string,
                          sublabel: string,
                          metric: QuotaMetricSummary,
                          formattedUsed: string,
                          formattedLimit: string,
                          formattedRemaining: string
                        ) => {
                          const barClass =
                            metric.level === 'critical'
                              ? 'bg-rose-500'
                              : metric.level === 'warning'
                                ? 'bg-amber-500'
                                : 'bg-emerald-500';
                          const badgeClass =
                            metric.level === 'critical'
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : metric.level === 'warning'
                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                : 'bg-emerald-50 text-emerald-700 border-emerald-200';
                          const statusLabel =
                            metric.level === 'critical'
                              ? 'Mendekati Batas'
                              : metric.level === 'warning'
                                ? 'Waspada'
                                : 'Aman';

                          return (
                            <div
                              key={label}
                              className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 space-y-2.5"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold text-slate-900">{label}</p>
                                  <p className="text-[11px] text-slate-500">{sublabel}</p>
                                </div>
                                <span
                                  className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border whitespace-nowrap shrink-0 ${badgeClass}`}
                                >
                                  {statusLabel}
                                </span>
                              </div>

                              <div className="flex items-baseline justify-between gap-2">
                                <p className="text-sm font-bold font-mono tabular-nums text-slate-900">
                                  {formattedUsed}
                                  <span className="text-xs font-normal text-slate-500">
                                    {' '}
                                    / {formattedLimit}
                                  </span>
                                </p>
                                <span className="text-xs font-mono font-semibold tabular-nums text-indigo-700">
                                  {metric.percent.toFixed(1)}%
                                </span>
                              </div>

                              <div className="h-2 w-full rounded-full bg-slate-200/90 overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all duration-300 ${barClass}`}
                                  style={{ width: `${Math.min(100, Math.max(metric.used > 0 ? 2 : 0, metric.percent))}%` }}
                                />
                              </div>

                              <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                                Sisa kuota: <span className="font-semibold text-slate-700">{formattedRemaining}</span>
                              </p>
                            </div>
                          );
                        };

                        const q = cloudSync.quota;
                        return (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                            {renderQuotaCard(
                              'Pembacaan Dokumen (Reads)',
                              'Batas gratis 50.000 poin / hari',
                              q.reads,
                              q.reads.used.toLocaleString('id-ID'),
                              q.reads.limit.toLocaleString('id-ID'),
                              `${q.reads.remaining.toLocaleString('id-ID')} baca`
                            )}
                            {renderQuotaCard(
                              'Penulisan Dokumen (Writes)',
                              'Batas gratis 20.000 poin / hari',
                              q.writes,
                              q.writes.used.toLocaleString('id-ID'),
                              q.writes.limit.toLocaleString('id-ID'),
                              `${q.writes.remaining.toLocaleString('id-ID')} tulis`
                            )}
                            {renderQuotaCard(
                              'Penghapusan Dokumen (Deletes)',
                              'Batas gratis 20.000 poin / hari',
                              q.deletes,
                              q.deletes.used.toLocaleString('id-ID'),
                              q.deletes.limit.toLocaleString('id-ID'),
                              `${q.deletes.remaining.toLocaleString('id-ID')} hapus`
                            )}
                            {renderQuotaCard(
                              'Penyimpanan Cloud (Storage)',
                              `Total ${q.storage.totalDocuments.toLocaleString('id-ID')} dokumen tersimpan · Batas 1 GiB`,
                              q.storage,
                              formatBytesReadable(q.storage.used),
                              '1.00 GiB',
                              formatBytesReadable(q.storage.remaining)
                            )}
                          </div>
                        );
                      })()}

                      <div className="rounded-xl bg-slate-50 border border-slate-200/70 px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono tabular-nums">
                          <span>Siswa: <strong className="text-slate-900">{cloudSync.quota.storage.breakdown.students}</strong></span>
                          <span>·</span>
                          <span>Presensi: <strong className="text-slate-900">{cloudSync.quota.storage.breakdown.attendance}</strong></span>
                          <span>·</span>
                          <span>Mapel &amp; Jadwal: <strong className="text-slate-900">{cloudSync.quota.storage.breakdown.subjects + cloudSync.quota.storage.breakdown.schedules + cloudSync.quota.storage.breakdown.subjectRecords}</strong></span>
                          <span>·</span>
                          <span>Akun: <strong className="text-slate-900">{cloudSync.quota.storage.breakdown.accounts}</strong></span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={cloudSync.onResetLocalQuota}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-[11px] font-medium text-slate-600 hover:bg-slate-100 transition-colors"
                          >
                            <RotateCcw className="h-3 w-3" aria-hidden="true" />
                            <span>Reset Counter Lokal</span>
                          </button>
                          <a
                            href={`https://console.firebase.google.com/project/${firebaseConfig.projectId}/firestore/databases/${firebaseConfig.firestoreDatabaseId}/usage`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-indigo-200 bg-indigo-50 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors"
                          >
                            <span>Lihat Detail Firebase Console</span>
                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </a>
                        </div>
                      </div>

                      <p className="text-[11px] text-slate-500">
                        Estimasi aktivitas pada perangkat ini. Kuota harian gratis Firestore (Spark Plan) direset otomatis oleh Google setiap hari pukul 00:00 Pacific Time (±14:00–15:00 WIB).
                      </p>
                    </section>
                  )}

                  <section className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-3.5">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2.5">
                        <div className="h-9 w-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                          <Cloud className="h-4 w-4" aria-hidden="true" />
                        </div>
                        <h2 className="text-sm sm:text-base font-semibold text-slate-900 leading-snug">
                          Koneksi Database Google Sheets (Sinkronisasi Penuh)
                        </h2>
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Terhubung otomatis ke 8 sheet: <strong>Siswa</strong>, <strong>Presensi</strong>, <strong>Pengaturan</strong>, <strong>Akun</strong>, <strong>MasterMapel</strong>, <strong>JadwalGuru</strong>, <strong>MapelKelas</strong>, dan <strong>PresensiMapel</strong>.
                      </p>
                    </div>

                  <div>
                    <label
                      htmlFor="setting-script-url"
                      className="block text-xs font-medium text-slate-700 mb-1.5"
                    >
                      Google Apps Script Web App URL
                    </label>
                    <input
                      id="setting-script-url"
                      type="url"
                      value={formState.script_url}
                      onChange={(e) => updateFormField({ script_url: e.target.value })}
                      placeholder="https://script.google.com/macros/s/AKfycb.../exec"
                      className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-mono text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                    <p className="text-xs text-slate-500 mt-1.5">
                      Kosongkan URL untuk menjalankan mode lokal dengan cache{' '}
                      <span className="font-mono text-slate-700">localStorage</span>.
                      {DEFAULT_SCRIPT_URL ? (
                        <span>
                          {' '}
                          Default URL kode: <span className="font-mono">{DEFAULT_SCRIPT_URL}</span>
                        </span>
                      ) : null}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 pt-1">
                    <button
                      type="button"
                      disabled={!formState.script_url.trim() || connectionStatus === 'syncing' || pushingAll}
                      onClick={async () => {
                        const target = formState.script_url.trim();
                        if (!target) return;
                        setHasUnsavedChanges(false);
                        await onTestAndSync(target);
                        setHasUnsavedChanges(false);
                      }}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${connectionStatus === 'syncing' ? 'animate-spin' : ''}`}
                        aria-hidden="true"
                      />
                      <span>Tarik Semua Data dari Spreadsheet</span>
                    </button>

                    <button
                      type="button"
                      disabled={!formState.script_url.trim() || connectionStatus === 'syncing' || pushingAll}
                      onClick={async () => {
                        setPushingAll(true);
                        try {
                          await onPushAllToSheets(formState.script_url.trim());
                        } finally {
                          setPushingAll(false);
                        }
                      }}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-indigo-200 bg-indigo-50 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 transition-colors"
                    >
                      <UploadCloud className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{pushingAll ? 'Mengirim ke Sheets...' : 'Kirim Semua Data Lokal ke Sheets'}</span>
                    </button>

                    {pendingSyncCount > 0 && (
                      <div className="inline-flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-[11px] font-semibold text-amber-800">
                          <span className="font-mono tabular-nums">{pendingSyncCount}</span> data offline menunggu sinkron
                        </span>
                        {isOnline && onFlushOfflineQueue && (
                          <button
                            type="button"
                            disabled={syncingQueue}
                            onClick={() => void onFlushOfflineQueue()}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-[11px] font-semibold hover:bg-amber-700 disabled:opacity-50 transition-colors"
                          >
                            <RefreshCw
                              className={`h-3 w-3 ${syncingQueue ? 'animate-spin' : ''}`}
                              aria-hidden="true"
                            />
                            <span>{syncingQueue ? 'Menyinkronkan...' : 'Sinkronkan Antrean'}</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-indigo-200/70 bg-indigo-50/40 p-3.5 space-y-1">
                    <p className="text-xs font-semibold text-indigo-950">
                      Cara Menyamakan Data di Perangkat Lain
                    </p>
                    <p className="text-[11px] text-indigo-900/85 leading-relaxed">
                      Tempelkan <strong>Web App URL</strong> yang sama di perangkat lain lalu klik <strong>Tarik Semua Data dari Spreadsheet</strong> agar seluruh 8 sheet langsung tersinkron tanpa menimpa data Spreadsheet.
                    </p>
                  </div>

                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Sinkronisasi berjalan otomatis setiap 10 detik, saat membuka tab, dan mengirim ulang antrean offline saat koneksi kembali.
                  </p>

                  {renderSaveFooter()}
                </section>
                </div>
              )}

              {/* SUB-MENU: PROFIL & SEKOLAH */}
              {activeSubMenu === 'profil' && (
                <section className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2.5">
                      <div className="h-9 w-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                        <Building2 className="h-4 w-4" aria-hidden="true" />
                      </div>
                      <h2 className="text-sm sm:text-base font-semibold text-slate-900 leading-snug">
                        Profil Sekolah &amp; Tahun Ajaran
                      </h2>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      Atur identitas sekolah, logo resmi untuk kartu E-Card/PDF, dan tahun ajaran aktif.
                    </p>
                  </div>

                  {/* Edit Logo Sekolah */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3.5 p-3.5 sm:p-4 rounded-xl bg-slate-50 border border-slate-200/80">
            <div className="h-14 w-14 sm:h-16 sm:w-16 rounded-2xl border border-slate-200 bg-white flex items-center justify-center shrink-0 overflow-hidden p-1.5">
              <img
                src={formState.logo_sekolah || DEFAULT_SCHOOL_LOGO}
                alt="Preview Logo Sekolah"
                className="h-full w-full object-contain"
              />
            </div>
            <div className="flex-1 min-w-0 space-y-2">
              <div>
                <p className="text-xs font-semibold text-slate-900">Logo Sekolah</p>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Default menggunakan lambang resmi SMA Negeri 1 Kabun. Unggah gambar PNG, JPG, atau SVG untuk mengganti.
                </p>
              </div>
              {logoError && (
                <p className="text-xs font-medium text-rose-600">{logoError}</p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer">
                  <ImagePlus className="h-3.5 w-3.5 text-indigo-600" aria-hidden="true" />
                  <span>Ganti Logo</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    onChange={handleLogoUpload}
                    className="sr-only"
                  />
                </label>
                {formState.logo_sekolah && formState.logo_sekolah !== DEFAULT_SCHOOL_LOGO && (
                  <button
                    type="button"
                    onClick={() => updateFormField({ logo_sekolah: DEFAULT_SCHOOL_LOGO })}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-200 bg-white text-xs font-medium text-rose-600 hover:bg-rose-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Kembalikan Logo Default</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    const nextName =
                      formState.nama_sekolah.trim() || DEFAULT_SCHOOL_NAME;
                    const nextLogo = formState.logo_sekolah || DEFAULT_SCHOOL_LOGO;
                    onSetDefaultIdentity(nextName, nextLogo);
                    const nextSavedPreview: SchoolSettings = {
                      ...settings,
                      nama_sekolah: nextName,
                      logo_sekolah: nextLogo,
                    };
                    if (areSettingsEqual(formState, nextSavedPreview)) {
                      setHasUnsavedChanges(false);
                    }
                    setSavedAsDefaultNotice(true);
                    setTimeout(() => setSavedAsDefaultNotice(false), 3000);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors"
                >
                  <BookmarkCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    {savedAsDefaultNotice
                      ? 'Tersimpan sebagai Default'
                      : 'Jadikan Nama & Logo Saat Ini Default'}
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* School Name, Tahun Ajaran & Semester */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
            <div className="sm:col-span-6">
              <label
                htmlFor="setting-school-name"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Nama Sekolah
              </label>
              <input
                id="setting-school-name"
                type="text"
                required
                value={formState.nama_sekolah}
                onChange={(e) => updateFormField({ nama_sekolah: e.target.value })}
                placeholder={DEFAULT_SCHOOL_NAME}
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            <div className="sm:col-span-3">
              <label
                htmlFor="setting-academic-year"
                className="flex items-center gap-1.5 text-xs font-medium text-slate-700 mb-1.5"
              >
                <GraduationCap className="h-3.5 w-3.5 text-indigo-600" aria-hidden="true" />
                <span>Tahun Ajaran Aktif</span>
              </label>
              <input
                id="setting-academic-year"
                type="text"
                required
                list="academic-year-presets"
                value={formState.tahun_ajaran}
                onChange={(e) => updateFormField({ tahun_ajaran: e.target.value })}
                placeholder="2026/2027"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-mono text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            <div className="sm:col-span-3">
              <label
                htmlFor="setting-semester"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Semester Aktif
              </label>
              <select
                id="setting-semester"
                value={normalizeSemester(formState.semester, 'ganjil')}
                onChange={(e) =>
                  updateFormField({ semester: e.target.value as SemesterKind })
                }
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="ganjil">Semester 1 (Ganjil)</option>
                <option value="genap">Semester 2 (Genap)</option>
              </select>
            </div>
          </div>

          <p className="text-[11px] text-slate-500 -mt-1.5 leading-relaxed">
            Mengubah Tahun Ajaran akan menyembunyikan data tahun sebelumnya dari Wali Kelas, Guru, dan Pemindai QR (tetap dapat diakses Master Admin).
          </p>

          {/* Pengesahan E-Card: Nama & NIP Kepala Sekolah, TTD PNG & Cap Sekolah PNG */}
          <div className="pt-3.5 border-t border-slate-100 space-y-3.5">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Pengesahan E-Card (Kepala Sekolah, NIP, TTD &amp; Cap Sekolah)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                Disematkan pada sisi kiri bawah Kartu Tanda Siswa Elektronik (PNG transparan) agar ukuran QR Code tetap maksimal.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="setting-principal-name"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Nama Kepala Sekolah
                </label>
                <input
                  id="setting-principal-name"
                  type="text"
                  value={formState.nama_kepala_sekolah || ''}
                  onChange={(e) =>
                    updateFormField({ nama_kepala_sekolah: e.target.value })
                  }
                  placeholder="Contoh: Drs. H. Ahmad Hidayat, M.Pd"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div>
                <label
                  htmlFor="setting-principal-nip"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  NIP Kepala Sekolah
                </label>
                <input
                  id="setting-principal-nip"
                  type="text"
                  value={formState.nip_kepala_sekolah || ''}
                  onChange={(e) =>
                    updateFormField({ nip_kepala_sekolah: e.target.value })
                  }
                  placeholder="Contoh: 196804121995121001"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-mono text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div className="md:col-span-2">
                <label
                  htmlFor="setting-admin-wa"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Nomor WhatsApp Master Admin (Tujuan Permohonan Wali Kelas)
                </label>
                <input
                  id="setting-admin-wa"
                  data-testid="setting-admin-wa-input"
                  type="tel"
                  value={formState.no_wa_admin || ''}
                  onChange={(e) =>
                    updateFormField({ no_wa_admin: e.target.value })
                  }
                  placeholder="Contoh: 081234567890 atau 6281234567890"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-mono text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Digunakan otomatis saat Wali Kelas mengirim permohonan ubah status terlambat menjadi tepat waktu melalui WhatsApp.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {/* Upload TTD Kepala Sekolah PNG Transparan */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2.5">
                <div className="flex items-center gap-3">
                  <div
                    className="h-12 w-20 rounded-xl border border-slate-200 bg-white flex items-center justify-center shrink-0 overflow-hidden p-1.5"
                    style={{
                      backgroundImage:
                        'linear-gradient(45deg, #f1f5f9 25%, transparent 25%), linear-gradient(-45deg, #f1f5f9 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f1f5f9 75%), linear-gradient(-45deg, transparent 75%, #f1f5f9 75%)',
                      backgroundSize: '12px 12px',
                      backgroundPosition: '0 0, 0 6px, 6px -6px, -6px 0px',
                    }}
                  >
                    {formState.ttd_kepala_sekolah ? (
                      <img
                        src={formState.ttd_kepala_sekolah}
                        alt="Preview TTD Kepala Sekolah"
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : (
                      <PenTool className="h-5 w-5 text-slate-400" aria-hidden="true" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-900">
                      TTD Kepala Sekolah (PNG)
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      File <span className="font-mono">.png</span> latar transparan.
                    </p>
                  </div>
                </div>

                {ttdError && (
                  <p role="alert" className="text-xs font-medium text-rose-600">
                    {ttdError}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap">
                    <Upload className="h-3.5 w-3.5 text-indigo-600" aria-hidden="true" />
                    <span>
                      {formState.ttd_kepala_sekolah ? 'Ganti TTD PNG' : 'Unggah TTD PNG'}
                    </span>
                    <input
                      id="setting-principal-ttd"
                      aria-label="Unggah TTD Kepala Sekolah PNG transparan"
                      type="file"
                      accept="image/png,.png"
                      onChange={handleTtdUpload}
                      className="sr-only"
                    />
                  </label>
                  {formState.ttd_kepala_sekolah && (
                    <button
                      type="button"
                      onClick={() => {
                        setTtdError(null);
                        updateFormField({ ttd_kepala_sekolah: '' });
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-200 bg-white text-xs font-medium text-rose-600 hover:bg-rose-50 whitespace-nowrap"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Hapus TTD</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Upload Cap Sekolah PNG Transparan */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2.5">
                <div className="flex items-center gap-3">
                  <div
                    className="h-12 w-12 rounded-xl border border-slate-200 bg-white flex items-center justify-center shrink-0 overflow-hidden p-1.5"
                    style={{
                      backgroundImage:
                        'linear-gradient(45deg, #f1f5f9 25%, transparent 25%), linear-gradient(-45deg, #f1f5f9 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f1f5f9 75%), linear-gradient(-45deg, transparent 75%, #f1f5f9 75%)',
                      backgroundSize: '12px 12px',
                      backgroundPosition: '0 0, 0 6px, 6px -6px, -6px 0px',
                    }}
                  >
                    {formState.cap_sekolah ? (
                      <img
                        src={formState.cap_sekolah}
                        alt="Preview Cap Sekolah"
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : (
                      <Stamp className="h-5 w-5 text-slate-400" aria-hidden="true" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-900">
                      Cap / Stempel Sekolah (PNG)
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      File <span className="font-mono">.png</span> latar transparan.
                    </p>
                  </div>
                </div>

                {capError && (
                  <p role="alert" className="text-xs font-medium text-rose-600">
                    {capError}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap">
                    <Upload className="h-3.5 w-3.5 text-indigo-600" aria-hidden="true" />
                    <span>
                      {formState.cap_sekolah ? 'Ganti Cap PNG' : 'Unggah Cap PNG'}
                    </span>
                    <input
                      id="setting-school-cap"
                      aria-label="Unggah Cap Sekolah PNG transparan"
                      type="file"
                      accept="image/png,.png"
                      onChange={handleCapUpload}
                      className="sr-only"
                    />
                  </label>
                  {formState.cap_sekolah && (
                    <button
                      type="button"
                      onClick={() => {
                        setCapError(null);
                        updateFormField({ cap_sekolah: '' });
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-200 bg-white text-xs font-medium text-rose-600 hover:bg-rose-50 whitespace-nowrap"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Hapus Cap</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Mini Live Preview of E-Card Approval Layout (Left under Siswa Putra/Putri, Full-Size QR Right) */}
            {(formState.nama_kepala_sekolah?.trim() ||
              formState.nip_kepala_sekolah?.trim() ||
              formState.ttd_kepala_sekolah ||
              formState.cap_sekolah) && (
              <div
                data-testid="principal-ecard-preview"
                className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 p-3.5 sm:p-4 rounded-xl border border-indigo-200/80 bg-indigo-50/40"
              >
                <div className="space-y-1 min-w-0 flex-1">
                  <p className="text-xs font-semibold text-slate-900">
                    Pratinjau Susunan Kartu Tanda Siswa (E-Card)
                  </p>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Ukuran standar KTP (8,56 × 5,4 cm). TTD, Cap, Nama, dan NIP Kepala Sekolah ditempatkan di kiri bawah agar QR Code tetap besar dan mudah dipindai.
                  </p>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 px-3.5 py-3 flex items-center justify-between gap-4 w-full max-w-[280px] aspect-[85.6/54] shrink-0">
                  <div className="min-w-0 flex-1 text-left">
                    <p className="text-[10px] font-bold text-slate-900 whitespace-nowrap truncate">
                      Ahmad Fauzi Pratama
                    </p>
                    <p className="text-[9px] text-slate-500">NISN 2026001 · X IPA 1</p>
                    <p className="text-[9px] text-slate-400 mb-1.5">Siswa Putra</p>

                    <div className="pt-1 border-t border-slate-100">
                      <p className="text-[8.5px] font-medium text-slate-500">Kepala Sekolah</p>
                      <div className="relative h-9 w-28 flex items-center my-0.5">
                        {formState.cap_sekolah && (
                          <img
                            src={formState.cap_sekolah}
                            alt="Cap Sekolah pada pratinjau"
                            className={`h-9 w-9 object-contain ${
                              formState.ttd_kepala_sekolah ? 'absolute left-0 opacity-90' : ''
                            }`}
                          />
                        )}
                        {formState.ttd_kepala_sekolah && (
                          <img
                            src={formState.ttd_kepala_sekolah}
                            alt="TTD Kepala Sekolah pada pratinjau"
                            className={`relative z-10 max-h-8 max-w-[96px] object-contain ${
                              formState.cap_sekolah ? 'ml-4' : ''
                            }`}
                          />
                        )}
                      </div>
                      {formState.nama_kepala_sekolah?.trim() && (
                        <p className="text-[9.5px] font-bold text-slate-900 leading-tight underline decoration-slate-400 underline-offset-2 truncate max-w-[148px]">
                          {formState.nama_kepala_sekolah.trim()}
                        </p>
                      )}
                      {formState.nip_kepala_sekolah?.trim() && (
                        <p className="text-[8.5px] font-mono text-slate-500 leading-tight mt-0.5 truncate max-w-[148px]">
                          NIP. {formState.nip_kepala_sekolah.trim()}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col items-center shrink-0">
                    <div className="h-20 w-20 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center">
                      <QrCode className="h-14 w-14 text-slate-800" aria-hidden="true" />
                    </div>
                    <span className="text-[8.5px] font-mono text-slate-500 mt-1">
                      NISN: 2026001
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {renderSaveFooter()}
        </section>
              )}

              {/* SUB-MENU: JADWAL PRESENSI (MASUK & PULANG) */}
              {activeSubMenu === 'jadwal' && (
                <section className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-4">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="h-9 w-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                          <Clock className="h-4 w-4" aria-hidden="true" />
                        </div>
                        <h2 className="text-sm sm:text-base font-semibold text-slate-900 leading-snug">
                          Jadwal Presensi Siswa (Masuk &amp; Pulang)
                        </h2>
                      </div>
                      <span className="text-[11px] font-mono tabular-nums px-2.5 py-1 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 font-medium whitespace-nowrap">
                        {formState.mode_presensi === 'masuk_pulang'
                          ? `Aktif: Masuk (${formState.batas_jam_masuk || '07:15'}) & Pulang (${formState.jam_pulang_standar || '15:00'})`
                          : `Aktif: Masuk Saja (${formState.batas_jam_masuk || '07:15'})`}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      Pilih mode pemindaian harian dan tentukan batas jam masuk serta jam pulang standar.
                    </p>
                  </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(
                [
                  {
                    value: 'masuk_saja' as AttendanceScheduleMode,
                    title: 'Masuk Saja',
                    desc: 'Siswa hanya melakukan presensi masuk 1 kali per hari.',
                  },
                  {
                    value: 'masuk_pulang' as AttendanceScheduleMode,
                    title: 'Masuk dan Pulang',
                    desc: 'Siswa melakukan presensi saat jam masuk dan presensi saat jam pulang sekolah.',
                  },
                ] as const
              ).map((opt) => {
                const selected = formState.mode_presensi === opt.value;
                return (
                  <label
                    key={opt.value}
                    className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-colors ${
                      selected
                        ? 'border-indigo-500 bg-indigo-50/50 ring-2 ring-indigo-500/20'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="mode_presensi"
                      value={opt.value}
                      checked={selected}
                      onChange={() =>
                        updateFormField({ mode_presensi: opt.value })
                      }
                      className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{opt.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{opt.desc}</p>
                    </div>
                  </label>
                );
              })}
            </div>

            {/* Cutoff & Checkout Time — both always visible and editable */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
              <div>
                <label
                  htmlFor="setting-cutoff-time"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Batas Jam Masuk (HH:MM)
                </label>
                <input
                  id="setting-cutoff-time"
                  type="time"
                  required
                  value={formState.batas_jam_masuk}
                  onChange={(e) =>
                    updateFormField({ batas_jam_masuk: e.target.value })
                  }
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-mono text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Siswa yang scan setelah jam ini otomatis berstatus <strong>Terlambat</strong>.
                </p>
              </div>

              <div>
                <label
                  htmlFor="setting-checkout-time"
                  className="flex items-center justify-between text-xs font-medium text-slate-700 mb-1.5"
                >
                  <span>Batas / Jam Pulang Standar (HH:MM)</span>
                  <span
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                      formState.mode_presensi === 'masuk_pulang'
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {formState.mode_presensi === 'masuk_pulang' ? 'Aktif' : 'Nonaktif'}
                  </span>
                </label>
                <input
                  id="setting-checkout-time"
                  type="time"
                  required={formState.mode_presensi === 'masuk_pulang'}
                  value={formState.jam_pulang_standar}
                  onChange={(e) =>
                    updateFormField({ jam_pulang_standar: e.target.value })
                  }
                  className={`w-full rounded-xl border px-3.5 py-2.5 text-sm font-mono text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 ${
                    formState.mode_presensi === 'masuk_pulang'
                      ? 'border-indigo-200'
                      : 'border-slate-200 opacity-75'
                  }`}
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  {formState.mode_presensi === 'masuk_pulang'
                    ? 'Scan pulang otomatis aktif mulai jam ini (atau pilih mode "Presensi Pulang" di halaman Scan QR kapan saja).'
                    : 'Pilih mode "Masuk dan Pulang" di atas agar jadwal jam pulang aktif pada pemindai.'}
                </p>
              </div>
            </div>

                  {renderSaveFooter()}
                </section>
              )}

              {/* SUB-MENU: TAMPILAN & TEMA */}
              {activeSubMenu === 'tema' && (
                <section className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2.5">
                      <div className="h-9 w-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                        <Palette className="h-4 w-4" aria-hidden="true" />
                      </div>
                      <h2 className="text-sm sm:text-base font-semibold text-slate-900 leading-snug">
                        Tema &amp; Warna Aplikasi ({THEME_PRESETS.length} Pilihan)
                      </h2>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      Klik warna untuk pratinjau langsung, lalu tekan Simpan Pengaturan.
                    </p>
                  </div>

            {/* Tema Terang */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
                <Sun className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
                <span>Mode Terang ({LIGHT_THEMES.length} Variasi)</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {LIGHT_THEMES.map((theme) => {
                  const active = formState.tema === theme.id;
                  return (
                    <button
                      key={theme.id}
                      type="button"
                      data-theme-option={theme.id}
                      onClick={() => {
                        updateFormField({ tema: theme.id });
                        onPreviewTheme(theme.id);
                      }}
                      aria-pressed={active}
                      className={`flex items-center gap-2 p-2 sm:p-2.5 rounded-xl border text-left transition-all ${
                        active
                          ? 'border-indigo-500 bg-indigo-50/50 ring-2 ring-indigo-500/20'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <span
                        className="h-8 w-8 rounded-lg border border-slate-200 flex items-center justify-center shrink-0"
                        style={{ backgroundColor: theme.surface }}
                      >
                        <span
                          className="h-4 w-4 rounded-full"
                          style={{ backgroundColor: theme.swatch }}
                        />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-xs font-semibold text-slate-900 truncate">
                          {theme.label}
                        </span>
                        <span className="block text-[10px] text-slate-500 truncate">
                          {theme.desc}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Mode Gelap */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
                <Moon className="h-3.5 w-3.5 text-indigo-500" aria-hidden="true" />
                <span>Mode Gelap ({DARK_THEMES.length} Variasi)</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {DARK_THEMES.map((theme) => {
                  const active = formState.tema === theme.id;
                  return (
                    <button
                      key={theme.id}
                      type="button"
                      data-theme-option={theme.id}
                      onClick={() => {
                        updateFormField({ tema: theme.id });
                        onPreviewTheme(theme.id);
                      }}
                      aria-pressed={active}
                      className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all ${
                        active
                          ? 'border-indigo-500 bg-indigo-50/50 ring-2 ring-indigo-500/20'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <span
                        className="h-8 w-8 rounded-lg border border-slate-700 flex items-center justify-center shrink-0"
                        style={{ backgroundColor: theme.surface }}
                      >
                        <span
                          className="h-4 w-4 rounded-full"
                          style={{ backgroundColor: theme.swatch }}
                        />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-xs font-semibold text-slate-900 truncate">
                          {theme.label}
                        </span>
                        <span className="block text-[10px] text-slate-500 truncate">
                          {theme.desc}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Tampilan Identitas Pembuat Aplikasi di Bagian Bawah Menu Bar */}
            <div className="pt-3.5 border-t border-slate-200/80">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-3.5 sm:p-4 rounded-xl border border-slate-200/80 bg-slate-50/70">
                <div className="space-y-0.5 min-w-0 flex-1">
                  <p className="text-xs sm:text-sm font-semibold text-slate-900">
                    Tampilkan Kredit Pembuat di Bagian Bawah Menu Bar
                  </p>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Menampilkan{' '}
                    <span className="font-semibold text-slate-800">
                      &ldquo;Application Created By: Tamtowi Yahya&rdquo;
                    </span>{' '}
                    di bagian bawah Menu Bar.
                  </p>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span
                    className={`text-xs font-semibold ${
                      formState.show_creator_credit !== false
                        ? 'text-indigo-700'
                        : 'text-slate-500'
                    }`}
                  >
                    {formState.show_creator_credit !== false ? 'Aktif' : 'Nonaktif'}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={formState.show_creator_credit !== false}
                    aria-label="Aktifkan atau nonaktifkan tulisan Application Created By: Tamtowi Yahya di bagian bawah Menu Bar"
                    data-testid="toggle-creator-credit"
                    onClick={() =>
                      updateFormField({
                        show_creator_credit: !(formState.show_creator_credit !== false),
                      })
                    }
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
                      formState.show_creator_credit !== false
                        ? 'bg-indigo-600'
                        : 'bg-slate-300'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition-transform ${
                        formState.show_creator_credit !== false
                          ? 'translate-x-5'
                          : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>

                  {renderSaveFooter()}
                </section>
              )}
            </form>
          )}

          {/* SUB-MENU: WHATSAPP FONNTE (Notifikasi Orang Tua Otomatis & Anti-Blokir) */}
          {activeSubMenu === 'fonnte' && fonnte && (
            <FonnteSettingsPanel
              config={fonnte.config}
              settings={settings}
              students={fonnte.students}
              todayRecords={fonnte.todayRecords}
              todayDate={fonnte.todayDate}
              sentDedupeKeys={fonnte.sentDedupeKeys}
              lastScheduleRunKey={fonnte.lastScheduleRunKey}
              queueSyncNonce={fonnte.queueSyncNonce}
              clientRole={fonnte.clientRole}
              onChangeConfig={fonnte.onChangeConfig}
              onMarkSentKeys={fonnte.onMarkSentKeys}
              onClearSentKeys={fonnte.onClearSentKeys}
              onResetScheduleToday={fonnte.onResetScheduleToday}
              onNotifyToast={fonnte.onNotifyToast}
            />
          )}

          {/* SUB-MENU: BACKUP & RESET (External / Local Computer Storage Backup & Restore + Reset) */}
          {activeSubMenu === 'backup' && (
            <>
      <section className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-3.5">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-9 w-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                <HardDrive className="h-4 w-4" aria-hidden="true" />
              </div>
              <h2 className="text-sm sm:text-base font-semibold text-slate-900 leading-snug">
                Penyimpanan Eksternal &amp; Backup Komputer
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono tabular-nums text-slate-600 shrink-0">
              <span className="px-2 py-0.5 rounded-lg bg-slate-100 border border-slate-200/70 whitespace-nowrap">
                {totalStudentsCount} siswa
              </span>
              <span className="px-2 py-0.5 rounded-lg bg-slate-100 border border-slate-200/70 whitespace-nowrap">
                {totalRecordsCount} presensi
              </span>
              <span className="px-2 py-0.5 rounded-lg bg-slate-100 border border-slate-200/70 whitespace-nowrap">
                {accounts.length} akun
              </span>
            </div>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">
            Simpan cadangan seluruh data aplikasi (siswa, presensi, pengaturan, logo, dan akun) ke komputer atau penyimpanan eksternal.
          </p>
        </div>

        {lastBackupMeta && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-emerald-50/70 border border-emerald-200/80 text-xs text-emerald-900">
            <span>
              Backup terakhir:{' '}
              <strong className="font-mono">{lastBackupMeta.filename}</strong>
            </span>
            <span className="font-mono tabular-nums text-[11px] text-emerald-700">
              {new Date(lastBackupMeta.savedAt).toLocaleString('id-ID')}
            </span>
          </div>
        )}

        {backupError && (
          <div
            role="alert"
            className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-xs font-medium text-rose-700"
          >
            {backupError}
          </div>
        )}

        {externalStorage && (
          <div
            data-testid="external-storage-summary"
            className="p-3.5 sm:p-4 rounded-xl border border-slate-200/80 bg-slate-50/60 space-y-3"
          >
            <div className="space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Database className="h-4 w-4 text-indigo-600 shrink-0" aria-hidden="true" />
                  <p className="text-xs font-semibold text-slate-900">
                    Kapasitas Penyimpanan (Terpakai &amp; Tersisa)
                  </p>
                </div>
                {onRefreshStorageEstimate && (
                  <button
                    type="button"
                    data-testid="btn-refresh-storage"
                    onClick={onRefreshStorageEstimate}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-[11px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
                  >
                    <RefreshCw className="h-3 w-3" aria-hidden="true" />
                    <span>Perbarui Info</span>
                  </button>
                )}
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Klik ikon <strong className="font-mono text-slate-700">i</strong> pada tiap bagian untuk penjelasan detail.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Penyimpanan Perangkat / Eksternal (Browser Storage Quota) */}
              {(() => {
                const dev = externalStorage.device;
                const barClass =
                  dev.level === 'critical'
                    ? 'bg-rose-600'
                    : dev.level === 'warning'
                      ? 'bg-amber-500'
                      : 'bg-emerald-600';
                const badgeClass =
                  dev.level === 'critical'
                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                    : dev.level === 'warning'
                      ? 'bg-amber-50 text-amber-800 border-amber-200'
                      : 'bg-emerald-50 text-emerald-700 border-emerald-200';
                return (
                  <div className="p-3.5 rounded-xl border border-slate-200/80 bg-white space-y-2.5 flex flex-col justify-between">
                    <div className="space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-semibold text-slate-900 leading-snug min-w-0">
                          <span>Penyimpanan Perangkat / Eksternal</span>
                          <button
                            type="button"
                            data-testid="btn-info-storage-device"
                            aria-expanded={showDeviceStorageInfo}
                            aria-label="Informasi Penyimpanan Perangkat / Eksternal"
                            title="Klik untuk melihat penjelasan Penyimpanan Perangkat / Eksternal"
                            onClick={() => setShowDeviceStorageInfo((prev) => !prev)}
                            className={`inline-flex items-center justify-center align-middle ml-1.5 h-5 w-5 rounded-full border transition-colors ${
                              showDeviceStorageInfo
                                ? 'bg-indigo-600 border-indigo-600 text-white'
                                : 'bg-white border-slate-200 text-indigo-600 hover:bg-indigo-50 hover:border-indigo-200'
                            }`}
                          >
                            <Info className="h-3 w-3" aria-hidden="true" />
                          </button>
                        </p>
                        <span
                          className={`px-2 py-0.5 rounded-md border text-[11px] font-semibold font-mono tabular-nums shrink-0 ${badgeClass}`}
                        >
                          {dev.percent}%
                        </span>
                      </div>

                      {showDeviceStorageInfo && (
                        <div
                          data-testid="info-panel-storage-device"
                          role="region"
                          aria-label="Penjelasan Penyimpanan Perangkat / Eksternal"
                          className="rounded-lg border border-indigo-200/80 bg-indigo-50/50 p-2.5 flex items-start justify-between gap-2 text-[11px] text-slate-700 leading-relaxed"
                        >
                          <div className="space-y-1 min-w-0">
                            <p className="font-semibold text-slate-900">
                              Tentang Penyimpanan Perangkat / Eksternal
                            </p>
                            <p>
                              Menampilkan total ruang penyimpanan yang dialokasikan browser pada perangkat ini (mencakup database <strong>IndexedDB</strong>, cache offline, dan penyimpanan lokal aplikasi). Kapasitas maksimal menyesuaikan ruang kosong disk perangkat secara otomatis
                              {dev.persisted
                                ? ' dengan mode Persistent Storage aktif.'
                                : '.'}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowDeviceStorageInfo(false)}
                            aria-label="Tutup informasi penyimpanan perangkat"
                            className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-indigo-100/60 shrink-0"
                          >
                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      )}

                      <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${barClass}`}
                          style={{ width: `${Math.min(100, Math.max(2, dev.percent))}%` }}
                        />
                      </div>
                      <div className="grid grid-cols-3 gap-2 pt-0.5 text-[11px]">
                        <div>
                          <p className="text-slate-500">Terpakai</p>
                          <p
                            data-testid="external-storage-used"
                            className="font-mono tabular-nums font-semibold text-slate-900"
                          >
                            {formatBytesReadable(dev.usedBytes)}
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-500">Tersisa</p>
                          <p
                            data-testid="external-storage-remaining"
                            className="font-mono tabular-nums font-semibold text-emerald-700"
                          >
                            {formatBytesReadable(dev.remainingBytes)}
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-500">Kuota Maksimal</p>
                          <p
                            data-testid="external-storage-limit"
                            className="font-mono tabular-nums font-semibold text-slate-700"
                          >
                            {formatBytesReadable(dev.limitBytes)}
                          </p>
                        </div>
                      </div>
                    </div>

                    {onClearStorage && (
                      <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-500">
                          Cache offline &amp; antrean
                        </span>
                        <button
                          type="button"
                          data-testid="btn-clear-device-storage"
                          onClick={() => setConfirmClearStorageScope('device_cache')}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-[11px] font-semibold text-amber-800 hover:bg-amber-100 transition-colors shrink-0 whitespace-nowrap"
                        >
                          <Trash2 className="h-3 w-3" aria-hidden="true" />
                          <span>Bersihkan Cache</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Storage Lokal Aplikasi (IndexedDB Kapasitas Maksimal Browser) */}
              {(() => {
                const loc = externalStorage.appLocal;
                const barClass =
                  loc.level === 'critical'
                    ? 'bg-rose-600'
                    : loc.level === 'warning'
                      ? 'bg-amber-500'
                      : 'bg-indigo-600';
                const badgeClass =
                  loc.level === 'critical'
                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                    : loc.level === 'warning'
                      ? 'bg-amber-50 text-amber-800 border-amber-200'
                      : 'bg-indigo-50 text-indigo-700 border-indigo-200';
                return (
                  <div className="p-3.5 rounded-xl border border-slate-200/80 bg-white space-y-2.5 flex flex-col justify-between">
                    <div className="space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-semibold text-slate-900 leading-snug min-w-0">
                          <span>Storage Lokal Aplikasi (IndexedDB)</span>
                          <button
                            type="button"
                            data-testid="btn-info-storage-local"
                            aria-expanded={showLocalStorageInfo}
                            aria-label="Informasi Storage Lokal Aplikasi"
                            title="Klik untuk melihat penjelasan Storage Lokal Aplikasi"
                            onClick={() => setShowLocalStorageInfo((prev) => !prev)}
                            className={`inline-flex items-center justify-center align-middle ml-1.5 h-5 w-5 rounded-full border transition-colors ${
                              showLocalStorageInfo
                                ? 'bg-indigo-600 border-indigo-600 text-white'
                                : 'bg-white border-slate-200 text-indigo-600 hover:bg-indigo-50 hover:border-indigo-200'
                            }`}
                          >
                            <Info className="h-3 w-3" aria-hidden="true" />
                          </button>
                        </p>
                        <span
                          className={`px-2 py-0.5 rounded-md border text-[11px] font-semibold font-mono tabular-nums shrink-0 ${badgeClass}`}
                        >
                          {loc.percent}%
                        </span>
                      </div>

                      {showLocalStorageInfo && (
                        <div
                          data-testid="info-panel-storage-local"
                          role="region"
                          aria-label="Penjelasan Storage Lokal Aplikasi"
                          className="rounded-lg border border-indigo-200/80 bg-indigo-50/50 p-2.5 flex items-start justify-between gap-2 text-[11px] text-slate-700 leading-relaxed"
                        >
                          <div className="space-y-1 min-w-0">
                            <p className="font-semibold text-slate-900">
                              Tentang Storage Lokal Aplikasi (Kapasitas Maksimal)
                            </p>
                            <p>
                              Menyimpan data Siswa, Presensi Harian &amp; Mapel, Jadwal, serta Pengaturan/Logo di perangkat ini. Batas <strong>5.00 MB</strong> sebelumnya adalah ketentuan standar <span className="font-mono">localStorage</span> browser, namun kini aplikasi menggunakan <strong>IndexedDB</strong> hingga batas maksimal kuota browser (<strong>{formatBytesReadable(loc.limitBytes)}</strong>). Cache cepat <span className="font-mono">localStorage</span> saat ini terpakai{' '}
                              <span className="font-mono font-semibold">
                                {formatBytesReadable(loc.quickCache.usedBytes)} / {formatBytesReadable(loc.quickCache.limitBytes)}
                              </span>
                              .
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowLocalStorageInfo(false)}
                            aria-label="Tutup informasi storage lokal aplikasi"
                            className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-indigo-100/60 shrink-0"
                          >
                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      )}

                      <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${barClass}`}
                          style={{ width: `${Math.min(100, Math.max(2, loc.percent))}%` }}
                        />
                      </div>
                      <div className="grid grid-cols-3 gap-2 pt-0.5 text-[11px]">
                        <div>
                          <p className="text-slate-500">Terpakai</p>
                          <p
                            data-testid="local-storage-used"
                            className="font-mono tabular-nums font-semibold text-slate-900"
                          >
                            {formatBytesReadable(loc.usedBytes)}
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-500">Tersisa</p>
                          <p
                            data-testid="local-storage-remaining"
                            className="font-mono tabular-nums font-semibold text-emerald-700"
                          >
                            {formatBytesReadable(loc.remainingBytes)}
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-500">Batas Maksimal</p>
                          <p
                            data-testid="local-storage-limit"
                            className="font-mono tabular-nums font-semibold text-slate-700"
                          >
                            {formatBytesReadable(loc.limitBytes)}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 border-t border-slate-100 text-[10px] text-slate-500 font-mono tabular-nums">
                        <span>Siswa: {formatBytesReadable(loc.breakdown.studentsBytes)}</span>
                        <span>Presensi: {formatBytesReadable(loc.breakdown.attendanceBytes)}</span>
                        <span>Setelan/Logo: {formatBytesReadable(loc.breakdown.settingsBytes)}</span>
                      </div>
                    </div>

                    {onClearStorage && (
                      <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-500">
                          Hapus semua data lokal
                        </span>
                        <button
                          type="button"
                          data-testid="btn-clear-local-storage"
                          onClick={() => setConfirmClearStorageScope('app_local')}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 bg-rose-50 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 transition-colors shrink-0 whitespace-nowrap"
                        >
                          <Trash2 className="h-3 w-3" aria-hidden="true" />
                          <span>Bersihkan Storage</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {externalStorage.cloud.connected && (
              <div className="rounded-lg border border-slate-200/80 bg-white px-3 py-2.5 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-slate-700">
                      Cloud Firebase Firestore (Kuota Gratis 1 GB)
                    </span>
                    <button
                      type="button"
                      data-testid="btn-info-storage-cloud"
                      aria-expanded={showCloudStorageInfo}
                      aria-label="Informasi Cloud Firebase Firestore"
                      title="Klik untuk melihat penjelasan Cloud Firebase Firestore"
                      onClick={() => setShowCloudStorageInfo((prev) => !prev)}
                      className={`inline-flex items-center justify-center h-5 w-5 rounded-full border transition-colors shrink-0 ${
                        showCloudStorageInfo
                          ? 'bg-indigo-600 border-indigo-600 text-white'
                          : 'bg-white border-slate-200 text-indigo-600 hover:bg-indigo-50 hover:border-indigo-200'
                      }`}
                    >
                      <Info className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums">
                    <span className="text-slate-600">
                      Terpakai:{' '}
                      <strong className="text-slate-900">
                        {formatBytesReadable(externalStorage.cloud.usedBytes)}
                      </strong>
                    </span>
                    <span className="text-slate-600">
                      Tersisa:{' '}
                      <strong className="text-emerald-700">
                        {formatBytesReadable(externalStorage.cloud.remainingBytes)}
                      </strong>
                    </span>
                    <span className="text-slate-500">({externalStorage.cloud.percent}%)</span>
                  </div>
                </div>
                {showCloudStorageInfo && (
                  <div
                    data-testid="info-panel-storage-cloud"
                    role="region"
                    aria-label="Penjelasan Cloud Firebase Firestore"
                    className="rounded-lg border border-indigo-200/80 bg-indigo-50/50 p-2.5 flex items-start justify-between gap-2 text-[11px] text-slate-700 leading-relaxed"
                  >
                    <p>
                      Penyimpanan awan (Cloud) untuk menyinkronkan data secara otomatis antar perangkat (HP, Tablet, Laptop). Pembersihan cache atau storage lokal di perangkat ini <strong>tidak menghapus data di Cloud Firebase</strong>. Untuk mengurangi kapasitas Cloud, gunakan fitur <em>Hapus Data Presensi Siswa per Tahun Ajaran</em> di bawah.
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowCloudStorageInfo(false)}
                      aria-label="Tutup informasi Cloud Firebase"
                      className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-indigo-100/60 shrink-0"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="p-4 rounded-xl border border-slate-200/80 bg-slate-50/70 flex flex-col justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">
                Simpan Data ke Laptop / Penyimpanan Eksternal
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Unduh atau pilih folder tujuan di komputer/flashdisk untuk menyimpan cadangan penuh format <span className="font-mono">.json</span> atau arsip <span className="font-mono">.xlsx</span>.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={savingBackup}
                onClick={async () => {
                  setBackupError(null);
                  setSavingBackup(true);
                  try {
                    const meta = await onSaveBackupToComputer();
                    if (meta) setLastBackupMeta(meta);
                  } finally {
                    setSavingBackup(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-60 transition-colors"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {savingBackup ? 'Menyimpan...' : 'Simpan Backup (.json)'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setBackupError(null);
                  const meta = onExportExcelArchive();
                  if (meta) setLastBackupMeta(meta);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-emerald-200 bg-emerald-50 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Ekspor Arsip Excel (.xlsx)</span>
              </button>
            </div>
          </div>

          <div className="p-4 rounded-xl border border-slate-200/80 bg-slate-50/70 flex flex-col justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">
                Pulihkan Data dari Penyimpanan Komputer
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Pilih file cadangan <span className="font-mono">.json</span> dari komputer atau flashdisk untuk memulihkan seluruh data siswa, presensi, pengaturan, dan akun.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer transition-colors">
                <Upload className="h-3.5 w-3.5 text-indigo-600" aria-hidden="true" />
                <span>Pilih File Backup (.json)</span>
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleSelectRestoreFile}
                  aria-label="Pilih file backup JSON dari komputer"
                  className="sr-only"
                />
              </label>
            </div>
          </div>
        </div>

        {pendingRestore && (
          <div className="p-4 rounded-xl border border-indigo-200 bg-indigo-50/60 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  Konfirmasi Pemulihan Backup: <span className="font-mono text-xs">{pendingRestore.filename}</span>
                </p>
                <p className="text-xs text-slate-600 mt-0.5">
                  Sekolah: <strong>{pendingRestore.backup.data.settings.nama_sekolah}</strong> ·{' '}
                  <strong className="font-mono">{pendingRestore.backup.data.students.length}</strong> siswa ·{' '}
                  <strong className="font-mono">{pendingRestore.backup.data.records.length}</strong> presensi ·{' '}
                  <strong className="font-mono">{pendingRestore.backup.data.accounts.length}</strong> akun
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={restoringBackup}
                  onClick={async () => {
                    setRestoringBackup(true);
                    try {
                      setHasUnsavedChanges(false);
                      await onRestoreBackup(pendingRestore.backup);
                      setPendingRestore(null);
                    } finally {
                      setRestoringBackup(false);
                    }
                  }}
                  className="px-3.5 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-60"
                >
                  {restoringBackup ? 'Memulihkan...' : 'Ya, Pulihkan Semua Data'}
                </button>
                <button
                  type="button"
                  onClick={() => setPendingRestore(null)}
                  className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Batal
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Data Maintenance Section: Hapus Presensi per Tahun Ajaran, Reset Semua Presensi & Muat Data Demo */}
      <section className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-3.5">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            </div>
            <h2 className="text-sm sm:text-base font-semibold text-slate-900 leading-snug">
              Pemeliharaan &amp; Reset Data
            </h2>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">
            Hapus presensi per tahun ajaran untuk hemat storage, kosongkan riwayat presensi, atau muat data demo.
          </p>
        </div>

        {/* Hapus Data Presensi Siswa per Tahun Ajaran */}
        {onDeleteAttendanceByAcademicYear && (
          <div
            data-testid="section-delete-attendance-by-year"
            className="p-3.5 sm:p-4 rounded-xl border border-amber-200/90 bg-amber-50/40 space-y-3"
          >
            <div>
              <p className="text-sm font-semibold text-slate-900">
                Hapus Presensi per Tahun Ajaran (Hemat Storage)
              </p>
              <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                Hapus seluruh presensi harian &amp; mapel pada tahun ajaran terpilih saja. Data siswa dan tahun ajaran lain tetap aman.
              </p>
            </div>

            {academicYearAttendanceStats.length === 0 ? (
              <p className="text-xs text-slate-500 bg-white/80 border border-slate-200/70 rounded-lg px-3 py-2.5">
                Belum ada catatan presensi siswa yang tersimpan pada tahun ajaran mana pun.
              </p>
            ) : (
              (() => {
                const selectedStat =
                  academicYearAttendanceStats.find(
                    (s) => s.tahun_ajaran === selectedDeleteYear
                  ) || academicYearAttendanceStats[0];
                return (
                  <div className="space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                      <div className="flex-1 min-w-0">
                        <label
                          htmlFor="select-delete-academic-year"
                          className="block text-xs font-semibold text-slate-700 mb-1"
                        >
                          Pilih Tahun Ajaran yang Akan Dihapus Presensinya
                        </label>
                        <select
                          id="select-delete-academic-year"
                          data-testid="select-delete-academic-year"
                          value={selectedStat.tahun_ajaran}
                          onChange={(e) => setSelectedDeleteYear(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                        >
                          {academicYearAttendanceStats.map((stat) => (
                            <option key={stat.tahun_ajaran} value={stat.tahun_ajaran}>
                              TA {stat.tahun_ajaran} — {stat.dailyCount} presensi harian ·{' '}
                              {stat.subjectCount} presensi mapel (~
                              {formatBytesReadable(stat.estimatedBytes)})
                            </option>
                          ))}
                        </select>
                      </div>

                      <button
                        type="button"
                        data-testid="btn-delete-year-attendance"
                        onClick={() => setConfirmDeleteYearModal(selectedStat)}
                        className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 transition-colors shrink-0 whitespace-nowrap"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Hapus Presensi TA {selectedStat.tahun_ajaran}</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div className="px-2.5 py-2 rounded-lg bg-white border border-slate-200/80">
                        <p className="text-[11px] text-slate-500">Harian</p>
                        <p className="font-mono tabular-nums font-semibold text-slate-900">
                          {selectedStat.dailyCount} data
                        </p>
                      </div>
                      <div className="px-2.5 py-2 rounded-lg bg-white border border-slate-200/80">
                        <p className="text-[11px] text-slate-500">Mapel</p>
                        <p className="font-mono tabular-nums font-semibold text-slate-900">
                          {selectedStat.subjectCount} data
                        </p>
                      </div>
                      <div className="px-2.5 py-2 rounded-lg bg-white border border-slate-200/80">
                        <p className="text-[11px] text-slate-500">Ruang Bebas</p>
                        <p className="font-mono tabular-nums font-semibold text-emerald-700">
                          ~{formatBytesReadable(selectedStat.estimatedBytes)}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })()
            )}
          </div>
        )}

        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 p-3.5 sm:p-4 rounded-xl border border-rose-200/80 bg-rose-50/40">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900">
              Reset Semua Data Presensi
            </p>
            <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
              Menghapus seluruh catatan kehadiran siswa (Dashboard &amp; Rekap kembali kosong). Data siswa &amp; pengaturan tetap aman.
            </p>
          </div>

          {!confirmResetAttendance ? (
            <button
              type="button"
              onClick={() => setConfirmResetAttendance(true)}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl border border-rose-300 bg-white text-xs font-semibold text-rose-700 hover:bg-rose-50 transition-colors shrink-0 self-start xl:self-auto whitespace-nowrap"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Reset Semua Data Presensi</span>
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  onResetAllAttendance();
                  setConfirmResetAttendance(false);
                }}
                className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 whitespace-nowrap"
              >
                Ya, Hapus Semua Presensi
              </button>
              <button
                type="button"
                onClick={() => setConfirmResetAttendance(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-600 hover:bg-slate-50 whitespace-nowrap"
              >
                Batal
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 p-3.5 sm:p-4 rounded-xl border border-slate-200/80 bg-slate-50/60">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900">
              Muat Data Contoh (Simulasi)
            </p>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              Isi daftar siswa dan riwayat presensi contoh secara instan jika belum memiliki file import Excel.
            </p>
          </div>

          {!confirmResetDemo ? (
            <button
              type="button"
              onClick={() => setConfirmResetDemo(true)}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shrink-0 whitespace-nowrap"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Muat Data Demo</span>
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  onResetDemo();
                  setConfirmResetDemo(false);
                }}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 whitespace-nowrap"
              >
                Ya, Muat Demo
              </button>
              <button
                type="button"
                onClick={() => setConfirmResetDemo(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-600 hover:bg-slate-50 whitespace-nowrap"
              >
                Batal
              </button>
            </div>
          )}
        </div>
      </section>
            </>
          )}

          {/* SUB-MENU: AKUN LOGIN */}
          {activeSubMenu === 'akun' && (
      <section className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-3.5">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            </div>
            <h2 className="text-sm sm:text-base font-semibold text-slate-900 leading-snug">
              Akun &amp; Akses (Master Admin, Kepala Sekolah, Wali Kelas &amp; Guru)
            </h2>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">
            Perubahan akun dan password otomatis disinkronkan ke tab <span className="font-mono font-semibold text-slate-700">Akun</span> &amp; <span className="font-mono font-semibold text-slate-700">Pengaturan</span> di Google Spreadsheet serta Firebase Cloud.
          </p>
        </div>

        {/* Status Koneksi Google Spreadsheet (Sheet Akun) */}
        {!settings.script_url.trim() ? (
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 p-3.5 rounded-xl border border-slate-200 bg-slate-50/80">
            <div className="flex items-start gap-2.5 min-w-0 flex-1">
              <FileSpreadsheet className="h-4 w-4 text-slate-500 mt-0.5 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-slate-800 leading-snug">
                  Google Spreadsheet Belum Terhubung
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                  Tambahkan Web App URL Google Apps Script agar Data Akun &amp; Akses tersimpan otomatis ke tab <span className="font-mono">Akun</span> di Spreadsheet.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setActiveSubMenu('koneksi')}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors shrink-0 self-start xl:self-auto whitespace-nowrap"
            >
              <Cloud className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Atur URL Spreadsheet</span>
            </button>
          </div>
        ) : sheetsSupportsAkun === false ? (
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 p-3.5 rounded-xl border border-amber-300 bg-amber-50/80">
            <div className="flex items-start gap-2.5 min-w-0 flex-1">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-amber-900 leading-snug">
                  Skrip Code.gs di Spreadsheet Masih Versi Lama (Sheet Akun Belum Aktif)
                </p>
                <p className="text-[11px] text-amber-800 mt-0.5 leading-relaxed">
                  Salin <span className="font-mono font-semibold">Code.gs</span> terbaru lalu lakukan <strong>Deploy → Kelola deployment → Versi baru</strong> agar tab <span className="font-mono font-semibold">Akun</span> aktif.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setActiveSubMenu('koneksi');
                setShowScriptGuide(true);
              }}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 transition-colors shrink-0 self-start xl:self-auto whitespace-nowrap"
            >
              <Code2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Buka &amp; Salin Code.gs</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/70">
            <div className="flex items-start gap-2.5 min-w-0 w-full">
              <FileSpreadsheet className="h-4 w-4 text-emerald-700 mt-0.5 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-emerald-900 leading-snug">
                  Terhubung ke Sheet <span className="font-mono">Akun</span> &amp; <span className="font-mono">Pengaturan</span> di Google Spreadsheet
                </p>
                <p className="text-[11px] text-emerald-800/90 mt-0.5 leading-relaxed">
                  {syncingAccounts
                    ? 'Menyinkronkan daftar akun ke Google Spreadsheet...'
                    : `Sinkronisasi 2 arah aktif untuk ${accounts.length} akun terdaftar.`}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:pl-6">
              {onPushAccountsToSheets && (
                <button
                  type="button"
                  disabled={syncingAccounts}
                  onClick={async () => {
                    setSyncingAccounts(true);
                    try {
                      await onPushAccountsToSheets();
                    } finally {
                      setSyncingAccounts(false);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-60 transition-colors whitespace-nowrap"
                >
                  <UploadCloud className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{syncingAccounts ? 'Mengirim...' : 'Kirim Akun ke Spreadsheet'}</span>
                </button>
              )}
              {onPullAccountsFromSheets && (
                <button
                  type="button"
                  disabled={syncingAccounts}
                  onClick={async () => {
                    setSyncingAccounts(true);
                    try {
                      await onPullAccountsFromSheets();
                    } finally {
                      setSyncingAccounts(false);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-300 bg-white text-xs font-semibold text-emerald-800 hover:bg-emerald-50 disabled:opacity-60 transition-colors whitespace-nowrap"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${syncingAccounts ? 'animate-spin' : ''}`} aria-hidden="true" />
                  <span>Muat dari Spreadsheet</span>
                </button>
              )}
            </div>
          </div>
        )}

        {accountError && (
          <div role="alert" className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-xs font-medium text-rose-700">
            {accountError}
          </div>
        )}

        <div className="overflow-x-auto border border-slate-200/80 rounded-xl">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500">
                <th className="py-2.5 px-3">Username</th>
                <th className="py-2.5 px-3">Nama</th>
                <th className="py-2.5 px-3">NIP</th>
                <th className="py-2.5 px-3">Peran</th>
                <th className="py-2.5 px-3">Kelas</th>
                <th className="py-2.5 px-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {accounts.map((acc) => (
                <tr key={acc.id} className="hover:bg-slate-50/70">
                  <td className="py-2.5 px-3 font-mono text-xs font-semibold text-slate-800 whitespace-nowrap">
                    {acc.username}
                  </td>
                  <td className="py-2.5 px-3 text-xs sm:text-sm text-slate-900">{acc.nama}</td>
                  <td className="py-2.5 px-3 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                    {acc.nip || '-'}
                  </td>
                  <td className="py-2.5 px-3 text-xs font-medium text-slate-600 whitespace-nowrap">
                    {acc.role === 'master_admin'
                      ? 'Master Admin'
                      : acc.role === 'kepala_sekolah'
                        ? 'Kepala Sekolah'
                        : acc.role === 'wali_kelas'
                          ? 'Wali Kelas'
                          : 'Guru'}
                  </td>
                  <td className="py-2.5 px-3 text-xs text-slate-600 whitespace-nowrap">
                    {acc.role === 'wali_kelas' ? acc.kelas_binaan || '-' : '-'}
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => openEditAccountModal(acc)}
                        aria-label={`Edit akun ${acc.username}`}
                        className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-indigo-700 transition-colors"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveAccount(acc.id)}
                        aria-label={`Hapus akun ${acc.username}`}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form onSubmit={handleAddAccount} className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-2.5 pt-2">
          <input
            type="text"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            placeholder="Username baru"
            aria-label="Username akun baru"
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
          />
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Password"
            aria-label="Password akun baru"
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
          />
          <input
            type="text"
            value={newNama}
            onChange={(e) => setNewNama(e.target.value)}
            placeholder="Nama lengkap"
            aria-label="Nama akun baru"
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
          />
          <input
            type="text"
            value={newNip}
            onChange={(e) => setNewNip(e.target.value)}
            placeholder={
              newRole === 'wali_kelas'
                ? 'NIP Wali Kelas'
                : newRole === 'kepala_sekolah'
                  ? 'NIP Kepala Sekolah'
                  : newRole === 'guru'
                    ? 'NIP Guru Mapel'
                    : 'NIP (opsional)'
            }
            aria-label="NIP akun baru"
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-mono text-slate-900 focus:border-indigo-500 focus:outline-none"
          />
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as UserRole)}
            aria-label="Peran akun baru"
            className="rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 focus:border-indigo-500 focus:outline-none"
          >
            <option value="wali_kelas">Wali Kelas</option>
            <option value="guru">Guru</option>
            <option value="kepala_sekolah">Kepala Sekolah</option>
            <option value="master_admin">Master Admin</option>
          </select>
          <div className="flex gap-2">
            {newRole === 'wali_kelas' && (
              <input
                type="text"
                list="class-suggestions"
                value={newKelasBinaan}
                onChange={(e) => setNewKelasBinaan(e.target.value)}
                placeholder="Kelas binaan"
                aria-label="Kelas binaan akun baru"
                className="flex-1 min-w-0 rounded-xl border border-slate-200 px-2.5 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
              />
            )}
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 shrink-0 flex-1 sm:flex-initial"
            >
              <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Tambah</span>
            </button>
          </div>
        </form>
      </section>
          )}

      {/* Edit Account Modal */}
      {editingAccount && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-account-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/55 backdrop-blur-[1px]"
        >
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-md shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 id="edit-account-title" className="text-base font-semibold text-slate-900">
                Edit Akun Login
              </h2>
              <button
                type="button"
                onClick={() => setEditingAccount(null)}
                aria-label="Tutup modal edit akun"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleSaveEditedAccount} className="p-6 space-y-4">
              {editAccountError && (
                <div
                  role="alert"
                  className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-xs font-medium text-rose-700"
                >
                  {editAccountError}
                </div>
              )}

              <div>
                <label htmlFor="edit-acc-username" className="block text-xs font-medium text-slate-700 mb-1">
                  Username
                </label>
                <input
                  id="edit-acc-username"
                  type="text"
                  required
                  value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-mono text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div>
                <label htmlFor="edit-acc-password" className="block text-xs font-medium text-slate-700 mb-1">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="edit-acc-password"
                    type={showEditPassword ? 'text' : 'password'}
                    required
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 pr-10 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowEditPassword((v) => !v)}
                    aria-label={showEditPassword ? 'Sembunyikan password' : 'Lihat password'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
                  >
                    {showEditPassword ? (
                      <EyeOff className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="edit-acc-nama" className="block text-xs font-medium text-slate-700 mb-1">
                  Nama Lengkap
                </label>
                <input
                  id="edit-acc-nama"
                  type="text"
                  required
                  value={editNama}
                  onChange={(e) => setEditNama(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div>
                <label htmlFor="edit-acc-nip" className="block text-xs font-medium text-slate-700 mb-1">
                  {editRole === 'wali_kelas'
                    ? 'NIP Wali Kelas'
                    : editRole === 'kepala_sekolah'
                      ? 'NIP Kepala Sekolah'
                      : editRole === 'guru'
                        ? 'NIP Guru Mapel'
                        : 'NIP (Opsional)'}
                </label>
                <input
                  id="edit-acc-nip"
                  type="text"
                  value={editNip}
                  onChange={(e) => setEditNip(e.target.value)}
                  placeholder="Contoh: 198705142015031002"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-mono text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div>
                <label htmlFor="edit-acc-role" className="block text-xs font-medium text-slate-700 mb-1">
                  Peran
                </label>
                <select
                  id="edit-acc-role"
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as UserRole)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                >
                  <option value="master_admin">Master Admin</option>
                  <option value="kepala_sekolah">Kepala Sekolah</option>
                  <option value="wali_kelas">Wali Kelas</option>
                  <option value="guru">Guru</option>
                </select>
              </div>

              {editRole === 'wali_kelas' && (
                <div>
                  <label htmlFor="edit-acc-kelas" className="block text-xs font-medium text-slate-700 mb-1">
                    Kelas Binaan
                  </label>
                  <input
                    id="edit-acc-kelas"
                    type="text"
                    required
                    list="class-suggestions"
                    value={editKelasBinaan}
                    onChange={(e) => setEditKelasBinaan(e.target.value)}
                    placeholder="Contoh: X IPA 1"
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setEditingAccount(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
                >
                  Simpan Perubahan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Collapsible Code.gs Setup Guide (shown under Koneksi Sheets sub-menu) */}
      {activeSubMenu === 'koneksi' && (
      <section className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden">
        <button
          type="button"
          onClick={() => setShowScriptGuide((v) => !v)}
          aria-expanded={showScriptGuide}
          className="w-full px-4 py-3.5 sm:px-5 sm:py-4 flex items-center justify-between gap-3 text-left hover:bg-slate-50/70 transition-colors"
        >
          <div className="flex items-start gap-2.5 min-w-0 flex-1">
            <Code2 className="h-4 w-4 sm:h-5 sm:w-5 text-indigo-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-semibold text-slate-900 leading-snug">
                Panduan &amp; Template Kode Google Apps Script (Code.gs)
              </p>
              <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5 leading-relaxed">
                Salin skrip siap pakai untuk sinkronisasi otomatis 8 sheet Google Spreadsheet.
              </p>
            </div>
          </div>
          {showScriptGuide ? (
            <ChevronUp className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
          )}
        </button>

        {showScriptGuide && (
          <div className="px-4 pb-4 sm:px-5 sm:pb-5 pt-2 border-t border-slate-100 space-y-3">
            <ol className="list-decimal list-inside text-xs text-slate-600 space-y-1">
              <li>Buka Google Sheets Anda, lalu pilih menu <strong>Extensions &gt; Apps Script</strong>.</li>
              <li>Tempel seluruh kode berikut ke dalam file <code className="font-mono text-slate-800">Code.gs</code>, lalu simpan. Sheet <strong>Siswa, Presensi, Pengaturan, Akun, MasterMapel, JadwalGuru, MapelKelas, PresensiMapel</strong> akan dibuat otomatis.</li>
              <li>Klik <strong>Deploy &gt; New deployment &gt; Web app</strong> (atau <em>Manage deployments &gt; Edit &gt; New version</em> bila memperbarui), atur <em>Execute as: Me</em> dan <em>Who has access: Anyone</em>, lalu salin URL Web App ke kolom di atas.</li>
            </ol>

            <div className="relative">
              <button
                type="button"
                onClick={handleCopyTemplate}
                className="absolute right-3 top-3 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-100 text-xs font-medium hover:bg-slate-700"
              >
                {copiedCode ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                    <span>Tersalin</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Salin Kode</span>
                  </>
                )}
              </button>
              <pre className="rounded-xl bg-slate-950 text-slate-100 p-4 pr-28 text-xs font-mono overflow-x-auto max-h-72">
                <code>{GOOGLE_APPS_SCRIPT_TEMPLATE}</code>
              </pre>
            </div>
          </div>
        )}
      </section>
      )}
        </div>
      </div>

      {/* Modal Konfirmasi Hapus Data Presensi Siswa per Tahun Ajaran */}
      {confirmDeleteYearModal && onDeleteAttendanceByAcademicYear && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-delete-year-title"
          data-testid="modal-confirm-delete-year-attendance"
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[2px] flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                </div>
                <h3
                  id="modal-delete-year-title"
                  className="text-sm font-semibold text-slate-900"
                >
                  Konfirmasi Hapus Presensi TA {confirmDeleteYearModal.tahun_ajaran}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setConfirmDeleteYearModal(null)}
                aria-label="Tutup dialog konfirmasi"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="p-5 space-y-3 text-xs text-slate-600 leading-relaxed">
              <p>
                Anda akan menghapus seluruh data presensi siswa pada{' '}
                <strong className="text-slate-900">
                  Tahun Ajaran {confirmDeleteYearModal.tahun_ajaran}
                </strong>{' '}
                untuk mengurangi penggunaan storage aplikasi:
              </p>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1 font-mono tabular-nums text-[11px] text-slate-700">
                <div className="flex items-center justify-between">
                  <span>Presensi Harian</span>
                  <strong className="text-slate-900">
                    {confirmDeleteYearModal.dailyCount} data
                  </strong>
                </div>
                <div className="flex items-center justify-between">
                  <span>Presensi Mata Pelajaran</span>
                  <strong className="text-slate-900">
                    {confirmDeleteYearModal.subjectCount} data
                  </strong>
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-slate-200">
                  <span>Estimasi Storage Dibebaskan</span>
                  <strong className="text-emerald-700">
                    ~{formatBytesReadable(confirmDeleteYearModal.estimatedBytes)}
                  </strong>
                </div>
              </div>
              <p className="text-[11px] text-slate-500">
                Disarankan untuk menekan <strong>Simpan Backup (.json)</strong> terlebih dahulu jika Anda masih memerlukan arsip tahun ajaran tersebut. Data siswa dan presensi tahun ajaran lainnya tidak akan terpengaruh.
              </p>
            </div>

            <div className="px-5 py-3.5 bg-slate-50/80 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteYearModal(null)}
                className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Batal
              </button>
              <button
                type="button"
                data-testid="btn-confirm-delete-year-attendance"
                onClick={() => {
                  const targetYear = confirmDeleteYearModal.tahun_ajaran;
                  setConfirmDeleteYearModal(null);
                  onDeleteAttendanceByAcademicYear(targetYear);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Ya, Hapus Presensi Tahun Ini</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Modal Konfirmasi Bersihkan Storage dengan Penjelasan Akibat */}
      {confirmClearStorageScope && onClearStorage && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-clear-storage-title"
          data-testid="modal-confirm-clear-storage"
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[2px] flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div
                  className={`h-8 w-8 rounded-xl flex items-center justify-center shrink-0 ${
                    confirmClearStorageScope === 'app_local'
                      ? 'bg-rose-100 text-rose-700'
                      : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                </div>
                <h3
                  id="modal-clear-storage-title"
                  className="text-sm font-semibold text-slate-900"
                >
                  {confirmClearStorageScope === 'app_local'
                    ? 'Konfirmasi Bersihkan Storage Lokal Aplikasi'
                    : 'Konfirmasi Bersihkan Cache & Storage Perangkat'}
                </h3>
              </div>
              <button
                type="button"
                disabled={clearingStorage}
                onClick={() => setConfirmClearStorageScope(null)}
                aria-label="Tutup dialog konfirmasi bersihkan storage"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div
              data-testid="clear-storage-consequences"
              className="p-5 space-y-3 text-xs text-slate-600 leading-relaxed"
            >
              <p className="font-semibold text-slate-900">
                Akibat jika Anda menghapus storage ini:
              </p>

              {confirmClearStorageScope === 'device_cache' ? (
                <ul className="list-disc pl-4 space-y-1.5 text-slate-700">
                  <li>
                    Menghapus cache sementara browser, cadangan IndexedDB, log kuota lokal, dan <strong>antrean sinkronisasi offline</strong> pada perangkat ini.
                  </li>
                  <li>
                    <strong>Risiko:</strong> Data presensi yang dicatat saat mode offline dan <em>belum sempat terkirim</em> ke Cloud Firebase atau Google Sheets akan hilang permanen.
                  </li>
                  <li>
                    Data siswa, presensi aktif, dan pengaturan yang sudah tersimpan di <strong>Cloud Firebase / Google Sheets</strong> tetap aman dan tidak terhapus.
                  </li>
                </ul>
              ) : (
                <ul className="list-disc pl-4 space-y-1.5 text-slate-700">
                  <li>
                    Menghapus <strong>seluruh data lokal aplikasi pada perangkat ini</strong> (Data Siswa, Presensi Harian &amp; Mapel, Jadwal Pelajaran, Antrean Offline, Cache IndexedDB, serta Pengaturan/Logo lokal).
                  </li>
                  <li>
                    <strong>Risiko Permanen:</strong> Jika Anda <em>belum mengunduh Backup (.json)</em> dan tidak terhubung ke Cloud Firebase / Google Spreadsheet, seluruh data lokal di perangkat ini akan <strong>hilang permanen dan tidak dapat dikembalikan</strong>.
                  </li>
                  <li>
                    Jika aplikasi terhubung ke Cloud Firebase atau Google Spreadsheet, data di server tetap aman dan dapat ditarik kembali dengan tombol <strong>Sinkronkan</strong>. Sesi login Anda tetap aktif agar tidak langsung keluar.
                  </li>
                </ul>
              )}

              <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200/80 text-[11px] text-amber-900">
                <strong>Saran Keamanan:</strong> Tekan <strong>Simpan Backup (.json)</strong> terlebih dahulu bila Anda masih membutuhkan cadangan data di komputer/flashdisk.
              </div>
            </div>

            <div className="px-5 py-3.5 bg-slate-50/80 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={clearingStorage}
                onClick={() => setConfirmClearStorageScope(null)}
                className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={clearingStorage}
                data-testid="btn-confirm-clear-storage"
                onClick={async () => {
                  const scope = confirmClearStorageScope;
                  setClearingStorage(true);
                  try {
                    await onClearStorage(scope);
                    setConfirmClearStorageScope(null);
                  } finally {
                    setClearingStorage(false);
                  }
                }}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-white text-xs font-semibold transition-colors disabled:opacity-60 ${
                  confirmClearStorageScope === 'app_local'
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-amber-600 hover:bg-amber-700'
                }`}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {clearingStorage
                    ? 'Membersihkan...'
                    : confirmClearStorageScope === 'app_local'
                      ? 'Ya, Bersihkan Storage Lokal'
                      : 'Ya, Bersihkan Cache'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
