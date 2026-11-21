import type {
  AttendanceStatus,
  DayOfWeek,
  MasterSubject,
  SemesterKind,
  Student,
  SubjectAssignment,
  SubjectAttendanceRecord,
  TeacherSchedule,
  UserRole,
} from '../types';
import {
  getCurrentTimeString,
  getTodayDateString,
  normalizeTimeHHMM,
  parseTimeToMinutes,
  resolveItemAcademicYear,
} from './attendanceLogic';

const SUBJECT_ASSIGNMENTS_KEY = 'presensiqr_subject_assignments_v2';
const SUBJECT_RECORDS_KEY = 'presensiqr_subject_records_v2';
const MASTER_SUBJECTS_KEY = 'presensiqr_master_subjects_v2';
const TEACHER_SCHEDULES_KEY = 'presensiqr_teacher_schedules_v2';

export const DAYS_OF_WEEK: DayOfWeek[] = [
  'Senin',
  'Selasa',
  'Rabu',
  'Kamis',
  'Jumat',
  'Sabtu',
  'Minggu',
];

export const SCHOOL_DAYS: DayOfWeek[] = [
  'Senin',
  'Selasa',
  'Rabu',
  'Kamis',
  'Jumat',
  'Sabtu',
];

const JS_DAY_TO_INDONESIAN: DayOfWeek[] = [
  'Minggu',
  'Senin',
  'Selasa',
  'Rabu',
  'Kamis',
  'Jumat',
  'Sabtu',
];

const INDONESIAN_MONTHS = [
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

export const SUBJECT_SUGGESTIONS = [
  'Matematika',
  'Bahasa Indonesia',
  'Bahasa Inggris',
  'Pendidikan Agama',
  'PPKn',
  'Fisika',
  'Kimia',
  'Biologi',
  'Sejarah',
  'Geografi',
  'Ekonomi',
  'Sosiologi',
  'Informatika',
  'PJOK',
  'Seni Budaya',
  'Prakarya',
];

export const DEFAULT_MASTER_SUBJECTS: MasterSubject[] = [
  { id: 'msub_mtk', kode: 'MTK', nama: 'Matematika', deskripsi: 'Matematika Umum & Peminatan' },
  { id: 'msub_bind', kode: 'BIND', nama: 'Bahasa Indonesia', deskripsi: 'Bahasa & Sastra Indonesia' },
  { id: 'msub_bing', kode: 'BING', nama: 'Bahasa Inggris', deskripsi: 'Bahasa Inggris' },
  { id: 'msub_fis', kode: 'FIS', nama: 'Fisika', deskripsi: 'Ilmu Pengetahuan Alam — Fisika' },
  { id: 'msub_kim', kode: 'KIM', nama: 'Kimia', deskripsi: 'Ilmu Pengetahuan Alam — Kimia' },
  { id: 'msub_bio', kode: 'BIO', nama: 'Biologi', deskripsi: 'Ilmu Pengetahuan Alam — Biologi' },
  { id: 'msub_inf', kode: 'INF', nama: 'Informatika', deskripsi: 'Teknologi Informasi & Komputer' },
  { id: 'msub_pai', kode: 'PAI', nama: 'Pendidikan Agama', deskripsi: 'Pendidikan Agama & Budi Pekerti' },
  { id: 'msub_ppkn', kode: 'PPKN', nama: 'PPKn', deskripsi: 'Pendidikan Pancasila & Kewarganegaraan' },
  { id: 'msub_sej', kode: 'SEJ', nama: 'Sejarah', deskripsi: 'Sejarah Indonesia' },
  { id: 'msub_eko', kode: 'EKO', nama: 'Ekonomi', deskripsi: 'Ilmu Pengetahuan Sosial — Ekonomi' },
  { id: 'msub_pjok', kode: 'PJOK', nama: 'PJOK', deskripsi: 'Pendidikan Jasmani, Olahraga & Kesehatan' },
];

export function normalizeSemester(raw: unknown, fallback: SemesterKind = 'ganjil'): SemesterKind {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'genap' || s === '2' || s === 'semester 2') return 'genap';
  if (s === 'ganjil' || s === '1' || s === 'semester 1') return 'ganjil';
  return fallback;
}

export function formatSemesterLabel(semester?: SemesterKind): string {
  return normalizeSemester(semester) === 'genap' ? 'Genap' : 'Ganjil';
}

export function normalizeDayOfWeek(raw: unknown): DayOfWeek | undefined {
  const s = String(raw ?? '').trim().toLowerCase();
  const map: Record<string, DayOfWeek> = {
    senin: 'Senin',
    selasa: 'Selasa',
    rabu: 'Rabu',
    kamis: 'Kamis',
    jumat: 'Jumat',
    "jum'at": 'Jumat',
    sabtu: 'Sabtu',
    minggu: 'Minggu',
  };
  return map[s];
}

export function getIndonesianDayOfWeek(dateStr: string): DayOfWeek {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((dateStr || '').trim());
  if (!m) {
    return JS_DAY_TO_INDONESIAN[new Date().getDay()];
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(year, month - 1, day);
  if (Number.isNaN(d.getTime())) {
    return JS_DAY_TO_INDONESIAN[new Date().getDay()];
  }
  return JS_DAY_TO_INDONESIAN[d.getDay()];
}

export function formatIndonesianDateWithDay(dateStr: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((dateStr || '').trim());
  if (!m) return dateStr;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const dayName = getIndonesianDayOfWeek(dateStr);
  const monthName = INDONESIAN_MONTHS[month - 1] || m[2];
  return `${dayName}, ${day} ${monthName} ${year}`;
}

export function validateTransparentPngFile(file: {
  name: string;
  type: string;
  size?: number;
}): { ok: true } | { ok: false; error: string } {
  const lowerName = (file.name || '').trim().toLowerCase();
  const mime = (file.type || '').trim().toLowerCase();
  const isPng = mime === 'image/png' || lowerName.endsWith('.png');
  if (!isPng) {
    return {
      ok: false,
      error:
        'Format file harus berupa PNG latar belakang transparan (.png). File JPG/WebP tidak diperbolehkan.',
    };
  }
  if (typeof file.size === 'number' && file.size > 5 * 1024 * 1024) {
    return {
      ok: false,
      error: 'Ukuran file PNG maksimal 5 MB.',
    };
  }
  return { ok: true };
}

// ============================================================
// Master Subjects (Sub Menu: Mata Pelajaran)
// ============================================================

export function sanitizeMasterSubjects(rawList: unknown): MasterSubject[] {
  if (!Array.isArray(rawList)) return [];
  const seenNames = new Set<string>();
  const out: MasterSubject[] = [];
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Partial<MasterSubject>;
    const nama = String(obj.nama || '').trim();
    if (!nama) continue;
    const norm = nama.toLowerCase();
    if (seenNames.has(norm)) continue;
    seenNames.add(norm);
    const kode =
      String(obj.kode || '')
        .trim()
        .toUpperCase() ||
      nama
        .replace(/[^a-zA-Z0-9]/g, '')
        .slice(0, 4)
        .toUpperCase() ||
      'MPL';
    out.push({
      id: String(obj.id || `msub_${norm.replace(/\s+/g, '_')}`).trim(),
      kode,
      nama,
      deskripsi: obj.deskripsi ? String(obj.deskripsi).trim() : undefined,
    });
  }
  return out;
}

export function loadMasterSubjects(): MasterSubject[] {
  try {
    const raw = localStorage.getItem(MASTER_SUBJECTS_KEY);
    if (!raw) {
      localStorage.setItem(MASTER_SUBJECTS_KEY, JSON.stringify(DEFAULT_MASTER_SUBJECTS));
      return [...DEFAULT_MASTER_SUBJECTS];
    }
    const parsed = sanitizeMasterSubjects(JSON.parse(raw));
    return parsed;
  } catch {
    return [...DEFAULT_MASTER_SUBJECTS];
  }
}

export function saveMasterSubjects(subjects: MasterSubject[]): void {
  try {
    localStorage.setItem(MASTER_SUBJECTS_KEY, JSON.stringify(subjects));
  } catch {
    // Ignore storage quota errors
  }
}

export function addMasterSubject(
  existing: MasterSubject[],
  input: { kode: string; nama: string; deskripsi?: string }
):
  | { ok: true; subject: MasterSubject; subjects: MasterSubject[] }
  | { ok: false; error: string } {
  const nama = input.nama.trim();
  const kode = input.kode.trim().toUpperCase();
  if (!nama) return { ok: false, error: 'Nama mata pelajaran wajib diisi.' };
  if (!kode) return { ok: false, error: 'Kode mata pelajaran wajib diisi.' };

  if (existing.some((s) => s.nama.trim().toLowerCase() === nama.toLowerCase())) {
    return { ok: false, error: `Mata pelajaran "${nama}" sudah terdaftar.` };
  }
  if (existing.some((s) => s.kode.trim().toUpperCase() === kode)) {
    return { ok: false, error: `Kode mata pelajaran "${kode}" sudah digunakan.` };
  }

  const subject: MasterSubject = {
    id: `msub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    kode,
    nama,
    deskripsi: input.deskripsi?.trim() || undefined,
  };
  return { ok: true, subject, subjects: [...existing, subject] };
}

export function updateMasterSubject(
  existing: MasterSubject[],
  id: string,
  input: { kode: string; nama: string; deskripsi?: string }
):
  | { ok: true; subject: MasterSubject; subjects: MasterSubject[] }
  | { ok: false; error: string } {
  const target = existing.find((s) => s.id === id);
  if (!target) return { ok: false, error: 'Mata pelajaran tidak ditemukan.' };
  const nama = input.nama.trim();
  const kode = input.kode.trim().toUpperCase();
  if (!nama) return { ok: false, error: 'Nama mata pelajaran wajib diisi.' };
  if (!kode) return { ok: false, error: 'Kode mata pelajaran wajib diisi.' };

  if (existing.some((s) => s.id !== id && s.nama.trim().toLowerCase() === nama.toLowerCase())) {
    return { ok: false, error: `Mata pelajaran "${nama}" sudah terdaftar.` };
  }
  if (existing.some((s) => s.id !== id && s.kode.trim().toUpperCase() === kode)) {
    return { ok: false, error: `Kode mata pelajaran "${kode}" sudah digunakan.` };
  }

  const subject: MasterSubject = {
    ...target,
    kode,
    nama,
    deskripsi: input.deskripsi?.trim() || undefined,
  };
  return {
    ok: true,
    subject,
    subjects: existing.map((s) => (s.id === id ? subject : s)),
  };
}

// ============================================================
// Teacher Schedules (Sub Menu: Jadwal Pelajaran Guru)
// ============================================================

export function sanitizeTeacherSchedules(rawList: unknown): TeacherSchedule[] {
  if (!Array.isArray(rawList)) return [];
  const out: TeacherSchedule[] = [];
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Partial<TeacherSchedule>;
    const hari = normalizeDayOfWeek(obj.hari);
    const teacherId = String(obj.teacher_user_id || '').trim();
    const kelas = String(obj.kelas || '').trim();
    const mapel = String(obj.mata_pelajaran || '').trim();
    if (!hari || !teacherId || !kelas || !mapel) continue;

    out.push({
      id: String(obj.id || `sch_${hari}_${teacherId}_${kelas}_${mapel}`).trim(),
      hari,
      teacher_user_id: teacherId,
      teacher_name: String(obj.teacher_name || 'Guru').trim(),
      kelas,
      mata_pelajaran: mapel,
      jam_mulai: normalizeTimeHHMM(obj.jam_mulai, '07:30'),
      jam_selesai: normalizeTimeHHMM(obj.jam_selesai, '09:00'),
      tahun_ajaran: resolveItemAcademicYear(obj.tahun_ajaran),
      semester: obj.semester ? normalizeSemester(obj.semester) : undefined,
    });
  }
  return out;
}

export function loadTeacherSchedules(): TeacherSchedule[] {
  try {
    const raw = localStorage.getItem(TEACHER_SCHEDULES_KEY);
    if (!raw) return [];
    return sanitizeTeacherSchedules(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function saveTeacherSchedules(schedules: TeacherSchedule[]): void {
  try {
    localStorage.setItem(TEACHER_SCHEDULES_KEY, JSON.stringify(schedules));
  } catch {
    // Ignore storage quota errors
  }
}

export function addTeacherSchedule(
  existing: TeacherSchedule[],
  input: {
    hari: DayOfWeek;
    teacher_user_id: string;
    teacher_name: string;
    kelas: string;
    mata_pelajaran: string;
    jam_mulai: string;
    jam_selesai: string;
    tahun_ajaran: string;
    semester?: SemesterKind;
  }
):
  | { ok: true; schedule: TeacherSchedule; schedules: TeacherSchedule[] }
  | { ok: false; error: string } {
  const hari = normalizeDayOfWeek(input.hari);
  const teacherId = input.teacher_user_id.trim();
  const teacherName = input.teacher_name.trim() || 'Guru';
  const kelas = input.kelas.trim();
  const mapel = input.mata_pelajaran.trim();
  const jamMulai = normalizeTimeHHMM(input.jam_mulai, '');
  const jamSelesai = normalizeTimeHHMM(input.jam_selesai, '');
  const tahunAjaran = resolveItemAcademicYear(input.tahun_ajaran);
  const semester = input.semester ? normalizeSemester(input.semester) : undefined;

  if (!hari) return { ok: false, error: 'Hari pelajaran wajib dipilih.' };
  if (!teacherId) return { ok: false, error: 'Guru pengampu wajib dipilih.' };
  if (!kelas) return { ok: false, error: 'Kelas wajib diisi.' };
  if (!mapel) return { ok: false, error: 'Mata pelajaran wajib dipilih.' };
  if (!jamMulai || !jamSelesai) {
    return { ok: false, error: 'Jam mulai dan jam selesai wajib diisi (format HH:MM).' };
  }

  const startMins = parseTimeToMinutes(jamMulai);
  const endMins = parseTimeToMinutes(jamSelesai);
  if (startMins !== null && endMins !== null && endMins <= startMins) {
    return { ok: false, error: 'Jam selesai harus lebih akhir daripada jam mulai.' };
  }

  const duplicate = existing.some(
    (s) =>
      s.hari === hari &&
      s.teacher_user_id === teacherId &&
      s.kelas.trim().toLowerCase() === kelas.toLowerCase() &&
      s.mata_pelajaran.trim().toLowerCase() === mapel.toLowerCase() &&
      resolveItemAcademicYear(s.tahun_ajaran) === tahunAjaran &&
      (!semester || !s.semester || s.semester === semester)
  );
  if (duplicate) {
    return {
      ok: false,
      error: `Jadwal ${mapel} kelas ${kelas} untuk ${teacherName} pada hari ${hari} sudah terdaftar.`,
    };
  }

  const schedule: TeacherSchedule = {
    id: `sch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    hari,
    teacher_user_id: teacherId,
    teacher_name: teacherName,
    kelas,
    mata_pelajaran: mapel,
    jam_mulai: jamMulai,
    jam_selesai: jamSelesai,
    tahun_ajaran: tahunAjaran,
    semester,
  };

  return { ok: true, schedule, schedules: [...existing, schedule] };
}

export function updateTeacherSchedule(
  existing: TeacherSchedule[],
  id: string,
  input: {
    hari: DayOfWeek;
    teacher_user_id: string;
    teacher_name: string;
    kelas: string;
    mata_pelajaran: string;
    jam_mulai: string;
    jam_selesai: string;
    tahun_ajaran: string;
    semester?: SemesterKind;
  }
):
  | { ok: true; schedule: TeacherSchedule; schedules: TeacherSchedule[] }
  | { ok: false; error: string } {
  const target = existing.find((s) => s.id === id);
  if (!target) return { ok: false, error: 'Jadwal tidak ditemukan.' };
  const others = existing.filter((s) => s.id !== id);
  const check = addTeacherSchedule(others, input);
  if (!check.ok) return check;

  const updated: TeacherSchedule = {
    ...check.schedule,
    id,
  };
  return {
    ok: true,
    schedule: updated,
    schedules: existing.map((s) => (s.id === id ? updated : s)),
  };
}

export function generateDemoTeacherSchedules(
  academicYear: string,
  semester: SemesterKind = 'ganjil'
): TeacherSchedule[] {
  return [
    {
      id: `sch_senin_guru_xipa1_mtk_${academicYear}`,
      hari: 'Senin',
      teacher_user_id: 'usr_guru',
      teacher_name: 'Siti Aminah, S.Pd',
      kelas: 'X IPA 1',
      mata_pelajaran: 'Matematika',
      jam_mulai: '07:30',
      jam_selesai: '09:00',
      tahun_ajaran: academicYear,
      semester,
    },
    {
      id: `sch_senin_wali_xipa1_fis_${academicYear}`,
      hari: 'Senin',
      teacher_user_id: 'usr_walikelas',
      teacher_name: 'Budi Santoso, S.Pd',
      kelas: 'X IPA 1',
      mata_pelajaran: 'Fisika',
      jam_mulai: '09:15',
      jam_selesai: '10:45',
      tahun_ajaran: academicYear,
      semester,
    },
    {
      id: `sch_rabu_guru_xipa2_mtk_${academicYear}`,
      hari: 'Rabu',
      teacher_user_id: 'usr_guru',
      teacher_name: 'Siti Aminah, S.Pd',
      kelas: 'X IPA 2',
      mata_pelajaran: 'Matematika',
      jam_mulai: '08:00',
      jam_selesai: '09:30',
      tahun_ajaran: academicYear,
      semester,
    },
    {
      id: `sch_jumat_guru_xipa1_mtk_${academicYear}`,
      hari: 'Jumat',
      teacher_user_id: 'usr_guru',
      teacher_name: 'Siti Aminah, S.Pd',
      kelas: 'X IPA 1',
      mata_pelajaran: 'Matematika',
      jam_mulai: '07:30',
      jam_selesai: '09:00',
      tahun_ajaran: academicYear,
      semester,
    },
    {
      id: `sch_jumat_wali_xipa2_fis_${academicYear}`,
      hari: 'Jumat',
      teacher_user_id: 'usr_walikelas',
      teacher_name: 'Budi Santoso, S.Pd',
      kelas: 'X IPA 2',
      mata_pelajaran: 'Fisika',
      jam_mulai: '09:15',
      jam_selesai: '10:45',
      tahun_ajaran: academicYear,
      semester,
    },
  ];
}

// ============================================================
// Subject Assignments & Records
// ============================================================

export function sanitizeSubjectAssignments(rawList: unknown): SubjectAssignment[] {
  if (!Array.isArray(rawList)) return [];
  const out: SubjectAssignment[] = [];
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Partial<SubjectAssignment>;
    const kelas = String(obj.kelas || '').trim();
    const mapel = String(obj.mata_pelajaran || '').trim();
    const teacherId = String(obj.teacher_user_id || '').trim();
    if (!kelas || !mapel || !teacherId) continue;
    out.push({
      id: String(obj.id || `mapel_${teacherId}_${kelas}_${mapel}`).trim(),
      teacher_user_id: teacherId,
      teacher_name: String(obj.teacher_name || 'Guru').trim(),
      kelas,
      mata_pelajaran: mapel,
      hari: normalizeDayOfWeek(obj.hari),
      jam_mulai: obj.jam_mulai ? normalizeTimeHHMM(obj.jam_mulai, '') || undefined : undefined,
      jam_selesai: obj.jam_selesai ? normalizeTimeHHMM(obj.jam_selesai, '') || undefined : undefined,
      tahun_ajaran: resolveItemAcademicYear(obj.tahun_ajaran),
      semester: obj.semester ? normalizeSemester(obj.semester) : undefined,
      source: obj.source === 'schedule' || obj.source === 'record' ? obj.source : 'manual',
    });
  }
  return out;
}

export function sanitizeSubjectRecords(rawList: unknown): SubjectAttendanceRecord[] {
  if (!Array.isArray(rawList)) return [];
  const validStatuses = new Set<AttendanceStatus>([
    'Hadir',
    'Terlambat',
    'Sakit',
    'Izin',
    'Alpa',
  ]);
  const out: SubjectAttendanceRecord[] = [];
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Partial<SubjectAttendanceRecord>;
    const tanggal = String(obj.tanggal || '').trim();
    const assignmentId = String(obj.assignment_id || '').trim();
    const nis = String(obj.nis || '').trim();
    if (!tanggal || !assignmentId || !nis) continue;
    const rawStatus = String(obj.status || 'Hadir') as AttendanceStatus;
    out.push({
      id: String(obj.id || `${tanggal}_${assignmentId}_${nis}`).trim(),
      assignment_id: assignmentId,
      tanggal,
      kelas: String(obj.kelas || '-').trim(),
      mata_pelajaran: String(obj.mata_pelajaran || '-').trim(),
      teacher_user_id: String(obj.teacher_user_id || '').trim(),
      teacher_name: String(obj.teacher_name || 'Guru').trim(),
      nis,
      nama: String(obj.nama || nis).trim(),
      jam_masuk: String(obj.jam_masuk || '-').trim(),
      status: validStatuses.has(rawStatus) ? rawStatus : 'Hadir',
      keterangan: obj.keterangan ? String(obj.keterangan).trim() : undefined,
      tahun_ajaran: resolveItemAcademicYear(obj.tahun_ajaran),
    });
  }
  return out;
}

export function loadSubjectAssignments(): SubjectAssignment[] {
  try {
    const raw = localStorage.getItem(SUBJECT_ASSIGNMENTS_KEY);
    if (!raw) return [];
    return sanitizeSubjectAssignments(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function saveSubjectAssignments(assignments: SubjectAssignment[]): void {
  try {
    localStorage.setItem(SUBJECT_ASSIGNMENTS_KEY, JSON.stringify(assignments));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadSubjectRecords(): SubjectAttendanceRecord[] {
  try {
    const raw = localStorage.getItem(SUBJECT_RECORDS_KEY);
    if (!raw) return [];
    return sanitizeSubjectRecords(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function saveSubjectRecords(records: SubjectAttendanceRecord[]): void {
  try {
    localStorage.setItem(SUBJECT_RECORDS_KEY, JSON.stringify(records));
  } catch {
    // Ignore storage quota errors
  }
}

export function generateDemoSubjectAssignments(
  academicYear: string
): SubjectAssignment[] {
  return [
    {
      id: `asg_guru_xipa1_mtk_${academicYear}`,
      teacher_user_id: 'usr_guru',
      teacher_name: 'Siti Aminah, S.Pd',
      kelas: 'X IPA 1',
      mata_pelajaran: 'Matematika',
      hari: 'Jumat',
      jam_mulai: '07:30',
      tahun_ajaran: academicYear,
      source: 'manual',
    },
    {
      id: `asg_guru_xipa2_mtk_${academicYear}`,
      teacher_user_id: 'usr_guru',
      teacher_name: 'Siti Aminah, S.Pd',
      kelas: 'X IPA 2',
      mata_pelajaran: 'Matematika',
      hari: 'Rabu',
      jam_mulai: '09:00',
      tahun_ajaran: academicYear,
      source: 'manual',
    },
    {
      id: `asg_wali_xipa1_fisika_${academicYear}`,
      teacher_user_id: 'usr_walikelas',
      teacher_name: 'Budi Santoso, S.Pd',
      kelas: 'X IPA 1',
      mata_pelajaran: 'Fisika',
      hari: 'Senin',
      jam_mulai: '08:15',
      tahun_ajaran: academicYear,
      source: 'manual',
    },
    {
      id: `asg_wali_xiipa1_fisika_${academicYear}`,
      teacher_user_id: 'usr_walikelas',
      teacher_name: 'Budi Santoso, S.Pd',
      kelas: 'XI IPA 1',
      mata_pelajaran: 'Fisika',
      hari: 'Kamis',
      jam_mulai: '10:15',
      tahun_ajaran: academicYear,
      source: 'manual',
    },
  ];
}

export function addSubjectAssignment(
  existing: SubjectAssignment[],
  input: {
    teacher_user_id: string;
    teacher_name: string;
    kelas: string;
    mata_pelajaran: string;
    hari?: DayOfWeek;
    jam_mulai?: string;
    jam_selesai?: string;
    tahun_ajaran: string;
    semester?: SemesterKind;
  }
):
  | { ok: true; assignment: SubjectAssignment; assignments: SubjectAssignment[] }
  | { ok: false; error: string } {
  const kelas = input.kelas.trim();
  const mapel = input.mata_pelajaran.trim();
  const teacherId = input.teacher_user_id.trim();
  const teacherName = input.teacher_name.trim() || 'Guru';
  const tahunAjaran = resolveItemAcademicYear(input.tahun_ajaran);
  const hari = input.hari ? normalizeDayOfWeek(input.hari) : undefined;

  if (!kelas) {
    return { ok: false, error: 'Nama kelas wajib diisi.' };
  }
  if (!mapel) {
    return { ok: false, error: 'Nama mata pelajaran wajib diisi.' };
  }

  const duplicate = existing.some(
    (a) =>
      a.teacher_user_id === teacherId &&
      a.kelas.trim().toLowerCase() === kelas.toLowerCase() &&
      a.mata_pelajaran.trim().toLowerCase() === mapel.toLowerCase() &&
      resolveItemAcademicYear(a.tahun_ajaran) === tahunAjaran &&
      (!hari || !a.hari || a.hari === hari)
  );

  if (duplicate) {
    return {
      ok: false,
      error: hari
        ? `Kelas ${kelas} untuk mata pelajaran ${mapel} pada hari ${hari} sudah ada di daftar Anda.`
        : `Kelas ${kelas} untuk mata pelajaran ${mapel} sudah ada di daftar Anda.`,
    };
  }

  const rawJam = (input.jam_mulai || '').trim();
  const jamMulai = rawJam ? normalizeTimeHHMM(rawJam, '') || undefined : undefined;
  const rawJamSelesai = (input.jam_selesai || '').trim();
  const jamSelesai = rawJamSelesai
    ? normalizeTimeHHMM(rawJamSelesai, '') || undefined
    : undefined;

  const assignment: SubjectAssignment = {
    id: `asg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    teacher_user_id: teacherId,
    teacher_name: teacherName,
    kelas,
    mata_pelajaran: mapel,
    hari,
    jam_mulai: jamMulai,
    jam_selesai: jamSelesai,
    tahun_ajaran: tahunAjaran,
    semester: input.semester ? normalizeSemester(input.semester) : undefined,
    source: 'manual',
  };

  return {
    ok: true,
    assignment,
    assignments: [...existing, assignment],
  };
}

/**
 * Resolves the exact list of SubjectAssignments that exist on `selectedDate`:
 * - Matches TeacherSchedules whose `hari` matches `getIndonesianDayOfWeek(selectedDate)`
 *   (and active academicYear + semester when configured).
 * - Matches manual SubjectAssignments whose `hari` matches that day of week.
 * - Includes any subject that already has attendance records on `selectedDate`
 *   (even if its schedule was later changed or it was created without `hari`).
 * - Returns an empty list when no scheduled or recorded subject exists on `selectedDate`.
 */
export function resolveAssignmentsForDate(params: {
  selectedDate: string;
  academicYear: string;
  semester?: SemesterKind;
  schedules: TeacherSchedule[];
  manualAssignments: SubjectAssignment[];
  records: SubjectAttendanceRecord[];
  role: UserRole;
  teacherUserId?: string;
}): SubjectAssignment[] {
  const {
    selectedDate,
    academicYear,
    semester,
    schedules,
    manualAssignments,
    records,
    role,
    teacherUserId,
  } = params;

  const dayName = getIndonesianDayOfWeek(selectedDate);
  const normYear = resolveItemAcademicYear(academicYear);
  const normSemester = semester ? normalizeSemester(semester) : undefined;
  const isAdmin = role === 'master_admin';

  const byKey = new Map<string, SubjectAssignment>();
  const makeKey = (tId: string, kelas: string, mapel: string) =>
    `${tId.trim().toLowerCase()}|${kelas.trim().toLowerCase()}|${mapel.trim().toLowerCase()}`;

  // 1. Authoritative schedules from Master Admin (Mapel & Jadwal)
  for (const sch of schedules) {
    if (resolveItemAcademicYear(sch.tahun_ajaran) !== normYear) continue;
    if (sch.hari !== dayName) continue;
    if (normSemester && sch.semester && sch.semester !== normSemester) continue;
    if (!isAdmin && sch.teacher_user_id !== teacherUserId) continue;

    const key = makeKey(sch.teacher_user_id, sch.kelas, sch.mata_pelajaran);
    byKey.set(key, {
      id: sch.id,
      teacher_user_id: sch.teacher_user_id,
      teacher_name: sch.teacher_name,
      kelas: sch.kelas,
      mata_pelajaran: sch.mata_pelajaran,
      hari: sch.hari,
      jam_mulai: sch.jam_mulai,
      jam_selesai: sch.jam_selesai,
      tahun_ajaran: sch.tahun_ajaran,
      semester: sch.semester,
      source: 'schedule',
    });
  }

  // 2. Manual assignments added by teachers matching this day of week
  for (const asg of manualAssignments) {
    if (resolveItemAcademicYear(asg.tahun_ajaran) !== normYear) continue;
    if (!isAdmin && asg.teacher_user_id !== teacherUserId) continue;
    if (normSemester && asg.semester && asg.semester !== normSemester) continue;
    if (!asg.hari || asg.hari !== dayName) continue;

    const key = makeKey(asg.teacher_user_id, asg.kelas, asg.mata_pelajaran);
    if (!byKey.has(key)) {
      byKey.set(key, { ...asg, source: 'manual' });
    }
  }

  // 3. Any attendance records already recorded on this exact selectedDate
  for (const rec of records) {
    if (rec.tanggal !== selectedDate) continue;
    if (resolveItemAcademicYear(rec.tahun_ajaran) !== normYear) continue;
    if (!isAdmin && rec.teacher_user_id !== teacherUserId) continue;

    const key = makeKey(rec.teacher_user_id, rec.kelas, rec.mata_pelajaran);
    if (!byKey.has(key)) {
      const existingManual = manualAssignments.find((a) => a.id === rec.assignment_id);
      byKey.set(key, {
        id: rec.assignment_id,
        teacher_user_id: rec.teacher_user_id,
        teacher_name: rec.teacher_name,
        kelas: rec.kelas,
        mata_pelajaran: rec.mata_pelajaran,
        hari: dayName,
        jam_mulai: existingManual?.jam_mulai,
        jam_selesai: existingManual?.jam_selesai,
        tahun_ajaran: rec.tahun_ajaran,
        source: existingManual ? 'manual' : 'record',
      });
    }
  }

  return Array.from(byKey.values()).sort(
    (a, b) =>
      (a.jam_mulai || '99:99').localeCompare(b.jam_mulai || '99:99') ||
      a.kelas.localeCompare(b.kelas) ||
      a.mata_pelajaran.localeCompare(b.mata_pelajaran)
  );
}

/**
 * Matches all subject attendance records belonging to a resolved SubjectAssignment on `selectedDate`.
 * Matches either by exact `assignment_id` OR by (kelas + mata_pelajaran + teacher_user_id) on `selectedDate`
 * so scheduled and manual records stay cleanly unified.
 */
export function getRecordsForAssignmentOnDate(
  records: SubjectAttendanceRecord[],
  assignment: SubjectAssignment,
  selectedDate: string
): SubjectAttendanceRecord[] {
  const normKelas = assignment.kelas.trim().toLowerCase();
  const normMapel = assignment.mata_pelajaran.trim().toLowerCase();
  return records.filter(
    (r) =>
      r.tanggal === selectedDate &&
      (r.assignment_id === assignment.id ||
        (r.kelas.trim().toLowerCase() === normKelas &&
          r.mata_pelajaran.trim().toLowerCase() === normMapel &&
          r.teacher_user_id === assignment.teacher_user_id))
  );
}

export type SubjectScanOutcome =
  | {
      ok: true;
      student: Student;
      record: SubjectAttendanceRecord;
    }
  | {
      ok: false;
      reason: 'invalid_qr' | 'not_found' | 'wrong_class' | 'duplicate';
      nis?: string;
      student?: Student;
      existingRecord?: SubjectAttendanceRecord;
    };

export function processSubjectQrScan(params: {
  qrRaw: string;
  assignment: SubjectAssignment;
  students: Student[];
  records: SubjectAttendanceRecord[];
  tanggal?: string;
  currentTime?: string;
}): SubjectScanOutcome {
  const nis = params.qrRaw.trim();
  if (!nis) {
    return { ok: false, reason: 'invalid_qr' };
  }

  const normalizedNis = nis.toLowerCase();
  const student = params.students.find(
    (s) => s.nis.trim().toLowerCase() === normalizedNis
  );
  if (!student) {
    return { ok: false, reason: 'not_found', nis };
  }

  const assignmentClassNorm = params.assignment.kelas.trim().toLowerCase();
  if (student.kelas.trim().toLowerCase() !== assignmentClassNorm) {
    return { ok: false, reason: 'wrong_class', nis: student.nis, student };
  }

  const tanggal = params.tanggal || getTodayDateString();
  const sessionRecs = getRecordsForAssignmentOnDate(
    params.records,
    params.assignment,
    tanggal
  );
  const existing = sessionRecs.find(
    (r) => r.nis.trim().toLowerCase() === normalizedNis
  );
  if (existing) {
    return {
      ok: false,
      reason: 'duplicate',
      nis: student.nis,
      student,
      existingRecord: existing,
    };
  }

  const jamMasuk = params.currentTime || getCurrentTimeString();
  let status: AttendanceStatus = 'Hadir';
  if (params.assignment.jam_mulai) {
    const startMins = parseTimeToMinutes(params.assignment.jam_mulai);
    const nowMins = parseTimeToMinutes(jamMasuk);
    if (startMins !== null && nowMins !== null && nowMins > startMins) {
      status = 'Terlambat';
    }
  }

  const record: SubjectAttendanceRecord = {
    id: `${tanggal}_${params.assignment.id}_${student.nis}`,
    assignment_id: params.assignment.id,
    tanggal,
    kelas: params.assignment.kelas,
    mata_pelajaran: params.assignment.mata_pelajaran,
    teacher_user_id: params.assignment.teacher_user_id,
    teacher_name: params.assignment.teacher_name,
    nis: student.nis,
    nama: student.nama,
    jam_masuk: jamMasuk,
    status,
    keterangan:
      status === 'Terlambat'
        ? `Masuk mapel melewati jam ${params.assignment.jam_mulai}`
        : `Hadir mata pelajaran ${params.assignment.mata_pelajaran}`,
    tahun_ajaran: params.assignment.tahun_ajaran,
  };

  return { ok: true, student, record };
}

export function upsertSubjectAttendanceStatus(params: {
  records: SubjectAttendanceRecord[];
  assignment: SubjectAssignment;
  student: Student;
  tanggal: string;
  status: AttendanceStatus;
  currentTime?: string;
}): { record: SubjectAttendanceRecord; records: SubjectAttendanceRecord[] } {
  const normNis = params.student.nis.trim().toLowerCase();
  const sessionRecs = getRecordsForAssignmentOnDate(
    params.records,
    params.assignment,
    params.tanggal
  );
  const existing = sessionRecs.find(
    (r) => r.nis.trim().toLowerCase() === normNis
  );

  const isPresent = params.status === 'Hadir' || params.status === 'Terlambat';
  const jamMasuk =
    existing && existing.jam_masuk && existing.jam_masuk !== '-'
      ? existing.jam_masuk
      : isPresent
        ? params.currentTime || getCurrentTimeString()
        : '-';

  const updated: SubjectAttendanceRecord = existing
    ? {
        ...existing,
        status: params.status,
        jam_masuk: jamMasuk,
        keterangan: `Diubah guru (${params.status})`,
      }
    : {
        id: `${params.tanggal}_${params.assignment.id}_${params.student.nis}`,
        assignment_id: params.assignment.id,
        tanggal: params.tanggal,
        kelas: params.assignment.kelas,
        mata_pelajaran: params.assignment.mata_pelajaran,
        teacher_user_id: params.assignment.teacher_user_id,
        teacher_name: params.assignment.teacher_name,
        nis: params.student.nis,
        nama: params.student.nama,
        jam_masuk: jamMasuk,
        status: params.status,
        keterangan: `Dicatat guru (${params.status})`,
        tahun_ajaran: params.assignment.tahun_ajaran,
      };

  const nextRecords = existing
    ? params.records.map((r) => (r.id === existing.id ? updated : r))
    : [updated, ...params.records];

  return { record: updated, records: nextRecords };
}

export interface SubjectSessionSummary {
  totalStudents: number;
  hadir: number;
  terlambat: number;
  sakit: number;
  izin: number;
  alpa: number;
  belumPresensi: number;
  persentaseHadir: number;
}

export function computeSubjectSessionSummary(
  classStudents: Student[],
  sessionRecords: SubjectAttendanceRecord[]
): SubjectSessionSummary {
  const byNis = new Map<string, SubjectAttendanceRecord>();
  for (const r of sessionRecords) {
    byNis.set(r.nis.trim().toLowerCase(), r);
  }

  let hadir = 0;
  let terlambat = 0;
  let sakit = 0;
  let izin = 0;
  let alpa = 0;
  let belumPresensi = 0;

  for (const student of classStudents) {
    const rec = byNis.get(student.nis.trim().toLowerCase());
    if (!rec) {
      belumPresensi++;
      continue;
    }
    if (rec.status === 'Hadir') hadir++;
    else if (rec.status === 'Terlambat') terlambat++;
    else if (rec.status === 'Sakit') sakit++;
    else if (rec.status === 'Izin') izin++;
    else alpa++;
  }

  const totalStudents = classStudents.length;
  const persentaseHadir =
    totalStudents > 0 ? Math.round(((hadir + terlambat) / totalStudents) * 100) : 0;

  return {
    totalStudents,
    hadir,
    terlambat,
    sakit,
    izin,
    alpa,
    belumPresensi,
    persentaseHadir,
  };
}
