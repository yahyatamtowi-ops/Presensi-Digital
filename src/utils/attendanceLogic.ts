import type {
  AnalyticsPeriodType,
  AttendanceRecord,
  AttendanceScheduleMode,
  AttendanceStatus,
  RecapPeriodType,
  ScanActionMode,
  SemesterKind,
  Student,
} from '../types';

export function pad2(num: number): string {
  return String(num).padStart(2, '0');
}

export function getTodayDateString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  return `${year}-${month}-${day}`;
}

export function shiftDateString(baseDateStr: string, deltaDays: number): string {
  const [y, m, d] = baseDateStr.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, (d || 1) + deltaDays);
  return getTodayDateString(dt);
}

export function getCurrentTimeString(date: Date = new Date()): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

export function parseTimeToMinutes(timeStr: string): number | null {
  const clean = String(timeStr ?? '').trim().replace(/\./g, ':');
  if (!clean) return null;

  const ampmMatch = clean.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (ampmMatch) {
    let hours = Number(ampmMatch[1]);
    const minutes = Number(ampmMatch[2]);
    const meridiem = ampmMatch[4].toUpperCase();
    if (hours >= 1 && hours <= 12 && minutes >= 0 && minutes <= 59) {
      if (meridiem === 'PM' && hours < 12) hours += 12;
      if (meridiem === 'AM' && hours === 12) hours = 0;
      return hours * 60 + minutes;
    }
    return null;
  }

  const match = clean.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function normalizeAttendanceStatus(raw: unknown): AttendanceStatus | null {
  const normalized = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!normalized) return null;
  if (normalized === 'hadir' || normalized === 'tepat waktu') return 'Hadir';
  if (normalized === 'terlambat' || normalized === 'telat' || normalized === 'late') {
    return 'Terlambat';
  }
  if (normalized === 'sakit') return 'Sakit';
  if (normalized === 'izin' || normalized === 'ijin') return 'Izin';
  if (
    normalized === 'alpa' ||
    normalized === 'alpha' ||
    normalized === 'tanpa keterangan'
  ) {
    return 'Alpa';
  }
  return null;
}

/**
 * Normalizes various time formats (e.g. '7:15', '07:15:00', '3:00 PM', '15.00')
 * into strict 24-hour 'HH:MM' required by HTML <input type="time"> and scan comparisons.
 */
export function normalizeTimeHHMM(raw: unknown, fallback = '07:15'): string {
  const rawText = String(raw ?? '').trim();
  if (!rawText) return fallback;

  // Handle ISO date-time strings returned by Google Sheets / Apps Script (e.g. 1899-12-30T00:30:00.000Z)
  if (rawText.includes('T') && /^\d{4}-\d{2}-\d{2}T/.test(rawText)) {
    const parsed = new Date(rawText);
    if (!Number.isNaN(parsed.getTime())) {
      return `${pad2(parsed.getHours())}:${pad2(parsed.getMinutes())}`;
    }
  }

  const text = rawText.replace(/\./g, ':');

  // Match HH:MM(:SS)? with optional AM/PM
  const ampmMatch = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
  if (ampmMatch) {
    let h = Number(ampmMatch[1]);
    const m = Number(ampmMatch[2]);
    const meridiem = ampmMatch[3].toUpperCase();
    if (h >= 1 && h <= 12 && m >= 0 && m <= 59) {
      if (meridiem === 'PM' && h < 12) h += 12;
      if (meridiem === 'AM' && h === 12) h = 0;
      return `${pad2(h)}:${pad2(m)}`;
    }
  }

  const basicMatch = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (basicMatch) {
    const h = Number(basicMatch[1]);
    const m = Number(basicMatch[2]);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${pad2(h)}:${pad2(m)}`;
    }
  }

  return fallback;
}

/**
 * Produces a canonical comparison key for class names so spacing/punctuation/dot differences
 * (e.g. "XI.D" vs "XI D", "X I.E" vs "XI E", "XII.E" vs "XII E", "Kelas X-IPA-1" vs "X IPA 1")
 * match reliably while keeping distinct classes ("X A", "XI A", "XII A") strictly separate.
 */
export function normalizeClassNameKey(raw?: string | null): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '';
  const withoutPrefix = trimmed.replace(/^kelas\s+/i, '');
  return withoutPrefix.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

export function isSameClassName(a?: string | null, b?: string | null): boolean {
  const keyA = normalizeClassNameKey(a);
  const keyB = normalizeClassNameKey(b);
  return Boolean(keyA && keyB && keyA === keyB);
}

/**
 * Resolves a raw class name to its canonical spelling from a list of known classes
 * (typically sourced from the Student roster) when an equivalent class exists.
 */
export function resolveCanonicalClassName(
  rawClass: string,
  canonicalClasses: string[]
): string {
  const trimmed = String(rawClass ?? '').trim();
  if (!trimmed) return '';
  const targetKey = normalizeClassNameKey(trimmed);
  if (!targetKey) return trimmed;
  const exact = canonicalClasses.find((c) => c.trim() === trimmed);
  if (exact) return exact.trim();
  const matched = canonicalClasses.find(
    (c) => normalizeClassNameKey(c) === targetKey
  );
  return matched ? matched.trim() : trimmed;
}

export function normalizeAcademicYear(raw?: string | null): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '';
  return trimmed
    .replace(/^(?:tahun\s*ajaran|ta\.?)\s*/i, '')
    .replace(/\s*[/\-–—]\s*/g, '/')
    .trim();
}

export function normalizeScheduleMode(
  raw: unknown,
  fallback: AttendanceScheduleMode = 'masuk_saja'
): AttendanceScheduleMode {
  const text = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s&-]+/g, '_');
  if (text === 'masuk_pulang' || text === 'masuk_dan_pulang') {
    return 'masuk_pulang';
  }
  if (text === 'masuk_saja' || text === 'masuk') {
    return 'masuk_saja';
  }
  return fallback;
}

export function determineAttendanceStatus(
  jamMasuk: string,
  batasJamMasuk: string
): 'Hadir' | 'Terlambat' {
  const scanMinutes = parseTimeToMinutes(jamMasuk);
  const cutoffMinutes = parseTimeToMinutes(batasJamMasuk);
  if (scanMinutes === null || cutoffMinutes === null) {
    return 'Hadir';
  }
  return scanMinutes <= cutoffMinutes ? 'Hadir' : 'Terlambat';
}

export const EARLY_CHECKOUT_PRESET_REASONS = [
  'Sakit / Kurang sehat',
  'Keperluan keluarga mendesak',
  'Dijemput orang tua / wali',
  'Izin kegiatan / lomba sekolah',
] as const;

export function isBeforeCheckoutTime(
  nowTime: string,
  jamPulangStandar: string
): boolean {
  const nowMinutes = parseTimeToMinutes(nowTime);
  const checkoutMinutes = parseTimeToMinutes(jamPulangStandar);
  if (nowMinutes === null || checkoutMinutes === null) {
    return false;
  }
  return nowMinutes < checkoutMinutes;
}

export function extractNisFromQrPayload(rawPayload: string): string {
  const trimmed = rawPayload.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed) as { nisn?: unknown; nis?: unknown };
      if (parsed && typeof parsed.nisn === 'string' && parsed.nisn.trim()) {
        return parsed.nisn.trim();
      }
      if (parsed && typeof parsed.nis === 'string' && parsed.nis.trim()) {
        return parsed.nis.trim();
      }
    } catch {
      // Fallback to raw string
    }
  }
  const prefixed = trimmed.match(/^NISN?[:=]\s*(.+)$/i);
  if (prefixed && prefixed[1]) {
    return prefixed[1].trim();
  }
  return trimmed;
}

export function hasScannedOnDate(
  records: AttendanceRecord[],
  nis: string,
  tanggal: string
): AttendanceRecord | undefined {
  const normalizedNis = nis.trim().toLowerCase();
  return records.find(
    (r) =>
      Boolean(r && r.tanggal && r.nis) &&
      r.tanggal === tanggal &&
      r.nis.trim().toLowerCase() === normalizedNis
  );
}

export function resolveItemAcademicYear(
  itemYear?: string,
  fallbackYear = '2026/2027'
): string {
  const normItem = normalizeAcademicYear(itemYear);
  const normFallback = normalizeAcademicYear(fallbackYear) || '2026/2027';
  return normItem || normFallback;
}

/**
 * Filters records or students by Academic Year.
 * Non-master_admin users (guest, wali_kelas, guru) ONLY see items matching activeAcademicYear.
 * Master Admin can view activeAcademicYear, a specific historical year, or 'ALL'.
 * Items without an explicit tahun_ajaran default to activeAcademicYear (unless fallbackYear is explicitly provided).
 */
export function filterByAcademicYear<T extends { tahun_ajaran?: string }>(
  items: T[],
  options: {
    activeAcademicYear: string;
    isMasterAdmin: boolean;
    masterYearFilter?: string; // 'ACTIVE' | 'ALL' | specific year like '2025/2026'
    fallbackYear?: string;
  }
): T[] {
  const {
    activeAcademicYear,
    isMasterAdmin,
    masterYearFilter = 'ACTIVE',
    fallbackYear,
  } = options;

  const normActive = normalizeAcademicYear(activeAcademicYear) || '2026/2027';
  const effectiveFallback =
    normalizeAcademicYear(fallbackYear ?? normActive) || normActive;

  if (isMasterAdmin) {
    if (masterYearFilter === 'ALL') {
      return items;
    }
    const targetYear =
      masterYearFilter === 'ACTIVE'
        ? normActive
        : normalizeAcademicYear(masterYearFilter) || normActive;
    return items.filter(
      (item) =>
        resolveItemAcademicYear(item.tahun_ajaran, effectiveFallback) === targetYear
    );
  }

  return items.filter(
    (item) =>
      resolveItemAcademicYear(item.tahun_ajaran, effectiveFallback) === normActive
  );
}

export function collectAcademicYears(
  students: Array<{ tahun_ajaran?: string }>,
  records: Array<{ tahun_ajaran?: string }>,
  activeAcademicYear: string,
  fallbackYear?: string
): string[] {
  const normActive = normalizeAcademicYear(activeAcademicYear) || '2026/2027';
  const effectiveFallback =
    normalizeAcademicYear(fallbackYear ?? normActive) || normActive;
  const set = new Set<string>([normActive]);
  for (const s of students) {
    set.add(resolveItemAcademicYear(s.tahun_ajaran, effectiveFallback));
  }
  for (const r of records) {
    set.add(resolveItemAcademicYear(r.tahun_ajaran, effectiveFallback));
  }
  return Array.from(set).sort((a, b) => b.localeCompare(a));
}

export type ScanOutcome =
  | {
      ok: true;
      scanType: 'masuk' | 'pulang';
      record: AttendanceRecord;
      student: Student;
    }
  | {
      ok: false;
      reason:
        | 'invalid_qr'
        | 'not_found'
        | 'duplicate'
        | 'duplicate_checkout'
        | 'before_checkout_time'
        | 'not_checked_in';
      nis: string;
      student?: Student;
      existingRecord?: AttendanceRecord;
    };

export function processQrScan(params: {
  qrRaw: string;
  students: Student[];
  records: AttendanceRecord[];
  batasJamMasuk: string;
  modePresensi?: AttendanceScheduleMode;
  jamPulangStandar?: string;
  scanAction?: ScanActionMode;
  alasanPulangCepat?: string;
  tahunAjaran?: string;
  now?: Date;
}): ScanOutcome {
  const {
    qrRaw,
    students,
    records,
    batasJamMasuk,
    modePresensi = 'masuk_saja',
    jamPulangStandar = '15:00',
    scanAction = 'auto',
    alasanPulangCepat,
    tahunAjaran,
    now = new Date(),
  } = params;
  const nis = extractNisFromQrPayload(qrRaw);

  if (!nis) {
    return { ok: false, reason: 'invalid_qr', nis: '' };
  }

  const student = students.find(
    (s) => s.nis.trim().toLowerCase() === nis.toLowerCase()
  );
  if (!student) {
    return { ok: false, reason: 'not_found', nis };
  }

  const tanggal = getTodayDateString(now);
  const nowTime = getCurrentTimeString(now);
  const existingRecord = hasScannedOnDate(records, student.nis, tanggal);

  if (!existingRecord) {
    if (modePresensi === 'masuk_pulang' && scanAction === 'pulang') {
      return {
        ok: false,
        reason: 'not_checked_in',
        nis: student.nis,
        student,
      };
    }

    const status = determineAttendanceStatus(nowTime, batasJamMasuk);
    const record: AttendanceRecord = {
      id: `${tanggal}_${student.nis}`,
      tanggal,
      nis: student.nis,
      nama: student.nama,
      kelas: student.kelas,
      jam_masuk: nowTime,
      jam_pulang: '-',
      status,
      keterangan: status === 'Hadir' ? 'Tepat waktu' : 'Melewati batas jam masuk',
      tahun_ajaran: tahunAjaran ?? student.tahun_ajaran,
    };

    return { ok: true, scanType: 'masuk', record, student };
  }

  // Existing record found for today
  if (modePresensi === 'masuk_saja' || scanAction === 'masuk') {
    return {
      ok: false,
      reason: 'duplicate',
      nis: student.nis,
      student,
      existingRecord,
    };
  }

  // modePresensi === 'masuk_pulang' and scanAction is 'auto' or 'pulang'
  const isPresentRecord =
    (existingRecord.status === 'Hadir' || existingRecord.status === 'Terlambat') &&
    Boolean(existingRecord.jam_masuk && existingRecord.jam_masuk !== '-');

  if (!isPresentRecord) {
    return {
      ok: false,
      reason: 'not_checked_in',
      nis: student.nis,
      student,
      existingRecord,
    };
  }

  if (existingRecord.jam_pulang && existingRecord.jam_pulang !== '-') {
    return {
      ok: false,
      reason: 'duplicate_checkout',
      nis: student.nis,
      student,
      existingRecord,
    };
  }

  const isEarlyCheckout = isBeforeCheckoutTime(nowTime, jamPulangStandar);
  const trimmedEarlyReason = (alasanPulangCepat || '').trim();

  if (isEarlyCheckout && !trimmedEarlyReason) {
    return {
      ok: false,
      reason: 'before_checkout_time',
      nis: student.nis,
      student,
      existingRecord,
    };
  }

  const checkoutNote = trimmedEarlyReason
    ? `Pulang cepat ${nowTime} (Alasan: ${trimmedEarlyReason})`
    : `Pulang ${nowTime}`;

  const updatedRecord: AttendanceRecord = {
    ...existingRecord,
    jam_pulang: nowTime,
    ...(trimmedEarlyReason ? { alasan_pulang_cepat: trimmedEarlyReason } : {}),
    keterangan: existingRecord.keterangan
      ? `${existingRecord.keterangan} · ${checkoutNote}`
      : checkoutNote,
  };

  return { ok: true, scanType: 'pulang', record: updatedRecord, student };
}

export interface ClassBreakdownItem {
  kelas: string;
  total: number;
  hadir: number;
  terlambat: number;
  tidakHadir: number;
  belumScan: number;
}

export interface DashboardMetrics {
  totalSiswa: number;
  hadir: number;
  terlambat: number;
  sakit: number;
  izin: number;
  alpa: number;
  tidakHadir: number;
  belumScan: number;
  kehadiranPct: number;
  classBreakdown: ClassBreakdownItem[];
  recentScans: AttendanceRecord[];
}

export function computeDashboardMetrics(
  students: Student[],
  records: AttendanceRecord[],
  targetDate: string
): DashboardMetrics {
  const totalSiswa = students.length;
  const todayRecords = records.filter(
    (r) => Boolean(r && r.tanggal && r.nis) && r.tanggal === targetDate
  );
  const recordByNis = new Map<string, AttendanceRecord>();
  for (const r of todayRecords) {
    recordByNis.set(r.nis.trim().toLowerCase(), r);
  }

  let hadir = 0;
  let terlambat = 0;
  let sakit = 0;
  let izin = 0;
  let alpa = 0;

  for (const r of todayRecords) {
    if (r.status === 'Hadir') hadir++;
    else if (r.status === 'Terlambat') terlambat++;
    else if (r.status === 'Sakit') sakit++;
    else if (r.status === 'Izin') izin++;
    else if (r.status === 'Alpa') alpa++;
  }

  const tidakHadir = sakit + izin + alpa;
  const recordedCount = todayRecords.length;
  const belumScan = Math.max(0, totalSiswa - recordedCount);
  const attendedCount = hadir + terlambat;
  const kehadiranPct =
    totalSiswa > 0 ? Math.round((attendedCount / totalSiswa) * 100) : 0;

  const classMap = new Map<string, ClassBreakdownItem>();
  for (const student of students) {
    const existing = classMap.get(student.kelas) ?? {
      kelas: student.kelas,
      total: 0,
      hadir: 0,
      terlambat: 0,
      tidakHadir: 0,
      belumScan: 0,
    };
    existing.total++;
    const rec = recordByNis.get(student.nis.trim().toLowerCase());
    if (!rec) {
      existing.belumScan++;
    } else if (rec.status === 'Hadir') {
      existing.hadir++;
    } else if (rec.status === 'Terlambat') {
      existing.terlambat++;
    } else {
      existing.tidakHadir++;
    }
    classMap.set(student.kelas, existing);
  }

  const classBreakdown = Array.from(classMap.values()).sort((a, b) =>
    a.kelas.localeCompare(b.kelas)
  );

  const recentScans = [...todayRecords]
    .sort((a, b) => b.jam_masuk.localeCompare(a.jam_masuk))
    .slice(0, 6);

  return {
    totalSiswa,
    hadir,
    terlambat,
    sakit,
    izin,
    alpa,
    tidakHadir,
    belumScan,
    kehadiranPct,
    classBreakdown,
    recentScans,
  };
}

export interface DailyTrendPoint {
  tanggal: string;
  label: string;
  hadir: number;
  terlambat: number;
  tidakHadir: number;
}

const SHORT_DAYS_ID = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

export function computeWeeklyTrend(
  records: AttendanceRecord[],
  endDate: string,
  days = 7
): DailyTrendPoint[] {
  const result: DailyTrendPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const tanggal = shiftDateString(endDate, -i);
    const [y, m, d] = tanggal.split('-').map(Number);
    const dt = new Date(y, (m || 1) - 1, d || 1);
    const dayRecords = records.filter(
      (r) => Boolean(r && r.tanggal) && r.tanggal === tanggal
    );

    let hadir = 0;
    let terlambat = 0;
    let tidakHadir = 0;
    for (const r of dayRecords) {
      if (r.status === 'Hadir') hadir++;
      else if (r.status === 'Terlambat') terlambat++;
      else tidakHadir++;
    }

    result.push({
      tanggal,
      label: `${SHORT_DAYS_ID[dt.getDay()]} ${pad2(dt.getDate())}`,
      hadir,
      terlambat,
      tidakHadir,
    });
  }
  return result;
}

export interface DailyRecapRow {
  nis: string;
  nama: string;
  kelas: string;
  tanggal: string;
  jam_masuk: string;
  jam_pulang: string;
  alasan_pulang_cepat: string;
  status: AttendanceStatus | 'Belum Presensi';
  keterangan: string;
  isRecorded: boolean;
}

export function buildDailyRecapRows(
  students: Student[],
  records: AttendanceRecord[],
  targetDate: string
): DailyRecapRow[] {
  const dayRecords = records.filter(
    (r) => Boolean(r && r.tanggal && r.nis) && r.tanggal === targetDate
  );
  const recordByNis = new Map<string, AttendanceRecord>();
  for (const r of dayRecords) {
    recordByNis.set(r.nis.trim().toLowerCase(), r);
  }

  const rows: DailyRecapRow[] = students.map((s) => {
    const rec = recordByNis.get(s.nis.trim().toLowerCase());
    if (rec) {
      return {
        nis: s.nis,
        nama: s.nama,
        kelas: s.kelas,
        tanggal: targetDate,
        jam_masuk: rec.jam_masuk || '-',
        jam_pulang: rec.jam_pulang || '-',
        alasan_pulang_cepat: rec.alasan_pulang_cepat?.trim() || '',
        status: rec.status,
        keterangan: rec.keterangan ?? '',
        isRecorded: true,
      };
    }
    return {
      nis: s.nis,
      nama: s.nama,
      kelas: s.kelas,
      tanggal: targetDate,
      jam_masuk: '-',
      jam_pulang: '-',
      alasan_pulang_cepat: '',
      status: 'Belum Presensi',
      keterangan: '',
      isRecorded: false,
    };
  });

  // Include orphan attendance records if student was removed later
  const studentNisSet = new Set(students.map((s) => s.nis.trim().toLowerCase()));
  for (const rec of dayRecords) {
    if (!studentNisSet.has(rec.nis.trim().toLowerCase())) {
      rows.push({
        nis: rec.nis,
        nama: rec.nama,
        kelas: rec.kelas,
        tanggal: rec.tanggal,
        jam_masuk: rec.jam_masuk || '-',
        jam_pulang: rec.jam_pulang || '-',
        alasan_pulang_cepat: rec.alasan_pulang_cepat?.trim() || '',
        status: rec.status,
        keterangan: rec.keterangan ?? '',
        isRecorded: true,
      });
    }
  }

  return rows.sort((a, b) => a.kelas.localeCompare(b.kelas) || a.nama.localeCompare(b.nama));
}

export interface ResetAttendanceResult {
  nextRecords: AttendanceRecord[];
  removedRecords: AttendanceRecord[];
}

/**
 * Removes daily attendance records for specific students on a given date so their
 * status returns cleanly to "Belum Presensi" (both single and collective reset).
 */
export function resetAttendanceRecordsForDate(
  records: AttendanceRecord[],
  tanggal: string,
  nisList: string[]
): ResetAttendanceResult {
  const targetDate = tanggal.trim();
  const targetNisSet = new Set(
    nisList.map((nis) => nis.trim().toLowerCase()).filter(Boolean)
  );
  if (!targetDate || targetNisSet.size === 0) {
    return { nextRecords: records, removedRecords: [] };
  }

  const nextRecords: AttendanceRecord[] = [];
  const removedRecords: AttendanceRecord[] = [];

  for (const rec of records) {
    const matches =
      rec.tanggal === targetDate && targetNisSet.has(rec.nis.trim().toLowerCase());
    if (matches) {
      removedRecords.push(rec);
    } else {
      nextRecords.push(rec);
    }
  }

  return { nextRecords, removedRecords };
}

export interface PeriodDateRange {
  period: RecapPeriodType;
  startDate: string;
  endDate: string;
  title: string;
  subtitle: string;
}

const MONTH_NAMES_ID = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

export function formatShortIndonesianDate(dateStr: string): string {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3) return dateStr;
  return `${pad2(parts[2])} ${MONTH_NAMES_ID[(parts[1] || 1) - 1] || ''} ${parts[0]}`;
}

export function getPeriodDateRange(params: {
  period: RecapPeriodType;
  date: string; // YYYY-MM-DD
  month?: string; // YYYY-MM
  semester?: SemesterKind;
  semesterYear?: number;
}): PeriodDateRange {
  const { period, date } = params;

  if (period === 'harian') {
    return {
      period,
      startDate: date,
      endDate: date,
      title: 'Rekap Presensi Harian',
      subtitle: formatIndonesianDate(date),
    };
  }

  if (period === 'mingguan') {
    const [y, m, d] = date.split('-').map(Number);
    const dt = new Date(y, (m || 1) - 1, d || 1);
    const dayOfWeek = dt.getDay(); // 0=Sun..6=Sat
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const startDate = shiftDateString(date, diffToMonday);
    const endDate = shiftDateString(startDate, 6);
    return {
      period,
      startDate,
      endDate,
      title: 'Rekap Presensi Mingguan',
      subtitle: `${formatShortIndonesianDate(startDate)} – ${formatShortIndonesianDate(endDate)}`,
    };
  }

  if (period === 'bulanan') {
    const targetMonth = params.month && /^\d{4}-\d{2}$/.test(params.month)
      ? params.month
      : date.slice(0, 7);
    const [yStr, mStr] = targetMonth.split('-');
    const year = Number(yStr);
    const monthIndex = Number(mStr); // 1..12
    const lastDay = new Date(year, monthIndex, 0).getDate();
    const startDate = `${year}-${pad2(monthIndex)}-01`;
    const endDate = `${year}-${pad2(monthIndex)}-${pad2(lastDay)}`;
    const monthLabel = MONTH_NAMES_ID[monthIndex - 1] || targetMonth;
    return {
      period,
      startDate,
      endDate,
      title: 'Rekap Presensi Bulanan',
      subtitle: `${monthLabel} ${year} (${formatShortIndonesianDate(startDate)} – ${formatShortIndonesianDate(endDate)})`,
    };
  }

  // semester
  const refYear = params.semesterYear || Number(date.slice(0, 4)) || new Date().getFullYear();
  const refMonth = Number(date.slice(5, 7)) || 1;
  const semesterKind: SemesterKind = params.semester ?? (refMonth >= 7 ? 'ganjil' : 'genap');
  if (semesterKind === 'ganjil') {
    const startDate = `${refYear}-07-01`;
    const endDate = `${refYear}-12-31`;
    return {
      period,
      startDate,
      endDate,
      title: 'Rekap Presensi Semester Ganjil',
      subtitle: `Semester Ganjil ${refYear} (Juli – Desember ${refYear})`,
    };
  }

  const startDate = `${refYear}-01-01`;
  const endDate = `${refYear}-06-30`;
  return {
    period,
    startDate,
    endDate,
    title: 'Rekap Presensi Semester Genap',
    subtitle: `Semester Genap ${refYear} (Januari – Juni ${refYear})`,
  };
}

export interface PeriodSummaryRow {
  nis: string;
  nama: string;
  kelas: string;
  hadir: number;
  terlambat: number;
  sakit: number;
  izin: number;
  alpa: number;
  totalTercatat: number;
  kehadiranPct: number;
  tepatWaktuPct: number;
  skorKehadiranPct: number;
  maxMonthlyIzin?: number;
  penalizedIzinDays?: number;
  maxConsecutiveSakitDays?: number;
  penalizedSakitDays?: number;
}

export const IZIN_MONTHLY_FAIR_LIMIT = 7;
export const SAKIT_CONSECUTIVE_FAIR_LIMIT = 7;

export const ATTENDANCE_SCORE_WEIGHTS = {
  hadir: 1.0,
  terlambat: 0.5,
  excusedSakit: 1.0,
  penalizedSakit: 0.5,
  excusedIzin: 1.0,
  penalizedIzin: 0.5,
  alpa: 0.0,
} as const;

export type AttendanceCategoryTier =
  | 'belum_ada_data'
  | 'sangat_baik'
  | 'baik'
  | 'cukup'
  | 'kurang_baik'
  | 'perlu_perhatian';

export interface AttendanceCategoryResult {
  tier: AttendanceCategoryTier;
  label: string;
  shortReason: string;
}

export interface StudentAttendancePenaltyStats {
  maxMonthlyIzin: number;
  penalizedIzinDays: number;
  maxConsecutiveSakitDays: number;
  penalizedSakitDays: number;
}

function parseIsoDateToUtcDayNumber(dateStr: string): number | null {
  const parts = (dateStr || '').trim().split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [y, m, d] = parts;
  if (y < 1970 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

/**
 * Inspects a single student's records to detect fair-threshold breaches:
 * - Izin: penalized ONLY if > 7 times in any calendar month (YYYY-MM).
 * - Sakit: penalized ONLY if > 7 consecutive calendar days.
 */
export function analyzeStudentAttendancePenalties(
  studentRecords: Array<Pick<AttendanceRecord, 'tanggal' | 'status'>>
): StudentAttendancePenaltyStats {
  const izinByMonth = new Map<string, number>();
  const sakitDayNumbers = new Set<number>();

  for (const r of studentRecords) {
    if (!r || !r.tanggal) continue;
    if (r.status === 'Izin') {
      const monthKey = r.tanggal.slice(0, 7);
      izinByMonth.set(monthKey, (izinByMonth.get(monthKey) || 0) + 1);
    } else if (r.status === 'Sakit') {
      const dayNum = parseIsoDateToUtcDayNumber(r.tanggal);
      if (dayNum !== null) {
        sakitDayNumbers.add(dayNum);
      }
    }
  }

  let maxMonthlyIzin = 0;
  let penalizedIzinDays = 0;
  for (const count of izinByMonth.values()) {
    if (count > maxMonthlyIzin) maxMonthlyIzin = count;
    if (count > IZIN_MONTHLY_FAIR_LIMIT) {
      penalizedIzinDays += count;
    }
  }

  const sortedSakitDays = Array.from(sakitDayNumbers).sort((a, b) => a - b);
  let maxConsecutiveSakitDays = 0;
  let penalizedSakitDays = 0;

  let streakLen = 0;
  let prevDay: number | null = null;
  for (const day of sortedSakitDays) {
    if (prevDay !== null && day === prevDay + 1) {
      streakLen++;
    } else {
      if (streakLen > maxConsecutiveSakitDays) maxConsecutiveSakitDays = streakLen;
      if (streakLen > SAKIT_CONSECUTIVE_FAIR_LIMIT) penalizedSakitDays += streakLen;
      streakLen = 1;
    }
    prevDay = day;
  }
  if (streakLen > maxConsecutiveSakitDays) maxConsecutiveSakitDays = streakLen;
  if (streakLen > SAKIT_CONSECUTIVE_FAIR_LIMIT) penalizedSakitDays += streakLen;

  return {
    maxMonthlyIzin,
    penalizedIzinDays,
    maxConsecutiveSakitDays,
    penalizedSakitDays,
  };
}

export interface AttendanceCountsInput {
  hadir: number;
  terlambat: number;
  sakit: number;
  izin: number;
  alpa: number;
  totalTercatat: number;
  denom?: number;
  maxMonthlyIzin?: number;
  penalizedIzinDays?: number;
  maxConsecutiveSakitDays?: number;
  penalizedSakitDays?: number;
}

/**
 * Computes fair attendance metrics:
 * - Hadir tepat waktu = 100% (full credit, required for Sangat Baik)
 * - Izin <= 7x/month = 100% (excused, not penalized); > 7x/month = 50% (Kurang Baik)
 * - Sakit <= 7 consecutive days = 100% (excused, not penalized); > 7 consecutive days = 50% (Kurang Baik)
 * - Terlambat = 50% (Kurang Baik)
 * - Alpa = 0% (Kurang Baik / Perlu Perhatian)
 */
export function computeFairAttendanceScore(input: AttendanceCountsInput): {
  skorKehadiranPct: number;
  tepatWaktuPct: number;
} {
  const denom = input.denom !== undefined ? input.denom : input.totalTercatat;
  if (denom <= 0) {
    return { skorKehadiranPct: 0, tepatWaktuPct: 0 };
  }

  const rawPenalizedIzin =
    input.penalizedIzinDays !== undefined
      ? Math.min(input.izin, Math.max(0, input.penalizedIzinDays))
      : input.maxMonthlyIzin !== undefined && input.maxMonthlyIzin > IZIN_MONTHLY_FAIR_LIMIT
        ? input.izin
        : 0;
  const excusedIzin = Math.max(0, input.izin - rawPenalizedIzin);

  const rawPenalizedSakit =
    input.penalizedSakitDays !== undefined
      ? Math.min(input.sakit, Math.max(0, input.penalizedSakitDays))
      : input.maxConsecutiveSakitDays !== undefined &&
          input.maxConsecutiveSakitDays > SAKIT_CONSECUTIVE_FAIR_LIMIT
        ? input.sakit
        : 0;
  const excusedSakit = Math.max(0, input.sakit - rawPenalizedSakit);

  const weighted =
    input.hadir * ATTENDANCE_SCORE_WEIGHTS.hadir +
    excusedSakit * ATTENDANCE_SCORE_WEIGHTS.excusedSakit +
    rawPenalizedSakit * ATTENDANCE_SCORE_WEIGHTS.penalizedSakit +
    excusedIzin * ATTENDANCE_SCORE_WEIGHTS.excusedIzin +
    rawPenalizedIzin * ATTENDANCE_SCORE_WEIGHTS.penalizedIzin +
    input.terlambat * ATTENDANCE_SCORE_WEIGHTS.terlambat +
    input.alpa * ATTENDANCE_SCORE_WEIGHTS.alpa;

  const skorKehadiranPct = Math.min(100, Math.max(0, Math.round((weighted / denom) * 100)));

  // On-time ratio evaluates days outside excused Sakit/Izin so excused students aren't penalized
  const evaluatedDays = Math.max(0, denom - excusedIzin - excusedSakit);
  const tepatWaktuPct =
    evaluatedDays > 0
      ? Math.min(100, Math.max(0, Math.round((input.hadir / evaluatedDays) * 100)))
      : 100;

  return { skorKehadiranPct, tepatWaktuPct };
}

/**
 * Evaluates a fair 5-tier attendance category:
 * - Penalti (nilai kurang baik): Terlambat, Alpa, Izin > 7x dalam sebulan, dan Sakit > 7 hari berturut-turut.
 * - Izin <= 7x/bulan & Sakit <= 7 hari berturut-turut TIDAK dinilai kurang baik.
 */
export function evaluateAttendanceCategory(
  input: AttendanceCountsInput & {
    skorKehadiranPct?: number;
    tepatWaktuPct?: number;
  }
): AttendanceCategoryResult {
  if (input.totalTercatat <= 0) {
    return {
      tier: 'belum_ada_data',
      label: 'Belum Ada Data',
      shortReason: 'Belum ada catatan presensi pada periode ini',
    };
  }

  const computed = computeFairAttendanceScore(input);
  const skorPct = input.skorKehadiranPct ?? computed.skorKehadiranPct;
  const tepatWaktuPct = input.tepatWaktuPct ?? computed.tepatWaktuPct;
  const denom = input.denom !== undefined && input.denom > 0 ? input.denom : input.totalTercatat;
  const alpaPct = Math.round((input.alpa / denom) * 100);

  const hasExcessIzin =
    (input.penalizedIzinDays ?? 0) > 0 ||
    (input.maxMonthlyIzin ?? 0) > IZIN_MONTHLY_FAIR_LIMIT;
  const hasExcessSakitStreak =
    (input.penalizedSakitDays ?? 0) > 0 ||
    (input.maxConsecutiveSakitDays ?? 0) > SAKIT_CONSECUTIVE_FAIR_LIMIT;

  // Severe Alpa or very low score => Perlu Perhatian
  if (alpaPct >= 30 || skorPct < 40 || (input.alpa > 0 && skorPct < 55)) {
    return {
      tier: 'perlu_perhatian',
      label: 'Perlu Perhatian',
      shortReason:
        input.alpa > 0
          ? 'Ketidakhadiran tanpa keterangan (Alpa) tinggi'
          : 'Skor kehadiran rendah, perlu pembinaan',
    };
  }

  // Explicit user rules for Kurang Baik:
  // 1) Izin > 7x dalam sebulan
  // 2) Sakit > 7 hari berturut-turut
  // 3) Terlambat mendominasi (terlambat >= hadir) atau Alpa > 10%
  if (hasExcessIzin || hasExcessSakitStreak) {
    const reasons: string[] = [];
    if (hasExcessIzin) reasons.push('Izin melebihi 7 kali dalam sebulan');
    if (hasExcessSakitStreak) reasons.push('Sakit lebih dari 7 hari berturut-turut');
    if (input.terlambat > 0) reasons.push(`Terlambat ${input.terlambat}x`);
    if (input.alpa > 0) reasons.push(`Alpa ${input.alpa}x`);
    return {
      tier: 'kurang_baik',
      label: 'Kurang Baik',
      shortReason: reasons.join(' · '),
    };
  }

  if (
    (input.terlambat > 0 && input.terlambat >= input.hadir) ||
    (input.alpa > 0 && alpaPct > 10)
  ) {
    return {
      tier: 'kurang_baik',
      label: 'Kurang Baik',
      shortReason:
        input.alpa > 0
          ? 'Memiliki catatan Alpa — nilai kehadiran kurang baik'
          : 'Hadir namun terlambat — kedisiplinan waktu kurang baik',
    };
  }

  if (tepatWaktuPct >= 90 && skorPct >= 90 && input.alpa === 0) {
    return {
      tier: 'sangat_baik',
      label: 'Sangat Baik',
      shortReason: 'Hadir tepat waktu ≥ 90%, tanpa Alpa, dan izin/sakit dalam batas wajar',
    };
  }

  if (
    skorPct >= 75 &&
    tepatWaktuPct >= 75 &&
    input.alpa === 0 &&
    input.hadir > input.terlambat
  ) {
    return {
      tier: 'baik',
      label: 'Baik',
      shortReason: 'Mayoritas hadir tepat waktu tanpa Alpa',
    };
  }

  if (skorPct >= 60 && input.hadir > input.terlambat && alpaPct <= 10) {
    return {
      tier: 'cukup',
      label: 'Cukup',
      shortReason: 'Hadir tepat waktu lebih banyak, masih ada keterlambatan atau Alpa ringan',
    };
  }

  return {
    tier: 'kurang_baik',
    label: 'Kurang Baik',
    shortReason: 'Skor kehadiran masih di bawah standar baik',
  };
}

export function buildPeriodSummaryRows(
  students: Student[],
  records: AttendanceRecord[],
  startDate: string,
  endDate: string
): PeriodSummaryRow[] {
  const periodRecords = records.filter(
    (r) =>
      Boolean(r && r.tanggal && r.nis) &&
      r.tanggal >= startDate &&
      r.tanggal <= endDate
  );

  const map = new Map<string, PeriodSummaryRow>();
  const studentRecordsMap = new Map<string, AttendanceRecord[]>();

  for (const s of students) {
    const key = s.nis.trim().toLowerCase();
    map.set(key, {
      nis: s.nis,
      nama: s.nama,
      kelas: s.kelas,
      hadir: 0,
      terlambat: 0,
      sakit: 0,
      izin: 0,
      alpa: 0,
      totalTercatat: 0,
      kehadiranPct: 0,
      tepatWaktuPct: 0,
      skorKehadiranPct: 0,
      maxMonthlyIzin: 0,
      penalizedIzinDays: 0,
      maxConsecutiveSakitDays: 0,
      penalizedSakitDays: 0,
    });
    studentRecordsMap.set(key, []);
  }

  for (const r of periodRecords) {
    const key = r.nis.trim().toLowerCase();
    let row = map.get(key);
    if (!row) {
      row = {
        nis: r.nis,
        nama: r.nama,
        kelas: r.kelas,
        hadir: 0,
        terlambat: 0,
        sakit: 0,
        izin: 0,
        alpa: 0,
        totalTercatat: 0,
        kehadiranPct: 0,
        tepatWaktuPct: 0,
        skorKehadiranPct: 0,
        maxMonthlyIzin: 0,
        penalizedIzinDays: 0,
        maxConsecutiveSakitDays: 0,
        penalizedSakitDays: 0,
      };
      map.set(key, row);
      studentRecordsMap.set(key, []);
    }

    studentRecordsMap.get(key)!.push(r);
    if (r.status === 'Hadir') row.hadir++;
    else if (r.status === 'Terlambat') row.terlambat++;
    else if (r.status === 'Sakit') row.sakit++;
    else if (r.status === 'Izin') row.izin++;
    else if (r.status === 'Alpa') row.alpa++;
    row.totalTercatat++;
  }

  const rows = Array.from(map.entries()).map(([key, row]) => {
    const attended = row.hadir + row.terlambat;
    const kehadiranPct =
      row.totalTercatat > 0 ? Math.round((attended / row.totalTercatat) * 100) : 0;
    const penaltyStats = analyzeStudentAttendancePenalties(studentRecordsMap.get(key) || []);
    const enrichedRow: PeriodSummaryRow = {
      ...row,
      ...penaltyStats,
    };
    const { skorKehadiranPct, tepatWaktuPct } = computeFairAttendanceScore(enrichedRow);
    return { ...enrichedRow, kehadiranPct, tepatWaktuPct, skorKehadiranPct };
  });

  return rows.sort((a, b) => a.kelas.localeCompare(b.kelas) || a.nama.localeCompare(b.nama));
}

export function formatIndonesianDate(dateStr: string): string {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3) return dateStr;
  const dt = new Date(parts[0], parts[1] - 1, parts[2]);
  return new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(dt);
}

export interface WaliKelasLoginReminder {
  kelasBinaan: string;
  totalSiswaKelas: number;
  belumHadirCount: number;
  belumPulangCount: number;
  messages: string[];
}

export function evaluateWaliKelasLoginReminder(params: {
  students: Student[];
  records: AttendanceRecord[];
  kelasBinaan?: string;
  targetDate: string;
  modePresensi: AttendanceScheduleMode;
}): WaliKelasLoginReminder {
  const kelasNorm = normalizeClassNameKey(params.kelasBinaan);
  if (!kelasNorm) {
    return {
      kelasBinaan: '',
      totalSiswaKelas: 0,
      belumHadirCount: 0,
      belumPulangCount: 0,
      messages: [],
    };
  }

  const classStudents = params.students.filter((s) =>
    isSameClassName(s.kelas, params.kelasBinaan)
  );

  if (classStudents.length === 0) {
    return {
      kelasBinaan: params.kelasBinaan?.trim() || '',
      totalSiswaKelas: 0,
      belumHadirCount: 0,
      belumPulangCount: 0,
      messages: [],
    };
  }

  let belumHadirCount = 0;
  let belumPulangCount = 0;

  for (const student of classStudents) {
    const rec = hasScannedOnDate(params.records, student.nis, params.targetDate);
    if (!rec) {
      belumHadirCount++;
      continue;
    }

    if (
      params.modePresensi === 'masuk_pulang' &&
      (rec.status === 'Hadir' || rec.status === 'Terlambat') &&
      rec.jam_masuk &&
      rec.jam_masuk !== '-' &&
      (!rec.jam_pulang || rec.jam_pulang === '-')
    ) {
      belumPulangCount++;
    }
  }

  const messages: string[] = [];
  if (belumHadirCount > 0) {
    messages.push(
      'Bapak/Ibu Wali Kelas, Mohon cek siswa kelas bapak/ibu yang masih belum melakukan presensi kehadiran'
    );
  }
  if (belumPulangCount > 0) {
    messages.push(
      `Bapak/Ibu Wali Kelas, ada ${belumPulangCount} siswa yang belum melakukan presensi pulang. Silakan konfirmasi presensi pulang siswa`
    );
  }

  return {
    kelasBinaan: params.kelasBinaan?.trim() || '',
    totalSiswaKelas: classStudents.length,
    belumHadirCount,
    belumPulangCount,
    messages,
  };
}

export interface AcademicYearDateRange {
  startDate: string;
  endDate: string;
  title: string;
  subtitle: string;
}

export function getAcademicYearDateRange(
  academicYear: string,
  fallbackDate: string
): AcademicYearDateRange {
  const trimmed = (academicYear || '').trim();
  const match = trimmed.match(/^(\d{4})\s*[/\-]\s*(\d{4})$/);
  if (match) {
    const startYear = Number(match[1]);
    const endYear = Number(match[2]);
    return {
      startDate: `${startYear}-07-01`,
      endDate: `${endYear}-06-30`,
      title: `Analisis Tahunan (${startYear}/${endYear})`,
      subtitle: `1 Jul ${startYear} – 30 Jun ${endYear}`,
    };
  }

  const singleYearMatch = trimmed.match(/^(\d{4})$/);
  const year = singleYearMatch
    ? Number(singleYearMatch[1])
    : Number(fallbackDate.slice(0, 4)) || new Date().getFullYear();

  return {
    startDate: `${year}-01-01`,
    endDate: `${year}-12-31`,
    title: `Analisis Tahunan (${year})`,
    subtitle: `1 Jan ${year} – 31 Des ${year}`,
  };
}

export interface PeriodAnalyticsOverview {
  period: AnalyticsPeriodType;
  label: string;
  shortLabel: string;
  startDate: string;
  endDate: string;
  subtitle: string;
  totalSiswa: number;
  hadir: number;
  terlambat: number;
  sakit: number;
  izin: number;
  alpa: number;
  belumPresensi: number;
  totalTercatat: number;
  activeDays: number;
  kehadiranPct: number;
  tepatWaktuPct: number;
  skorKehadiranPct: number;
  penalizedIzinDays?: number;
  penalizedSakitDays?: number;
}

export interface ClassAnalyticsRow {
  kelas: string;
  totalSiswa: number;
  hadir: number;
  terlambat: number;
  sakit: number;
  izin: number;
  alpa: number;
  totalTercatat: number;
  kehadiranPct: number;
  tepatWaktuPct: number;
  skorKehadiranPct: number;
  penalizedIzinDays?: number;
  penalizedSakitDays?: number;
}

export interface AttendanceAnalyticsResult {
  overviews: Record<AnalyticsPeriodType, PeriodAnalyticsOverview>;
  selectedOverview: PeriodAnalyticsOverview;
  classAnalytics: ClassAnalyticsRow[];
  studentRows: PeriodSummaryRow[];
  attentionStudents: PeriodSummaryRow[];
  topStudents: PeriodSummaryRow[];
}

function summarizePeriodRecords(params: {
  period: AnalyticsPeriodType;
  label: string;
  shortLabel: string;
  startDate: string;
  endDate: string;
  subtitle: string;
  students: Student[];
  records: AttendanceRecord[];
}): PeriodAnalyticsOverview {
  const { period, label, shortLabel, startDate, endDate, subtitle, students, records } = params;
  const studentNisSet = new Set(students.map((s) => s.nis.trim().toLowerCase()));
  const filtered = records.filter((r) => {
    if (!r || !r.tanggal || !r.nis) return false;
    if (r.tanggal < startDate || r.tanggal > endDate) return false;
    if (students.length > 0 && !studentNisSet.has(r.nis.trim().toLowerCase())) {
      return false;
    }
    return true;
  });

  let hadir = 0;
  let terlambat = 0;
  let sakit = 0;
  let izin = 0;
  let alpa = 0;
  const activeDateSet = new Set<string>();
  const recordsByNis = new Map<string, AttendanceRecord[]>();

  for (const r of filtered) {
    activeDateSet.add(r.tanggal);
    const key = r.nis.trim().toLowerCase();
    if (!recordsByNis.has(key)) recordsByNis.set(key, []);
    recordsByNis.get(key)!.push(r);

    if (r.status === 'Hadir') hadir++;
    else if (r.status === 'Terlambat') terlambat++;
    else if (r.status === 'Sakit') sakit++;
    else if (r.status === 'Izin') izin++;
    else if (r.status === 'Alpa') alpa++;
  }

  let penalizedIzinDays = 0;
  let penalizedSakitDays = 0;
  for (const list of recordsByNis.values()) {
    const stats = analyzeStudentAttendancePenalties(list);
    penalizedIzinDays += stats.penalizedIzinDays;
    penalizedSakitDays += stats.penalizedSakitDays;
  }

  const totalTercatat = filtered.length;
  const attended = hadir + terlambat;
  const belumPresensi =
    period === 'harian' ? Math.max(0, students.length - totalTercatat) : 0;

  const denom =
    period === 'harian'
      ? students.length > 0
        ? students.length
        : totalTercatat
      : totalTercatat;
  const kehadiranPct = denom > 0 ? Math.round((attended / denom) * 100) : 0;
  const { skorKehadiranPct, tepatWaktuPct } = computeFairAttendanceScore({
    hadir,
    terlambat,
    sakit,
    izin,
    alpa,
    totalTercatat,
    denom,
    penalizedIzinDays,
    penalizedSakitDays,
  });

  return {
    period,
    label,
    shortLabel,
    startDate,
    endDate,
    subtitle,
    totalSiswa: students.length,
    hadir,
    terlambat,
    sakit,
    izin,
    alpa,
    belumPresensi,
    totalTercatat,
    activeDays: activeDateSet.size,
    kehadiranPct,
    tepatWaktuPct,
    skorKehadiranPct,
    penalizedIzinDays,
    penalizedSakitDays,
  };
}

export function computeAttendanceAnalytics(params: {
  students: Student[];
  records: AttendanceRecord[];
  selectedPeriod: AnalyticsPeriodType;
  date: string; // YYYY-MM-DD
  month: string; // YYYY-MM
  semester: SemesterKind;
  semesterYear: number;
  academicYear: string;
}): AttendanceAnalyticsResult {
  const {
    students,
    records,
    selectedPeriod,
    date,
    month,
    semester,
    semesterYear,
    academicYear,
  } = params;

  const dailyRange = getPeriodDateRange({ period: 'harian', date });
  const weeklyRange = getPeriodDateRange({ period: 'mingguan', date });
  const monthlyRange = getPeriodDateRange({ period: 'bulanan', date, month });
  const semesterRange = getPeriodDateRange({
    period: 'semester',
    date,
    semester,
    semesterYear,
  });
  const yearlyRange = getAcademicYearDateRange(academicYear, date);

  const overviews: Record<AnalyticsPeriodType, PeriodAnalyticsOverview> = {
    harian: summarizePeriodRecords({
      period: 'harian',
      label: 'Harian',
      shortLabel: 'Harian',
      startDate: dailyRange.startDate,
      endDate: dailyRange.endDate,
      subtitle: dailyRange.subtitle,
      students,
      records,
    }),
    mingguan: summarizePeriodRecords({
      period: 'mingguan',
      label: 'Mingguan',
      shortLabel: 'Mingguan',
      startDate: weeklyRange.startDate,
      endDate: weeklyRange.endDate,
      subtitle: weeklyRange.subtitle,
      students,
      records,
    }),
    bulanan: summarizePeriodRecords({
      period: 'bulanan',
      label: 'Bulanan',
      shortLabel: 'Bulanan',
      startDate: monthlyRange.startDate,
      endDate: monthlyRange.endDate,
      subtitle: monthlyRange.subtitle,
      students,
      records,
    }),
    semester: summarizePeriodRecords({
      period: 'semester',
      label: semester === 'ganjil' ? 'Semester Ganjil' : 'Semester Genap',
      shortLabel: 'Semester',
      startDate: semesterRange.startDate,
      endDate: semesterRange.endDate,
      subtitle: semesterRange.subtitle,
      students,
      records,
    }),
    tahunan: summarizePeriodRecords({
      period: 'tahunan',
      label: `Tahunan (${academicYear})`,
      shortLabel: 'Tahunan',
      startDate: yearlyRange.startDate,
      endDate: yearlyRange.endDate,
      subtitle: yearlyRange.subtitle,
      students,
      records,
    }),
  };

  const selectedOverview = overviews[selectedPeriod];

  const studentRows = buildPeriodSummaryRows(
    students,
    records,
    selectedOverview.startDate,
    selectedOverview.endDate
  );

  // Class-level analytics for selected period
  const classMap = new Map<string, ClassAnalyticsRow>();
  for (const s of students) {
    const cls = s.kelas.trim() || 'Tanpa Kelas';
    if (!classMap.has(cls)) {
      classMap.set(cls, {
        kelas: cls,
        totalSiswa: 0,
        hadir: 0,
        terlambat: 0,
        sakit: 0,
        izin: 0,
        alpa: 0,
        totalTercatat: 0,
        kehadiranPct: 0,
        tepatWaktuPct: 0,
        skorKehadiranPct: 0,
        penalizedIzinDays: 0,
        penalizedSakitDays: 0,
      });
    }
    classMap.get(cls)!.totalSiswa++;
  }

  for (const row of studentRows) {
    const cls = row.kelas.trim() || 'Tanpa Kelas';
    if (!classMap.has(cls)) {
      classMap.set(cls, {
        kelas: cls,
        totalSiswa: 0,
        hadir: 0,
        terlambat: 0,
        sakit: 0,
        izin: 0,
        alpa: 0,
        totalTercatat: 0,
        kehadiranPct: 0,
        tepatWaktuPct: 0,
        skorKehadiranPct: 0,
        penalizedIzinDays: 0,
        penalizedSakitDays: 0,
      });
    }
    const target = classMap.get(cls)!;
    target.hadir += row.hadir;
    target.terlambat += row.terlambat;
    target.sakit += row.sakit;
    target.izin += row.izin;
    target.alpa += row.alpa;
    target.totalTercatat += row.totalTercatat;
    target.penalizedIzinDays = (target.penalizedIzinDays || 0) + (row.penalizedIzinDays || 0);
    target.penalizedSakitDays = (target.penalizedSakitDays || 0) + (row.penalizedSakitDays || 0);
  }

  const classAnalytics = Array.from(classMap.values())
    .map((c) => {
      const attended = c.hadir + c.terlambat;
      const denom =
        selectedPeriod === 'harian'
          ? c.totalSiswa > 0
            ? c.totalSiswa
            : c.totalTercatat
          : c.totalTercatat;
      const { skorKehadiranPct, tepatWaktuPct } = computeFairAttendanceScore({
        hadir: c.hadir,
        terlambat: c.terlambat,
        sakit: c.sakit,
        izin: c.izin,
        alpa: c.alpa,
        totalTercatat: c.totalTercatat,
        denom,
        penalizedIzinDays: c.penalizedIzinDays,
        penalizedSakitDays: c.penalizedSakitDays,
      });
      return {
        ...c,
        kehadiranPct: denom > 0 ? Math.round((attended / denom) * 100) : 0,
        tepatWaktuPct,
        skorKehadiranPct,
      };
    })
    .sort(
      (a, b) =>
        b.skorKehadiranPct - a.skorKehadiranPct ||
        b.tepatWaktuPct - a.tepatWaktuPct ||
        a.kelas.localeCompare(b.kelas)
    );

  const attentionStudents = studentRows
    .filter((r) => {
      if (r.totalTercatat <= 0) return false;
      const cat = evaluateAttendanceCategory(r);
      return cat.tier === 'kurang_baik' || cat.tier === 'perlu_perhatian' || r.alpa > 0;
    })
    .sort(
      (a, b) =>
        a.skorKehadiranPct - b.skorKehadiranPct ||
        b.alpa - a.alpa ||
        b.terlambat - a.terlambat ||
        a.nama.localeCompare(b.nama)
    )
    .slice(0, 6);

  const topStudents = studentRows
    .filter((r) => evaluateAttendanceCategory(r).tier === 'sangat_baik')
    .sort(
      (a, b) =>
        b.tepatWaktuPct - a.tepatWaktuPct ||
        b.skorKehadiranPct - a.skorKehadiranPct ||
        b.hadir - a.hadir ||
        a.nama.localeCompare(b.nama)
    )
    .slice(0, 5);

  return {
    overviews,
    selectedOverview,
    classAnalytics,
    studentRows,
    attentionStudents,
    topStudents,
  };
}

export const COLLECTIVE_EARLY_CHECKOUT_PRESETS: string[] = [
  'Rapat Dewan Guru / Kegiatan Sekolah',
  'Kegiatan Peringatan Hari Besar / Lomba Sekolah',
  'Cuaca Ekstrem / Hujan Deras / Banjir',
  'Pemulangan Lebih Awal Sesuai Instruksi Kepala Sekolah',
  'Kegiatan Ujian / Selesai Pembelajaran Lebih Awal',
];

/**
 * Normalizes an HH:MM or HH:MM:SS checkout input into HH:MM:SS.
 */
export function normalizeCheckoutTimeHHMMSS(raw?: string | null, fallback?: string): string {
  const cleaned = String(raw || '').trim();
  const match = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(cleaned);
  if (match) {
    const hh = match[1].padStart(2, '0');
    const mm = match[2];
    const ss = match[3] || '00';
    return `${hh}:${mm}:${ss}`;
  }
  return fallback || getCurrentTimeString();
}

/**
 * Pure helper to collectively confirm check-out times (and optional collective early-checkout reason)
 * for multiple students on a given date. Only applies to checked-in students ('Hadir' | 'Terlambat')
 * who have not yet recorded a checkout time.
 */
export function applyCollectiveCheckout(params: {
  records: AttendanceRecord[];
  tanggal: string;
  targetNisList: string[];
  checkoutTime: string;
  alasanPulangCepat?: string;
}): {
  nextRecords: AttendanceRecord[];
  updatedRecords: AttendanceRecord[];
  skippedCount: number;
} {
  const { records, tanggal, targetNisList, checkoutTime, alasanPulangCepat } = params;
  const targetSet = new Set(targetNisList.map((n) => n.trim().toLowerCase()).filter(Boolean));
  if (targetSet.size === 0) {
    return { nextRecords: records, updatedRecords: [], skippedCount: 0 };
  }

  const normalizedTime = normalizeCheckoutTimeHHMMSS(checkoutTime);
  const trimmedReason = String(alasanPulangCepat || '').trim();
  const checkoutNote = trimmedReason
    ? `Pulang cepat ${normalizedTime} (Alasan: ${trimmedReason})`
    : `Pulang ${normalizedTime}`;

  const updatedRecords: AttendanceRecord[] = [];
  const updatedNisSet = new Set<string>();

  const nextRecords = records.map((rec) => {
    if (rec.tanggal !== tanggal) return rec;
    const normNis = rec.nis.trim().toLowerCase();
    if (!targetSet.has(normNis)) return rec;
    const isCheckedIn =
      (rec.status === 'Hadir' || rec.status === 'Terlambat') &&
      Boolean(rec.jam_masuk) &&
      rec.jam_masuk !== '-';
    const alreadyCheckedOut = Boolean(rec.jam_pulang && rec.jam_pulang !== '-');
    if (!isCheckedIn || alreadyCheckedOut) {
      return rec;
    }

    const updated: AttendanceRecord = {
      ...rec,
      jam_pulang: normalizedTime,
      ...(trimmedReason ? { alasan_pulang_cepat: trimmedReason } : {}),
      keterangan: rec.keterangan ? `${rec.keterangan} · ${checkoutNote}` : checkoutNote,
    };
    updatedRecords.push(updated);
    updatedNisSet.add(normNis);
    return updated;
  });

  return {
    nextRecords,
    updatedRecords,
    skippedCount: Math.max(0, targetSet.size - updatedNisSet.size),
  };
}



