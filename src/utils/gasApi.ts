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
  UserRole,
} from '../types';
import {
  DEFAULT_ACADEMIC_YEAR,
  DEFAULT_SCHOOL_LOGO,
  DEFAULT_SCHOOL_NAME,
  SEED_SETTINGS,
  SEED_STUDENTS,
  generateSeedRecords,
} from './seedData';
import { formatRoleLabel } from './auth';
import {
  normalizeAttendanceStatus,
  normalizeScheduleMode,
  normalizeTimeHHMM,
} from './attendanceLogic';
import {
  normalizeSemester,
  sanitizeMasterSubjects,
  sanitizeSubjectAssignments,
  sanitizeSubjectRecords,
  sanitizeTeacherSchedules,
} from './subjectAttendance';
import { normalizeThemeId } from './themes';
import {
  coalesceOfflineQueue,
  isBrowserOnline,
  isLikelyNetworkError,
  mirrorOfflineQueueToIdb,
  mirrorRecordsBackupToIdb,
  mirrorSettingsBackupToIdb,
  mirrorStudentsBackupToIdb,
  readOfflineQueueFromIdb,
} from './offlineStore';
import { notifyStorageWriteError } from './storageHealth';
import { DEFAULT_GAS_WEBAPP_URL } from './startupSyncPrompt';

const LEGACY_DEFAULT_SCHOOL_NAME = 'SMA Negeri 1 Nusantara';

/**
 * Web App URL default Google Apps Script agar aplikasi langsung terhubung
 * dan tersinkronisasi otomatis ke Google Sheets di semua perangkat.
 */
export const DEFAULT_SCRIPT_URL = DEFAULT_GAS_WEBAPP_URL;

const STORAGE_KEYS = {
  STUDENTS: 'presensiqr_students_v2',
  RECORDS: 'presensiqr_records_v2',
  SETTINGS: 'presensiqr_settings_v2',
  DEFAULT_IDENTITY: 'presensiqr_default_identity_v2',
  SYNC_QUEUE: 'presensiqr_sync_queue_v2',
  LEGACY_SETTINGS_V1: 'presensiqr_settings_v1',
};

export interface LocalCacheState {
  students: Student[];
  records: AttendanceRecord[];
  settings: SchoolSettings;
}

export type GasAction =
  | 'addSiswa'
  | 'bulkAddSiswa'
  | 'updateSiswa'
  | 'deleteSiswa'
  | 'bulkDeleteSiswa'
  | 'recordPresensi'
  | 'updateStatusPresensi'
  | 'resetPresensi'
  | 'savePengaturan'
  | 'syncAkun'
  | 'upsertAkun'
  | 'deleteAkun'
  | 'upsertMasterMapel'
  | 'deleteMasterMapel'
  | 'upsertJadwalGuru'
  | 'deleteJadwalGuru'
  | 'upsertMapelKelas'
  | 'deleteMapelKelas'
  | 'recordPresensiMapel'
  | 'bulkRecordPresensiMapel'
  | 'syncAll';

export interface PendingSyncItem {
  id: string;
  action: GasAction;
  payload: Record<string, unknown>;
  createdAt: string;
}

function resolveDefaultIdentityValues(
  namaRaw?: string,
  logoRaw?: string
): DefaultSchoolIdentity {
  const trimmedName = (namaRaw || '').trim();
  const trimmedLogo = (logoRaw || '').trim();
  const isUntouchedLegacyDefault =
    (!trimmedName || trimmedName === LEGACY_DEFAULT_SCHOOL_NAME) && !trimmedLogo;
  if (isUntouchedLegacyDefault) {
    return {
      nama_sekolah: DEFAULT_SCHOOL_NAME,
      logo_sekolah: DEFAULT_SCHOOL_LOGO,
    };
  }
  return {
    nama_sekolah: trimmedName || DEFAULT_SCHOOL_NAME,
    logo_sekolah: trimmedLogo || DEFAULT_SCHOOL_LOGO,
  };
}

export function loadDefaultSchoolIdentity(): DefaultSchoolIdentity {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.DEFAULT_IDENTITY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DefaultSchoolIdentity>;
      const resolved = resolveDefaultIdentityValues(parsed.nama_sekolah, parsed.logo_sekolah);
      if (
        resolved.nama_sekolah !== parsed.nama_sekolah ||
        resolved.logo_sekolah !== (parsed.logo_sekolah || '')
      ) {
        localStorage.setItem(STORAGE_KEYS.DEFAULT_IDENTITY, JSON.stringify(resolved));
      }
      return resolved;
    }

    // Seed default identity from any existing saved settings (v2 or v1)
    const rawCurrent =
      localStorage.getItem(STORAGE_KEYS.SETTINGS) ||
      localStorage.getItem(STORAGE_KEYS.LEGACY_SETTINGS_V1);
    if (rawCurrent) {
      const parsedCurrent = JSON.parse(rawCurrent) as Partial<SchoolSettings>;
      const derived = resolveDefaultIdentityValues(
        parsedCurrent.nama_sekolah,
        parsedCurrent.logo_sekolah
      );
      localStorage.setItem(STORAGE_KEYS.DEFAULT_IDENTITY, JSON.stringify(derived));
      return derived;
    }
  } catch {
    // Fallback below
  }

  return {
    nama_sekolah: DEFAULT_SCHOOL_NAME,
    logo_sekolah: DEFAULT_SCHOOL_LOGO,
  };
}

export function saveDefaultSchoolIdentity(
  identity: DefaultSchoolIdentity
): DefaultSchoolIdentity {
  const normalized: DefaultSchoolIdentity = {
    nama_sekolah: identity.nama_sekolah.trim() || DEFAULT_SCHOOL_NAME,
    logo_sekolah: (identity.logo_sekolah || '').trim() || DEFAULT_SCHOOL_LOGO,
  };
  try {
    localStorage.setItem(STORAGE_KEYS.DEFAULT_IDENTITY, JSON.stringify(normalized));
  } catch {
    // Ignore storage quota errors
  }
  return normalized;
}

export function loadLocalCache(): LocalCacheState {
  const defaultIdentity = loadDefaultSchoolIdentity();

  try {
    const rawSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    const rawStudents = localStorage.getItem(STORAGE_KEYS.STUDENTS);
    const rawRecords = localStorage.getItem(STORAGE_KEYS.RECORDS);

    let legacySettings: Partial<SchoolSettings> | null = null;
    if (!rawSettings) {
      try {
        const rawV1 = localStorage.getItem(STORAGE_KEYS.LEGACY_SETTINGS_V1);
        if (rawV1) {
          legacySettings = JSON.parse(rawV1) as Partial<SchoolSettings>;
        }
      } catch {
        legacySettings = null;
      }
    }

    const baseDefaults: SchoolSettings = {
      ...SEED_SETTINGS,
      nama_sekolah: defaultIdentity.nama_sekolah || DEFAULT_SCHOOL_NAME,
      logo_sekolah: defaultIdentity.logo_sekolah || DEFAULT_SCHOOL_LOGO,
      script_url: DEFAULT_SCRIPT_URL,
    };

    const parseJsonSafe = <T,>(raw: string | null): T | null => {
      if (!raw) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    };

    const parsedRawSettings = parseJsonSafe<Partial<SchoolSettings>>(rawSettings);
    const parsedSettings: SchoolSettings = parsedRawSettings
      ? { ...baseDefaults, ...parsedRawSettings }
      : legacySettings
        ? {
            ...baseDefaults,
            nama_sekolah: legacySettings.nama_sekolah || baseDefaults.nama_sekolah,
            logo_sekolah: legacySettings.logo_sekolah || baseDefaults.logo_sekolah,
            script_url: legacySettings.script_url || baseDefaults.script_url,
          }
        : baseDefaults;

    // Migrate untouched legacy starter default ("SMA Negeri 1 Nusantara" without custom logo)
    if (
      parsedSettings.nama_sekolah?.trim() === LEGACY_DEFAULT_SCHOOL_NAME &&
      !(parsedSettings.logo_sekolah || '').trim()
    ) {
      parsedSettings.nama_sekolah = DEFAULT_SCHOOL_NAME;
      parsedSettings.logo_sekolah = DEFAULT_SCHOOL_LOGO;
    }

    if (!parsedSettings.nama_sekolah?.trim()) {
      parsedSettings.nama_sekolah = defaultIdentity.nama_sekolah || DEFAULT_SCHOOL_NAME;
    }
    if (!(parsedSettings.logo_sekolah || '').trim()) {
      parsedSettings.logo_sekolah = defaultIdentity.logo_sekolah || DEFAULT_SCHOOL_LOGO;
    }
    if (!parsedSettings.script_url && DEFAULT_SCRIPT_URL) {
      parsedSettings.script_url = DEFAULT_SCRIPT_URL;
    }
    if (!parsedSettings.tahun_ajaran) {
      parsedSettings.tahun_ajaran = DEFAULT_ACADEMIC_YEAR;
    }
    parsedSettings.semester = normalizeSemester(parsedSettings.semester, 'ganjil');
    parsedSettings.mode_presensi = normalizeScheduleMode(
      parsedSettings.mode_presensi,
      'masuk_saja'
    );
    parsedSettings.batas_jam_masuk = normalizeTimeHHMM(
      parsedSettings.batas_jam_masuk,
      SEED_SETTINGS.batas_jam_masuk
    );
    parsedSettings.jam_pulang_standar = normalizeTimeHHMM(
      parsedSettings.jam_pulang_standar,
      SEED_SETTINGS.jam_pulang_standar
    );
    parsedSettings.tema = normalizeThemeId(parsedSettings.tema, 'indigo');
    const rawCreatorCredit = (parsedSettings as unknown as Record<string, unknown>)
      .show_creator_credit;
    parsedSettings.show_creator_credit =
      typeof rawCreatorCredit === 'boolean'
        ? rawCreatorCredit
        : String(rawCreatorCredit ?? '').toLowerCase() === 'false'
          ? false
          : true;

    // Default state starts genuinely empty before user inputs/imports data
    const students: Student[] = sanitizeStudents(parseJsonSafe<unknown>(rawStudents));
    const records: AttendanceRecord[] = sanitizeRecords(parseJsonSafe<unknown>(rawRecords));

    try {
      if (!rawStudents) {
        localStorage.setItem(STORAGE_KEYS.STUDENTS, JSON.stringify(students));
      }
      if (!rawRecords) {
        localStorage.setItem(STORAGE_KEYS.RECORDS, JSON.stringify(records));
      }
      if (!rawSettings) {
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(parsedSettings));
      }
    } catch {
      // Ignore quota write failures during initial hydration
    }

    return { students, records, settings: parsedSettings };
  } catch {
    return {
      students: [],
      records: [],
      settings: {
        ...SEED_SETTINGS,
        nama_sekolah: defaultIdentity.nama_sekolah,
        logo_sekolah: defaultIdentity.logo_sekolah || '',
        script_url: DEFAULT_SCRIPT_URL,
      },
    };
  }
}

export function saveLocalStudents(students: Student[]): void {
  void mirrorStudentsBackupToIdb(students);
  try {
    localStorage.setItem(STORAGE_KEYS.STUDENTS, JSON.stringify(students));
  } catch {
    notifyStorageWriteError(
      'Cache cepat localStorage (5 MB) penuh saat menyimpan data siswa. Data tetap dicadangkan otomatis ke IndexedDB berkapasitas besar.'
    );
  }
}

export function saveLocalRecords(records: AttendanceRecord[]): void {
  void mirrorRecordsBackupToIdb(records);
  try {
    localStorage.setItem(STORAGE_KEYS.RECORDS, JSON.stringify(records));
  } catch {
    notifyStorageWriteError(
      'Cache cepat localStorage (5 MB) penuh saat menyimpan data presensi. Data tetap dicadangkan otomatis ke IndexedDB berkapasitas besar.'
    );
  }
}

export function saveLocalSettings(
  settings: SchoolSettings
): { ok: boolean; error?: string } {
  void mirrorSettingsBackupToIdb(settings);
  const serialized = JSON.stringify(settings);
  try {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, serialized);
    return { ok: true };
  } catch {
    // Recovery: clear bloated duplicate savePengaturan entries from sync queue and retry once
    try {
      const prunedQueue = loadSyncQueue().filter((item) => item.action !== 'savePengaturan');
      localStorage.setItem(STORAGE_KEYS.SYNC_QUEUE, JSON.stringify(prunedQueue));
      localStorage.setItem(STORAGE_KEYS.SETTINGS, serialized);
      return { ok: true };
    } catch {
      const msg =
        'Cache cepat localStorage (5 MB) penuh. Data pengaturan dicadangkan ke IndexedDB, namun disarankan membersihkan cache atau presensi tahun ajaran lama.';
      notifyStorageWriteError(msg);
      return {
        ok: false,
        error: msg,
      };
    }
  }
}

export function resetLocalDemoData(preserveSettings: SchoolSettings): LocalCacheState {
  const defaultIdentity = loadDefaultSchoolIdentity();
  const preservedName =
    preserveSettings.nama_sekolah?.trim() || defaultIdentity.nama_sekolah || DEFAULT_SCHOOL_NAME;
  const preservedLogo =
    (preserveSettings.logo_sekolah || '').trim() ||
    (defaultIdentity.logo_sekolah || '').trim() ||
    DEFAULT_SCHOOL_LOGO;

  const fresh: LocalCacheState = {
    students: SEED_STUDENTS.map((s) => ({
      ...s,
      tahun_ajaran: preserveSettings.tahun_ajaran || DEFAULT_ACADEMIC_YEAR,
    })),
    records: generateSeedRecords(
      undefined,
      preserveSettings.tahun_ajaran || DEFAULT_ACADEMIC_YEAR
    ),
    settings: {
      ...SEED_SETTINGS,
      ...preserveSettings,
      nama_sekolah: preservedName,
      logo_sekolah: preservedLogo,
    },
  };
  saveLocalStudents(fresh.students);
  saveLocalRecords(fresh.records);
  saveLocalSettings(fresh.settings);
  return fresh;
}

export function loadSyncQueue(): PendingSyncItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SYNC_QUEUE);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is PendingSyncItem =>
        Boolean(
          item &&
            typeof item === 'object' &&
            typeof (item as PendingSyncItem).action === 'string' &&
            (item as PendingSyncItem).payload &&
            typeof (item as PendingSyncItem).payload === 'object'
        )
    );
  } catch {
    return [];
  }
}

export function saveSyncQueue(queue: PendingSyncItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.SYNC_QUEUE, JSON.stringify(queue));
  } catch {
    // Ignore storage quota errors — IndexedDB mirror below keeps offline items safe
  }
  void mirrorOfflineQueueToIdb(queue);
}

export async function hydrateSyncQueueFromOfflineStore(): Promise<PendingSyncItem[]> {
  const localQueue = loadSyncQueue();
  const idbQueue = await readOfflineQueueFromIdb();
  if (idbQueue.length === 0) {
    return localQueue;
  }
  if (localQueue.length === 0) {
    saveSyncQueue(idbQueue);
    return idbQueue;
  }
  const existingIds = new Set(localQueue.map((item) => item.id));
  let merged = [...localQueue];
  for (const item of idbQueue) {
    if (!existingIds.has(item.id)) {
      merged = coalesceOfflineQueue(merged, item);
    }
  }
  saveSyncQueue(merged);
  return merged;
}

export function enqueueSyncMutation(
  action: GasAction,
  payload: Record<string, unknown>
): PendingSyncItem[] {
  const current = loadSyncQueue();
  const safePayload =
    payload && typeof payload === 'object' ? payload : {};
  const item: PendingSyncItem = {
    id: `sync_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    action,
    payload: safePayload,
    createdAt: new Date().toISOString(),
  };
  const next = coalesceOfflineQueue(current, item);
  saveSyncQueue(next);
  return next;
}

export function clearSyncQueue(): void {
  saveSyncQueue([]);
}

function getFieldCaseInsensitive(
  obj: Record<string, unknown>,
  candidates: string[]
): string {
  for (const key of candidates) {
    if (obj[key] !== undefined && obj[key] !== null) {
      return String(obj[key]).trim();
    }
  }
  const normalizedMap = new Map<string, unknown>();
  for (const [k, v] of Object.entries(obj)) {
    normalizedMap.set(k.trim().toLowerCase().replace(/[\s-]+/g, '_'), v);
  }
  for (const key of candidates) {
    const val = normalizedMap.get(key.toLowerCase());
    if (val !== undefined && val !== null) {
      return String(val).trim();
    }
  }
  return '';
}

export function normalizeSheetDateString(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (!text) return '';

  // Already YYYY-MM-DD (or ISO prefix)
  const isoMatch = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmyMatch) {
    const p1 = Number(dmyMatch[1]);
    const p2 = Number(dmyMatch[2]);
    // Treat as DD/MM/YYYY unless second number > 12 (MM/DD/YYYY)
    const day = p2 > 12 ? p2 : p1;
    const month = p2 > 12 ? p1 : p2;
    return `${dmyMatch[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return text;
}

export function sanitizeStudents(rawList: unknown): Student[] {
  if (!Array.isArray(rawList)) return [];
  const out: Student[] = [];
  const indexByNis = new Map<string, number>();

  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const nis = getFieldCaseInsensitive(obj, ['nis', 'nisn']);
    const nama = getFieldCaseInsensitive(obj, ['nama', 'nama_siswa', 'nama_lengkap', 'name']);
    if (!nis) continue;
    const kelas = getFieldCaseInsensitive(obj, ['kelas', 'class', 'rombel', 'nama_kelas']);
    const genderRaw = getFieldCaseInsensitive(obj, ['gender', 'jenis_kelamin', 'l_p']);
    const gender: 'L' | 'P' = /^p/i.test(genderRaw) ? 'P' : 'L';
    const no_wa_ortu = getFieldCaseInsensitive(obj, ['no_wa_ortu', 'wa_ortu', 'no_wa']);
    const tahun_ajaran = getFieldCaseInsensitive(obj, ['tahun_ajaran', 'tahunajaran', 'ta']);

    const nisKey = nis.toLowerCase();
    const normalizedYear = tahun_ajaran.replace(/\s+/g, '');
    const untaggedKey = `__NO_YEAR__|${nisKey}`;
    const dedupeKey = `${normalizedYear || '__NO_YEAR__'}|${nisKey}`;

    let existingIdx = indexByNis.get(dedupeKey);
    if (existingIdx === undefined && normalizedYear) {
      const untaggedIdx = indexByNis.get(untaggedKey);
      if (untaggedIdx !== undefined) {
        existingIdx = untaggedIdx;
        indexByNis.delete(untaggedKey);
        indexByNis.set(dedupeKey, untaggedIdx);
      }
    }

    if (existingIdx !== undefined) {
      const prev = out[existingIdx];
      out[existingIdx] = {
        ...prev,
        nis,
        nama: nama || prev.nama,
        kelas: kelas || prev.kelas,
        gender: genderRaw ? gender : prev.gender,
        no_wa_ortu: no_wa_ortu || prev.no_wa_ortu,
        ...(tahun_ajaran || prev.tahun_ajaran
          ? { tahun_ajaran: tahun_ajaran || prev.tahun_ajaran }
          : {}),
      };
      continue;
    }

    indexByNis.set(dedupeKey, out.length);
    out.push({
      nis,
      nama: nama || nis,
      kelas: kelas || '-',
      gender,
      no_wa_ortu,
      ...(tahun_ajaran ? { tahun_ajaran } : {}),
    });
  }
  return out;
}

const ACADEMIC_YEAR_PATTERN = /^\d{4}\s*[/\-]\s*\d{4}$/;

function inferStatusFromNote(note: string): AttendanceRecord['status'] | null {
  const trimmed = note.trim();
  if (!trimmed) return null;
  const manualMatch = trimmed.match(/di(?:ubah|input)\s+manual\s*\(([^)]+)\)/i);
  if (manualMatch && manualMatch[1]) {
    const parsedManual = normalizeAttendanceStatus(manualMatch[1]);
    if (parsedManual) return parsedManual;
  }
  if (/melewati\s+(?:batas\s+)?jam\s+masuk|\bterlambat\b/i.test(trimmed)) {
    return 'Terlambat';
  }
  return null;
}

export function sanitizeRecords(rawList: unknown): AttendanceRecord[] {
  if (!Array.isArray(rawList)) return [];
  const out: AttendanceRecord[] = [];
  const indexByDayNis = new Map<string, number>();

  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const rawTanggal = getFieldCaseInsensitive(obj, ['tanggal', 'tgl', 'date']);
    const tanggal = normalizeSheetDateString(rawTanggal);
    const nis = getFieldCaseInsensitive(obj, ['nis']);
    if (!tanggal || !nis) continue;

    const id = getFieldCaseInsensitive(obj, ['id']) || `${tanggal}_${nis}`;
    const nama = getFieldCaseInsensitive(obj, ['nama', 'nama_siswa']) || nis;
    const kelas = getFieldCaseInsensitive(obj, ['kelas']) || '-';
    const jam_masuk = getFieldCaseInsensitive(obj, ['jam_masuk']) || '-';
    const jam_pulang = getFieldCaseInsensitive(obj, ['jam_pulang']) || '-';
    const rawStatus = getFieldCaseInsensitive(obj, ['status']);
    const rawKeterangan = getFieldCaseInsensitive(obj, ['keterangan']);
    const rawAlasan = getFieldCaseInsensitive(obj, [
      'alasan_pulang_cepat',
      'alasan pulang cepat',
    ]);
    const rawTahunAjaran = getFieldCaseInsensitive(obj, ['tahun_ajaran']);

    const directStatus = normalizeAttendanceStatus(rawStatus);
    const alasanAsStatus = normalizeAttendanceStatus(rawAlasan);
    const keteranganAsStatus = normalizeAttendanceStatus(rawKeterangan);

    let status: AttendanceRecord['status'];
    let keterangan = rawKeterangan;
    let alasan_pulang_cepat = rawAlasan;
    let tahun_ajaran = rawTahunAjaran;

    // Self-heal shifted-column Case A:
    // Legacy 10-col row read under shifted 11-col header where `alasan_pulang_cepat` sat before `status`:
    // alasan_pulang_cepat = <status>, status = <keterangan>, keterangan = <tahun_ajaran>
    const looksLikeShiftedCaseA =
      alasanAsStatus !== null &&
      (!directStatus ||
        (rawStatus.trim().toLowerCase() === 'tepat waktu' &&
          !rawTahunAjaran &&
          ACADEMIC_YEAR_PATTERN.test(rawKeterangan.trim())));

    if (looksLikeShiftedCaseA && alasanAsStatus) {
      status = alasanAsStatus;
      keterangan = rawStatus || (ACADEMIC_YEAR_PATTERN.test(rawKeterangan.trim()) ? '' : rawKeterangan);
      tahun_ajaran =
        rawTahunAjaran ||
        (ACADEMIC_YEAR_PATTERN.test(rawKeterangan.trim()) ? rawKeterangan.trim() : '');
      alasan_pulang_cepat = '';
    } else if (directStatus) {
      status = directStatus;
    } else if (keteranganAsStatus) {
      // Self-heal shifted-column Case B:
      // 11-col shifted row written into legacy 10-col header:
      // status = <alasan_pulang_cepat or ''>, keterangan = <status>, tahun_ajaran = <keterangan>
      status = keteranganAsStatus;
      alasan_pulang_cepat = rawAlasan || rawStatus;
      if (ACADEMIC_YEAR_PATTERN.test(rawTahunAjaran.trim())) {
        keterangan = '';
        tahun_ajaran = rawTahunAjaran.trim();
      } else {
        keterangan = rawTahunAjaran;
        tahun_ajaran = '';
      }
    } else {
      // Case C: Recover status from keterangan text if status cell was blank/corrupted
      status = inferStatusFromNote(rawKeterangan) ?? inferStatusFromNote(rawStatus) ?? 'Hadir';
    }

    if (
      status === 'Hadir' &&
      keterangan &&
      !/di(?:ubah|input)\s+manual/i.test(keterangan) &&
      /melewati\s+(?:batas\s+)?jam\s+masuk/i.test(keterangan)
    ) {
      status = 'Terlambat';
    }

    if (!alasan_pulang_cepat && keterangan) {
      const match = keterangan.match(/Pulang cepat\s+[0-9:]+\s*\(Alasan:\s*([^)]+)\)/i);
      if (match && match[1]) {
        alasan_pulang_cepat = match[1].trim();
      }
    }

    const sanitizedRecord: AttendanceRecord = {
      id,
      tanggal,
      nis,
      nama,
      kelas,
      jam_masuk,
      jam_pulang,
      ...(alasan_pulang_cepat ? { alasan_pulang_cepat } : {}),
      status,
      ...(keterangan ? { keterangan } : {}),
      ...(tahun_ajaran ? { tahun_ajaran } : {}),
    };

    const dedupeKey = `${tanggal}__${nis.trim().toLowerCase()}`;
    const existingIdx = indexByDayNis.get(dedupeKey);
    if (existingIdx !== undefined) {
      const prev = out[existingIdx];
      out[existingIdx] = {
        ...sanitizedRecord,
        jam_masuk:
          sanitizedRecord.jam_masuk && sanitizedRecord.jam_masuk !== '-'
            ? sanitizedRecord.jam_masuk
            : prev.jam_masuk,
        jam_pulang:
          sanitizedRecord.jam_pulang && sanitizedRecord.jam_pulang !== '-'
            ? sanitizedRecord.jam_pulang
            : prev.jam_pulang,
        alasan_pulang_cepat:
          sanitizedRecord.alasan_pulang_cepat || prev.alasan_pulang_cepat,
      };
    } else {
      indexByDayNis.set(dedupeKey, out.length);
      out.push(sanitizedRecord);
    }
  }
  return out;
}

function normalizeSheetUserRole(raw: string): UserRole {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (
    normalized === 'master_admin' ||
    normalized === 'master' ||
    normalized === 'admin' ||
    normalized === 'administrator'
  ) {
    return 'master_admin';
  }
  if (
    normalized === 'kepala_sekolah' ||
    normalized === 'kepsek' ||
    normalized === 'principal'
  ) {
    return 'kepala_sekolah';
  }
  if (normalized === 'wali_kelas' || normalized === 'walikelas') {
    return 'wali_kelas';
  }
  return 'guru';
}

export function sanitizeAccounts(rawList: unknown): UserAccount[] {
  if (!Array.isArray(rawList)) return [];
  const seenUsernames = new Set<string>();
  const out: UserAccount[] = [];
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const username = getFieldCaseInsensitive(obj, ['username', 'user']);
    const password = getFieldCaseInsensitive(obj, ['password', 'kata_sandi', 'sandi']);
    const nama = getFieldCaseInsensitive(obj, ['nama', 'nama_lengkap', 'name']);
    if (!username || !password || !nama) continue;
    const unameKey = username.toLowerCase();
    if (seenUsernames.has(unameKey)) continue;
    seenUsernames.add(unameKey);

    const rawRole = getFieldCaseInsensitive(obj, ['role', 'peran', 'hak_akses']);
    const role: UserRole = normalizeSheetUserRole(rawRole);
    const nip = getFieldCaseInsensitive(obj, ['nip']);
    const kelasBinaan =
      role === 'wali_kelas'
        ? getFieldCaseInsensitive(obj, ['kelas_binaan', 'kelas', 'rombel', 'kelas_wali'])
        : '';
    const id =
      getFieldCaseInsensitive(obj, ['id']) || `usr_${unameKey.replace(/[^a-z0-9]/g, '_')}`;
    const jabatan =
      getFieldCaseInsensitive(obj, ['jabatan']) || formatRoleLabel(role, kelasBinaan);

    const fotoProfil = getFieldCaseInsensitive(obj, ['foto_profil', 'foto', 'avatar']);

    out.push({
      id,
      username,
      password,
      nama,
      ...(nip ? { nip } : {}),
      role,
      jabatan,
      ...(kelasBinaan ? { kelas_binaan: kelasBinaan } : {}),
      ...(fotoProfil ? { foto_profil: fotoProfil } : {}),
    });
  }
  return out;
}

export function validateGasScriptUrl(scriptUrl: string): string {
  const trimmed = scriptUrl.trim();
  if (!trimmed) {
    throw new Error('URL Google Apps Script belum diisi.');
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error('URL Google Apps Script harus diawali dengan https://.');
  }
  if (trimmed.includes('script.google.com') && trimmed.endsWith('/edit')) {
    throw new Error(
      'URL masih berakhiran /edit. Gunakan URL hasil Deploy Web App yang berakhiran /exec.'
    );
  }
  return trimmed;
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs = 15000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Koneksi ke Google Apps Script timeout (melebihi 15 detik).');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export interface GasGetAllResponse {
  status?: string;
  students?: Student[];
  siswa?: Student[];
  records?: AttendanceRecord[];
  presensi?: AttendanceRecord[];
  settings?: Partial<SchoolSettings>;
  pengaturan?: Partial<SchoolSettings>;
  accounts?: UserAccount[];
  akun?: UserAccount[];
  masterSubjects?: MasterSubject[];
  master_mapel?: MasterSubject[];
  teacherSchedules?: TeacherSchedule[];
  jadwal_guru?: TeacherSchedule[];
  subjectAssignments?: SubjectAssignment[];
  mapel_kelas?: SubjectAssignment[];
  subjectRecords?: SubjectAttendanceRecord[];
  presensi_mapel?: SubjectAttendanceRecord[];
  message?: string;
}

export async function fetchAllFromGas(scriptUrl: string): Promise<{
  students: Student[];
  records: AttendanceRecord[];
  settings: Partial<SchoolSettings>;
  accounts: UserAccount[];
  masterSubjects: MasterSubject[];
  teacherSchedules: TeacherSchedule[];
  subjectAssignments: SubjectAssignment[];
  subjectRecords: SubjectAttendanceRecord[];
  supportsAkun: boolean;
  hasRemoteData: boolean;
}> {
  const trimmed = validateGasScriptUrl(scriptUrl);

  const separator = trimmed.includes('?') ? '&' : '?';
  const url = `${trimmed}${separator}action=getAll&_t=${Date.now()}`;

  const response = await fetchWithTimeout(url, {
    method: 'GET',
    redirect: 'follow',
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Server merespons dengan status ${response.status}`);
  }

  const rawText = await response.text();
  if (rawText.trim().startsWith('<')) {
    throw new Error(
      'Respons bukan JSON. Pastikan Web App di-deploy dengan akses "Anyone" dan URL berakhiran /exec.'
    );
  }

  let data: GasGetAllResponse;
  try {
    data = JSON.parse(rawText) as GasGetAllResponse;
  } catch {
    throw new Error('Format respons Google Apps Script tidak valid (bukan JSON).');
  }

  if (data.status === 'error') {
    throw new Error(data.message || 'Gagal memuat data dari Google Apps Script.');
  }

  const rawStudents = Array.isArray(data.students)
    ? data.students
    : Array.isArray(data.siswa)
      ? data.siswa
      : [];

  const rawRecords = Array.isArray(data.records)
    ? data.records
    : Array.isArray(data.presensi)
      ? data.presensi
      : [];

  const rawSettingsSource = (data.settings ?? data.pengaturan ?? {}) as Record<string, unknown>;
  const rawSettingsObj: Record<string, unknown> = {};
  for (const [rawKey, rawVal] of Object.entries(rawSettingsSource)) {
    const normKey = rawKey.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (normKey) {
      rawSettingsObj[normKey] = rawVal;
    }
  }

  const rawSettingsAkunAkses = rawSettingsObj.akun_akses;
  let accountsFromSettings: unknown[] = [];
  if (Array.isArray(rawSettingsAkunAkses)) {
    accountsFromSettings = rawSettingsAkunAkses;
  } else if (typeof rawSettingsAkunAkses === 'string' && rawSettingsAkunAkses.trim()) {
    try {
      const parsed = JSON.parse(rawSettingsAkunAkses);
      if (Array.isArray(parsed)) {
        accountsFromSettings = parsed;
      }
    } catch {
      accountsFromSettings = [];
    }
  }

  const rawAccounts =
    Array.isArray(data.accounts) && data.accounts.length > 0
      ? data.accounts
      : Array.isArray(data.akun) && data.akun.length > 0
        ? data.akun
        : accountsFromSettings;

  const rawMasterSubjects = Array.isArray(data.masterSubjects)
    ? data.masterSubjects
    : Array.isArray(data.master_mapel)
      ? data.master_mapel
      : [];

  const rawTeacherSchedules = Array.isArray(data.teacherSchedules)
    ? data.teacherSchedules
    : Array.isArray(data.jadwal_guru)
      ? data.jadwal_guru
      : [];

  const rawSubjectAssignments = Array.isArray(data.subjectAssignments)
    ? data.subjectAssignments
    : Array.isArray(data.mapel_kelas)
      ? data.mapel_kelas
      : [];

  const rawSubjectRecords = Array.isArray(data.subjectRecords)
    ? data.subjectRecords
    : Array.isArray(data.presensi_mapel)
      ? data.presensi_mapel
      : [];

  const students = sanitizeStudents(rawStudents);
  const records = sanitizeRecords(rawRecords);
  const cleanSettings: Record<string, unknown> = { ...rawSettingsObj };
  delete cleanSettings.akun_akses;
  delete cleanSettings.jumlah_akun;
  delete cleanSettings.daftar_akun;
  const settings = cleanSettings as Partial<SchoolSettings>;
  const accounts = sanitizeAccounts(rawAccounts);
  const masterSubjects = sanitizeMasterSubjects(rawMasterSubjects);
  const teacherSchedules = sanitizeTeacherSchedules(rawTeacherSchedules);
  const subjectAssignments = sanitizeSubjectAssignments(rawSubjectAssignments);
  const subjectRecords = sanitizeSubjectRecords(rawSubjectRecords);

  const supportsAkun =
    Object.prototype.hasOwnProperty.call(data, 'akun') ||
    Object.prototype.hasOwnProperty.call(data, 'accounts') ||
    Object.prototype.hasOwnProperty.call(rawSettingsObj, 'akun_akses') ||
    Object.prototype.hasOwnProperty.call(rawSettingsObj, 'jumlah_akun');

  const hasRemoteSettingsValues = Object.values(cleanSettings).some(
    (v) => typeof v === 'string' && v.trim().length > 0
  );

  const hasRemoteData =
    students.length > 0 ||
    records.length > 0 ||
    accounts.length > 0 ||
    masterSubjects.length > 0 ||
    teacherSchedules.length > 0 ||
    subjectAssignments.length > 0 ||
    subjectRecords.length > 0 ||
    hasRemoteSettingsValues;

  return {
    students,
    records,
    settings,
    accounts,
    masterSubjects,
    teacherSchedules,
    subjectAssignments,
    subjectRecords,
    supportsAkun,
    hasRemoteData,
  };
}

export function prepareGasPayload(
  action: GasAction,
  payload: Record<string, unknown>
): Record<string, unknown> {
  const safePayload =
    payload && typeof payload === 'object' ? { ...payload } : {};

  if (action === 'recordPresensi' || action === 'updateStatusPresensi') {
    const nested =
      safePayload.record && typeof safePayload.record === 'object'
        ? (safePayload.record as Record<string, unknown>)
        : {};
    const mergedRecord: Record<string, unknown> = {
      ...nested,
      ...safePayload,
    };
    delete mergedRecord.record;
    if (mergedRecord.tanggal) {
      mergedRecord.tanggal = normalizeSheetDateString(mergedRecord.tanggal);
    }
    return {
      ...mergedRecord,
      record: mergedRecord,
    };
  }

  if (action === 'syncAkun') {
    const cleanAccounts = sanitizeAccounts(safePayload.accounts ?? safePayload.akun);
    return {
      accounts: cleanAccounts,
      akun: cleanAccounts,
    };
  }

  if (action === 'upsertAkun') {
    const rawAcc =
      safePayload.account && typeof safePayload.account === 'object'
        ? safePayload.account
        : safePayload.akun && typeof safePayload.akun === 'object'
          ? safePayload.akun
          : safePayload;
    const cleanAcc = sanitizeAccounts([rawAcc])[0] || rawAcc;
    return {
      ...(typeof cleanAcc === 'object' && cleanAcc ? cleanAcc : {}),
      account: cleanAcc,
      akun: cleanAcc,
    };
  }

  if (action === 'recordPresensiMapel') {
    const nested =
      safePayload.record && typeof safePayload.record === 'object'
        ? (safePayload.record as Record<string, unknown>)
        : safePayload;
    const sanitized = sanitizeSubjectRecords([nested])[0] || nested;
    return {
      ...sanitized,
      record: sanitized,
    };
  }

  if (action === 'bulkRecordPresensiMapel') {
    return {
      records: sanitizeSubjectRecords(safePayload.records),
    };
  }

  if (action === 'savePengaturan') {
    const rawSettingsAccounts =
      safePayload.accounts ??
      safePayload.akun ??
      (safePayload.settings && typeof safePayload.settings === 'object'
        ? (safePayload.settings as Record<string, unknown>).accounts ??
          (safePayload.settings as Record<string, unknown>).akun
        : undefined);
    if (Array.isArray(rawSettingsAccounts)) {
      const cleanAccounts = sanitizeAccounts(rawSettingsAccounts);
      const daftarAkun = cleanAccounts
        .map((a) => `${a.username} (${a.jabatan || formatRoleLabel(a.role, a.kelas_binaan)})`)
        .join(' | ');
      return {
        ...safePayload,
        accounts: cleanAccounts,
        akun: cleanAccounts,
        jumlah_akun: String(cleanAccounts.length),
        daftar_akun: daftarAkun,
        akun_akses: JSON.stringify(cleanAccounts),
      };
    }
    return safePayload;
  }

  if (action === 'syncAll') {
    const cleanAccounts = sanitizeAccounts(safePayload.accounts ?? safePayload.akun);
    const daftarAkun = cleanAccounts
      .map((a) => `${a.username} (${a.jabatan || formatRoleLabel(a.role, a.kelas_binaan)})`)
      .join(' | ');
    const baseSettings =
      safePayload.settings && typeof safePayload.settings === 'object'
        ? {
            ...(safePayload.settings as Record<string, unknown>),
            jumlah_akun: String(cleanAccounts.length),
            daftar_akun: daftarAkun,
            akun_akses: JSON.stringify(cleanAccounts),
          }
        : safePayload.settings;
    return {
      ...safePayload,
      settings: baseSettings,
      students: sanitizeStudents(safePayload.students),
      records: sanitizeRecords(safePayload.records),
      accounts: cleanAccounts,
      akun: cleanAccounts,
      masterSubjects: sanitizeMasterSubjects(safePayload.masterSubjects),
      teacherSchedules: sanitizeTeacherSchedules(safePayload.teacherSchedules),
      subjectAssignments: sanitizeSubjectAssignments(safePayload.subjectAssignments),
      subjectRecords: sanitizeSubjectRecords(safePayload.subjectRecords),
    };
  }

  return safePayload;
}

export async function postToGas(
  scriptUrl: string,
  action: GasAction,
  payload: Record<string, unknown>
): Promise<{ status: string; message?: string }> {
  const trimmed = validateGasScriptUrl(scriptUrl);
  const preparedPayload = prepareGasPayload(action, payload);
  const body = JSON.stringify({ action, ...preparedPayload });

  try {
    const response = await fetchWithTimeout(trimmed, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      redirect: 'follow',
      cache: 'no-store',
      body,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const text = await response.text();
    try {
      const parsed = JSON.parse(text) as { status?: string; message?: string };
      if (parsed.status === 'error') {
        throw new Error(parsed.message || 'Gagal sinkronisasi ke Google Sheets.');
      }
      return { status: parsed.status ?? 'ok', message: parsed.message };
    } catch (err) {
      if (err instanceof SyntaxError) {
        return { status: 'ok' };
      }
      throw err;
    }
  } catch (err) {
    // Handle Google Apps Script 302 redirect CORS quirks in strict browser policies:
    // Retry via no-cors POST and verify server reachability with GET getAll.
    const isNetworkCorsError =
      err instanceof TypeError ||
      (err instanceof Error &&
        /failed to fetch|networkerror|load failed/i.test(err.message));

    if (isNetworkCorsError) {
      await fetchWithTimeout(trimmed, {
        method: 'POST',
        mode: 'no-cors',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
        },
        body,
      });
      const verified = await fetchAllFromGas(trimmed);
      if (
        (action === 'syncAkun' || action === 'upsertAkun' || action === 'deleteAkun') &&
        !verified.supportsAkun
      ) {
        throw new Error(
          'Skrip Code.gs di Google Sheets Anda masih versi lama dan belum mendukung Sheet Akun. Salin template Code.gs terbaru lalu deploy New version.'
        );
      }
      return { status: 'ok', message: 'Tersinkron ke Google Sheets.' };
    }

    throw err;
  }
}

let activeFlushPromise: Promise<{
  flushed: number;
  remaining: number;
  lastError?: string;
  skippedOffline?: boolean;
}> | null = null;

export async function flushSyncQueue(
  scriptUrl: string
): Promise<{
  flushed: number;
  remaining: number;
  lastError?: string;
  skippedOffline?: boolean;
}> {
  const trimmed = scriptUrl.trim();
  const queue = loadSyncQueue();
  if (!trimmed || queue.length === 0) {
    return { flushed: 0, remaining: queue.length };
  }
  if (!isBrowserOnline()) {
    return { flushed: 0, remaining: queue.length, skippedOffline: true };
  }
  if (activeFlushPromise) {
    return activeFlushPromise;
  }

  activeFlushPromise = (async () => {
    const currentQueue = loadSyncQueue();
    if (currentQueue.length === 0) {
      return { flushed: 0, remaining: 0 };
    }
    let flushed = 0;
    const failedItems: PendingSyncItem[] = [];
    let lastError: string | undefined;

    for (let i = 0; i < currentQueue.length; i++) {
      const item = currentQueue[i];
      if (!item || !item.action || !item.payload || typeof item.payload !== 'object') {
        continue;
      }
      try {
        await postToGas(trimmed, item.action, item.payload);
        flushed++;
      } catch (err) {
        lastError = err instanceof Error ? err.message : 'Gagal mengirim antrean.';
        failedItems.push(item);
        // If network/offline error, keep remaining items in exact FIFO order and stop trying
        if (isLikelyNetworkError(err)) {
          failedItems.push(...currentQueue.slice(i + 1));
          break;
        }
      }
    }

    // Preserve any brand-new items appended while flush was in-flight
    const processedIds = new Set(currentQueue.map((item) => item.id));
    const newlyAdded = loadSyncQueue().filter((item) => !processedIds.has(item.id));
    const finalQueue = [...failedItems, ...newlyAdded];
    saveSyncQueue(finalQueue);
    return { flushed, remaining: finalQueue.length, lastError };
  })();

  try {
    return await activeFlushPromise;
  } finally {
    activeFlushPromise = null;
  }
}

export const GOOGLE_APPS_SCRIPT_TEMPLATE = `// Salin kode ini ke Google Apps Script (Extensions > Apps Script) di Google Sheet Anda.
// Seluruh 8 sheet akan dibuat otomatis saat sync:
// "Siswa", "Presensi", "Pengaturan", "Akun", "MasterMapel", "JadwalGuru", "MapelKelas", "PresensiMapel".
// Deploy sebagai Web App: Execute as "Me", Who has access "Anyone".

var HEADERS_SISWA = ['nis', 'nama', 'kelas', 'gender', 'no_wa_ortu', 'tahun_ajaran'];
var HEADERS_PRESENSI = ['id', 'tanggal', 'nis', 'nama', 'kelas', 'jam_masuk', 'jam_pulang', 'status', 'keterangan', 'tahun_ajaran', 'alasan_pulang_cepat'];
var HEADERS_AKUN = ['id', 'username', 'password', 'nama', 'nip', 'role', 'jabatan', 'kelas_binaan', 'foto_profil'];
var HEADERS_MASTER_MAPEL = ['id', 'kode', 'nama', 'deskripsi'];
var HEADERS_JADWAL_GURU = ['id', 'hari', 'teacher_user_id', 'teacher_name', 'kelas', 'mata_pelajaran', 'jam_mulai', 'jam_selesai', 'tahun_ajaran', 'semester'];
var HEADERS_MAPEL_KELAS = ['id', 'teacher_user_id', 'teacher_name', 'kelas', 'mata_pelajaran', 'hari', 'jam_mulai', 'jam_selesai', 'tahun_ajaran', 'semester', 'source'];
var HEADERS_PRESENSI_MAPEL = ['id', 'assignment_id', 'tanggal', 'kelas', 'mata_pelajaran', 'teacher_user_id', 'teacher_name', 'nis', 'nama', 'jam_masuk', 'status', 'keterangan', 'tahun_ajaran'];

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || 'getAll';
    if (action === 'getAll') {
      ensureAllSheetsExist();
      var pengaturanObj = readPengaturan();
      var akunList = readSheetAsObjects('Akun');
      if (akunList.length === 0 && pengaturanObj.akun_akses) {
        var parsedAkun = parseAccountsJsonSafe(pengaturanObj.akun_akses);
        if (parsedAkun.length > 0) {
          akunList = parsedAkun;
          replaceSheetRows('Akun', HEADERS_AKUN, mapAccountsToRows(parsedAkun));
        }
      } else if (akunList.length > 0 && (!pengaturanObj.akun_akses || !pengaturanObj.jumlah_akun)) {
        syncAccountsIntoPengaturanSheet(akunList);
        pengaturanObj = readPengaturan();
      }
      return jsonResponse({
        status: 'ok',
        siswa: readSheetAsObjects('Siswa'),
        presensi: readSheetAsObjects('Presensi'),
        pengaturan: pengaturanObj,
        akun: akunList,
        accounts: akunList,
        master_mapel: readSheetAsObjects('MasterMapel'),
        jadwal_guru: readSheetAsObjects('JadwalGuru'),
        mapel_kelas: readSheetAsObjects('MapelKelas'),
        presensi_mapel: readSheetAsObjects('PresensiMapel')
      });
    }
    return jsonResponse({ status: 'error', message: 'Action tidak dikenal' });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err && err.message ? err.message : String(err) });
  }
}

function ensureAllSheetsExist() {
  getOrCreateSheet('Siswa', HEADERS_SISWA);
  getOrCreateSheet('Presensi', HEADERS_PRESENSI);
  getOrCreateSheet('Pengaturan', ['key', 'value']);
  getOrCreateSheet('Akun', HEADERS_AKUN);
  getOrCreateSheet('MasterMapel', HEADERS_MASTER_MAPEL);
  getOrCreateSheet('JadwalGuru', HEADERS_JADWAL_GURU);
  getOrCreateSheet('MapelKelas', HEADERS_MAPEL_KELAS);
  getOrCreateSheet('PresensiMapel', HEADERS_PRESENSI_MAPEL);
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(15000);
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ status: 'error', message: 'Payload POST kosong' });
    }
    var data = JSON.parse(e.postData.contents);
    var action = data.action;

    if (action === 'addSiswa') {
      var sh = getOrCreateSheet('Siswa', HEADERS_SISWA);
      appendRowAsText(sh, [data.nis || '', data.nama || '', data.kelas || '', data.gender || 'L', data.no_wa_ortu || '', data.tahun_ajaran || '']);
      return jsonResponse({ status: 'ok' });
    }

    if (action === 'bulkAddSiswa' && Array.isArray(data.students)) {
      var shB = getOrCreateSheet('Siswa', HEADERS_SISWA);
      var rowsToAdd = [];
      for (var bi = 0; bi < data.students.length; bi++) {
        var bs = data.students[bi];
        if (!bs || typeof bs !== 'object') continue;
        rowsToAdd.push([String(bs.nis || ''), String(bs.nama || ''), String(bs.kelas || ''), String(bs.gender || 'L'), String(bs.no_wa_ortu || ''), String(bs.tahun_ajaran || '')]);
      }
      if (rowsToAdd.length > 0) {
        var rngB = shB.getRange(shB.getLastRow() + 1, 1, rowsToAdd.length, HEADERS_SISWA.length);
        rngB.setNumberFormat('@');
        rngB.setValues(rowsToAdd);
      }
      return jsonResponse({ status: 'ok' });
    }

    if (action === 'updateSiswa') {
      var shU = getOrCreateSheet('Siswa', HEADERS_SISWA);
      var rowsU = shU.getDataRange().getDisplayValues();
      var targetNis = data.originalNis || data.nis || '';
      var targetYearU = String(data.originalTahunAjaran || data.tahun_ajaran || '').trim();
      var updatedRow = [String(data.nis || ''), String(data.nama || ''), String(data.kelas || ''), String(data.gender || 'L'), String(data.no_wa_ortu || ''), String(data.tahun_ajaran || '')];
      for (var i = 1; i < rowsU.length; i++) {
        var rowYearU = String(rowsU[i][5] || '').trim();
        var yearMatchesU = !targetYearU || !rowYearU || rowYearU === targetYearU;
        if (String(rowsU[i][0]) === String(targetNis) && yearMatchesU) {
          var rngU = shU.getRange(i + 1, 1, 1, HEADERS_SISWA.length);
          rngU.setNumberFormat('@');
          rngU.setValues([updatedRow]);
          return jsonResponse({ status: 'ok' });
        }
      }
      appendRowAsText(shU, updatedRow);
      return jsonResponse({ status: 'ok' });
    }

    if (action === 'deleteSiswa') {
      var shD = getOrCreateSheet('Siswa', HEADERS_SISWA);
      var rowsD = shD.getDataRange().getDisplayValues();
      var targetYearD = String(data.tahun_ajaran || '').trim();
      for (var j = rowsD.length - 1; j >= 1; j--) {
        var rowYearD = String(rowsD[j][5] || '').trim();
        var yearMatchesD = !targetYearD || !rowYearD || rowYearD === targetYearD;
        if (String(rowsD[j][0]) === String(data.nis || '') && yearMatchesD) {
          shD.deleteRow(j + 1);
          return jsonResponse({ status: 'ok' });
        }
      }
      return jsonResponse({ status: 'ok' });
    }

    if (action === 'bulkDeleteSiswa' && Array.isArray(data.nisList)) {
      var shBD = getOrCreateSheet('Siswa', HEADERS_SISWA);
      var rowsBD = shBD.getDataRange().getDisplayValues();
      var targetYearsBD = Array.isArray(data.tahunAjaranList) ? data.tahunAjaranList : [];
      var hasYearFilterBD = targetYearsBD.length > 0;
      var yearSetBD = {};
      for (var yx = 0; yx < targetYearsBD.length; yx++) {
        yearSetBD[String(targetYearsBD[yx] || '').trim()] = true;
      }
      var nisMap = {};
      for (var x = 0; x < data.nisList.length; x++) {
        nisMap[String(data.nisList[x])] = true;
      }
      for (var d = rowsBD.length - 1; d >= 1; d--) {
        var rowYearBD = String(rowsBD[d][5] || '').trim();
        var yearOkBD = !hasYearFilterBD || !rowYearBD || Boolean(yearSetBD[rowYearBD]);
        if (nisMap[String(rowsBD[d][0])] && yearOkBD) {
          shBD.deleteRow(d + 1);
        }
      }
      return jsonResponse({ status: 'ok' });
    }

    if (action === 'recordPresensi' || action === 'updateStatusPresensi') {
      var recP = (data && data.record && typeof data.record === 'object') ? data.record : data;
      var tglP = String((recP && recP.tanggal) || data.tanggal || '');
      var nisP = String((recP && recP.nis) || data.nis || '');
      if (!tglP || !nisP) {
        return jsonResponse({ status: 'error', message: 'Data presensi (tanggal/nis) tidak lengkap' });
      }
      var shP = getOrCreateSheet('Presensi', HEADERS_PRESENSI);
      var activeHeadersP = appendMissingHeaders(shP, HEADERS_PRESENSI);
      var rowsP = shP.getDataRange().getDisplayValues();
      var valuesMapP = {
        id: String(recP.id || (tglP + '_' + nisP)),
        tanggal: tglP,
        nis: nisP,
        nama: String(recP.nama || ''),
        kelas: String(recP.kelas || ''),
        jam_masuk: String(recP.jam_masuk || '-'),
        jam_pulang: String(recP.jam_pulang || '-'),
        status: String(recP.status || 'Hadir'),
        keterangan: String(recP.keterangan || ''),
        tahun_ajaran: String(recP.tahun_ajaran || ''),
        alasan_pulang_cepat: String(recP.alasan_pulang_cepat || '')
      };
      var presensiRow = mapObjectToHeaders(activeHeadersP, valuesMapP);
      var tglIdx = findHeaderIndex(activeHeadersP, ['tanggal', 'tgl', 'date'], 1);
      var nisIdx = findHeaderIndex(activeHeadersP, ['nis'], 2);
      for (var p = 1; p < rowsP.length; p++) {
        if (String(rowsP[p][tglIdx]) === tglP && String(rowsP[p][nisIdx]) === nisP) {
          var rngP = shP.getRange(p + 1, 1, 1, presensiRow.length);
          rngP.setNumberFormat('@');
          rngP.setValues([presensiRow]);
          return jsonResponse({ status: 'ok' });
        }
      }
      appendRowAsText(shP, presensiRow);
      return jsonResponse({ status: 'ok' });
    }

    if (action === 'resetPresensi') {
      replaceSheetRows('Presensi', HEADERS_PRESENSI, []);
      replaceSheetRows('PresensiMapel', HEADERS_PRESENSI_MAPEL, []);
      return jsonResponse({ status: 'ok' });
    }

    if (action === 'savePengaturan') {
      var settingsPayload = (data && data.settings && typeof data.settings === 'object') ? data.settings : data;
      var settingsAccounts = extractAccountsList(data, settingsPayload);
      saveSettingsRows(settingsPayload, settingsAccounts);
      if (settingsAccounts && settingsAccounts.length > 0) {
        replaceSheetRows('Akun', HEADERS_AKUN, mapAccountsToRows(settingsAccounts));
      }
      return jsonResponse({ status: 'ok' });
    }

    if (action === 'syncAkun') {
      var akunPayload = Array.isArray(data.accounts)
        ? data.accounts
        : (Array.isArray(data.akun) ? data.akun : []);
      var akunRows = mapAccountsToRows(akunPayload);
      replaceSheetRows('Akun', HEADERS_AKUN, akunRows);
      syncAccountsIntoPengaturanSheet(akunPayload);
      return jsonResponse({ status: 'ok', count: akunRows.length });
    }

    if (action === 'upsertAkun') {
      var accObj = (data && data.account && typeof data.account === 'object') ? data.account : data;
      var accRows = mapAccountsToRows([accObj]);
      if (accRows.length > 0) {
        upsertRowById('Akun', HEADERS_AKUN, String(accObj.id || ''), accRows[0]);
      }
      syncAccountsIntoPengaturanSheet(readSheetAsObjects('Akun'));
      return jsonResponse({ status: 'ok' });
    }

    if (action === 'deleteAkun') {
      deleteRowById('Akun', HEADERS_AKUN, String(data.id || ''));
      syncAccountsIntoPengaturanSheet(readSheetAsObjects('Akun'));
      return jsonResponse({ status: 'ok' });
    }

    if (action === 'upsertMasterMapel') {
      var subj = (data && data.subject && typeof data.subject === 'object') ? data.subject : data;
      upsertRowById('MasterMapel', HEADERS_MASTER_MAPEL, String(subj.id || ''), [
        String(subj.id || ''),
        String(subj.kode || ''),
        String(subj.nama || ''),
        String(subj.deskripsi || '')
      ]);
      return jsonResponse({ status: 'ok' });
    }

    if (action === 'deleteMasterMapel') {
      deleteRowById('MasterMapel', HEADERS_MASTER_MAPEL, String(data.id || ''));
      return jsonResponse({ status: 'ok' });
    }

    if (action === 'upsertJadwalGuru') {
      var sch = (data && data.schedule && typeof data.schedule === 'object') ? data.schedule : data;
      upsertRowById('JadwalGuru', HEADERS_JADWAL_GURU, String(sch.id || ''), [
        String(sch.id || ''),
        String(sch.hari || 'Senin'),
        String(sch.teacher_user_id || ''),
        String(sch.teacher_name || ''),
        String(sch.kelas || ''),
        String(sch.mata_pelajaran || ''),
        String(sch.jam_mulai || ''),
        String(sch.jam_selesai || ''),
        String(sch.tahun_ajaran || ''),
        String(sch.semester || 'ganjil')
      ]);
      return jsonResponse({ status: 'ok' });
    }

    if (action === 'deleteJadwalGuru') {
      deleteRowById('JadwalGuru', HEADERS_JADWAL_GURU, String(data.id || ''));
      return jsonResponse({ status: 'ok' });
    }

    if (action === 'upsertMapelKelas') {
      var asg = (data && data.assignment && typeof data.assignment === 'object') ? data.assignment : data;
      upsertRowById('MapelKelas', HEADERS_MAPEL_KELAS, String(asg.id || ''), [
        String(asg.id || ''),
        String(asg.teacher_user_id || ''),
        String(asg.teacher_name || ''),
        String(asg.kelas || ''),
        String(asg.mata_pelajaran || ''),
        String(asg.hari || ''),
        String(asg.jam_mulai || ''),
        String(asg.jam_selesai || ''),
        String(asg.tahun_ajaran || ''),
        String(asg.semester || 'ganjil'),
        String(asg.source || 'manual')
      ]);
      return jsonResponse({ status: 'ok' });
    }

    if (action === 'deleteMapelKelas') {
      deleteRowById('MapelKelas', HEADERS_MAPEL_KELAS, String(data.id || ''));
      return jsonResponse({ status: 'ok' });
    }

    if (action === 'recordPresensiMapel') {
      var sRec = (data && data.record && typeof data.record === 'object') ? data.record : data;
      upsertRowById('PresensiMapel', HEADERS_PRESENSI_MAPEL, String(sRec.id || ''), mapSubjectRecordToRow(sRec));
      return jsonResponse({ status: 'ok' });
    }

    if (action === 'bulkRecordPresensiMapel' && Array.isArray(data.records)) {
      for (var sr = 0; sr < data.records.length; sr++) {
        var itemRec = data.records[sr];
        if (!itemRec || typeof itemRec !== 'object') continue;
        upsertRowById('PresensiMapel', HEADERS_PRESENSI_MAPEL, String(itemRec.id || ''), mapSubjectRecordToRow(itemRec));
      }
      return jsonResponse({ status: 'ok' });
    }

    if (action === 'syncAll') {
      var sRows = [];
      if (Array.isArray(data.students)) {
        for (var si = 0; si < data.students.length; si++) {
          var st = data.students[si];
          if (!st || typeof st !== 'object') continue;
          sRows.push([String(st.nis || ''), String(st.nama || ''), String(st.kelas || ''), String(st.gender || 'L'), String(st.no_wa_ortu || ''), String(st.tahun_ajaran || '')]);
        }
      }
      replaceSheetRows('Siswa', HEADERS_SISWA, sRows);

      var pRows = [];
      if (Array.isArray(data.records)) {
        for (var pi = 0; pi < data.records.length; pi++) {
          var r = data.records[pi];
          if (!r || typeof r !== 'object') continue;
          pRows.push([
            String(r.id || ''),
            String(r.tanggal || ''),
            String(r.nis || ''),
            String(r.nama || ''),
            String(r.kelas || ''),
            String(r.jam_masuk || '-'),
            String(r.jam_pulang || '-'),
            String(r.status || 'Hadir'),
            String(r.keterangan || ''),
            String(r.tahun_ajaran || ''),
            String(r.alasan_pulang_cepat || '')
          ]);
        }
      }
      replaceSheetRows('Presensi', HEADERS_PRESENSI, pRows);

      var syncAllAkun = Array.isArray(data.accounts)
        ? data.accounts
        : (Array.isArray(data.akun) ? data.akun : null);
      if (syncAllAkun) {
        replaceSheetRows('Akun', HEADERS_AKUN, mapAccountsToRows(syncAllAkun));
      }

      if (data.settings) {
        saveSettingsRows(data.settings, syncAllAkun);
      } else if (syncAllAkun) {
        syncAccountsIntoPengaturanSheet(syncAllAkun);
      }

      if (Array.isArray(data.masterSubjects)) {
        var mRows = [];
        for (var mi = 0; mi < data.masterSubjects.length; mi++) {
          var ms = data.masterSubjects[mi];
          if (!ms || typeof ms !== 'object') continue;
          mRows.push([String(ms.id || ''), String(ms.kode || ''), String(ms.nama || ''), String(ms.deskripsi || '')]);
        }
        replaceSheetRows('MasterMapel', HEADERS_MASTER_MAPEL, mRows);
      }

      if (Array.isArray(data.teacherSchedules)) {
        var jRows = [];
        for (var ji = 0; ji < data.teacherSchedules.length; ji++) {
          var js = data.teacherSchedules[ji];
          if (!js || typeof js !== 'object') continue;
          jRows.push([
            String(js.id || ''),
            String(js.hari || 'Senin'),
            String(js.teacher_user_id || ''),
            String(js.teacher_name || ''),
            String(js.kelas || ''),
            String(js.mata_pelajaran || ''),
            String(js.jam_mulai || ''),
            String(js.jam_selesai || ''),
            String(js.tahun_ajaran || ''),
            String(js.semester || 'ganjil')
          ]);
        }
        replaceSheetRows('JadwalGuru', HEADERS_JADWAL_GURU, jRows);
      }

      if (Array.isArray(data.subjectAssignments)) {
        var aRows = [];
        for (var ai = 0; ai < data.subjectAssignments.length; ai++) {
          var asItem = data.subjectAssignments[ai];
          if (!asItem || typeof asItem !== 'object') continue;
          aRows.push([
            String(asItem.id || ''),
            String(asItem.teacher_user_id || ''),
            String(asItem.teacher_name || ''),
            String(asItem.kelas || ''),
            String(asItem.mata_pelajaran || ''),
            String(asItem.hari || ''),
            String(asItem.jam_mulai || ''),
            String(asItem.jam_selesai || ''),
            String(asItem.tahun_ajaran || ''),
            String(asItem.semester || 'ganjil'),
            String(asItem.source || 'manual')
          ]);
        }
        replaceSheetRows('MapelKelas', HEADERS_MAPEL_KELAS, aRows);
      }

      if (Array.isArray(data.subjectRecords)) {
        var srRows = [];
        for (var sri = 0; sri < data.subjectRecords.length; sri++) {
          var sItem = data.subjectRecords[sri];
          if (!sItem || typeof sItem !== 'object') continue;
          srRows.push(mapSubjectRecordToRow(sItem));
        }
        replaceSheetRows('PresensiMapel', HEADERS_PRESENSI_MAPEL, srRows);
      }

      return jsonResponse({ status: 'ok' });
    }

    return jsonResponse({ status: 'error', message: 'Action POST tidak dikenal' });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err && err.message ? err.message : String(err) });
  } finally {
    try { lock.releaseLock(); } catch (eLock) {}
  }
}

function mapAccountsToRows(accounts) {
  var rows = [];
  for (var i = 0; i < accounts.length; i++) {
    var a = accounts[i];
    if (!a || typeof a !== 'object') continue;
    rows.push([
      String(a.id || ''),
      String(a.username || ''),
      String(a.password || ''),
      String(a.nama || ''),
      String(a.nip || ''),
      String(a.role || 'guru'),
      String(a.jabatan || ''),
      String(a.kelas_binaan || ''),
      String(a.foto_profil || '')
    ]);
  }
  return rows;
}

function mapSubjectRecordToRow(r) {
  return [
    String(r.id || ''),
    String(r.assignment_id || ''),
    String(r.tanggal || ''),
    String(r.kelas || ''),
    String(r.mata_pelajaran || ''),
    String(r.teacher_user_id || ''),
    String(r.teacher_name || ''),
    String(r.nis || ''),
    String(r.nama || ''),
    String(r.jam_masuk || '-'),
    String(r.status || 'Hadir'),
    String(r.keterangan || ''),
    String(r.tahun_ajaran || '')
  ];
}

function parseAccountsJsonSafe(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function extractAccountsList(rootData, settingsData) {
  if (rootData && Array.isArray(rootData.accounts)) return rootData.accounts;
  if (rootData && Array.isArray(rootData.akun)) return rootData.akun;
  if (settingsData && Array.isArray(settingsData.accounts)) return settingsData.accounts;
  if (settingsData && Array.isArray(settingsData.akun)) return settingsData.akun;
  if (settingsData && settingsData.akun_akses) {
    var fromSetting = parseAccountsJsonSafe(settingsData.akun_akses);
    if (fromSetting.length > 0) return fromSetting;
  }
  if (rootData && rootData.akun_akses) {
    var fromRoot = parseAccountsJsonSafe(rootData.akun_akses);
    if (fromRoot.length > 0) return fromRoot;
  }
  return null;
}

function formatAccountsSummary(accounts) {
  if (!Array.isArray(accounts) || accounts.length === 0) return '';
  var parts = [];
  for (var i = 0; i < accounts.length; i++) {
    var a = accounts[i];
    if (!a || typeof a !== 'object') continue;
    var uname = String(a.username || '').trim();
    var roleLabel = String(a.jabatan || a.role || '').trim();
    if (uname) {
      parts.push(roleLabel ? (uname + ' (' + roleLabel + ')') : uname);
    }
  }
  return parts.join(' | ');
}

function syncAccountsIntoPengaturanSheet(accounts) {
  var list = Array.isArray(accounts) ? accounts : [];
  var shSet = getOrCreateSheet('Pengaturan', ['key', 'value']);
  var values = shSet.getDataRange().getDisplayValues();
  var keyRowMap = {};
  for (var i = 1; i < values.length; i++) {
    var k = String(values[i][0] || '').trim();
    if (k) keyRowMap[k] = i + 1;
  }
  var updates = [
    ['jumlah_akun', String(list.length)],
    ['daftar_akun', formatAccountsSummary(list)],
    ['akun_akses', JSON.stringify(list)]
  ];
  for (var u = 0; u < updates.length; u++) {
    var key = updates[u][0];
    var val = updates[u][1];
    if (keyRowMap[key]) {
      var rng = shSet.getRange(keyRowMap[key], 1, 1, 2);
      rng.setNumberFormat('@');
      rng.setValues([[key, val]]);
    } else {
      appendRowAsText(shSet, [key, val]);
    }
  }
}

function safeCellText(val, fallback) {
  var str = val !== undefined && val !== null ? String(val) : (fallback || '');
  if (str.length > 49000) {
    return fallback || '';
  }
  return str;
}

function saveSettingsRows(data, accountsOverride) {
  if (!data || typeof data !== 'object') return;
  var shSet = getOrCreateSheet('Pengaturan', ['key', 'value']);
  var existingSettings = readPengaturan();
  var accountsList = Array.isArray(accountsOverride)
    ? accountsOverride
    : extractAccountsList(null, data);
  if (!accountsList) {
    var sheetAkun = readSheetAsObjects('Akun');
    if (sheetAkun.length > 0) {
      accountsList = sheetAkun;
    } else if (existingSettings.akun_akses) {
      accountsList = parseAccountsJsonSafe(existingSettings.akun_akses);
    } else {
      accountsList = [];
    }
  }
  shSet.clear();
  var rows = [
    ['key', 'value'],
    ['nama_sekolah', safeCellText(data.nama_sekolah, 'SMA Negeri 1 Kabun')],
    ['nama_kepala_sekolah', safeCellText(data.nama_kepala_sekolah, '')],
    ['nip_kepala_sekolah', safeCellText(data.nip_kepala_sekolah, '')],
    ['ttd_kepala_sekolah', safeCellText(data.ttd_kepala_sekolah, '')],
    ['cap_sekolah', safeCellText(data.cap_sekolah, '')],
    ['batas_jam_masuk', safeCellText(data.batas_jam_masuk, '07:15')],
    ['mode_presensi', safeCellText(data.mode_presensi, 'masuk_saja')],
    ['jam_pulang_standar', safeCellText(data.jam_pulang_standar, '15:00')],
    ['tahun_ajaran', safeCellText(data.tahun_ajaran, '2026/2027')],
    ['semester', safeCellText(data.semester, 'ganjil')],
    ['tema', safeCellText(data.tema, 'indigo')],
    ['logo_sekolah', safeCellText(data.logo_sekolah, '')],
    ['jumlah_akun', String(accountsList.length)],
    ['daftar_akun', safeCellText(formatAccountsSummary(accountsList), '')],
    ['akun_akses', safeCellText(JSON.stringify(accountsList), '[]')]
  ];
  var range = shSet.getRange(1, 1, rows.length, 2);
  range.setNumberFormat('@');
  range.setValues(rows);
}

function getOrCreateSheet(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    var hdrRange = sh.getRange(1, 1, 1, headers.length);
    hdrRange.setNumberFormat('@');
    hdrRange.setValues([headers]);
  }
  return sh;
}

function appendMissingHeaders(sh, requiredHeaders) {
  if (sh.getLastRow() === 0 || sh.getLastColumn() === 0) {
    var hdrRange = sh.getRange(1, 1, 1, requiredHeaders.length);
    hdrRange.setNumberFormat('@');
    hdrRange.setValues([requiredHeaders]);
    return requiredHeaders.slice();
  }
  var existing = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  var normalized = [];
  var existingSet = {};
  for (var i = 0; i < existing.length; i++) {
    var h = String(existing[i] || '').trim();
    normalized.push(h);
    if (h) existingSet[h.toLowerCase()] = true;
  }
  var toAppend = [];
  for (var j = 0; j < requiredHeaders.length; j++) {
    var req = String(requiredHeaders[j] || '').trim();
    if (req && !existingSet[req.toLowerCase()]) {
      toAppend.push(req);
      normalized.push(req);
      existingSet[req.toLowerCase()] = true;
    }
  }
  if (toAppend.length > 0) {
    var startCol = existing.length + 1;
    var appendRange = sh.getRange(1, startCol, 1, toAppend.length);
    appendRange.setNumberFormat('@');
    appendRange.setValues([toAppend]);
  }
  return normalized;
}

function findHeaderIndex(headers, aliases, fallbackIdx) {
  for (var a = 0; a < aliases.length; a++) {
    var target = String(aliases[a]).toLowerCase();
    for (var i = 0; i < headers.length; i++) {
      if (String(headers[i] || '').trim().toLowerCase() === target) {
        return i;
      }
    }
  }
  return fallbackIdx;
}

function mapObjectToHeaders(headers, valuesMap) {
  var row = [];
  for (var i = 0; i < headers.length; i++) {
    var key = String(headers[i] || '').trim().toLowerCase();
    row.push(valuesMap[key] !== undefined ? String(valuesMap[key]) : '');
  }
  return row;
}

function ensureHeaders(sh, headers) {
  return appendMissingHeaders(sh, headers);
}

function appendRowAsText(sh, rowValues) {
  var nextRow = Math.max(2, sh.getLastRow() + 1);
  var rng = sh.getRange(nextRow, 1, 1, rowValues.length);
  rng.setNumberFormat('@');
  rng.setValues([rowValues]);
}

function replaceSheetRows(name, headers, rows) {
  var sh = getOrCreateSheet(name, headers);
  sh.clear();
  var allRows = [headers].concat(rows || []);
  var rng = sh.getRange(1, 1, allRows.length, headers.length);
  rng.setNumberFormat('@');
  rng.setValues(allRows);
}

function upsertRowById(name, headers, idValue, rowValues) {
  if (!idValue) return;
  var sh = getOrCreateSheet(name, headers);
  ensureHeaders(sh, headers);
  var values = sh.getDataRange().getDisplayValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(idValue)) {
      var rng = sh.getRange(i + 1, 1, 1, headers.length);
      rng.setNumberFormat('@');
      rng.setValues([rowValues]);
      return;
    }
  }
  appendRowAsText(sh, rowValues);
}

function deleteRowById(name, headers, idValue) {
  if (!idValue) return;
  var sh = getOrCreateSheet(name, headers);
  var values = sh.getDataRange().getDisplayValues();
  for (var i = values.length - 1; i >= 1; i--) {
    if (String(values[i][0]) === String(idValue)) {
      sh.deleteRow(i + 1);
      return;
    }
  }
}

function readSheetAsObjects(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) return [];
  var values = sh.getDataRange().getDisplayValues();
  if (!values || values.length < 2) return [];
  var headers = values[0];
  var list = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (!row) continue;
    var hasValue = false;
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      var key = String(headers[c] || '').trim();
      if (!key) continue;
      var val = row[c] !== undefined && row[c] !== null ? String(row[c]).trim() : '';
      if (val) hasValue = true;
      obj[key] = val;
    }
    if (hasValue) {
      list.push(obj);
    }
  }
  return list;
}

function readPengaturan() {
  var rows = readSheetAsObjects('Pengaturan');
  var out = {};
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var k = row.key || row.Key || row.KEY || '';
    var v = row.value !== undefined ? row.value : (row.Value !== undefined ? row.Value : row.VALUE);
    var normKey = String(k || '').trim().toLowerCase().replace(/[\\s-]+/g, '_');
    if (normKey) out[normKey] = v !== undefined && v !== null ? String(v) : '';
  }
  return out;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}`;
