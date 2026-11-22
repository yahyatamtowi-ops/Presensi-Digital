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
  const text = String(raw ?? '').trim().replace(/\./g, ':');
  if (!text) return fallback;

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
  const trimmed = itemYear?.trim();
  return trimmed || fallbackYear;
}

/**
 * Filters records or students by Academic Year.
 * Non-master_admin users (guest, wali_kelas, guru) ONLY see items matching activeAcademicYear.
 * Master Admin can view activeAcademicYear, a specific historical year, or 'ALL'.
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
    fallbackYear = '2026/2027',
  } = options;

  if (isMasterAdmin) {
    if (masterYearFilter === 'ALL') {
      return items;
    }
    const targetYear =
      masterYearFilter === 'ACTIVE' ? activeAcademicYear : masterYearFilter;
    return items.filter(
      (item) => resolveItemAcademicYear(item.tahun_ajaran, fallbackYear) === targetYear
    );
  }

  return items.filter(
    (item) =>
      resolveItemAcademicYear(item.tahun_ajaran, fallbackYear) === activeAcademicYear
  );
}

export function collectAcademicYears(
  students: Array<{ tahun_ajaran?: string }>,
  records: Array<{ tahun_ajaran?: string }>,
  activeAcademicYear: string,
  fallbackYear = '2026/2027'
): string[] {
  const set = new Set<string>([activeAcademicYear]);
  for (const s of students) {
    set.add(resolveItemAcademicYear(s.tahun_ajaran, fallbackYear));
  }
  for (const r of records) {
    set.add(resolveItemAcademicYear(r.tahun_ajaran, fallbackYear));
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
  status: AttendanceStatus | 'Belum Absen';
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
      status: 'Belum Absen',
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
}

export const ATTENDANCE_SCORE_WEIGHTS = {
  hadir: 1.0,
  terlambat: 0.5,
  sakit: 0.25,
  izin: 0.25,
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

export interface AttendanceCountsInput {
  hadir: number;
  terlambat: number;
  sakit: number;
  izin: number;
  alpa: number;
  totalTercatat: number;
  denom?: number;
}

/**
 * Computes fair attendance metrics where:
 * - Hadir tepat waktu = 100% (full credit, required for Sangat Baik)
 * - Terlambat = 50% (counts as Kurang Baik when late arrivals dominate)
 * - Sakit / Izin = 25% (fair partial consideration vs unexcused absence)
 * - Alpa = 0% (unexcused absence)
 */
export function computeFairAttendanceScore(input: AttendanceCountsInput): {
  skorKehadiranPct: number;
  tepatWaktuPct: number;
} {
  const denom = input.denom !== undefined ? input.denom : input.totalTercatat;
  if (denom <= 0) {
    return { skorKehadiranPct: 0, tepatWaktuPct: 0 };
  }
  const weighted =
    input.hadir * ATTENDANCE_SCORE_WEIGHTS.hadir +
    input.terlambat * ATTENDANCE_SCORE_WEIGHTS.terlambat +
    input.sakit * ATTENDANCE_SCORE_WEIGHTS.sakit +
    input.izin * ATTENDANCE_SCORE_WEIGHTS.izin +
    input.alpa * ATTENDANCE_SCORE_WEIGHTS.alpa;
  const skorKehadiranPct = Math.min(100, Math.max(0, Math.round((weighted / denom) * 100)));
  const tepatWaktuPct = Math.min(100, Math.max(0, Math.round((input.hadir / denom) * 100)));
  return { skorKehadiranPct, tepatWaktuPct };
}

/**
 * Evaluates a fair 5-tier attendance category:
 * - Sangat Baik: Hadir tepat waktu >= 90%, skor >= 90%, tanpa Alpa
 * - Baik: Skor >= 75%, tepat waktu >= 75%, tanpa Alpa, tepat waktu > terlambat
 * - Cukup: Skor >= 60%, hadir tepat waktu > terlambat, Alpa <= 20%
 * - Kurang Baik: Hadir namun dominan/sering terlambat (terlambat >= hadir) atau skor 40-59% dengan Alpa < 30%
 * - Perlu Perhatian: Skor < 40% atau Alpa >= 30%
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

  if (tepatWaktuPct >= 90 && skorPct >= 90 && input.alpa === 0) {
    return {
      tier: 'sangat_baik',
      label: 'Sangat Baik',
      shortReason: 'Hadir tepat waktu ≥ 90% tanpa alpa',
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
      shortReason: 'Mayoritas hadir tepat waktu tanpa alpa',
    };
  }

  if (skorPct >= 60 && input.hadir > input.terlambat && alpaPct <= 20) {
    return {
      tier: 'cukup',
      label: 'Cukup',
      shortReason: 'Hadir tepat waktu lebih banyak, namun masih ada keterlambatan/izin/alpa',
    };
  }

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

  return {
    tier: 'kurang_baik',
    label: 'Kurang Baik',
    shortReason:
      input.terlambat > 0 && input.terlambat >= input.hadir
        ? 'Hadir namun terlambat — kedisiplinan waktu kurang baik'
        : 'Skor kehadiran masih di bawah standar baik',
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

  for (const s of students) {
    map.set(s.nis.trim().toLowerCase(), {
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
    });
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
      };
      map.set(key, row);
    }

    if (r.status === 'Hadir') row.hadir++;
    else if (r.status === 'Terlambat') row.terlambat++;
    else if (r.status === 'Sakit') row.sakit++;
    else if (r.status === 'Izin') row.izin++;
    else if (r.status === 'Alpa') row.alpa++;
    row.totalTercatat++;
  }

  const rows = Array.from(map.values()).map((row) => {
    const attended = row.hadir + row.terlambat;
    const kehadiranPct =
      row.totalTercatat > 0 ? Math.round((attended / row.totalTercatat) * 100) : 0;
    const { skorKehadiranPct, tepatWaktuPct } = computeFairAttendanceScore(row);
    return { ...row, kehadiranPct, tepatWaktuPct, skorKehadiranPct };
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
  const kelasNorm = (params.kelasBinaan || '').trim().toLowerCase();
  if (!kelasNorm) {
    return {
      kelasBinaan: '',
      totalSiswaKelas: 0,
      belumHadirCount: 0,
      belumPulangCount: 0,
      messages: [],
    };
  }

  const classStudents = params.students.filter(
    (s) => s.kelas.trim().toLowerCase() === kelasNorm
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
  belumAbsen: number;
  totalTercatat: number;
  activeDays: number;
  kehadiranPct: number;
  tepatWaktuPct: number;
  skorKehadiranPct: number;
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

  for (const r of filtered) {
    activeDateSet.add(r.tanggal);
    if (r.status === 'Hadir') hadir++;
    else if (r.status === 'Terlambat') terlambat++;
    else if (r.status === 'Sakit') sakit++;
    else if (r.status === 'Izin') izin++;
    else if (r.status === 'Alpa') alpa++;
  }

  const totalTercatat = filtered.length;
  const attended = hadir + terlambat;
  const belumAbsen =
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
    belumAbsen,
    totalTercatat,
    activeDays: activeDateSet.size,
    kehadiranPct,
    tepatWaktuPct,
    skorKehadiranPct,
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
      });
    }
    const target = classMap.get(cls)!;
    target.hadir += row.hadir;
    target.terlambat += row.terlambat;
    target.sakit += row.sakit;
    target.izin += row.izin;
    target.alpa += row.alpa;
    target.totalTercatat += row.totalTercatat;
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


