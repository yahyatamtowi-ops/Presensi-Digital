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
} from 'lucide-react';
import type {
  AppThemeId,
  AttendanceScheduleMode,
  ConnectionStatus,
  SchoolSettings,
  SemesterKind,
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
import { normalizeSemester, validateTransparentPngFile } from '../utils/subjectAttendance';
import { normalizeThemeId, THEME_PRESETS } from '../utils/themes';

interface SettingsViewProps {
  settings: SchoolSettings;
  accounts: UserAccount[];
  availableClasses: string[];
  totalStudentsCount: number;
  totalRecordsCount: number;
  connectionStatus: ConnectionStatus;
  pendingSyncCount?: number;
  onSaveSettings: (newSettings: SchoolSettings) => Promise<void>;
  onSetDefaultIdentity: (namaSekolah: string, logoSekolah?: string) => void;
  onPreviewTheme: (tema: AppThemeId) => void;
  onUpdateAccounts: (nextAccounts: UserAccount[]) => void;
  onTestAndSync: (scriptUrl: string) => Promise<void>;
  onPushAllToSheets: (scriptUrl: string) => Promise<void>;
  onSaveBackupToComputer: () => Promise<LastBackupMeta | null>;
  onExportExcelArchive: () => LastBackupMeta | null;
  onRestoreBackup: (backup: AppBackupPayload) => Promise<void>;
  onResetAllAttendance: () => void;
  onResetDemo: () => void;
}

const LIGHT_THEMES = THEME_PRESETS.filter((t) => t.mode === 'light');
const DARK_THEMES = THEME_PRESETS.filter((t) => t.mode === 'dark');

type SettingsSubMenuId =
  | 'profil'
  | 'jadwal'
  | 'tema'
  | 'koneksi'
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
    label: 'Koneksi Sheets',
    desc: 'URL Apps Script & Code.gs',
    Icon: Cloud,
    usesFormSave: true,
  },
  {
    id: 'akun',
    label: 'Akun & Akses',
    desc: 'Admin, Wali Kelas & Guru',
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

function resizeLogoFileToDataUrl(file: File): Promise<string> {
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
        const maxSize = 256;
        const ratio = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * ratio));
        const h = Math.max(1, Math.round(img.height * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(result);
          return;
        }
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('Format gambar logo tidak didukung.'));
      img.src = result;
    };
    reader.onerror = () => reject(new Error('Gagal membaca file logo.'));
    reader.readAsDataURL(file);
  });
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
  pendingSyncCount = 0,
  onSaveSettings,
  onSetDefaultIdentity,
  onPreviewTheme,
  onUpdateAccounts,
  onTestAndSync,
  onPushAllToSheets,
  onSaveBackupToComputer,
  onExportExcelArchive,
  onRestoreBackup,
  onResetAllAttendance,
  onResetDemo,
}: SettingsViewProps) {
  const [formState, setFormState] = useState<SchoolSettings>({
    ...settings,
    batas_jam_masuk: normalizeTimeHHMM(settings.batas_jam_masuk, '07:15'),
    mode_presensi: normalizeScheduleMode(settings.mode_presensi, 'masuk_saja'),
    jam_pulang_standar: normalizeTimeHHMM(settings.jam_pulang_standar, '15:00'),
    tahun_ajaran: settings.tahun_ajaran || '2026/2027',
    semester: normalizeSemester(settings.semester, 'ganjil'),
    tema: normalizeThemeId(settings.tema, 'indigo'),
  });
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pushingAll, setPushingAll] = useState(false);
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
  const [activeSubMenu, setActiveSubMenu] = useState<SettingsSubMenuId>('profil');
  const [confirmResetDemo, setConfirmResetDemo] = useState(false);
  const [confirmResetAttendance, setConfirmResetAttendance] = useState(false);

  // Sync external settings updates (e.g. backup restore) ONLY when user has no unsaved edits
  useEffect(() => {
    if (hasUnsavedChanges) return;
    setFormState({
      ...settings,
      nama_kepala_sekolah: settings.nama_kepala_sekolah || '',
      nip_kepala_sekolah: settings.nip_kepala_sekolah || '',
      ttd_kepala_sekolah: settings.ttd_kepala_sekolah || '',
      cap_sekolah: settings.cap_sekolah || '',
      batas_jam_masuk: normalizeTimeHHMM(settings.batas_jam_masuk, '07:15'),
      mode_presensi: normalizeScheduleMode(settings.mode_presensi, 'masuk_saja'),
      jam_pulang_standar: normalizeTimeHHMM(settings.jam_pulang_standar, '15:00'),
      tahun_ajaran: settings.tahun_ajaran || '2026/2027',
      semester: normalizeSemester(settings.semester, 'ganjil'),
      tema: normalizeThemeId(settings.tema, 'indigo'),
    });
  }, [settings, hasUnsavedChanges]);

  function updateFormField(patch: Partial<SchoolSettings>) {
    setHasUnsavedChanges(true);
    setFormState((prev) => ({ ...prev, ...patch }));
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
        nama_sekolah: formState.nama_sekolah.trim() || 'SMA Negeri 1 Nusantara',
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
        logo_sekolah: formState.logo_sekolah || '',
      };
      setFormState(normalizedPayload);
      await onSaveSettings(normalizedPayload);
      setHasUnsavedChanges(false);
    } finally {
      setSaving(false);
    }
  }

  function handleAddAccount(e: React.FormEvent) {
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
    onUpdateAccounts([...accounts, created]);
    setNewUsername('');
    setNewPassword('');
    setNewNama('');
    setNewNip('');
    setAccountError(null);
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

  function handleSaveEditedAccount(e: React.FormEvent) {
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

    onUpdateAccounts(
      accounts.map((a) => (a.id === editingAccount.id ? updatedAccount : a))
    );
    setEditingAccount(null);
    setEditAccountError(null);
  }

  function handleRemoveAccount(id: string) {
    const target = accounts.find((a) => a.id === id);
    if (!target) return;
    const masterCount = accounts.filter((a) => a.role === 'master_admin').length;
    if (target.role === 'master_admin' && masterCount <= 1) {
      setAccountError('Minimal harus ada satu akun Master Admin.');
      return;
    }
    setAccountError(null);
    onUpdateAccounts(accounts.filter((a) => a.id !== id));
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
        {hasUnsavedChanges
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
    <div className="space-y-6">
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

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Sub-Menu Navigation Rail */}
        <aside
          aria-label="Sub menu pengaturan"
          className="lg:col-span-3 lg:sticky lg:top-20 bg-white rounded-2xl border border-slate-200/80 p-3 shadow-[0_1px_3px_rgba(15,23,42,0.04)]"
        >
          <div className="px-2.5 pt-1 pb-2.5 border-b border-slate-100 mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Kategori Pengaturan
            </p>
            {hasUnsavedChanges && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200">
                Belum disimpan
              </span>
            )}
          </div>

          <div
            role="tablist"
            aria-label="Daftar sub menu pengaturan"
            className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-1 gap-1.5"
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
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                    isActive
                      ? 'bg-indigo-50 text-indigo-700 border border-indigo-200 shadow-xs'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 border border-transparent'
                  }`}
                >
                  <div
                    className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
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
                      {usesFormSave && hasUnsavedChanges && (
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0"
                          aria-hidden="true"
                        />
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 truncate hidden sm:block">
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
          className="lg:col-span-9 space-y-6 min-w-0"
        >
          {currentSubMenuMeta.usesFormSave && (
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* SUB-MENU: KONEKSI GOOGLE SHEETS */}
              {activeSubMenu === 'koneksi' && (
                <section className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                        <Cloud className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <div>
                        <h2 className="text-base font-semibold text-slate-900">
                          Koneksi Database Google Sheets
                        </h2>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Hubungkan aplikasi ke Google Apps Script Web App URL agar data siswa dan presensi tersinkron otomatis.
                        </p>
                      </div>
                    </div>
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
                      onClick={() => onTestAndSync(formState.script_url.trim())}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${connectionStatus === 'syncing' ? 'animate-spin' : ''}`}
                        aria-hidden="true"
                      />
                      <span>Muat Ulang dari Spreadsheet</span>
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
                      <span>{pushingAll ? 'Mengirim ke Sheets...' : 'Kirim Data Lokal ke Sheets'}</span>
                    </button>

                    {pendingSyncCount > 0 && (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-[11px] font-semibold text-amber-700">
                        <span className="font-mono tabular-nums">{pendingSyncCount}</span> perubahan menunggu sinkron
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Sinkronisasi berjalan otomatis secara real-time setiap 10 detik, saat membuka tab, dan setiap kali data diubah.
                  </p>

                  {renderSaveFooter()}
                </section>
              )}

              {/* SUB-MENU: PROFIL & SEKOLAH */}
              {activeSubMenu === 'profil' && (
                <section className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-5">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                      <Building2 className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div>
                      <h2 className="text-base font-semibold text-slate-900">
                        Profil Sekolah &amp; Tahun Ajaran
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Atur identitas sekolah, logo resmi untuk kartu E-Card/PDF, dan tahun ajaran aktif.
                      </p>
                    </div>
                  </div>

                  {/* Edit Logo Sekolah */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200/80">
            <div className="h-16 w-16 rounded-2xl border border-slate-200 bg-white flex items-center justify-center shrink-0 overflow-hidden p-1.5">
              {formState.logo_sekolah ? (
                <img
                  src={formState.logo_sekolah}
                  alt="Preview Logo Sekolah"
                  className="h-full w-full object-contain"
                />
              ) : (
                <QrCode className="h-8 w-8 text-indigo-600" aria-hidden="true" />
              )}
            </div>
            <div className="flex-1 min-w-0 space-y-2">
              <div>
                <p className="text-xs font-semibold text-slate-900">Logo Sekolah</p>
                <p className="text-[11px] text-slate-500">
                  Unggah gambar PNG, JPG, atau SVG (otomatis disesuaikan untuk kartu & PDF).
                </p>
              </div>
              {logoError && (
                <p className="text-xs font-medium text-rose-600">{logoError}</p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer">
                  <ImagePlus className="h-3.5 w-3.5 text-indigo-600" aria-hidden="true" />
                  <span>{formState.logo_sekolah ? 'Ganti Logo' : 'Unggah Logo'}</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    onChange={handleLogoUpload}
                    className="sr-only"
                  />
                </label>
                {formState.logo_sekolah && (
                  <button
                    type="button"
                    onClick={() => updateFormField({ logo_sekolah: '' })}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-200 bg-white text-xs font-medium text-rose-600 hover:bg-rose-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Hapus Logo</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    onSetDefaultIdentity(
                      formState.nama_sekolah.trim() || 'SMA Negeri 1 Nusantara',
                      formState.logo_sekolah || ''
                    );
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
                placeholder="SMA Negeri 1 Nusantara"
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

          <p className="text-[11px] text-slate-500 -mt-2">
            Saat Tahun Ajaran diubah, data siswa dan presensi tahun ajaran sebelumnya tidak ditampilkan kepada Wali Kelas, Guru, dan Pemindai QR (kecuali diakses oleh Master Admin).
          </p>

          {/* Pengesahan E-Card: Nama & NIP Kepala Sekolah, TTD PNG & Cap Sekolah PNG */}
          <div className="pt-4 border-t border-slate-100 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Pengesahan E-Card (Kepala Sekolah, NIP, TTD &amp; Cap Sekolah)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Nama, NIP, TTD Kepala Sekolah, dan Cap Sekolah (PNG transparan) akan disematkan di sisi kiri bawah tulisan Siswa Putra/Siswa Putri pada Kartu Tanda Siswa Elektronik agar ukuran QR Code tetap maksimal.
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
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Upload TTD Kepala Sekolah PNG Transparan */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-3">
                <div className="flex items-center gap-3">
                  <div
                    className="h-16 w-24 rounded-xl border border-slate-200 bg-white flex items-center justify-center shrink-0 overflow-hidden p-1.5"
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
                      <PenTool className="h-6 w-6 text-slate-400" aria-hidden="true" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-900">
                      TTD Kepala Sekolah (PNG)
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Wajib file <span className="font-mono">.png</span> latar belakang transparan.
                    </p>
                  </div>
                </div>

                {ttdError && (
                  <p role="alert" className="text-xs font-medium text-rose-600">
                    {ttdError}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer">
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
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-200 bg-white text-xs font-medium text-rose-600 hover:bg-rose-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Hapus TTD</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Upload Cap Sekolah PNG Transparan */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-3">
                <div className="flex items-center gap-3">
                  <div
                    className="h-16 w-16 rounded-xl border border-slate-200 bg-white flex items-center justify-center shrink-0 overflow-hidden p-1.5"
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
                      <Stamp className="h-6 w-6 text-slate-400" aria-hidden="true" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-900">
                      Cap / Stempel Sekolah (PNG)
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Wajib file <span className="font-mono">.png</span> latar belakang transparan.
                    </p>
                  </div>
                </div>

                {capError && (
                  <p role="alert" className="text-xs font-medium text-rose-600">
                    {capError}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer">
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
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-200 bg-white text-xs font-medium text-rose-600 hover:bg-rose-50"
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
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-indigo-200/80 bg-indigo-50/40"
              >
                <div className="space-y-0.5 max-w-xs">
                  <p className="text-xs font-semibold text-slate-900">
                    Pratinjau Susunan Kartu Tanda Siswa (E-Card)
                  </p>
                  <p className="text-[11px] text-slate-500">
                    TTD, Cap, Nama, dan NIP Kepala Sekolah ditempatkan di kiri bawah Siswa Putra/Putri agar QR Code di kanan tetap besar dan mudah dipindai.
                  </p>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 px-3.5 py-3 flex items-center justify-between gap-4 min-w-[270px] shrink-0">
                  <div className="min-w-0 flex-1 text-left">
                    <p className="text-[10px] font-bold text-slate-900 truncate">
                      Ahmad Fauzi Pratama
                    </p>
                    <p className="text-[9px] text-slate-500">NIS 2026001 · X IPA 1</p>
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
                      NIS: 2026001
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
                <section className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                        <Clock className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <div>
                        <h2 className="text-base font-semibold text-slate-900">
                          Jadwal Presensi Siswa (Masuk &amp; Pulang)
                        </h2>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Pilih mode pemindaian harian dan tentukan batas jam masuk serta jam pulang standar.
                        </p>
                      </div>
                    </div>
                    <span className="text-[11px] font-mono tabular-nums px-2.5 py-1 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 font-medium">
                      {formState.mode_presensi === 'masuk_pulang'
                        ? `Aktif: Masuk (${formState.batas_jam_masuk || '07:15'}) & Pulang (${formState.jam_pulang_standar || '15:00'})`
                        : `Aktif: Masuk Saja (${formState.batas_jam_masuk || '07:15'})`}
                    </span>
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
                <section className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                        <Palette className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <div>
                        <h2 className="text-base font-semibold text-slate-900">
                          Tema &amp; Warna Aplikasi ({THEME_PRESETS.length} Pilihan)
                        </h2>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Klik warna untuk pratinjau langsung, lalu tekan Simpan Pengaturan.
                        </p>
                      </div>
                    </div>
                  </div>

            {/* Tema Terang */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
                <Sun className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
                <span>Mode Terang ({LIGHT_THEMES.length} Variasi)</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
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
                      className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all ${
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

                  {renderSaveFooter()}
                </section>
              )}
            </form>
          )}

          {/* SUB-MENU: BACKUP & RESET (External / Local Computer Storage Backup & Restore + Reset) */}
          {activeSubMenu === 'backup' && (
            <>
      <section className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              <HardDrive className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Penyimpanan Eksternal & Backup Komputer (Master Admin)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Simpan seluruh data aplikasi (siswa, presensi, pengaturan, logo, dan akun) ke laptop, komputer, atau flashdisk/harddisk eksternal.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono tabular-nums text-slate-600 shrink-0">
            <span className="px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200/70">
              {totalStudentsCount} siswa
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200/70">
              {totalRecordsCount} presensi
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200/70">
              {accounts.length} akun
            </span>
          </div>
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

      {/* Data Maintenance Section: Reset Semua Data Presensi & Muat Data Demo */}
      <section className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Pemeliharaan & Reset Data
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Kosongkan seluruh riwayat presensi siswa atau muat contoh data demo untuk pengujian cepat.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border border-rose-200/80 bg-rose-50/40">
          <div>
            <p className="text-sm font-semibold text-slate-900">
              Reset Semua Data Presensi
            </p>
            <p className="text-xs text-slate-600 mt-0.5">
              Menghapus seluruh catatan kehadiran siswa (Dashboard & Rekap kembali kosong). Data siswa & pengaturan tetap aman.
            </p>
          </div>

          {!confirmResetAttendance ? (
            <button
              type="button"
              onClick={() => setConfirmResetAttendance(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-rose-300 bg-white text-xs font-semibold text-rose-700 hover:bg-rose-50 transition-colors shrink-0"
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
                className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700"
              >
                Ya, Hapus Semua Presensi
              </button>
              <button
                type="button"
                onClick={() => setConfirmResetAttendance(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Batal
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border border-slate-200/80 bg-slate-50/60">
          <div>
            <p className="text-sm font-semibold text-slate-900">
              Muat Data Contoh (Simulasi)
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              Isi daftar siswa dan riwayat presensi contoh secara instan jika belum memiliki file import Excel.
            </p>
          </div>

          {!confirmResetDemo ? (
            <button
              type="button"
              onClick={() => setConfirmResetDemo(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shrink-0"
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
                className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700"
              >
                Ya, Muat Demo
              </button>
              <button
                type="button"
                onClick={() => setConfirmResetDemo(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-600 hover:bg-slate-50"
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
      <section className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Akun Login (Master Admin, Wali Kelas & Guru)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Master Admin mengakses seluruh menu & arsip tahun ajaran; Wali Kelas khusus mengakses kelas binaannya; Guru khusus mengecek siswa tidak hadir di Rekap & Export.
            </p>
          </div>
        </div>

        {accountError && (
          <div role="alert" className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-xs font-medium text-rose-700">
            {accountError}
          </div>
        )}

        <div className="overflow-x-auto border border-slate-200/80 rounded-xl">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500">
                <th className="py-2.5 px-4">Username</th>
                <th className="py-2.5 px-4">Nama</th>
                <th className="py-2.5 px-4">NIP</th>
                <th className="py-2.5 px-4">Peran</th>
                <th className="py-2.5 px-4">Kelas Binaan</th>
                <th className="py-2.5 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {accounts.map((acc) => (
                <tr key={acc.id} className="hover:bg-slate-50/70">
                  <td className="py-2.5 px-4 font-mono text-xs font-semibold text-slate-800 whitespace-nowrap">
                    {acc.username}
                  </td>
                  <td className="py-2.5 px-4 text-slate-900">{acc.nama}</td>
                  <td className="py-2.5 px-4 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                    {acc.nip || '-'}
                  </td>
                  <td className="py-2.5 px-4 text-xs font-medium text-slate-600 whitespace-nowrap">
                    {acc.role === 'master_admin'
                      ? 'Master Admin'
                      : acc.role === 'kepala_sekolah'
                        ? 'Kepala Sekolah'
                        : acc.role === 'wali_kelas'
                          ? 'Wali Kelas'
                          : 'Guru'}
                  </td>
                  <td className="py-2.5 px-4 text-xs text-slate-600 whitespace-nowrap">
                    {acc.role === 'wali_kelas' ? acc.kelas_binaan || '-' : '-'}
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => openEditAccountModal(acc)}
                        aria-label={`Edit akun ${acc.username}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-indigo-700 transition-colors"
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

        <form onSubmit={handleAddAccount} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 pt-2">
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
          className="w-full px-6 py-4 flex items-center justify-between gap-4 text-left hover:bg-slate-50/70 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Code2 className="h-5 w-5 text-indigo-600 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-slate-900">
                Panduan & Template Kode Google Apps Script (Code.gs)
              </p>
              <p className="text-xs text-slate-500">
                Salin skrip siap pakai untuk endpoint GET & POST Google Sheets Anda
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
          <div className="px-6 pb-6 pt-2 border-t border-slate-100 space-y-3">
            <ol className="list-decimal list-inside text-xs text-slate-600 space-y-1">
              <li>Buka Google Sheets baru, lalu pilih menu <strong>Extensions &gt; Apps Script</strong>.</li>
              <li>Tempel kode berikut ke dalam file <code className="font-mono text-slate-800">Code.gs</code>, lalu simpan.</li>
              <li>Klik <strong>Deploy &gt; New deployment &gt; Web app</strong>, atur <em>Execute as: Me</em> dan <em>Who has access: Anyone</em>, lalu salin URL Web App ke kolom di atas.</li>
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
    </div>
  );
}
