import type {
  DayOfWeek,
  SchoolDayCount,
  SemesterKind,
  TeacherSchedule,
  TimetableBreak,
  TimetableCellValue,
  TimetableConfig,
  TimetableTimeSlot,
} from '../types';
import {
  isSameClassName,
  normalizeClassNameKey,
  normalizeTimeHHMM,
  parseTimeToMinutes,
  resolveCanonicalClassName,
  resolveItemAcademicYear,
} from './attendanceLogic';
import { normalizeDayOfWeek, normalizeSemester } from './subjectAttendance';

const TIMETABLE_STORAGE_KEY = 'presensiqr_timetable_configs_v1';

export const FIVE_SCHOOL_DAYS: DayOfWeek[] = [
  'Senin',
  'Selasa',
  'Rabu',
  'Kamis',
  'Jumat',
];

export const SIX_SCHOOL_DAYS: DayOfWeek[] = [
  'Senin',
  'Selasa',
  'Rabu',
  'Kamis',
  'Jumat',
  'Sabtu',
];

export const DEFAULT_TIMETABLE_CLASSES = [
  'X IPA 1',
  'X IPA 2',
  'XI IPA 1',
  'XII IPA 1',
];

export function getSchoolDaysForCount(count: SchoolDayCount): DayOfWeek[] {
  return count === 6 ? [...SIX_SCHOOL_DAYS] : [...FIVE_SCHOOL_DAYS];
}

export function formatMinutesToHHMM(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(totalMinutes)));
  const hh = Math.floor(clamped / 60);
  const mm = clamped % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function getTimetableConfigKey(
  tahunAjaran: string,
  semester: SemesterKind
): string {
  return `${resolveItemAcademicYear(tahunAjaran)}__${normalizeSemester(semester)}`;
}

export function makeTimetableCellKey(
  hari: DayOfWeek,
  jamKe: number,
  kelas: string
): string {
  return `${hari}|${jamKe}|${kelas.trim()}`;
}

export function parseTimetableCellKey(
  key: string
): { hari: DayOfWeek; jamKe: number; kelas: string } | null {
  const parts = key.split('|');
  if (parts.length < 3) return null;
  const hari = normalizeDayOfWeek(parts[0]);
  const jamKe = Number(parts[1]);
  const kelas = parts.slice(2).join('|').trim();
  if (!hari || !Number.isInteger(jamKe) || jamKe < 1 || !kelas) return null;
  return { hari, jamKe, kelas };
}

export function createDefaultTimetableConfig(
  tahunAjaran: string,
  semester: SemesterKind = 'ganjil',
  jamMulaiSekolah = '07:15'
): TimetableConfig {
  const start = normalizeTimeHHMM(jamMulaiSekolah, '07:15');
  return {
    tahun_ajaran: resolveItemAcademicYear(tahunAjaran),
    semester: normalizeSemester(semester),
    jumlah_hari: 5,
    jam_mulai_sekolah: start,
    durasi_jp_menit: 45,
    jumlah_jp: 8,
    istirahat: [
      {
        id: 'brk_1',
        label: 'Istirahat 1',
        jam_mulai: '09:30',
        jam_selesai: '09:45',
      },
      {
        id: 'brk_2',
        label: 'Istirahat 2',
        jam_mulai: '12:00',
        jam_selesai: '12:30',
      },
    ],
    custom_classes: [],
    cells: {},
  };
}

/**
 * Generates ordered daily time slots (Jam ke 1..N interleaved with manually configured breaks).
 * Break start/end times are always honored verbatim; lessons automatically flow around them.
 */
export function generateDailyTimeSlots(params: {
  jam_mulai_sekolah: string;
  durasi_jp_menit: number;
  jumlah_jp: number;
  istirahat: TimetableBreak[];
}): TimetableTimeSlot[] {
  const startMins = parseTimeToMinutes(normalizeTimeHHMM(params.jam_mulai_sekolah, '07:15')) ?? 435;
  const duration = Math.max(15, Math.min(180, Math.round(Number(params.durasi_jp_menit) || 45)));
  const totalPeriods = Math.max(1, Math.min(16, Math.round(Number(params.jumlah_jp) || 8)));

  // Normalize and sort valid manual breaks chronologically
  const sortedBreaks = (params.istirahat || [])
    .map((b, idx) => {
      const s = parseTimeToMinutes(normalizeTimeHHMM(b.jam_mulai, ''));
      const e = parseTimeToMinutes(normalizeTimeHHMM(b.jam_selesai, ''));
      if (s === null || e === null || e <= s) return null;
      return {
        id: b.id || `brk_${idx + 1}`,
        label: (b.label || '').trim() || `Istirahat ${idx + 1}`,
        start: s,
        end: e,
        jam_mulai: formatMinutesToHHMM(s),
        jam_selesai: formatMinutesToHHMM(e),
      };
    })
    .filter((b): b is NonNullable<typeof b> => b !== null)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const slots: TimetableTimeSlot[] = [];
  const usedBreakIds = new Set<string>();
  let cursor = startMins;

  for (let jp = 1; jp <= totalPeriods; jp++) {
    // Insert any break that starts at or before the current cursor (or within < 10 mins of cursor)
    let inserted = true;
    while (inserted) {
      inserted = false;
      for (const brk of sortedBreaks) {
        if (usedBreakIds.has(brk.id)) continue;
        if (brk.start <= cursor && brk.end > cursor) {
          slots.push({
            kind: 'break',
            breakId: brk.id,
            label: brk.label,
            jam_mulai: brk.jam_mulai,
            jam_selesai: brk.jam_selesai,
          });
          usedBreakIds.add(brk.id);
          cursor = brk.end;
          inserted = true;
          break;
        }
        if (brk.start < cursor && brk.end <= cursor) {
          // Break was configured earlier than current lesson start — still display before upcoming slots if after school start
          if (brk.start >= startMins) {
            slots.push({
              kind: 'break',
              breakId: brk.id,
              label: brk.label,
              jam_mulai: brk.jam_mulai,
              jam_selesai: brk.jam_selesai,
            });
          }
          usedBreakIds.add(brk.id);
          inserted = true;
          break;
        }
      }
    }

    // Check if an upcoming manual break starts inside this lesson slot
    const overlappingBreak = sortedBreaks.find(
      (b) => !usedBreakIds.has(b.id) && b.start > cursor && b.start < cursor + duration
    );

    if (overlappingBreak) {
      const gapBeforeBreak = overlappingBreak.start - cursor;
      if (gapBeforeBreak < Math.ceil(duration / 2)) {
        // Gap before manual break is less than half a JP: place break first, then run full lesson after break
        slots.push({
          kind: 'break',
          breakId: overlappingBreak.id,
          label: overlappingBreak.label,
          jam_mulai: overlappingBreak.jam_mulai,
          jam_selesai: overlappingBreak.jam_selesai,
        });
        usedBreakIds.add(overlappingBreak.id);
        cursor = overlappingBreak.end;
      } else {
        // Place lesson ending cleanly at break start, then break will be inserted right before next JP
        const end = overlappingBreak.start;
        slots.push({
          kind: 'lesson',
          jamKe: jp,
          jam_mulai: formatMinutesToHHMM(cursor),
          jam_selesai: formatMinutesToHHMM(end),
        });
        cursor = end;
        continue;
      }
    }

    const end = Math.min(23 * 60 + 59, cursor + duration);
    slots.push({
      kind: 'lesson',
      jamKe: jp,
      jam_mulai: formatMinutesToHHMM(cursor),
      jam_selesai: formatMinutesToHHMM(end),
    });
    cursor = end;
  }

  return slots;
}

export interface TimetableConflict {
  hari: DayOfWeek;
  jamKe: number;
  teacher_user_id: string;
  teacher_name: string;
  classes: string[];
}

/**
 * Detects when the same teacher is assigned to 2+ different classes in the same (Hari, Jam ke).
 */
export function detectTimetableTeacherConflicts(
  config: TimetableConfig,
  activeClasses: string[]
): TimetableConflict[] {
  const days = getSchoolDaysForCount(config.jumlah_hari);
  const conflicts: TimetableConflict[] = [];

  // Deduplicate activeClasses by canonical class key so spelling variants ("XI E" & "X I.E")
  // are never mistaken for two different classes.
  const dedupedClasses: string[] = [];
  const seenClassKeys = new Set<string>();
  for (const rawKelas of activeClasses) {
    const trimmed = rawKelas.trim();
    if (!trimmed) continue;
    const key = normalizeClassNameKey(trimmed) || trimmed.toLowerCase();
    if (seenClassKeys.has(key)) continue;
    seenClassKeys.add(key);
    dedupedClasses.push(trimmed);
  }

  for (const hari of days) {
    for (let jp = 1; jp <= config.jumlah_jp; jp++) {
      const byTeacher = new Map<
        string,
        { rawId: string; name: string; classes: string[] }
      >();
      for (const kelas of dedupedClasses) {
        const cell = config.cells[makeTimetableCellKey(hari, jp, kelas)];
        if (!cell?.mata_pelajaran?.trim() || !cell.teacher_user_id?.trim()) continue;
        const rawTid = cell.teacher_user_id.trim();
        const tidKey = rawTid.toLowerCase();
        const entry = byTeacher.get(tidKey) || {
          rawId: rawTid,
          name: cell.teacher_name || 'Guru',
          classes: [],
        };
        if (!entry.classes.some((c) => isSameClassName(c, kelas))) {
          entry.classes.push(kelas);
        }
        byTeacher.set(tidKey, entry);
      }
      for (const info of byTeacher.values()) {
        if (info.classes.length > 1) {
          conflicts.push({
            hari,
            jamKe: jp,
            teacher_user_id: info.rawId,
            teacher_name: info.name,
            classes: info.classes,
          });
        }
      }
    }
  }

  return conflicts;
}

/**
 * Converts a TimetableConfig matrix into TeacherSchedule entries.
 * Consecutive lesson slots (not separated by a break) with identical (hari, kelas, mapel, teacher)
 * are merged into a single schedule block spanning start of first JP to end of last JP.
 */
export function buildTeacherSchedulesFromTimetable(
  config: TimetableConfig,
  activeClasses: string[]
): TeacherSchedule[] {
  const days = getSchoolDaysForCount(config.jumlah_hari);
  const slots = generateDailyTimeSlots(config);
  const tahunAjaran = resolveItemAcademicYear(config.tahun_ajaran);
  const semester = normalizeSemester(config.semester);

  const out: TeacherSchedule[] = [];

  for (const hari of days) {
    for (const kelas of activeClasses) {
      let currentBlock: {
        mata_pelajaran: string;
        teacher_user_id: string;
        teacher_name: string;
        jam_mulai: string;
        jam_selesai: string;
        startJp: number;
      } | null = null;

      const flushBlock = () => {
        if (!currentBlock) return;
        const safeKelas = kelas.trim().replace(/[^a-zA-Z0-9]+/g, '_');
        const safeMapel = currentBlock.mata_pelajaran
          .trim()
          .replace(/[^a-zA-Z0-9]+/g, '_')
          .slice(0, 24);
        const safeYear = tahunAjaran.replace(/[^a-zA-Z0-9]+/g, '');
        out.push({
          id: `tt_${safeYear}_${semester}_${hari}_${currentBlock.startJp}_${safeKelas}_${safeMapel}_${currentBlock.teacher_user_id}`,
          hari,
          teacher_user_id: currentBlock.teacher_user_id,
          teacher_name: currentBlock.teacher_name,
          kelas: kelas.trim(),
          mata_pelajaran: currentBlock.mata_pelajaran.trim(),
          jam_mulai: currentBlock.jam_mulai,
          jam_selesai: currentBlock.jam_selesai,
          tahun_ajaran: tahunAjaran,
          semester,
        });
        currentBlock = null;
      };

      for (const slot of slots) {
        if (slot.kind === 'break') {
          // Breaks cleanly split lesson blocks
          flushBlock();
          continue;
        }
        const cell = config.cells[makeTimetableCellKey(hari, slot.jamKe, kelas)];
        const mapel = cell?.mata_pelajaran?.trim() || '';
        const teacherId = cell?.teacher_user_id?.trim() || '';
        const teacherName = cell?.teacher_name?.trim() || 'Guru';

        if (!mapel || !teacherId) {
          flushBlock();
          continue;
        }

        if (
          currentBlock &&
          currentBlock.teacher_user_id === teacherId &&
          currentBlock.mata_pelajaran.toLowerCase() === mapel.toLowerCase()
        ) {
          currentBlock.jam_selesai = slot.jam_selesai;
        } else {
          flushBlock();
          currentBlock = {
            mata_pelajaran: mapel,
            teacher_user_id: teacherId,
            teacher_name: teacherName,
            jam_mulai: slot.jam_mulai,
            jam_selesai: slot.jam_selesai,
            startJp: slot.jamKe,
          };
        }
      }

      flushBlock();
    }
  }

  return out;
}

/**
 * Determines whether a TeacherSchedule's time interval genuinely covers a timetable lesson slot.
 * Uses strict majority overlap (> 50% of slot duration) so adjacent non-overlapping schedules
 * can never both claim the same boundary slot and trigger false conflicts.
 */
function doesScheduleCoverSlot(
  schStart: number,
  schEnd: number,
  slotStart: number,
  slotEnd: number
): boolean {
  const overlap = Math.min(schEnd, slotEnd) - Math.max(schStart, slotStart);
  if (overlap <= 0) return false;
  const slotDur = Math.max(1, slotEnd - slotStart);
  const schDur = Math.max(1, schEnd - schStart);

  if (overlap > slotDur / 2) return true;
  if (overlap === slotDur / 2 && schStart >= slotStart && schStart < slotEnd) {
    return true;
  }
  if (schDur < slotDur && overlap / schDur >= 0.6) {
    return true;
  }
  return false;
}

/**
 * Expands `jumlah_jp` (up to 16) when schedules extend beyond the last generated lesson slot
 * so afternoon classes land in their exact chronological JP instead of snapping onto an earlier JP.
 */
function computeRequiredJumlahJp(
  config: Pick<
    TimetableConfig,
    'jam_mulai_sekolah' | 'durasi_jp_menit' | 'jumlah_jp' | 'istirahat'
  >,
  maxScheduleEndMinutes: number
): number {
  let effectiveJp = Math.max(1, Math.min(16, Math.round(Number(config.jumlah_jp) || 8)));
  if (!Number.isFinite(maxScheduleEndMinutes) || maxScheduleEndMinutes <= 0) {
    return effectiveJp;
  }

  while (effectiveJp < 16) {
    const slots = generateDailyTimeSlots({ ...config, jumlah_jp: effectiveJp });
    const lessonSlots = slots.filter(
      (s): s is Extract<TimetableTimeSlot, { kind: 'lesson' }> => s.kind === 'lesson'
    );
    const lastLesson = lessonSlots[lessonSlots.length - 1];
    const lastEnd = lastLesson ? parseTimeToMinutes(lastLesson.jam_selesai) : null;
    if (lastEnd === null || lastEnd >= maxScheduleEndMinutes - 5) {
      break;
    }
    effectiveJp += 1;
  }

  return effectiveJp;
}

function gcdPositive(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

const STANDARD_JP_DURATIONS = [35, 40, 45, 30, 50, 60];

interface ScopedScheduleSpan {
  sch: TeacherSchedule;
  schStart: number;
  schEnd: number;
}

interface GridAlignmentScore {
  exactMatches: number;
  boundaryMatches: number;
  totalBoundaryError: number;
  deadGapMinutes: number;
}

function evaluateGridAlignment(
  slots: TimetableTimeSlot[],
  scoped: ScopedScheduleSpan[]
): GridAlignmentScore {
  const lessonSpans = slots
    .filter(
      (s): s is Extract<TimetableTimeSlot, { kind: 'lesson' }> => s.kind === 'lesson'
    )
    .map((s) => ({
      start: parseTimeToMinutes(s.jam_mulai) ?? 0,
      end: parseTimeToMinutes(s.jam_selesai) ?? 0,
    }));

  const breakSpans = slots
    .filter(
      (s): s is Extract<TimetableTimeSlot, { kind: 'break' }> => s.kind === 'break'
    )
    .map((s) => ({
      start: parseTimeToMinutes(s.jam_mulai) ?? 0,
      end: parseTimeToMinutes(s.jam_selesai) ?? 0,
    }));

  // Detect any dead gap between consecutive generated slots (e.g. JP3 ending 09:15 while break starts 09:30)
  let deadGapMinutes = 0;
  for (let i = 1; i < slots.length; i++) {
    const prevEnd = parseTimeToMinutes(slots[i - 1].jam_selesai);
    const currStart = parseTimeToMinutes(slots[i].jam_mulai);
    if (prevEnd !== null && currStart !== null && currStart > prevEnd) {
      deadGapMinutes += currStart - prevEnd;
    }
  }

  const startSet = new Set(lessonSpans.map((s) => s.start));
  const endSet = new Set(lessonSpans.map((s) => s.end));

  let exactMatches = 0;
  let boundaryMatches = 0;
  let totalBoundaryError = 0;

  for (const { schStart, schEnd } of scoped) {
    const hasStart = startSet.has(schStart);
    const hasEnd = endSet.has(schEnd);
    const splitByBreak = breakSpans.some(
      (b) => b.start > schStart && b.start < schEnd
    );

    if (hasStart) boundaryMatches += 1;
    if (hasEnd) boundaryMatches += 1;
    if (hasStart && hasEnd && !splitByBreak) {
      exactMatches += 1;
    }

    if (lessonSpans.length > 0) {
      let minStartDist = Infinity;
      let minEndDist = Infinity;
      for (const ls of lessonSpans) {
        const ds = Math.abs(ls.start - schStart);
        const de = Math.abs(ls.end - schEnd);
        if (ds < minStartDist) minStartDist = ds;
        if (de < minEndDist) minEndDist = de;
      }
      totalBoundaryError += minStartDist + minEndDist + (splitByBreak ? 30 : 0);
    }
  }

  return { exactMatches, boundaryMatches, totalBoundaryError, deadGapMinutes };
}

/**
 * Aligns configured break boundaries onto exact lesson slot edges so breaks never slice
 * through a teacher-input schedule and post-break schedules align cleanly on JP boundaries.
 */
function alignBreaksForCandidateGrid(
  startMins: number,
  duration: number,
  baseBreaks: TimetableBreak[],
  scoped: ScopedScheduleSpan[]
): TimetableBreak[] {
  const parsedBreaks = (baseBreaks || [])
    .map((b, idx) => {
      const s = parseTimeToMinutes(normalizeTimeHHMM(b.jam_mulai, ''));
      const e = parseTimeToMinutes(normalizeTimeHHMM(b.jam_selesai, ''));
      if (s === null || e === null || e <= s) return null;
      return {
        id: b.id || `brk_${idx + 1}`,
        label: (b.label || '').trim() || `Istirahat ${idx + 1}`,
        start: s,
        end: e,
        origLen: e - s,
      };
    })
    .filter((b): b is NonNullable<typeof b> => b !== null)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  if (parsedBreaks.length === 0) return [];

  const aligned: TimetableBreak[] = [];
  let cursor = startMins;

  for (let i = 0; i < parsedBreaks.length; i++) {
    const brk = parsedBreaks[i];
    const nextOrigStart = parsedBreaks[i + 1]?.start ?? 24 * 60;

    // Candidate break starts aligned to lesson edges >= cursor + duration
    const kApprox = Math.max(1, Math.round((brk.start - cursor) / duration));
    const candidateStarts: number[] = [];
    for (let dk = -2; dk <= 2; dk++) {
      const k = kApprox + dk;
      if (k < 1) continue;
      const candStart = cursor + k * duration;
      if (candStart >= nextOrigStart - 15) continue;
      // Avoid slicing straight through any teacher schedule
      const slicesSchedule = scoped.some(
        (s) => candStart > s.schStart && candStart < s.schEnd
      );
      if (!slicesSchedule) {
        candidateStarts.push(candStart);
      }
    }

    const chosenStart =
      candidateStarts.length > 0
        ? candidateStarts.sort(
            (a, b) => Math.abs(a - brk.start) - Math.abs(b - brk.start)
          )[0]
        : cursor + kApprox * duration;

    // Schedules starting after this break and before the next break
    const segmentSchedules = scoped.filter(
      (s) => s.schStart >= chosenStart && s.schStart < nextOrigStart
    );

    const earliestSegmentStart = segmentSchedules.reduce(
      (min, s) => Math.min(min, s.schStart),
      Infinity
    );

    let chosenEnd = chosenStart + brk.origLen;

    if (segmentSchedules.length > 0 && Number.isFinite(earliestSegmentStart)) {
      const maxAllowedEnd = Math.min(
        earliestSegmentStart,
        chosenStart + Math.max(brk.origLen + duration, 60)
      );
      const minAllowedEnd = Math.min(maxAllowedEnd, chosenStart + 10);

      if (maxAllowedEnd > chosenStart) {
        // Test candidate break ends that align post-break schedules modulo `duration`
        const candEndSet = new Set<number>();
        for (const seg of segmentSchedules) {
          const offset = seg.schStart - chosenStart;
          const rem = ((offset % duration) + duration) % duration;
          for (let mult = 0; mult <= 2; mult++) {
            const c = chosenStart + rem + mult * duration;
            if (c >= minAllowedEnd && c <= maxAllowedEnd && c > chosenStart) {
              candEndSet.add(c);
            }
          }
        }
        if (candEndSet.size > 0) {
          const idealEnd = chosenStart + brk.origLen;
          const rankedEnds = Array.from(candEndSet)
            .map((cEnd) => {
              const alignedCount = segmentSchedules.filter(
                (s) =>
                  s.schStart >= cEnd &&
                  (s.schStart - cEnd) % duration === 0 &&
                  (s.schEnd - cEnd) % duration === 0
              ).length;
              return {
                cEnd,
                alignedCount,
                dist: Math.abs(cEnd - idealEnd),
              };
            })
            .sort(
              (a, b) => b.alignedCount - a.alignedCount || a.dist - b.dist
            );
          chosenEnd = rankedEnds[0].cEnd;
        } else if (chosenEnd > earliestSegmentStart && earliestSegmentStart > chosenStart) {
          chosenEnd = earliestSegmentStart;
        }
      }
    }

    // Ensure break does not overlap any schedule starting before chosenEnd
    const blockingSchedule = scoped.find(
      (s) => s.schStart < chosenEnd && s.schEnd > chosenStart
    );
    if (blockingSchedule) {
      if (blockingSchedule.schStart > chosenStart) {
        chosenEnd = blockingSchedule.schStart;
      } else {
        // Cannot place break cleanly here without cutting a lesson; keep original break timing
        aligned.push({
          id: brk.id,
          label: brk.label,
          jam_mulai: formatMinutesToHHMM(brk.start),
          jam_selesai: formatMinutesToHHMM(brk.end),
        });
        cursor = Math.max(cursor, brk.end);
        continue;
      }
    }

    aligned.push({
      id: brk.id,
      label: brk.label,
      jam_mulai: formatMinutesToHHMM(chosenStart),
      jam_selesai: formatMinutesToHHMM(chosenEnd),
    });
    cursor = chosenEnd;
  }

  return aligned;
}

/**
 * Automatically adapts the timetable bell grid (jam_mulai_sekolah, durasi_jp_menit, istirahat)
 * to match teacher-input schedules when the current grid does not align with their exact times.
 * Example: if a teacher inputs 07:30–08:40 (70m) on a default 07:15 / 45m grid, this aligns
 * the grid to 07:30 with 35m JP slots (07:30–08:05 and 08:05–08:40).
 * When the current grid already aligns 100% with all schedules, config is returned unchanged.
 */
export function alignTimetableBellScheduleToSchedules(
  config: TimetableConfig,
  schedules: TeacherSchedule[]
): TimetableConfig {
  if (config.bell_locked_by_admin) return config;

  const tahunAjaran = resolveItemAcademicYear(config.tahun_ajaran);
  const semester = normalizeSemester(config.semester);
  const validDays = new Set(getSchoolDaysForCount(config.jumlah_hari));

  const scoped: ScopedScheduleSpan[] = schedules
    .filter(
      (s) =>
        resolveItemAcademicYear(s.tahun_ajaran) === tahunAjaran &&
        (!s.semester || normalizeSemester(s.semester) === semester) &&
        validDays.has(s.hari)
    )
    .map((sch) => {
      const schStart = parseTimeToMinutes(normalizeTimeHHMM(sch.jam_mulai, ''));
      const schEnd = parseTimeToMinutes(normalizeTimeHHMM(sch.jam_selesai, ''));
      return { sch, schStart, schEnd };
    })
    .filter(
      (item): item is ScopedScheduleSpan =>
        item.schStart !== null &&
        item.schEnd !== null &&
        item.schEnd > item.schStart
    );

  if (scoped.length === 0) return config;

  const maxScheduleEnd = scoped.reduce((max, item) => Math.max(max, item.schEnd), 0);
  const currentJp = computeRequiredJumlahJp(config, maxScheduleEnd);
  const currentSlots = generateDailyTimeSlots({ ...config, jumlah_jp: currentJp });
  const currentScore = evaluateGridAlignment(currentSlots, scoped);

  // If current bell grid already matches every teacher schedule cleanly with zero dead gaps, keep it untouched
  if (currentScore.exactMatches === scoped.length && currentScore.deadGapMinutes === 0) {
    return config;
  }

  const currentStartMins =
    parseTimeToMinutes(normalizeTimeHHMM(config.jam_mulai_sekolah, '07:15')) ?? 435;
  const currentDur = Math.max(
    15,
    Math.min(180, Math.round(Number(config.durasi_jp_menit) || 45))
  );

  // Build candidate JP durations from existing duration, standard JP durations, and schedule GCD/divisors
  const durationCandidates = new Set<number>([currentDur, ...STANDARD_JP_DURATIONS]);
  const allDurations = scoped.map((s) => s.schEnd - s.schStart);
  let overallGcd = allDurations[0];
  for (let i = 1; i < allDurations.length; i++) {
    overallGcd = gcdPositive(overallGcd, allDurations[i]);
  }
  if (overallGcd >= 20 && overallGcd <= 60) {
    durationCandidates.add(overallGcd);
  }
  for (const dur of [...allDurations, overallGcd]) {
    if (dur >= 20 && dur <= 60) durationCandidates.add(dur);
    for (let factor = 2; factor <= 4; factor++) {
      if (dur % factor === 0) {
        const sub = dur / factor;
        if (sub >= 25 && sub <= 55) durationCandidates.add(sub);
      }
    }
  }

  const earliestScheduleStart = scoped.reduce(
    (min, item) => Math.min(min, item.schStart),
    Infinity
  );

  // Build candidate school start times (existing start + earliest morning schedule start)
  const startCandidates = new Set<number>([currentStartMins]);
  if (Number.isFinite(earliestScheduleStart)) {
    if (earliestScheduleStart <= 10 * 60 || earliestScheduleStart < currentStartMins) {
      startCandidates.add(earliestScheduleStart);
    }
    // Also check earliest schedule per distinct morning start <= 09:00
    for (const item of scoped) {
      if (item.schStart <= 9 * 60) {
        startCandidates.add(item.schStart);
      }
    }
  }

  interface RankedCandidate {
    startMins: number;
    duration: number;
    istirahat: TimetableBreak[];
    score: GridAlignmentScore;
    sameDuration: boolean;
    sameStart: boolean;
    standardRank: number;
  }

  let best: RankedCandidate = {
    startMins: currentStartMins,
    duration: currentDur,
    istirahat: config.istirahat,
    score: currentScore,
    sameDuration: true,
    sameStart: true,
    standardRank: STANDARD_JP_DURATIONS.indexOf(currentDur) >= 0
      ? STANDARD_JP_DURATIONS.indexOf(currentDur)
      : 99,
  };

  const isStrictlyBetter = (a: RankedCandidate, b: RankedCandidate): boolean => {
    if (a.score.exactMatches !== b.score.exactMatches) {
      return a.score.exactMatches > b.score.exactMatches;
    }
    if (a.score.boundaryMatches !== b.score.boundaryMatches) {
      return a.score.boundaryMatches > b.score.boundaryMatches;
    }
    if (a.score.totalBoundaryError !== b.score.totalBoundaryError) {
      return a.score.totalBoundaryError < b.score.totalBoundaryError;
    }
    if (a.score.deadGapMinutes !== b.score.deadGapMinutes) {
      return a.score.deadGapMinutes < b.score.deadGapMinutes;
    }
    if (a.sameDuration !== b.sameDuration) return a.sameDuration;
    if (a.sameStart !== b.sameStart) return a.sameStart;
    if (a.standardRank !== b.standardRank) return a.standardRank < b.standardRank;
    // Prefer larger standard duration (e.g. 45 over 30 for a 90m block) when tied
    return a.duration > b.duration;
  };

  for (const candDur of durationCandidates) {
    const startSetForDur = new Set<number>(startCandidates);
    // If earliest schedule is e.g. 08:05 and candDur is 35, also consider 07:30 (1 JP before)
    if (
      Number.isFinite(earliestScheduleStart) &&
      earliestScheduleStart > 7 * 60 &&
      earliestScheduleStart <= 10 * 60
    ) {
      let back = earliestScheduleStart - candDur;
      while (back >= 6 * 60 + 30) {
        startSetForDur.add(back);
        back -= candDur;
      }
    }

    for (const candStart of startSetForDur) {
      // Never shift school start later than the earliest schedule start
      if (candStart > earliestScheduleStart) continue;

      const breakVariants: TimetableBreak[][] = [
        config.istirahat,
        alignBreaksForCandidateGrid(candStart, candDur, config.istirahat, scoped),
      ];

      for (const candBreaks of breakVariants) {
        const candConfig: TimetableConfig = {
          ...config,
          jam_mulai_sekolah: formatMinutesToHHMM(candStart),
          durasi_jp_menit: candDur,
          istirahat: candBreaks,
        };
        const candJp = computeRequiredJumlahJp(candConfig, maxScheduleEnd);
        const candSlots = generateDailyTimeSlots({
          ...candConfig,
          jumlah_jp: candJp,
        });
        const candScore = evaluateGridAlignment(candSlots, scoped);

        const candidate: RankedCandidate = {
          startMins: candStart,
          duration: candDur,
          istirahat: candBreaks,
          score: candScore,
          sameDuration: candDur === currentDur,
          sameStart: candStart === currentStartMins,
          standardRank:
            STANDARD_JP_DURATIONS.indexOf(candDur) >= 0
              ? STANDARD_JP_DURATIONS.indexOf(candDur)
              : 99,
        };

        if (isStrictlyBetter(candidate, best)) {
          best = candidate;
        }
      }
    }
  }

  // Only adopt the new bell grid if it strictly improves alignment or removes dead break gaps
  const improvedAlignment =
    best.score.exactMatches > currentScore.exactMatches ||
    (best.score.exactMatches === currentScore.exactMatches &&
      best.score.boundaryMatches > currentScore.boundaryMatches) ||
    (best.score.exactMatches === currentScore.exactMatches &&
      best.score.boundaryMatches === currentScore.boundaryMatches &&
      best.score.totalBoundaryError < currentScore.totalBoundaryError) ||
    (best.score.exactMatches === currentScore.exactMatches &&
      best.score.boundaryMatches === currentScore.boundaryMatches &&
      best.score.totalBoundaryError === currentScore.totalBoundaryError &&
      best.score.deadGapMinutes < currentScore.deadGapMinutes);

  if (!improvedAlignment) {
    return config;
  }

  return {
    ...config,
    jam_mulai_sekolah: formatMinutesToHHMM(best.startMins),
    durasi_jp_menit: best.duration,
    istirahat: best.istirahat.map((b) => ({ ...b })),
  };
}

/**
 * Populates a TimetableConfig's cells from existing TeacherSchedule records matching the
 * config's academic year & semester.
 * - Maps each subject across the exact 1 / 2 / 3+ JP slots covered by its start..end interval
 *   according to the configured 1-JP duration (e.g. 35m/JP: 07:30-08:40 -> Jam ke-1 07:30-08:05
 *   & Jam ke-2 08:05-08:40; 07:30-09:15 -> Jam ke-1, ke-2, ke-3).
 * - Auto-aligns bell grid to teacher-input schedules unless respectConfiguredBell or
 *   config.bell_locked_by_admin is set.
 * - Auto-expands jumlah_jp (up to 16) when schedules run later than the configured last JP.
 * - Uses strict majority overlap so non-overlapping classes on the same day land in exact
 *   chronological slots without false conflicts.
 */
export function hydrateTimetableCellsFromSchedules(
  config: TimetableConfig,
  schedules: TeacherSchedule[],
  overwriteExisting = false,
  canonicalClasses: string[] = [],
  respectConfiguredBell = false
): TimetableConfig {
  const alignedConfig =
    respectConfiguredBell || config.bell_locked_by_admin
      ? config
      : alignTimetableBellScheduleToSchedules(config, schedules);
  const tahunAjaran = resolveItemAcademicYear(alignedConfig.tahun_ajaran);
  const semester = normalizeSemester(alignedConfig.semester);
  const validDays = new Set(getSchoolDaysForCount(alignedConfig.jumlah_hari));

  const scoped = schedules
    .filter(
      (s) =>
        resolveItemAcademicYear(s.tahun_ajaran) === tahunAjaran &&
        (!s.semester || normalizeSemester(s.semester) === semester) &&
        validDays.has(s.hari)
    )
    .map((sch) => {
      const schStart = parseTimeToMinutes(normalizeTimeHHMM(sch.jam_mulai, ''));
      const schEnd = parseTimeToMinutes(normalizeTimeHHMM(sch.jam_selesai, ''));
      return { sch, schStart, schEnd };
    })
    .filter(
      (
        item
      ): item is { sch: TeacherSchedule; schStart: number; schEnd: number } =>
        item.schStart !== null &&
        item.schEnd !== null &&
        item.schEnd > item.schStart
    )
    .sort(
      (a, b) =>
        a.sch.hari.localeCompare(b.sch.hari) ||
        a.schStart - b.schStart ||
        a.schEnd - b.schEnd ||
        a.sch.kelas.localeCompare(b.sch.kelas)
    );

  const maxScheduleEnd = scoped.reduce(
    (max, item) => Math.max(max, item.schEnd),
    0
  );
  const effectiveJumlahJp = computeRequiredJumlahJp(alignedConfig, maxScheduleEnd);
  const lessonSlots = generateDailyTimeSlots({
    ...alignedConfig,
    jumlah_jp: effectiveJumlahJp,
  }).filter(
    (s): s is Extract<TimetableTimeSlot, { kind: 'lesson' }> => s.kind === 'lesson'
  );

  const nextCells: Record<string, TimetableCellValue> = overwriteExisting
    ? {}
    : { ...alignedConfig.cells };

  // Keep custom_classes free of aliases that already exist in canonicalClasses
  const canonicalKeys = new Set(
    canonicalClasses.map((c) => normalizeClassNameKey(c)).filter(Boolean)
  );
  const extraClassesMap = new Map<string, string>();
  for (const rawCustom of config.custom_classes || []) {
    const resolved =
      canonicalClasses.length > 0
        ? resolveCanonicalClassName(rawCustom, canonicalClasses)
        : rawCustom.trim();
    const key = normalizeClassNameKey(resolved) || resolved.toLowerCase();
    if (!resolved || !key) continue;
    if (canonicalKeys.has(key)) continue;
    if (!extraClassesMap.has(key)) {
      extraClassesMap.set(key, resolved);
    }
  }

  // Track placed spans per (hari, jamKe, teacherKey) so non-overlapping schedules of the same
  // teacher NEVER collide onto the same JP slot while genuine real-time overlaps ARE preserved.
  const placedByTeacherSlot = new Map<
    string,
    Array<{ schStart: number; schEnd: number; kelas: string }>
  >();

  const hasNonOverlappingTeacherCollision = (
    hari: DayOfWeek,
    jamKe: number,
    teacherKey: string,
    kelas: string,
    schStart: number,
    schEnd: number
  ): boolean => {
    if (!teacherKey) return false;
    const existing = placedByTeacherSlot.get(`${hari}|${jamKe}|${teacherKey}`);
    if (!existing || existing.length === 0) return false;
    return existing.some(
      (prev) =>
        !isSameClassName(prev.kelas, kelas) &&
        !(prev.schStart < schEnd && schStart < prev.schEnd)
    );
  };

  const recordPlacement = (
    hari: DayOfWeek,
    jamKe: number,
    teacherKey: string,
    kelas: string,
    schStart: number,
    schEnd: number
  ) => {
    if (!teacherKey) return;
    const mapKey = `${hari}|${jamKe}|${teacherKey}`;
    const list = placedByTeacherSlot.get(mapKey) || [];
    list.push({ schStart, schEnd, kelas });
    placedByTeacherSlot.set(mapKey, list);
  };

  for (const { sch, schStart, schEnd } of scoped) {
    const resolvedKelas =
      canonicalClasses.length > 0
        ? resolveCanonicalClassName(sch.kelas, canonicalClasses)
        : sch.kelas.trim();
    if (!resolvedKelas) continue;

    const kelasKey = normalizeClassNameKey(resolvedKelas) || resolvedKelas.toLowerCase();
    if (!canonicalKeys.has(kelasKey) && !extraClassesMap.has(kelasKey)) {
      extraClassesMap.set(kelasKey, resolvedKelas);
    }

    const teacherKey = sch.teacher_user_id.trim().toLowerCase();
    const candidateSlots: Array<{
      slot: Extract<TimetableTimeSlot, { kind: 'lesson' }>;
      overlap: number;
    }> = [];

    for (const slot of lessonSlots) {
      const slotStart = parseTimeToMinutes(slot.jam_mulai);
      const slotEnd = parseTimeToMinutes(slot.jam_selesai);
      if (slotStart === null || slotEnd === null) continue;
      if (doesScheduleCoverSlot(schStart, schEnd, slotStart, slotEnd)) {
        const overlap = Math.min(schEnd, slotEnd) - Math.max(schStart, slotStart);
        candidateSlots.push({ slot, overlap });
      }
    }

    let placedAny = false;
    for (const { slot } of candidateSlots) {
      if (
        hasNonOverlappingTeacherCollision(
          sch.hari,
          slot.jamKe,
          teacherKey,
          resolvedKelas,
          schStart,
          schEnd
        )
      ) {
        continue;
      }
      const key = makeTimetableCellKey(sch.hari, slot.jamKe, resolvedKelas);
      if (overwriteExisting || !nextCells[key]?.mata_pelajaran) {
        nextCells[key] = {
          mata_pelajaran: sch.mata_pelajaran,
          teacher_user_id: sch.teacher_user_id,
          teacher_name: sch.teacher_name,
        };
      }
      recordPlacement(
        sch.hari,
        slot.jamKe,
        teacherKey,
        resolvedKelas,
        schStart,
        schEnd
      );
      placedAny = true;
    }

    // Fallback: if schedule time fell outside/between configured slots or was shifted off a
    // non-overlapping boundary collision, pick the nearest chronological slot without causing
    // a false teacher collision.
    if (!placedAny && lessonSlots.length > 0) {
      const schMid = (schStart + schEnd) / 2;
      const ranked = lessonSlots
        .map((slot) => {
          const slotStart = parseTimeToMinutes(slot.jam_mulai) ?? 0;
          const slotEnd = parseTimeToMinutes(slot.jam_selesai) ?? slotStart;
          const slotMid = (slotStart + slotEnd) / 2;
          const dist = Math.abs(slotMid - schMid);
          const collidesNonOverlapping = hasNonOverlappingTeacherCollision(
            sch.hari,
            slot.jamKe,
            teacherKey,
            resolvedKelas,
            schStart,
            schEnd
          );
          return { slot, dist, collidesNonOverlapping };
        })
        .sort(
          (a, b) =>
            Number(a.collidesNonOverlapping) - Number(b.collidesNonOverlapping) ||
            a.dist - b.dist ||
            a.slot.jamKe - b.slot.jamKe
        );

      const chosen = ranked[0]?.slot;
      if (chosen) {
        const key = makeTimetableCellKey(sch.hari, chosen.jamKe, resolvedKelas);
        if (overwriteExisting || !nextCells[key]?.mata_pelajaran) {
          nextCells[key] = {
            mata_pelajaran: sch.mata_pelajaran,
            teacher_user_id: sch.teacher_user_id,
            teacher_name: sch.teacher_name,
          };
        }
        recordPlacement(
          sch.hari,
          chosen.jamKe,
          teacherKey,
          resolvedKelas,
          schStart,
          schEnd
        );
      }
    }
  }

  return {
    ...alignedConfig,
    jumlah_jp: effectiveJumlahJp,
    custom_classes: Array.from(extraClassesMap.values()).sort((a, b) =>
      a.localeCompare(b)
    ),
    cells: nextCells,
  };
}

/**
 * Checks whether two TimetableConfigs have identical semantic content
 * (ignoring the `updated_at` timestamp) so background polling / cloud snapshots
 * never bump `updated_at` or clobber UI state when nothing actually changed.
 */
export function areTimetableConfigsEqual(
  a: TimetableConfig | undefined,
  b: TimetableConfig | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (
    a.tahun_ajaran !== b.tahun_ajaran ||
    a.semester !== b.semester ||
    a.jumlah_hari !== b.jumlah_hari ||
    a.jam_mulai_sekolah !== b.jam_mulai_sekolah ||
    a.durasi_jp_menit !== b.durasi_jp_menit ||
    a.jumlah_jp !== b.jumlah_jp ||
    Boolean(a.bell_locked_by_admin) !== Boolean(b.bell_locked_by_admin)
  ) {
    return false;
  }

  const breaksA = a.istirahat || [];
  const breaksB = b.istirahat || [];
  if (breaksA.length !== breaksB.length) return false;
  for (let i = 0; i < breaksA.length; i++) {
    if (
      breaksA[i].id !== breaksB[i].id ||
      breaksA[i].label !== breaksB[i].label ||
      breaksA[i].jam_mulai !== breaksB[i].jam_mulai ||
      breaksA[i].jam_selesai !== breaksB[i].jam_selesai
    ) {
      return false;
    }
  }

  const customA = a.custom_classes || [];
  const customB = b.custom_classes || [];
  if (customA.length !== customB.length) return false;
  for (let i = 0; i < customA.length; i++) {
    if (customA[i] !== customB[i]) return false;
  }

  const cellsA = a.cells || {};
  const cellsB = b.cells || {};
  const keysA = Object.keys(cellsA);
  const keysB = Object.keys(cellsB);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    const valA = cellsA[key];
    const valB = cellsB[key];
    if (!valB) return false;
    if (
      valA.mata_pelajaran !== valB.mata_pelajaran ||
      (valA.teacher_user_id || '') !== (valB.teacher_user_id || '') ||
      (valA.teacher_name || '') !== (valB.teacher_name || '')
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Synchronizes all TimetableConfigs from the authoritative TeacherSchedule list.
 * Preserves each (tahun_ajaran, semester) config's bell schedule (jam mulai, durasi JP,
 * jumlah JP, manual istirahat, custom classes) while rebuilding teacher-assigned cells
 * so changes made in Mapel & Jadwal, Presensi Mapel Guru, or Cloud/Sheets appear
 * automatically in Pengaturan Jadwal.
 * Returns the original `configs` reference unchanged when every period is semantically identical,
 * avoiding spurious `updated_at` bumps during periodic background syncs.
 */
export function syncTimetableConfigsFromSchedules(
  configs: Record<string, TimetableConfig>,
  schedules: TeacherSchedule[],
  fallbackStartTime = '07:15',
  canonicalClasses: string[] = []
): Record<string, TimetableConfig> {
  const safeConfigs = configs || {};
  const next: Record<string, TimetableConfig> = {};
  let changedAny = false;

  // Gather all (tahun_ajaran, semester) keys present in configs or schedules
  const keyMeta = new Map<string, { tahun_ajaran: string; semester: SemesterKind }>();

  for (const [k, cfg] of Object.entries(safeConfigs)) {
    const tahunAjaran = resolveItemAcademicYear(cfg.tahun_ajaran);
    const semester = normalizeSemester(cfg.semester, 'ganjil');
    const normalizedKey = getTimetableConfigKey(tahunAjaran, semester) || k;
    keyMeta.set(normalizedKey, { tahun_ajaran: tahunAjaran, semester });
  }

  for (const sch of schedules) {
    const tahunAjaran = resolveItemAcademicYear(sch.tahun_ajaran);
    const semester = normalizeSemester(sch.semester, 'ganjil');
    const key = getTimetableConfigKey(tahunAjaran, semester);
    if (!keyMeta.has(key)) {
      keyMeta.set(key, { tahun_ajaran: tahunAjaran, semester });
    }
  }

  if (Object.keys(safeConfigs).length !== keyMeta.size) {
    changedAny = true;
  }

  for (const [key, meta] of keyMeta.entries()) {
    const existing = safeConfigs[key];
    const base: TimetableConfig = existing
      ? {
          ...existing,
          tahun_ajaran: meta.tahun_ajaran,
          semester: meta.semester,
          istirahat: existing.istirahat.map((b) => ({ ...b })),
          custom_classes: [...(existing.custom_classes || [])],
          cells: { ...existing.cells },
        }
      : createDefaultTimetableConfig(
          meta.tahun_ajaran,
          meta.semester,
          fallbackStartTime
        );

    const matchingSchedules = schedules.filter(
      (s) =>
        resolveItemAcademicYear(s.tahun_ajaran) === meta.tahun_ajaran &&
        (!s.semester || normalizeSemester(s.semester, 'ganjil') === meta.semester)
    );

    // Automatically expand to 6 days if a Saturday schedule exists for this period
    const hasSaturdaySchedule = matchingSchedules.some((s) => s.hari === 'Sabtu');
    const adjustedBase: TimetableConfig =
      hasSaturdaySchedule && base.jumlah_hari !== 6
        ? { ...base, jumlah_hari: 6 }
        : base;

    // Rebuild all teacher-assigned cells from TeacherSchedules
    const hydrated = hydrateTimetableCellsFromSchedules(
      adjustedBase,
      matchingSchedules,
      true,
      canonicalClasses
    );

    // Preserve any incomplete draft cells (subject picked without teacher yet) if slot is still empty
    const mergedCells: Record<string, TimetableCellValue> = { ...hydrated.cells };
    if (existing) {
      for (const [cellKey, cellVal] of Object.entries(existing.cells)) {
        const parsedKey = parseTimetableCellKey(cellKey);
        const resolvedCellKey =
          parsedKey && canonicalClasses.length > 0
            ? makeTimetableCellKey(
                parsedKey.hari,
                parsedKey.jamKe,
                resolveCanonicalClassName(parsedKey.kelas, canonicalClasses)
              )
            : cellKey;
        if (
          cellVal?.mata_pelajaran?.trim() &&
          !cellVal.teacher_user_id?.trim() &&
          !mergedCells[resolvedCellKey]?.mata_pelajaran
        ) {
          mergedCells[resolvedCellKey] = { ...cellVal };
        }
      }
    }

    const candidate: TimetableConfig = {
      ...hydrated,
      cells: mergedCells,
      updated_at: existing?.updated_at,
    };

    if (existing && areTimetableConfigsEqual(existing, candidate)) {
      next[key] = existing;
      continue;
    }

    changedAny = true;
    const nowIso = new Date().toISOString();
    const nextStamp =
      existing?.updated_at && existing.updated_at === nowIso
        ? `${nowIso}_${Math.random().toString(36).slice(2, 6)}`
        : nowIso;

    next[key] = {
      ...candidate,
      updated_at: nextStamp,
    };
  }

  return changedAny ? next : safeConfigs;
}

/**
 * Updates subject names inside all TimetableConfig cells when a MasterSubject is renamed
 * in Mapel & Jadwal so the matrix remains completely consistent.
 */
export function renameSubjectInTimetableConfigs(
  configs: Record<string, TimetableConfig>,
  oldSubjectName: string,
  newSubjectName: string
): Record<string, TimetableConfig> {
  const oldNorm = oldSubjectName.trim().toLowerCase();
  const nextName = newSubjectName.trim();
  if (!oldNorm || !nextName || oldNorm === nextName.toLowerCase()) {
    return configs;
  }

  let changedAny = false;
  const out: Record<string, TimetableConfig> = {};

  for (const [key, cfg] of Object.entries(configs || {})) {
    let cfgChanged = false;
    const nextCells: Record<string, TimetableCellValue> = {};
    for (const [cellKey, cellVal] of Object.entries(cfg.cells || {})) {
      if (cellVal?.mata_pelajaran?.trim().toLowerCase() === oldNorm) {
        nextCells[cellKey] = { ...cellVal, mata_pelajaran: nextName };
        cfgChanged = true;
        changedAny = true;
      } else {
        nextCells[cellKey] = cellVal;
      }
    }
    out[key] = cfgChanged
      ? { ...cfg, cells: nextCells, updated_at: new Date().toISOString() }
      : cfg;
  }

  return changedAny ? out : configs;
}

/**
 * Maps a schedule's jam_mulai..jam_selesai to the matching lesson period range (Jam ke)
 * in the active TimetableConfig so Mapel & Jadwal displays and edits slots in lockstep.
 */
export function findSlotRangeLabelForSchedule(
  config: Pick<
    TimetableConfig,
    'jam_mulai_sekolah' | 'durasi_jp_menit' | 'jumlah_jp' | 'istirahat'
  >,
  jamMulai: string,
  jamSelesai: string
): { startJp: number; endJp: number; label: string } | null {
  const schStart = parseTimeToMinutes(normalizeTimeHHMM(jamMulai, ''));
  const schEnd = parseTimeToMinutes(normalizeTimeHHMM(jamSelesai, ''));
  if (schStart === null || schEnd === null || schEnd <= schStart) return null;

  const effectiveJp = computeRequiredJumlahJp(config, schEnd);
  const lessonSlots = generateDailyTimeSlots({
    ...config,
    jumlah_jp: effectiveJp,
  }).filter(
    (s): s is Extract<TimetableTimeSlot, { kind: 'lesson' }> => s.kind === 'lesson'
  );
  const matched: number[] = [];

  for (const slot of lessonSlots) {
    const slotStart = parseTimeToMinutes(slot.jam_mulai);
    const slotEnd = parseTimeToMinutes(slot.jam_selesai);
    if (slotStart === null || slotEnd === null) continue;
    if (doesScheduleCoverSlot(schStart, schEnd, slotStart, slotEnd)) {
      matched.push(slot.jamKe);
    }
  }

  if (matched.length === 0) return null;
  const startJp = matched[0];
  const endJp = matched[matched.length - 1];
  return {
    startJp,
    endJp,
    label: startJp === endJp ? `Jam ke-${startJp}` : `Jam ke-${startJp}–${endJp}`,
  };
}

export function sanitizeTimetableConfigs(
  raw: unknown
): Record<string, TimetableConfig> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, TimetableConfig> = {};

  for (const [k, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const obj = value as Record<string, unknown>;
    const tahunAjaran = resolveItemAcademicYear(
      typeof obj.tahun_ajaran === 'string' ? obj.tahun_ajaran : ''
    );
    const semester = normalizeSemester(obj.semester, 'ganjil');
    const jumlahHari: SchoolDayCount = Number(obj.jumlah_hari) === 6 ? 6 : 5;
    const jamMulai = normalizeTimeHHMM(
      typeof obj.jam_mulai_sekolah === 'string' ? obj.jam_mulai_sekolah : '07:15',
      '07:15'
    );
    const durasi = Math.max(15, Math.min(180, Math.round(Number(obj.durasi_jp_menit) || 45)));
    const jumlahJp = Math.max(1, Math.min(16, Math.round(Number(obj.jumlah_jp) || 8)));

    const istirahat: TimetableBreak[] = Array.isArray(obj.istirahat)
      ? obj.istirahat
          .map((item, idx) => {
            if (!item || typeof item !== 'object') return null;
            const b = item as Record<string, unknown>;
            const jm = normalizeTimeHHMM(String(b.jam_mulai ?? ''), '');
            const js = normalizeTimeHHMM(String(b.jam_selesai ?? ''), '');
            if (!jm || !js) return null;
            return {
              id: String(b.id || `brk_${idx + 1}`),
              label: String(b.label || `Istirahat ${idx + 1}`).trim() || `Istirahat ${idx + 1}`,
              jam_mulai: jm,
              jam_selesai: js,
            };
          })
          .filter((b): b is TimetableBreak => b !== null)
      : createDefaultTimetableConfig(tahunAjaran, semester, jamMulai).istirahat;

    const customClasses: string[] = Array.isArray(obj.custom_classes)
      ? Array.from(
          new Set(
            obj.custom_classes
              .map((c) => String(c ?? '').trim())
              .filter(Boolean)
          )
        )
      : [];

    const cells: Record<string, TimetableCellValue> = {};
    if (obj.cells && typeof obj.cells === 'object' && !Array.isArray(obj.cells)) {
      for (const [cellKey, cellVal] of Object.entries(
        obj.cells as Record<string, unknown>
      )) {
        if (!parseTimetableCellKey(cellKey)) continue;
        if (!cellVal || typeof cellVal !== 'object') continue;
        const c = cellVal as Record<string, unknown>;
        const mapel = String(c.mata_pelajaran ?? '').trim();
        if (!mapel) continue;
        cells[cellKey] = {
          mata_pelajaran: mapel,
          teacher_user_id: String(c.teacher_user_id ?? '').trim() || undefined,
          teacher_name: String(c.teacher_name ?? '').trim() || undefined,
        };
      }
    }

    const normalizedKey = getTimetableConfigKey(tahunAjaran, semester) || k;
    out[normalizedKey] = {
      tahun_ajaran: tahunAjaran,
      semester,
      jumlah_hari: jumlahHari,
      jam_mulai_sekolah: jamMulai,
      durasi_jp_menit: durasi,
      jumlah_jp: jumlahJp,
      istirahat,
      custom_classes: customClasses,
      ...(obj.bell_locked_by_admin === true ? { bell_locked_by_admin: true } : {}),
      cells,
      updated_at: typeof obj.updated_at === 'string' ? obj.updated_at : undefined,
    };
  }

  return out;
}

export function loadTimetableConfigs(): Record<string, TimetableConfig> {
  try {
    const raw = localStorage.getItem(TIMETABLE_STORAGE_KEY);
    if (!raw) return {};
    return sanitizeTimetableConfigs(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveTimetableConfigs(
  configs: Record<string, TimetableConfig>
): void {
  try {
    localStorage.setItem(TIMETABLE_STORAGE_KEY, JSON.stringify(configs));
  } catch {
    // Ignore storage quota errors
  }
}
