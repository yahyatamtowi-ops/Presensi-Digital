import type {
  AttendanceRecord,
  DefaultSchoolIdentity,
  SchoolSettings,
  Student,
} from '../types';
import {
  DEFAULT_ACADEMIC_YEAR,
  SEED_SETTINGS,
  SEED_STUDENTS,
  generateSeedRecords,
} from './seedData';
import { normalizeScheduleMode, normalizeTimeHHMM } from './attendanceLogic';
import { normalizeSemester } from './subjectAttendance';
import { normalizeThemeId } from './themes';

/**
 * Isi konstanta DEFAULT_SCRIPT_URL dengan Web App URL dari Google Apps Script
 * agar aplikasi langsung terhubung ke Google Sheets secara default.
 */
export const DEFAULT_SCRIPT_URL = '';

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
  | 'syncAll';

export interface PendingSyncItem {
  id: string;
  action: GasAction;
  payload: Record<string, unknown>;
  createdAt: string;
}

export function loadDefaultSchoolIdentity(): DefaultSchoolIdentity {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.DEFAULT_IDENTITY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DefaultSchoolIdentity>;
      return {
        nama_sekolah: parsed.nama_sekolah?.trim() || SEED_SETTINGS.nama_sekolah,
        logo_sekolah: parsed.logo_sekolah || '',
      };
    }

    // Seed default identity from any existing saved settings (v2 or v1)
    const rawCurrent =
      localStorage.getItem(STORAGE_KEYS.SETTINGS) ||
      localStorage.getItem(STORAGE_KEYS.LEGACY_SETTINGS_V1);
    if (rawCurrent) {
      const parsedCurrent = JSON.parse(rawCurrent) as Partial<SchoolSettings>;
      const derived: DefaultSchoolIdentity = {
        nama_sekolah: parsedCurrent.nama_sekolah?.trim() || SEED_SETTINGS.nama_sekolah,
        logo_sekolah: parsedCurrent.logo_sekolah || '',
      };
      localStorage.setItem(STORAGE_KEYS.DEFAULT_IDENTITY, JSON.stringify(derived));
      return derived;
    }
  } catch {
    // Fallback below
  }

  return {
    nama_sekolah: SEED_SETTINGS.nama_sekolah,
    logo_sekolah: SEED_SETTINGS.logo_sekolah || '',
  };
}

export function saveDefaultSchoolIdentity(
  identity: DefaultSchoolIdentity
): DefaultSchoolIdentity {
  const normalized: DefaultSchoolIdentity = {
    nama_sekolah: identity.nama_sekolah.trim() || SEED_SETTINGS.nama_sekolah,
    logo_sekolah: identity.logo_sekolah || '',
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
      nama_sekolah: defaultIdentity.nama_sekolah || SEED_SETTINGS.nama_sekolah,
      logo_sekolah: defaultIdentity.logo_sekolah || '',
      script_url: DEFAULT_SCRIPT_URL,
    };

    const parsedSettings: SchoolSettings = rawSettings
      ? { ...baseDefaults, ...JSON.parse(rawSettings) }
      : legacySettings
        ? {
            ...baseDefaults,
            nama_sekolah: legacySettings.nama_sekolah || baseDefaults.nama_sekolah,
            logo_sekolah: legacySettings.logo_sekolah || baseDefaults.logo_sekolah,
            script_url: legacySettings.script_url || baseDefaults.script_url,
          }
        : baseDefaults;

    if (!parsedSettings.nama_sekolah?.trim()) {
      parsedSettings.nama_sekolah = defaultIdentity.nama_sekolah;
    }
    if (!parsedSettings.logo_sekolah && defaultIdentity.logo_sekolah) {
      parsedSettings.logo_sekolah = defaultIdentity.logo_sekolah;
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

    // Default state starts genuinely empty before user inputs/imports data
    const students: Student[] = rawStudents
      ? sanitizeStudents(JSON.parse(rawStudents))
      : [];
    const records: AttendanceRecord[] = rawRecords
      ? sanitizeRecords(JSON.parse(rawRecords))
      : [];

    if (!rawStudents) {
      localStorage.setItem(STORAGE_KEYS.STUDENTS, JSON.stringify(students));
    }
    if (!rawRecords) {
      localStorage.setItem(STORAGE_KEYS.RECORDS, JSON.stringify(records));
    }
    if (!rawSettings) {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(parsedSettings));
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
  try {
    localStorage.setItem(STORAGE_KEYS.STUDENTS, JSON.stringify(students));
  } catch {
    // Ignore storage quota errors
  }
}

export function saveLocalRecords(records: AttendanceRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.RECORDS, JSON.stringify(records));
  } catch {
    // Ignore storage quota errors
  }
}

export function saveLocalSettings(
  settings: SchoolSettings
): { ok: boolean; error?: string } {
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
      return {
        ok: false,
        error:
          'Penyimpanan lokal browser penuh. Gunakan gambar logo/TTD/cap berukuran lebih kecil agar dapat tersimpan.',
      };
    }
  }
}

export function resetLocalDemoData(preserveSettings: SchoolSettings): LocalCacheState {
  const defaultIdentity = loadDefaultSchoolIdentity();
  const preservedName =
    preserveSettings.nama_sekolah?.trim() || defaultIdentity.nama_sekolah;
  const preservedLogo =
    preserveSettings.logo_sekolah || defaultIdentity.logo_sekolah || '';

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
    // Ignore storage quota errors
  }
}

export function enqueueSyncMutation(
  action: GasAction,
  payload: Record<string, unknown>
): PendingSyncItem[] {
  const current = loadSyncQueue();
  const safePayload =
    payload && typeof payload === 'object' ? payload : {};
  // Replace previous queued savePengaturan/syncAll entries to avoid storing duplicate base64 images
  const filtered =
    action === 'savePengaturan'
      ? current.filter((item) => item.action !== 'savePengaturan')
      : current;
  const item: PendingSyncItem = {
    id: `sync_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    action,
    payload: safePayload,
    createdAt: new Date().toISOString(),
  };
  const next = [...filtered, item];
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
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const nis = getFieldCaseInsensitive(obj, ['nis']);
    const nama = getFieldCaseInsensitive(obj, ['nama', 'nama_siswa']);
    if (!nis && !nama) continue;
    const kelas = getFieldCaseInsensitive(obj, ['kelas']);
    const genderRaw = getFieldCaseInsensitive(obj, ['gender', 'jenis_kelamin', 'l_p']);
    const gender: 'L' | 'P' = /^p/i.test(genderRaw) ? 'P' : 'L';
    const no_wa_ortu = getFieldCaseInsensitive(obj, ['no_wa_ortu', 'wa_ortu', 'no_wa']);
    const tahun_ajaran = getFieldCaseInsensitive(obj, ['tahun_ajaran']);

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

export function sanitizeRecords(rawList: unknown): AttendanceRecord[] {
  if (!Array.isArray(rawList)) return [];
  const validStatuses = new Set(['Hadir', 'Terlambat', 'Sakit', 'Izin', 'Alpa']);
  const out: AttendanceRecord[] = [];
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
    const status = (validStatuses.has(rawStatus) ? rawStatus : 'Hadir') as AttendanceRecord['status'];
    const keterangan = getFieldCaseInsensitive(obj, ['keterangan']);
    let alasan_pulang_cepat = getFieldCaseInsensitive(obj, [
      'alasan_pulang_cepat',
      'alasan pulang cepat',
    ]);
    if (!alasan_pulang_cepat && keterangan) {
      const match = keterangan.match(/Pulang cepat\s+[0-9:]+\s*\(Alasan:\s*([^)]+)\)/i);
      if (match && match[1]) {
        alasan_pulang_cepat = match[1].trim();
      }
    }
    const tahun_ajaran = getFieldCaseInsensitive(obj, ['tahun_ajaran']);

    out.push({
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
  message?: string;
}

export async function fetchAllFromGas(scriptUrl: string): Promise<{
  students: Student[];
  records: AttendanceRecord[];
  settings: Partial<SchoolSettings>;
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

  const students = sanitizeStudents(rawStudents);
  const records = sanitizeRecords(rawRecords);
  const settings = data.settings ?? data.pengaturan ?? {};

  return { students, records, settings };
}

function prepareGasPayload(
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

  if (action === 'syncAll') {
    return {
      ...safePayload,
      students: sanitizeStudents(safePayload.students),
      records: sanitizeRecords(safePayload.records),
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
      await fetchAllFromGas(trimmed);
      return { status: 'ok', message: 'Tersinkron ke Google Sheets.' };
    }

    throw err;
  }
}

export async function flushSyncQueue(
  scriptUrl: string
): Promise<{ flushed: number; remaining: number; lastError?: string }> {
  const trimmed = scriptUrl.trim();
  const queue = loadSyncQueue();
  if (!trimmed || queue.length === 0) {
    return { flushed: 0, remaining: queue.length };
  }

  let flushed = 0;
  const failedItems: PendingSyncItem[] = [];
  let lastError: string | undefined;

  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    if (!item || !item.action || !item.payload || typeof item.payload !== 'object') {
      continue;
    }
    try {
      await postToGas(trimmed, item.action, item.payload);
      flushed++;
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Gagal mengirim antrean.';
      failedItems.push(item);
      // If network/offline error, keep remaining items in order and stop trying
      const isNetworkErr =
        err instanceof TypeError ||
        (err instanceof Error &&
          /failed to fetch|networkerror|load failed|timeout/i.test(err.message));
      if (isNetworkErr) {
        failedItems.push(...queue.slice(i + 1));
        break;
      }
    }
  }

  saveSyncQueue(failedItems);
  return { flushed, remaining: failedItems.length, lastError };
}

export const GOOGLE_APPS_SCRIPT_TEMPLATE = `// Salin kode ini ke Google Apps Script (Extensions > Apps Script) di Google Sheet Anda.
// Buat 3 sheet bernama: "Siswa", "Presensi", dan "Pengaturan" (atau otomatis dibuat saat sync).
// Deploy sebagai Web App: Execute as "Me", Who has access "Anyone".

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || 'getAll';
    if (action === 'getAll') {
      return jsonResponse({
        status: 'ok',
        siswa: readSheetAsObjects('Siswa'),
        presensi: readSheetAsObjects('Presensi'),
        pengaturan: readPengaturan()
      });
    }
    return jsonResponse({ status: 'error', message: 'Action tidak dikenal' });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err && err.message ? err.message : String(err) });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ status: 'error', message: 'Payload POST kosong' });
    }
    var data = JSON.parse(e.postData.contents);
    var action = data.action;

    if (action === 'addSiswa') {
      var sh = getOrCreateSheet('Siswa', ['nis', 'nama', 'kelas', 'gender', 'no_wa_ortu', 'tahun_ajaran']);
      sh.appendRow([data.nis || '', data.nama || '', data.kelas || '', data.gender || 'L', data.no_wa_ortu || '', data.tahun_ajaran || '']);
      return jsonResponse({ status: 'ok' });
    }

    if (action === 'bulkAddSiswa' && Array.isArray(data.students)) {
      var shB = getOrCreateSheet('Siswa', ['nis', 'nama', 'kelas', 'gender', 'no_wa_ortu', 'tahun_ajaran']);
      var rowsToAdd = [];
      for (var bi = 0; bi < data.students.length; bi++) {
        var bs = data.students[bi];
        if (!bs || typeof bs !== 'object') continue;
        rowsToAdd.push([bs.nis || '', bs.nama || '', bs.kelas || '', bs.gender || 'L', bs.no_wa_ortu || '', bs.tahun_ajaran || '']);
      }
      if (rowsToAdd.length > 0) {
        shB.getRange(shB.getLastRow() + 1, 1, rowsToAdd.length, 6).setValues(rowsToAdd);
      }
      return jsonResponse({ status: 'ok' });
    }

    if (action === 'updateSiswa') {
      var shU = getOrCreateSheet('Siswa', ['nis', 'nama', 'kelas', 'gender', 'no_wa_ortu', 'tahun_ajaran']);
      var rowsU = shU.getDataRange().getDisplayValues();
      var targetNis = data.originalNis || data.nis || '';
      for (var i = 1; i < rowsU.length; i++) {
        if (String(rowsU[i][0]) === String(targetNis)) {
          shU.getRange(i + 1, 1, 1, 6).setValues([[data.nis || '', data.nama || '', data.kelas || '', data.gender || 'L', data.no_wa_ortu || '', data.tahun_ajaran || '']]);
          return jsonResponse({ status: 'ok' });
        }
      }
      shU.appendRow([data.nis || '', data.nama || '', data.kelas || '', data.gender || 'L', data.no_wa_ortu || '', data.tahun_ajaran || '']);
      return jsonResponse({ status: 'ok' });
    }

    if (action === 'deleteSiswa') {
      var shD = getOrCreateSheet('Siswa', ['nis', 'nama', 'kelas', 'gender', 'no_wa_ortu', 'tahun_ajaran']);
      var rowsD = shD.getDataRange().getDisplayValues();
      for (var j = rowsD.length - 1; j >= 1; j--) {
        if (String(rowsD[j][0]) === String(data.nis || '')) {
          shD.deleteRow(j + 1);
          return jsonResponse({ status: 'ok' });
        }
      }
      return jsonResponse({ status: 'ok' });
    }

    if (action === 'bulkDeleteSiswa' && Array.isArray(data.nisList)) {
      var shBD = getOrCreateSheet('Siswa', ['nis', 'nama', 'kelas', 'gender', 'no_wa_ortu', 'tahun_ajaran']);
      var rowsBD = shBD.getDataRange().getDisplayValues();
      var nisMap = {};
      for (var x = 0; x < data.nisList.length; x++) {
        nisMap[String(data.nisList[x])] = true;
      }
      for (var d = rowsBD.length - 1; d >= 1; d--) {
        if (nisMap[String(rowsBD[d][0])]) {
          shBD.deleteRow(d + 1);
        }
      }
      return jsonResponse({ status: 'ok' });
    }

    if (action === 'recordPresensi') {
      var recP = (data && data.record && typeof data.record === 'object') ? data.record : data;
      var tglP = String((recP && recP.tanggal) || data.tanggal || '');
      var nisP = String((recP && recP.nis) || data.nis || '');
      if (!tglP || !nisP) {
        return jsonResponse({ status: 'error', message: 'Data presensi (tanggal/nis) tidak lengkap' });
      }
      var shP = getOrCreateSheet('Presensi', ['id', 'tanggal', 'nis', 'nama', 'kelas', 'jam_masuk', 'jam_pulang', 'status', 'keterangan', 'tahun_ajaran']);
      var rowsP = shP.getDataRange().getDisplayValues();
      for (var p = 1; p < rowsP.length; p++) {
        if (String(rowsP[p][1]) === tglP && String(rowsP[p][2]) === nisP) {
          shP.getRange(p + 1, 7).setValue(recP.jam_pulang || '-');
          shP.getRange(p + 1, 8).setValue(recP.status || 'Hadir');
          if (recP.keterangan !== undefined) shP.getRange(p + 1, 9).setValue(recP.keterangan);
          return jsonResponse({ status: 'ok' });
        }
      }
      shP.appendRow([recP.id || (tglP + '_' + nisP), tglP, nisP, recP.nama || '', recP.kelas || '', recP.jam_masuk || '-', recP.jam_pulang || '-', recP.status || 'Hadir', recP.keterangan || '', recP.tahun_ajaran || '']);
      return jsonResponse({ status: 'ok' });
    }

    if (action === 'updateStatusPresensi') {
      var recS = (data && data.record && typeof data.record === 'object') ? data.record : data;
      var tglS = String((recS && recS.tanggal) || data.tanggal || '');
      var nisS = String((recS && recS.nis) || data.nis || '');
      if (!tglS || !nisS) {
        return jsonResponse({ status: 'error', message: 'Data status presensi (tanggal/nis) tidak lengkap' });
      }
      var shS = getOrCreateSheet('Presensi', ['id', 'tanggal', 'nis', 'nama', 'kelas', 'jam_masuk', 'jam_pulang', 'status', 'keterangan', 'tahun_ajaran']);
      var rowsS = shS.getDataRange().getDisplayValues();
      for (var k = 1; k < rowsS.length; k++) {
        if (String(rowsS[k][1]) === tglS && String(rowsS[k][2]) === nisS) {
          shS.getRange(k + 1, 8).setValue(recS.status || 'Hadir');
          if (recS.keterangan !== undefined) shS.getRange(k + 1, 9).setValue(recS.keterangan);
          return jsonResponse({ status: 'ok' });
        }
      }
      shS.appendRow([recS.id || (tglS + '_' + nisS), tglS, nisS, recS.nama || '', recS.kelas || '', recS.jam_masuk || '-', recS.jam_pulang || '-', recS.status || 'Hadir', recS.keterangan || '', recS.tahun_ajaran || '']);
      return jsonResponse({ status: 'ok' });
    }

    if (action === 'resetPresensi') {
      var shR = getOrCreateSheet('Presensi', ['id', 'tanggal', 'nis', 'nama', 'kelas', 'jam_masuk', 'jam_pulang', 'status', 'keterangan', 'tahun_ajaran']);
      shR.clear();
      shR.appendRow(['id', 'tanggal', 'nis', 'nama', 'kelas', 'jam_masuk', 'jam_pulang', 'status', 'keterangan', 'tahun_ajaran']);
      return jsonResponse({ status: 'ok' });
    }

    if (action === 'savePengaturan') {
      saveSettingsRows((data && data.settings && typeof data.settings === 'object') ? data.settings : data);
      return jsonResponse({ status: 'ok' });
    }

    if (action === 'syncAll') {
      var shAllS = getOrCreateSheet('Siswa', ['nis', 'nama', 'kelas', 'gender', 'no_wa_ortu', 'tahun_ajaran']);
      shAllS.clear();
      shAllS.appendRow(['nis', 'nama', 'kelas', 'gender', 'no_wa_ortu', 'tahun_ajaran']);
      if (Array.isArray(data.students) && data.students.length > 0) {
        var sRows = [];
        for (var si = 0; si < data.students.length; si++) {
          var st = data.students[si];
          if (!st || typeof st !== 'object') continue;
          sRows.push([st.nis || '', st.nama || '', st.kelas || '', st.gender || 'L', st.no_wa_ortu || '', st.tahun_ajaran || '']);
        }
        if (sRows.length > 0) {
          shAllS.getRange(2, 1, sRows.length, 6).setValues(sRows);
        }
      }

      var shAllP = getOrCreateSheet('Presensi', ['id', 'tanggal', 'nis', 'nama', 'kelas', 'jam_masuk', 'jam_pulang', 'status', 'keterangan', 'tahun_ajaran']);
      shAllP.clear();
      shAllP.appendRow(['id', 'tanggal', 'nis', 'nama', 'kelas', 'jam_masuk', 'jam_pulang', 'status', 'keterangan', 'tahun_ajaran']);
      if (Array.isArray(data.records) && data.records.length > 0) {
        var pRows = [];
        for (var pi = 0; pi < data.records.length; pi++) {
          var r = data.records[pi];
          if (!r || typeof r !== 'object') continue;
          pRows.push([r.id || '', r.tanggal || '', r.nis || '', r.nama || '', r.kelas || '', r.jam_masuk || '-', r.jam_pulang || '-', r.status || 'Hadir', r.keterangan || '', r.tahun_ajaran || '']);
        }
        if (pRows.length > 0) {
          shAllP.getRange(2, 1, pRows.length, 10).setValues(pRows);
        }
      }

      if (data.settings) {
        saveSettingsRows(data.settings);
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

function saveSettingsRows(data) {
  if (!data || typeof data !== 'object') return;
  var shSet = getOrCreateSheet('Pengaturan', ['key', 'value']);
  shSet.clear();
  var rows = [
    ['key', 'value'],
    ['nama_sekolah', String(data.nama_sekolah || '')],
    ['nama_kepala_sekolah', String(data.nama_kepala_sekolah || '')],
    ['nip_kepala_sekolah', String(data.nip_kepala_sekolah || '')],
    ['ttd_kepala_sekolah', String(data.ttd_kepala_sekolah || '')],
    ['cap_sekolah', String(data.cap_sekolah || '')],
    ['batas_jam_masuk', String(data.batas_jam_masuk || '07:15')],
    ['mode_presensi', String(data.mode_presensi || 'masuk_saja')],
    ['jam_pulang_standar', String(data.jam_pulang_standar || '15:00')],
    ['tahun_ajaran', String(data.tahun_ajaran || '2026/2027')],
    ['semester', String(data.semester || 'ganjil')],
    ['tema', String(data.tema || 'indigo')],
    ['logo_sekolah', String(data.logo_sekolah || '')]
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
    sh.appendRow(headers);
  }
  return sh;
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
    var k = rows[i].key || rows[i].Key;
    var v = rows[i].value !== undefined ? rows[i].value : rows[i].Value;
    if (k) out[k] = v || '';
  }
  return out;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}`;
