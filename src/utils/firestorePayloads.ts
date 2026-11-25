import type {
  AppThemeId,
  AttendanceRecord,
  AttendanceScheduleMode,
  AttendanceStatus,
  DayOfWeek,
  LateCorrectionRequest,
  MasterSubject,
  SchoolSettings,
  SemesterKind,
  Student,
  SubjectAssignment,
  SubjectAttendanceRecord,
  TeacherSchedule,
  UserAccount,
  UserRole,
} from '../types';
import {
  normalizeAttendanceStatus,
  normalizeScheduleMode,
  normalizeTimeHHMM,
  resolveItemAcademicYear,
} from './attendanceLogic';
import { normalizeSemester } from './subjectAttendance';
import { normalizeThemeId } from './themes';

const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;
const VALID_DAYS: ReadonlySet<DayOfWeek> = new Set([
  'Senin',
  'Selasa',
  'Rabu',
  'Kamis',
  'Jumat',
  'Sabtu',
  'Minggu',
]);
const VALID_ROLES: ReadonlySet<UserRole> = new Set([
  'master_admin',
  'kepala_sekolah',
  'wali_kelas',
  'guru',
]);
const DATE_YMD_REGEX = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;

function fnv1aHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Deterministically maps any raw identifier into a Firestore-rule-safe document ID
 * matching `^[a-zA-Z0-9_-]{1,128}$`.
 */
export function toSafeFirestoreDocId(raw: string, fallbackPrefix = 'doc'): string {
  const trimmed = (raw || '').trim();
  if (trimmed && SAFE_ID_REGEX.test(trimmed)) {
    return trimmed;
  }
  const source = trimmed || fallbackPrefix;
  const cleaned = source
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96);
  const hash = fnv1aHash(source);
  const combined = cleaned ? `${cleaned}_${hash}` : `${fallbackPrefix}_${hash}`;
  return combined.slice(0, 128);
}

export function clampString(val: string | undefined | null, maxLen: number, fallback = ''): string {
  const raw = typeof val === 'string' ? val.trim() : '';
  const resolved = raw || fallback;
  return resolved.length > maxLen ? resolved.slice(0, maxLen) : resolved;
}

export function sanitizeDataUrl(val: string | undefined | null, maxLen = 150000): string {
  if (typeof val !== 'string') return '';
  const trimmed = val.trim();
  if (!trimmed) return '';
  if (trimmed.length > maxLen) {
    return '';
  }
  return trimmed;
}

export function sanitizeOptionalHttpsUrl(val: string | undefined | null, maxLen = 500): string {
  if (typeof val !== 'string') return '';
  const trimmed = val.trim();
  if (!trimmed) return '';
  if (!trimmed.startsWith('https://')) return '';
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

export function normalizeDateYMD(val: string | undefined | null): string {
  const trimmed = (val || '').trim();
  if (DATE_YMD_REGEX.test(trimmed)) return trimmed;
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function studentDocId(student: Pick<Student, 'nis' | 'tahun_ajaran'>): string {
  const yr = resolveItemAcademicYear(student.tahun_ajaran);
  return toSafeFirestoreDocId(`${yr}_${student.nis.trim().toLowerCase()}`, 'stu');
}

export function attendanceDocId(record: Pick<AttendanceRecord, 'id' | 'tanggal' | 'nis'>): string {
  const base = record.id?.trim() || `${record.tanggal}_${record.nis}`;
  return toSafeFirestoreDocId(base, 'att');
}

export function lateCorrectionDocId(
  req: Pick<LateCorrectionRequest, 'id' | 'tanggal' | 'nis'>
): string {
  const base = req.id?.trim() || `lcr_${req.tanggal}_${req.nis}`;
  return toSafeFirestoreDocId(base, 'lcr');
}

export function buildSchoolConfigCreatePayload<T>(
  ownerId: string,
  settings: SchoolSettings,
  timestampValue: T
) {
  return {
    ownerId,
    nama_sekolah: clampString(settings.nama_sekolah, 200, 'SMA Negeri 1 Kabun'),
    nama_kepala_sekolah: clampString(settings.nama_kepala_sekolah, 160),
    nip_kepala_sekolah: clampString(settings.nip_kepala_sekolah, 64),
    ttd_kepala_sekolah: sanitizeDataUrl(settings.ttd_kepala_sekolah, 150000),
    cap_sekolah: sanitizeDataUrl(settings.cap_sekolah, 150000),
    logo_sekolah: sanitizeDataUrl(settings.logo_sekolah, 150000),
    batas_jam_masuk: normalizeTimeHHMM(settings.batas_jam_masuk, '07:15'),
    mode_presensi: normalizeScheduleMode(settings.mode_presensi, 'masuk_saja'),
    jam_pulang_standar: normalizeTimeHHMM(settings.jam_pulang_standar, '15:00'),
    tahun_ajaran: clampString(settings.tahun_ajaran, 32, '2026/2027'),
    semester: normalizeSemester(settings.semester, 'ganjil'),
    tema: clampString(normalizeThemeId(settings.tema, 'indigo'), 32, 'indigo'),
    script_url: sanitizeOptionalHttpsUrl(settings.script_url, 500),
    no_wa_admin: clampString(settings.no_wa_admin, 32),
    show_creator_credit: settings.show_creator_credit !== false,
    createdAt: timestampValue,
    updatedAt: timestampValue,
  };
}

export function buildSchoolConfigUpdatePayload<T>(
  settings: SchoolSettings,
  timestampValue: T
) {
  return {
    nama_sekolah: clampString(settings.nama_sekolah, 200, 'SMA Negeri 1 Kabun'),
    nama_kepala_sekolah: clampString(settings.nama_kepala_sekolah, 160),
    nip_kepala_sekolah: clampString(settings.nip_kepala_sekolah, 64),
    ttd_kepala_sekolah: sanitizeDataUrl(settings.ttd_kepala_sekolah, 150000),
    cap_sekolah: sanitizeDataUrl(settings.cap_sekolah, 150000),
    logo_sekolah: sanitizeDataUrl(settings.logo_sekolah, 150000),
    batas_jam_masuk: normalizeTimeHHMM(settings.batas_jam_masuk, '07:15'),
    mode_presensi: normalizeScheduleMode(settings.mode_presensi, 'masuk_saja'),
    jam_pulang_standar: normalizeTimeHHMM(settings.jam_pulang_standar, '15:00'),
    tahun_ajaran: clampString(settings.tahun_ajaran, 32, '2026/2027'),
    semester: normalizeSemester(settings.semester, 'ganjil'),
    tema: clampString(normalizeThemeId(settings.tema, 'indigo'), 32, 'indigo'),
    script_url: sanitizeOptionalHttpsUrl(settings.script_url, 500),
    no_wa_admin: clampString(settings.no_wa_admin, 32),
    show_creator_credit: settings.show_creator_credit !== false,
    updatedAt: timestampValue,
  };
}

export function buildStudentPayload<T>(
  ownerId: string,
  student: Student,
  timestampValue: T
) {
  const yr = clampString(resolveItemAcademicYear(student.tahun_ajaran), 32, '2026/2027');
  return {
    ownerId,
    nis: clampString(student.nis, 64, '0'),
    nama: clampString(student.nama, 160, 'Siswa'),
    kelas: clampString(student.kelas, 64, 'Umum'),
    gender: student.gender === 'P' ? ('P' as const) : ('L' as const),
    no_wa_ortu: clampString(student.no_wa_ortu, 32),
    tahun_ajaran: yr.length >= 4 ? yr : '2026/2027',
    updatedAt: timestampValue,
  };
}

export function buildAttendancePayload<T>(
  ownerId: string,
  record: AttendanceRecord,
  timestampValue: T
) {
  const status: AttendanceStatus = normalizeAttendanceStatus(record.status) ?? 'Hadir';
  const yr = clampString(resolveItemAcademicYear(record.tahun_ajaran), 32, '2026/2027');
  return {
    ownerId,
    id: clampString(record.id, 128, `${normalizeDateYMD(record.tanggal)}_${record.nis}`),
    tanggal: normalizeDateYMD(record.tanggal),
    nis: clampString(record.nis, 64, '0'),
    nama: clampString(record.nama, 160, 'Siswa'),
    kelas: clampString(record.kelas, 64, 'Umum'),
    jam_masuk: clampString(record.jam_masuk, 16, '-'),
    jam_pulang: clampString(record.jam_pulang, 16, '-'),
    alasan_pulang_cepat: clampString(record.alasan_pulang_cepat, 300),
    status,
    keterangan: clampString(record.keterangan, 400),
    tahun_ajaran: yr.length >= 4 ? yr : '2026/2027',
    updatedAt: timestampValue,
  };
}

export function buildMasterSubjectPayload<T>(
  ownerId: string,
  subject: MasterSubject,
  timestampValue: T
) {
  return {
    ownerId,
    id: clampString(subject.id, 128, toSafeFirestoreDocId(subject.kode || subject.nama, 'subj')),
    kode: clampString(subject.kode, 32, 'MPL'),
    nama: clampString(subject.nama, 120, 'Mata Pelajaran'),
    deskripsi: clampString(subject.deskripsi, 300),
    updatedAt: timestampValue,
  };
}

export function buildTeacherSchedulePayload<T>(
  ownerId: string,
  schedule: TeacherSchedule,
  timestampValue: T
) {
  const hari: DayOfWeek = VALID_DAYS.has(schedule.hari) ? schedule.hari : 'Senin';
  const yr = clampString(resolveItemAcademicYear(schedule.tahun_ajaran), 32, '2026/2027');
  return {
    ownerId,
    id: clampString(schedule.id, 128, toSafeFirestoreDocId(`${hari}_${schedule.kelas}`, 'sch')),
    hari,
    teacher_user_id: clampString(schedule.teacher_user_id, 128, 'usr_guru'),
    teacher_name: clampString(schedule.teacher_name, 160, 'Guru'),
    kelas: clampString(schedule.kelas, 64, 'Umum'),
    mata_pelajaran: clampString(schedule.mata_pelajaran, 120, 'Umum'),
    jam_mulai: normalizeTimeHHMM(schedule.jam_mulai, '07:00'),
    jam_selesai: normalizeTimeHHMM(schedule.jam_selesai, '08:30'),
    tahun_ajaran: yr.length >= 4 ? yr : '2026/2027',
    semester: normalizeSemester(schedule.semester, 'ganjil'),
    updatedAt: timestampValue,
  };
}

export function buildSubjectAssignmentPayload<T>(
  ownerId: string,
  assignment: SubjectAssignment,
  timestampValue: T
) {
  const yr = clampString(resolveItemAcademicYear(assignment.tahun_ajaran), 32, '2026/2027');
  const source: 'schedule' | 'manual' | 'record' =
    assignment.source === 'schedule' || assignment.source === 'record'
      ? assignment.source
      : 'manual';
  return {
    ownerId,
    id: clampString(assignment.id, 128, toSafeFirestoreDocId(`${assignment.kelas}_${assignment.mata_pelajaran}`, 'asg')),
    teacher_user_id: clampString(assignment.teacher_user_id, 128, 'usr_guru'),
    teacher_name: clampString(assignment.teacher_name, 160, 'Guru'),
    kelas: clampString(assignment.kelas, 64, 'Umum'),
    mata_pelajaran: clampString(assignment.mata_pelajaran, 120, 'Umum'),
    hari: clampString(assignment.hari, 16),
    jam_mulai: clampString(assignment.jam_mulai, 8),
    jam_selesai: clampString(assignment.jam_selesai, 8),
    tahun_ajaran: yr.length >= 4 ? yr : '2026/2027',
    semester: normalizeSemester(assignment.semester, 'ganjil'),
    source,
    updatedAt: timestampValue,
  };
}

export function buildSubjectRecordPayload<T>(
  ownerId: string,
  record: SubjectAttendanceRecord,
  timestampValue: T
) {
  const status: AttendanceStatus = normalizeAttendanceStatus(record.status) ?? 'Hadir';
  const yr = clampString(resolveItemAcademicYear(record.tahun_ajaran), 32, '2026/2027');
  return {
    ownerId,
    id: clampString(record.id, 128, toSafeFirestoreDocId(`${record.tanggal}_${record.assignment_id}_${record.nis}`, 'srec')),
    assignment_id: clampString(record.assignment_id, 128, 'asg_default'),
    tanggal: normalizeDateYMD(record.tanggal),
    kelas: clampString(record.kelas, 64, 'Umum'),
    mata_pelajaran: clampString(record.mata_pelajaran, 120, 'Umum'),
    teacher_user_id: clampString(record.teacher_user_id, 128, 'usr_guru'),
    teacher_name: clampString(record.teacher_name, 160, 'Guru'),
    nis: clampString(record.nis, 64, '0'),
    nama: clampString(record.nama, 160, 'Siswa'),
    jam_masuk: clampString(record.jam_masuk, 16, '-'),
    status,
    keterangan: clampString(record.keterangan, 400),
    tahun_ajaran: yr.length >= 4 ? yr : '2026/2027',
    updatedAt: timestampValue,
  };
}

export function buildUserAccountPayload<T>(
  ownerId: string,
  account: UserAccount,
  timestampValue: T
) {
  const role: UserRole = VALID_ROLES.has(account.role) ? account.role : 'guru';
  return {
    ownerId,
    id: clampString(account.id, 128, toSafeFirestoreDocId(account.username, 'usr')),
    username: clampString(account.username, 64, 'user'),
    password: clampString(account.password, 128, '123'),
    nama: clampString(account.nama, 160, 'Pengguna'),
    nip: clampString(account.nip, 64),
    role,
    jabatan: clampString(account.jabatan, 120, 'Guru'),
    kelas_binaan: clampString(account.kelas_binaan, 64),
    foto_profil: clampString(account.foto_profil, 150000),
    updatedAt: timestampValue,
  };
}

export function buildLateCorrectionRequestPayload<T>(
  ownerId: string,
  req: LateCorrectionRequest,
  timestampValue: T
) {
  const status: LateCorrectionRequest['status'] =
    req.status === 'approved' || req.status === 'rejected' ? req.status : 'pending';
  const yr = clampString(resolveItemAcademicYear(req.tahun_ajaran), 32, '2026/2027');
  return {
    ownerId,
    id: clampString(req.id, 128, lateCorrectionDocId(req)),
    tanggal: normalizeDateYMD(req.tanggal),
    nis: clampString(req.nis, 64, '0'),
    nama: clampString(req.nama, 160, 'Siswa'),
    kelas: clampString(req.kelas, 64, 'Umum'),
    jam_masuk_asal: clampString(req.jam_masuk_asal, 16, '-'),
    alasan: clampString(req.alasan, 400, 'Kendala perjalanan'),
    requested_by_user_id: clampString(req.requested_by_user_id, 128, 'usr_walikelas'),
    requested_by_name: clampString(req.requested_by_name, 160, 'Wali Kelas'),
    requested_at: clampString(req.requested_at, 64, new Date().toISOString()),
    status,
    resolved_by_name: clampString(req.resolved_by_name, 160),
    resolved_at: clampString(req.resolved_at, 64),
    catatan_admin: clampString(req.catatan_admin, 300),
    tahun_ajaran: yr.length >= 4 ? yr : '2026/2027',
    updatedAt: timestampValue,
  };
}

export function extractSchoolSettingsFromDoc(
  data: Record<string, unknown>,
  fallback: SchoolSettings
): SchoolSettings {
  return {
    nama_sekolah:
      typeof data.nama_sekolah === 'string' && data.nama_sekolah.trim()
        ? data.nama_sekolah.trim()
        : fallback.nama_sekolah,
    nama_kepala_sekolah:
      typeof data.nama_kepala_sekolah === 'string'
        ? data.nama_kepala_sekolah
        : fallback.nama_kepala_sekolah || '',
    nip_kepala_sekolah:
      typeof data.nip_kepala_sekolah === 'string'
        ? data.nip_kepala_sekolah
        : fallback.nip_kepala_sekolah || '',
    ttd_kepala_sekolah:
      typeof data.ttd_kepala_sekolah === 'string'
        ? data.ttd_kepala_sekolah
        : fallback.ttd_kepala_sekolah || '',
    cap_sekolah:
      typeof data.cap_sekolah === 'string'
        ? data.cap_sekolah
        : fallback.cap_sekolah || '',
    logo_sekolah:
      typeof data.logo_sekolah === 'string'
        ? data.logo_sekolah
        : fallback.logo_sekolah || '',
    batas_jam_masuk:
      typeof data.batas_jam_masuk === 'string'
        ? normalizeTimeHHMM(data.batas_jam_masuk, fallback.batas_jam_masuk)
        : fallback.batas_jam_masuk,
    mode_presensi:
      typeof data.mode_presensi === 'string'
        ? normalizeScheduleMode(
            data.mode_presensi as AttendanceScheduleMode,
            fallback.mode_presensi
          )
        : fallback.mode_presensi,
    jam_pulang_standar:
      typeof data.jam_pulang_standar === 'string'
        ? normalizeTimeHHMM(data.jam_pulang_standar, fallback.jam_pulang_standar)
        : fallback.jam_pulang_standar,
    tahun_ajaran:
      typeof data.tahun_ajaran === 'string' && data.tahun_ajaran.trim()
        ? data.tahun_ajaran.trim()
        : fallback.tahun_ajaran,
    semester:
      typeof data.semester === 'string'
        ? normalizeSemester(data.semester as SemesterKind, fallback.semester || 'ganjil')
        : fallback.semester || 'ganjil',
    tema:
      typeof data.tema === 'string'
        ? normalizeThemeId(data.tema as AppThemeId, fallback.tema)
        : fallback.tema,
    script_url:
      typeof data.script_url === 'string' && data.script_url.trim()
        ? data.script_url.trim()
        : fallback.script_url,
    no_wa_admin:
      typeof data.no_wa_admin === 'string'
        ? data.no_wa_admin
        : fallback.no_wa_admin || '',
    show_creator_credit:
      typeof data.show_creator_credit === 'boolean'
        ? data.show_creator_credit
        : fallback.show_creator_credit !== false,
  };
}
