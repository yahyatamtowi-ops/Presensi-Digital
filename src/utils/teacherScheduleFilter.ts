import type {
  AuthSession,
  DayOfWeek,
  SemesterKind,
  SubjectAssignment,
  TeacherSchedule,
  TimetableConfig,
} from '../types';
import { resolveItemAcademicYear } from './attendanceLogic';
import { getIndonesianDayOfWeek, normalizeSemester } from './subjectAttendance';
import {
  findSlotRangeLabelForSchedule,
  getSchoolDaysForCount,
} from './timetableLogic';

export type PersonalScheduleDayFilter = 'ALL' | DayOfWeek;

export interface PersonalLessonItem {
  id: string;
  hari: DayOfWeek;
  kelas: string;
  mata_pelajaran: string;
  jam_mulai: string;
  jam_selesai: string;
  jamKeLabel: string | null;
  teacher_user_id: string;
  teacher_name: string;
  semester: SemesterKind;
  tahun_ajaran: string;
}

const DAY_ORDER: Record<DayOfWeek, number> = {
  Senin: 1,
  Selasa: 2,
  Rabu: 3,
  Kamis: 4,
  Jumat: 5,
  Sabtu: 6,
  Minggu: 7,
};

function matchesTeacherAccount(
  item: { teacher_user_id: string; teacher_name: string },
  session: AuthSession
): boolean {
  if (item.teacher_user_id && item.teacher_user_id === session.userId) {
    return true;
  }
  const itemName = (item.teacher_name || '').trim().toLowerCase();
  const sessionName = (session.nama || '').trim().toLowerCase();
  return Boolean(itemName && sessionName && itemName === sessionName);
}

/**
 * Collects all personal teaching schedules belonging strictly to the logged-in
 * teacher (Guru / Wali Kelas) for the active academic year & semester, merging
 * any manual SubjectAssignments that carry a day so nothing is missed.
 */
export function collectPersonalTeacherLessons(params: {
  schedules: TeacherSchedule[];
  assignments?: SubjectAssignment[];
  session: AuthSession;
  tahunAjaran: string;
  semester?: SemesterKind;
  activeTimetableConfig?: TimetableConfig;
}): PersonalLessonItem[] {
  const {
    schedules,
    assignments = [],
    session,
    tahunAjaran,
    activeTimetableConfig,
  } = params;
  const activeSem = normalizeSemester(params.semester, 'ganjil');
  const targetYear = resolveItemAcademicYear(tahunAjaran);

  const items: PersonalLessonItem[] = [];
  const seenKeys = new Set<string>();

  const pushItem = (candidate: {
    id: string;
    hari: DayOfWeek;
    kelas: string;
    mata_pelajaran: string;
    jam_mulai: string;
    jam_selesai: string;
    teacher_user_id: string;
    teacher_name: string;
    semester?: SemesterKind;
    tahun_ajaran: string;
  }) => {
    const dedupeKey = [
      candidate.hari,
      candidate.kelas.trim().toLowerCase(),
      candidate.mata_pelajaran.trim().toLowerCase(),
      candidate.jam_mulai.trim(),
      candidate.jam_selesai.trim(),
    ].join('|');

    if (seenKeys.has(dedupeKey)) return;
    seenKeys.add(dedupeKey);

    const slotInfo =
      activeTimetableConfig && candidate.jam_mulai && candidate.jam_selesai
        ? findSlotRangeLabelForSchedule(
            activeTimetableConfig,
            candidate.jam_mulai,
            candidate.jam_selesai
          )
        : null;

    items.push({
      id: candidate.id,
      hari: candidate.hari,
      kelas: candidate.kelas,
      mata_pelajaran: candidate.mata_pelajaran,
      jam_mulai: candidate.jam_mulai,
      jam_selesai: candidate.jam_selesai,
      jamKeLabel: slotInfo?.label ?? null,
      teacher_user_id: candidate.teacher_user_id,
      teacher_name: candidate.teacher_name,
      semester: normalizeSemester(candidate.semester, activeSem),
      tahun_ajaran: resolveItemAcademicYear(candidate.tahun_ajaran, targetYear),
    });
  };

  for (const sch of schedules) {
    if (!matchesTeacherAccount(sch, session)) continue;
    if (resolveItemAcademicYear(sch.tahun_ajaran) !== targetYear) continue;
    if (sch.semester && normalizeSemester(sch.semester, activeSem) !== activeSem) continue;
    pushItem(sch);
  }

  for (const asg of assignments) {
    if (!asg.hari) continue;
    if (!matchesTeacherAccount(asg, session)) continue;
    if (resolveItemAcademicYear(asg.tahun_ajaran) !== targetYear) continue;
    if (asg.semester && normalizeSemester(asg.semester, activeSem) !== activeSem) continue;
    const jamMulai = (asg.jam_mulai || '').trim() || '07:15';
    const jamSelesai = (asg.jam_selesai || '').trim() || '08:45';
    pushItem({
      id: asg.id,
      hari: asg.hari,
      kelas: asg.kelas,
      mata_pelajaran: asg.mata_pelajaran,
      jam_mulai: jamMulai,
      jam_selesai: jamSelesai,
      teacher_user_id: asg.teacher_user_id,
      teacher_name: asg.teacher_name,
      semester: asg.semester,
      tahun_ajaran: asg.tahun_ajaran,
    });
  }

  return items.sort((a, b) => {
    const dayDiff = (DAY_ORDER[a.hari] ?? 99) - (DAY_ORDER[b.hari] ?? 99);
    if (dayDiff !== 0) return dayDiff;
    const timeDiff = a.jam_mulai.localeCompare(b.jam_mulai);
    if (timeDiff !== 0) return timeDiff;
    return a.kelas.localeCompare(b.kelas);
  });
}

/**
 * Resolves the available school day tabs for the personal Daftar Pelajaran view.
 */
export function getAvailablePersonalScheduleDays(
  personalLessons: PersonalLessonItem[],
  activeTimetableConfig?: TimetableConfig
): DayOfWeek[] {
  const hasSaturday =
    activeTimetableConfig?.jumlah_hari === 6 ||
    personalLessons.some((item) => item.hari === 'Sabtu');
  return getSchoolDaysForCount(hasSaturday ? 6 : 5);
}

/**
 * Filters personal teacher lessons by a chosen day filter ('ALL' or specific DayOfWeek).
 */
export function filterPersonalLessonsByDay(
  personalLessons: PersonalLessonItem[],
  dayFilter: PersonalScheduleDayFilter
): PersonalLessonItem[] {
  if (dayFilter === 'ALL') return personalLessons;
  return personalLessons.filter((item) => item.hari === dayFilter);
}

/**
 * Computes the default day filter from a YYYY-MM-DD date string (the day/date when the menu is opened).
 */
export function resolveDayForDate(dateStr: string): DayOfWeek {
  return getIndonesianDayOfWeek(dateStr);
}

/**
 * Determines whether a scheduled lesson on today's date is currently ongoing, upcoming, or finished.
 */
export function getLessonTimeState(
  lesson: Pick<PersonalLessonItem, 'jam_mulai' | 'jam_selesai'>,
  currentTimeHHMM: string
): 'upcoming' | 'ongoing' | 'done' {
  const toMin = (hhmm: string): number | null => {
    const parts = hhmm.trim().split(':');
    if (parts.length < 2) return null;
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
  };
  const now = toMin(currentTimeHHMM);
  const start = toMin(lesson.jam_mulai);
  const end = toMin(lesson.jam_selesai);
  if (now === null || start === null || end === null) return 'upcoming';
  if (now < start) return 'upcoming';
  if (now >= start && now <= end) return 'ongoing';
  return 'done';
}
