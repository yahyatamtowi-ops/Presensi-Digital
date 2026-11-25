import * as XLSX from 'xlsx';
import type {
  AttendanceRecord,
  DefaultSchoolIdentity,
  MasterSubject,
  SchoolSettings,
  Student,
  SubjectAssignment,
  SubjectAttendanceRecord,
  TeacherSchedule,
  UserAccount,
} from '../types';
import { formatRoleLabel } from './auth';
import { normalizeScheduleMode, normalizeTimeHHMM } from './attendanceLogic';
import { sanitizeRecords, sanitizeStudents } from './gasApi';
import { DEFAULT_ACADEMIC_YEAR, SEED_SETTINGS } from './seedData';
import {
  formatSemesterLabel,
  normalizeSemester,
  sanitizeMasterSubjects,
  sanitizeSubjectAssignments,
  sanitizeSubjectRecords,
  sanitizeTeacherSchedules,
} from './subjectAttendance';
import { normalizeThemeId } from './themes';
import { buildLetterheadExcelSheet } from './excelLetterhead';

const LAST_BACKUP_META_KEY = 'presensiqr_last_backup_meta_v2';

export interface AppBackupPayload {
  app: 'Presensi Digital' | 'PresensiQR';
  schemaVersion: number;
  exportedAt: string;
  exportedBy: string;
  data: {
    students: Student[];
    records: AttendanceRecord[];
    settings: SchoolSettings;
    accounts: UserAccount[];
    defaultIdentity: DefaultSchoolIdentity;
    subjectAssignments?: SubjectAssignment[];
    subjectRecords?: SubjectAttendanceRecord[];
    masterSubjects?: MasterSubject[];
    teacherSchedules?: TeacherSchedule[];
  };
}

export interface LastBackupMeta {
  savedAt: string;
  filename: string;
  studentCount: number;
  recordCount: number;
  method: 'file_picker' | 'download' | 'excel';
}

export function createAppBackupPayload(params: {
  students: Student[];
  records: AttendanceRecord[];
  settings: SchoolSettings;
  accounts: UserAccount[];
  defaultIdentity: DefaultSchoolIdentity;
  subjectAssignments?: SubjectAssignment[];
  subjectRecords?: SubjectAttendanceRecord[];
  masterSubjects?: MasterSubject[];
  teacherSchedules?: TeacherSchedule[];
  exportedBy?: string;
  now?: Date;
}): AppBackupPayload {
  const now = params.now ?? new Date();
  return {
    app: 'Presensi Digital',
    schemaVersion: 4,
    exportedAt: now.toISOString(),
    exportedBy: params.exportedBy?.trim() || 'Master Admin',
    data: {
      students: sanitizeStudents(params.students),
      records: sanitizeRecords(params.records),
      settings: {
        ...SEED_SETTINGS,
        ...params.settings,
        semester: normalizeSemester(params.settings.semester, 'ganjil'),
      },
      accounts: Array.isArray(params.accounts) ? params.accounts : [],
      defaultIdentity: {
        nama_sekolah:
          params.defaultIdentity.nama_sekolah?.trim() ||
          params.settings.nama_sekolah?.trim() ||
          SEED_SETTINGS.nama_sekolah,
        logo_sekolah:
          params.defaultIdentity.logo_sekolah ||
          params.settings.logo_sekolah ||
          '',
      },
      subjectAssignments: sanitizeSubjectAssignments(params.subjectAssignments ?? []),
      subjectRecords: sanitizeSubjectRecords(params.subjectRecords ?? []),
      masterSubjects: sanitizeMasterSubjects(params.masterSubjects ?? []),
      teacherSchedules: sanitizeTeacherSchedules(params.teacherSchedules ?? []),
    },
  };
}

export function buildBackupFilename(
  schoolName: string,
  extension: 'json' | 'xlsx' = 'json',
  now: Date = new Date()
): string {
  const safeSchool = (schoolName || 'Sekolah')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 36);
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const prefix =
    extension === 'xlsx' ? 'Arsip_Presensi_Digital' : 'Backup_Presensi_Digital';
  return `${prefix}_${safeSchool || 'Sekolah'}_${yyyy}-${mm}-${dd}_${hh}-${min}.${extension}`;
}

export function parseAndValidateBackupJson(
  rawText: string,
  fallbackAccounts: UserAccount[] = []
): { ok: true; backup: AppBackupPayload } | { ok: false; error: string } {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { ok: false, error: 'File backup kosong.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      ok: false,
      error: 'Format file tidak valid. Pastikan memilih file backup .json dari Presensi Digital.',
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'Struktur file backup tidak dikenali.' };
  }

  const root = parsed as Record<string, unknown>;
  const dataNode =
    root.data && typeof root.data === 'object'
      ? (root.data as Record<string, unknown>)
      : root;

  if (!Array.isArray(dataNode.students) && !Array.isArray(dataNode.records)) {
    return {
      ok: false,
      error:
        'File JSON tidak memiliki data siswa maupun presensi yang valid untuk Presensi Digital.',
    };
  }

  const students = sanitizeStudents(dataNode.students);
  const records = sanitizeRecords(dataNode.records);

  const rawSettings =
    dataNode.settings && typeof dataNode.settings === 'object'
      ? (dataNode.settings as Partial<SchoolSettings>)
      : {};

  const settings: SchoolSettings = {
    ...SEED_SETTINGS,
    ...rawSettings,
    nama_sekolah:
      rawSettings.nama_sekolah?.trim() || SEED_SETTINGS.nama_sekolah,
    nama_kepala_sekolah: rawSettings.nama_kepala_sekolah?.trim() || '',
    nip_kepala_sekolah: rawSettings.nip_kepala_sekolah?.trim() || '',
    ttd_kepala_sekolah: rawSettings.ttd_kepala_sekolah || '',
    cap_sekolah: rawSettings.cap_sekolah || '',
    batas_jam_masuk: normalizeTimeHHMM(
      rawSettings.batas_jam_masuk,
      SEED_SETTINGS.batas_jam_masuk
    ),
    mode_presensi: normalizeScheduleMode(rawSettings.mode_presensi, 'masuk_saja'),
    jam_pulang_standar: normalizeTimeHHMM(
      rawSettings.jam_pulang_standar,
      SEED_SETTINGS.jam_pulang_standar
    ),
    tahun_ajaran: rawSettings.tahun_ajaran || DEFAULT_ACADEMIC_YEAR,
    semester: normalizeSemester(rawSettings.semester, 'ganjil'),
    tema: normalizeThemeId(rawSettings.tema, 'indigo'),
    script_url: rawSettings.script_url || '',
    logo_sekolah: rawSettings.logo_sekolah || '',
  };

  const rawDefaultId =
    dataNode.defaultIdentity && typeof dataNode.defaultIdentity === 'object'
      ? (dataNode.defaultIdentity as Partial<DefaultSchoolIdentity>)
      : {};

  const defaultIdentity: DefaultSchoolIdentity = {
    nama_sekolah:
      rawDefaultId.nama_sekolah?.trim() || settings.nama_sekolah,
    logo_sekolah:
      rawDefaultId.logo_sekolah ?? settings.logo_sekolah ?? '',
  };

  const rawAccounts = Array.isArray(dataNode.accounts) ? dataNode.accounts : [];
  const validAccounts: UserAccount[] = [];
  for (const item of rawAccounts) {
    if (!item || typeof item !== 'object') continue;
    const acc = item as Partial<UserAccount>;
    if (!acc.username?.trim() || !acc.password?.trim() || !acc.nama?.trim()) continue;
    const role: UserAccount['role'] =
      acc.role === 'master_admin' ||
      acc.role === 'kepala_sekolah' ||
      acc.role === 'guru' ||
      acc.role === 'wali_kelas'
        ? acc.role
        : 'wali_kelas';
    validAccounts.push({
      id: acc.id || `usr_${Date.now()}_${validAccounts.length}`,
      username: acc.username.trim(),
      password: acc.password.trim(),
      nama: acc.nama.trim(),
      nip: acc.nip?.trim() || undefined,
      role,
      jabatan: formatRoleLabel(role, acc.kelas_binaan),
      kelas_binaan: role === 'wali_kelas' ? acc.kelas_binaan?.trim() || undefined : undefined,
      ...(typeof acc.foto_profil === 'string' && acc.foto_profil.trim()
        ? { foto_profil: acc.foto_profil.trim() }
        : {}),
    });
  }

  const hasMasterAdmin = validAccounts.some((a) => a.role === 'master_admin');
  const finalAccounts = hasMasterAdmin
    ? validAccounts
    : fallbackAccounts.length > 0
      ? fallbackAccounts
      : validAccounts;

  const subjectAssignments = sanitizeSubjectAssignments(dataNode.subjectAssignments);
  const subjectRecords = sanitizeSubjectRecords(dataNode.subjectRecords);
  const masterSubjects = sanitizeMasterSubjects(dataNode.masterSubjects);
  const teacherSchedules = sanitizeTeacherSchedules(dataNode.teacherSchedules);

  return {
    ok: true,
    backup: {
      app: 'Presensi Digital',
      schemaVersion: typeof root.schemaVersion === 'number' ? root.schemaVersion : 4,
      exportedAt:
        typeof root.exportedAt === 'string'
          ? root.exportedAt
          : new Date().toISOString(),
      exportedBy:
        typeof root.exportedBy === 'string' ? root.exportedBy : 'Master Admin',
      data: {
        students,
        records,
        settings,
        accounts: finalAccounts,
        defaultIdentity,
        subjectAssignments,
        subjectRecords,
        masterSubjects,
        teacherSchedules,
      },
    },
  };
}

export function loadLastBackupMeta(): LastBackupMeta | null {
  try {
    const raw = localStorage.getItem(LAST_BACKUP_META_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastBackupMeta>;
    if (parsed && parsed.savedAt && parsed.filename) {
      return {
        savedAt: parsed.savedAt,
        filename: parsed.filename,
        studentCount: Number(parsed.studentCount || 0),
        recordCount: Number(parsed.recordCount || 0),
        method: parsed.method || 'download',
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveLastBackupMeta(meta: LastBackupMeta): void {
  try {
    localStorage.setItem(LAST_BACKUP_META_KEY, JSON.stringify(meta));
  } catch {
    // Ignore storage quota errors
  }
}

interface SaveFilePickerHandle {
  name?: string;
  createWritable: () => Promise<{
    write: (data: Blob | string) => Promise<void>;
    close: () => Promise<void>;
  }>;
}

type WindowWithFilePicker = Window & {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<SaveFilePickerHandle>;
};

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * Saves the complete PresensiQR backup JSON directly to the Master Admin's
 * computer or external drive (USB/HDD). Uses the File System Access API
 * ("Save As" folder/drive picker) when permitted, and falls back seamlessly
 * to browser file download in iframes or browsers without showSaveFilePicker.
 */
export async function saveBackupToComputer(
  payload: AppBackupPayload,
  preferPicker = true
): Promise<
  | { ok: true; filename: string; method: 'file_picker' | 'download'; meta: LastBackupMeta }
  | { ok: false; cancelled?: boolean; error?: string }
> {
  const filename = buildBackupFilename(payload.data.settings.nama_sekolah, 'json');
  const jsonContent = JSON.stringify(payload, null, 2);
  const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8' });

  const win = typeof window !== 'undefined' ? (window as WindowWithFilePicker) : null;
  const isTopFrame = typeof window !== 'undefined' && window.self === window.top;

  if (preferPicker && win && typeof win.showSaveFilePicker === 'function' && isTopFrame) {
    try {
      const handle = await win.showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: 'File Backup Presensi Digital (.json)',
            accept: { 'application/json': ['.json'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      const savedName = handle.name || filename;
      const meta: LastBackupMeta = {
        savedAt: new Date().toISOString(),
        filename: savedName,
        studentCount: payload.data.students.length,
        recordCount: payload.data.records.length,
        method: 'file_picker',
      };
      saveLastBackupMeta(meta);
      return { ok: true, filename: savedName, method: 'file_picker', meta };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { ok: false, cancelled: true };
      }
      // SecurityError / cross-origin restriction -> fall through to standard download
    }
  }

  try {
    triggerBlobDownload(blob, filename);
    const meta: LastBackupMeta = {
      savedAt: new Date().toISOString(),
      filename,
      studentCount: payload.data.students.length,
      recordCount: payload.data.records.length,
      method: 'download',
    };
    saveLastBackupMeta(meta);
    return { ok: true, filename, method: 'download', meta };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Gagal menyimpan file backup.',
    };
  }
}

/**
 * Exports a multi-sheet Excel archive (.xlsx) containing Siswa, Presensi, and Pengaturan
 * directly to the Master Admin's local/external storage.
 */
export function exportFullExcelArchive(payload: AppBackupPayload): {
  filename: string;
  meta: LastBackupMeta;
} {
  const wb = XLSX.utils.book_new();
  const settings = payload.data.settings;
  const exportMetaLine = `Diekspor oleh: ${payload.exportedBy} · Tahun Ajaran: ${settings.tahun_ajaran} · Semester: ${formatSemesterLabel(settings.semester)}`;

  const studentRows: Array<Array<string | number>> = payload.data.students.map((s, idx) => [
    idx + 1,
    s.nis,
    s.nama,
    s.kelas,
    s.gender,
    s.no_wa_ortu || '',
    s.tahun_ajaran || settings.tahun_ajaran,
  ]);
  const { sheet: wsSiswa } = buildLetterheadExcelSheet({
    settings,
    documentTitle: 'ARSIP DATA SISWA',
    subtitleLines: [
      `Total Siswa: ${payload.data.students.length} siswa · ${exportMetaLine}`,
    ],
    headers: ['No', 'NISN', 'Nama Siswa', 'Kelas', 'Gender', 'No WA Ortu', 'Tahun Ajaran'],
    rows: studentRows,
    includeSignature: true,
  });
  XLSX.utils.book_append_sheet(wb, wsSiswa, 'Siswa');

  const recordRows: Array<Array<string | number>> = payload.data.records.map((r, idx) => [
    idx + 1,
    r.id,
    r.tanggal,
    r.nis,
    r.nama,
    r.kelas,
    r.jam_masuk,
    r.jam_pulang || '-',
    r.status,
    r.keterangan || '',
    r.tahun_ajaran || settings.tahun_ajaran,
  ]);
  const { sheet: wsPresensi } = buildLetterheadExcelSheet({
    settings,
    documentTitle: 'ARSIP CATATAN PRESENSI SISWA',
    subtitleLines: [
      `Total Catatan: ${payload.data.records.length} baris · ${exportMetaLine}`,
    ],
    headers: [
      'No',
      'ID',
      'Tanggal',
      'NISN',
      'Nama Siswa',
      'Kelas',
      'Jam Masuk',
      'Jam Pulang',
      'Status',
      'Keterangan',
      'Tahun Ajaran',
    ],
    rows: recordRows,
    includeSignature: true,
  });
  XLSX.utils.book_append_sheet(wb, wsPresensi, 'Presensi');

  const settingsRows: Array<Array<string | number>> = [
    ['Nama Sekolah', settings.nama_sekolah],
    ['Nama Kepala Sekolah', settings.nama_kepala_sekolah || '-'],
    ['NIP Kepala Sekolah', settings.nip_kepala_sekolah || '-'],
    ['Tahun Ajaran', settings.tahun_ajaran],
    ['Semester', formatSemesterLabel(settings.semester)],
    ['Mode Presensi', settings.mode_presensi],
    ['Batas Jam Masuk', settings.batas_jam_masuk],
    ['Jam Pulang Standar', settings.jam_pulang_standar],
    ['Tema Aplikasi', settings.tema],
    ['Diekspor Pada', payload.exportedAt],
  ];
  const { sheet: wsPengaturan } = buildLetterheadExcelSheet({
    settings,
    documentTitle: 'PENGATURAN APLIKASI PRESENSI DIGITAL',
    subtitleLines: [exportMetaLine],
    headers: ['Pengaturan', 'Nilai'],
    rows: settingsRows,
    includeSignature: false,
  });
  XLSX.utils.book_append_sheet(wb, wsPengaturan, 'Pengaturan');

  const accountRows: Array<Array<string | number>> = (payload.data.accounts ?? []).map((a, idx) => [
    idx + 1,
    a.id,
    a.username,
    a.nama,
    a.nip || '',
    a.role,
    a.jabatan,
    a.kelas_binaan || '',
  ]);
  if (accountRows.length > 0) {
    const { sheet: wsAkun } = buildLetterheadExcelSheet({
      settings,
      documentTitle: 'DAFTAR AKUN DAN AKSES PENGGUNA',
      subtitleLines: [`Total Akun: ${accountRows.length} akun · ${exportMetaLine}`],
      headers: ['No', 'ID', 'Username', 'Nama Lengkap', 'NIP', 'Peran', 'Jabatan', 'Kelas Binaan'],
      rows: accountRows,
      includeSignature: true,
    });
    XLSX.utils.book_append_sheet(wb, wsAkun, 'Akun');
  }

  const subjectRecordRows: Array<Array<string | number>> = (payload.data.subjectRecords ?? []).map(
    (r, idx) => [
      idx + 1,
      r.tanggal,
      r.kelas,
      r.mata_pelajaran,
      r.teacher_name,
      r.nis,
      r.nama,
      r.jam_masuk,
      r.status,
      r.keterangan || '',
      r.tahun_ajaran,
    ]
  );
  if (subjectRecordRows.length > 0) {
    const { sheet: wsMapel } = buildLetterheadExcelSheet({
      settings,
      documentTitle: 'ARSIP PRESENSI MATA PELAJARAN',
      subtitleLines: [
        `Total Catatan Mapel: ${subjectRecordRows.length} baris · ${exportMetaLine}`,
      ],
      headers: [
        'No',
        'Tanggal',
        'Kelas',
        'Mata Pelajaran',
        'Guru',
        'NISN',
        'Nama Siswa',
        'Jam Masuk',
        'Status',
        'Keterangan',
        'Tahun Ajaran',
      ],
      rows: subjectRecordRows,
      includeSignature: true,
    });
    XLSX.utils.book_append_sheet(wb, wsMapel, 'Presensi_Mapel');
  }

  const filename = buildBackupFilename(settings.nama_sekolah, 'xlsx');
  XLSX.writeFile(wb, filename);

  const meta: LastBackupMeta = {
    savedAt: new Date().toISOString(),
    filename,
    studentCount: payload.data.students.length,
    recordCount: payload.data.records.length,
    method: 'excel',
  };
  saveLastBackupMeta(meta);
  return { filename, meta };
}
