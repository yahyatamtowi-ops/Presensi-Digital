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
  normalizeTimeHHMM,
  parseTimeToMinutes,
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
      if (gapBeforeBreak < Math.min(15, duration / 2)) {
        // Very tiny gap before manual break: place break first, then run full lesson after break
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

  for (const hari of days) {
    for (let jp = 1; jp <= config.jumlah_jp; jp++) {
      const byTeacher = new Map<string, { name: string; classes: string[] }>();
      for (const kelas of activeClasses) {
        const cell = config.cells[makeTimetableCellKey(hari, jp, kelas)];
        if (!cell?.mata_pelajaran?.trim() || !cell.teacher_user_id?.trim()) continue;
        const tid = cell.teacher_user_id.trim();
        const entry = byTeacher.get(tid) || {
          name: cell.teacher_name || 'Guru',
          classes: [],
        };
        entry.classes.push(kelas);
        byTeacher.set(tid, entry);
      }
      for (const [tid, info] of byTeacher.entries()) {
        if (info.classes.length > 1) {
          conflicts.push({
            hari,
            jamKe: jp,
            teacher_user_id: tid,
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
 * Populates a TimetableConfig's cells from existing TeacherSchedule records matching the
 * config's academic year & semester (fills any slot whose time range overlaps the schedule).
 */
export function hydrateTimetableCellsFromSchedules(
  config: TimetableConfig,
  schedules: TeacherSchedule[],
  overwriteExisting = false
): TimetableConfig {
  const tahunAjaran = resolveItemAcademicYear(config.tahun_ajaran);
  const semester = normalizeSemester(config.semester);
  const validDays = new Set(getSchoolDaysForCount(config.jumlah_hari));
  const lessonSlots = generateDailyTimeSlots(config).filter(
    (s): s is Extract<TimetableTimeSlot, { kind: 'lesson' }> => s.kind === 'lesson'
  );

  const nextCells: Record<string, TimetableCellValue> = overwriteExisting
    ? {}
    : { ...config.cells };
  const extraClasses = new Set<string>(config.custom_classes || []);

  const scoped = schedules.filter(
    (s) =>
      resolveItemAcademicYear(s.tahun_ajaran) === tahunAjaran &&
      (!s.semester || normalizeSemester(s.semester) === semester) &&
      validDays.has(s.hari)
  );

  for (const sch of scoped) {
    const schStart = parseTimeToMinutes(sch.jam_mulai);
    const schEnd = parseTimeToMinutes(sch.jam_selesai);
    if (schStart === null || schEnd === null || schEnd <= schStart) continue;
    extraClasses.add(sch.kelas.trim());

    let matchedAny = false;
    for (const slot of lessonSlots) {
      const slotStart = parseTimeToMinutes(slot.jam_mulai);
      const slotEnd = parseTimeToMinutes(slot.jam_selesai);
      if (slotStart === null || slotEnd === null) continue;
      // Overlap check: consider a slot covered if overlap >= 15 minutes or >= half slot
      const overlapStart = Math.max(schStart, slotStart);
      const overlapEnd = Math.min(schEnd, slotEnd);
      const overlap = overlapEnd - overlapStart;
      const slotDur = slotEnd - slotStart;
      if (overlap >= Math.min(15, Math.ceil(slotDur / 2))) {
        const key = makeTimetableCellKey(sch.hari, slot.jamKe, sch.kelas);
        if (overwriteExisting || !nextCells[key]?.mata_pelajaran) {
          nextCells[key] = {
            mata_pelajaran: sch.mata_pelajaran,
            teacher_user_id: sch.teacher_user_id,
            teacher_name: sch.teacher_name,
          };
        }
        matchedAny = true;
      }
    }

    // Fallback: if schedule time fell outside configured slots, snap to nearest slot
    if (!matchedAny && lessonSlots.length > 0) {
      let nearest = lessonSlots[0];
      let minDist = Infinity;
      for (const slot of lessonSlots) {
        const slotStart = parseTimeToMinutes(slot.jam_mulai) ?? 0;
        const dist = Math.abs(slotStart - schStart);
        if (dist < minDist) {
          minDist = dist;
          nearest = slot;
        }
      }
      const key = makeTimetableCellKey(sch.hari, nearest.jamKe, sch.kelas);
      if (overwriteExisting || !nextCells[key]?.mata_pelajaran) {
        nextCells[key] = {
          mata_pelajaran: sch.mata_pelajaran,
          teacher_user_id: sch.teacher_user_id,
          teacher_name: sch.teacher_name,
        };
      }
    }
  }

  return {
    ...config,
    custom_classes: Array.from(extraClasses).sort((a, b) => a.localeCompare(b)),
    cells: nextCells,
  };
}

/**
 * Synchronizes all TimetableConfigs from the authoritative TeacherSchedule list.
 * Preserves each (tahun_ajaran, semester) config's bell schedule (jam mulai, durasi JP,
 * jumlah JP, manual istirahat, custom classes) while rebuilding teacher-assigned cells
 * so changes made in Mapel & Jadwal, Presensi Mapel Guru, or Cloud/Sheets appear
 * automatically in Pengaturan Jadwal.
 */
export function syncTimetableConfigsFromSchedules(
  configs: Record<string, TimetableConfig>,
  schedules: TeacherSchedule[],
  fallbackStartTime = '07:15'
): Record<string, TimetableConfig> {
  const next: Record<string, TimetableConfig> = {};

  // Gather all (tahun_ajaran, semester) keys present in configs or schedules
  const keyMeta = new Map<string, { tahun_ajaran: string; semester: SemesterKind }>();

  for (const [k, cfg] of Object.entries(configs || {})) {
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

  for (const [key, meta] of keyMeta.entries()) {
    const existing = configs[key];
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
      true
    );

    // Preserve any incomplete draft cells (subject picked without teacher yet) if slot is still empty
    const mergedCells: Record<string, TimetableCellValue> = { ...hydrated.cells };
    if (existing) {
      for (const [cellKey, cellVal] of Object.entries(existing.cells)) {
        if (
          cellVal?.mata_pelajaran?.trim() &&
          !cellVal.teacher_user_id?.trim() &&
          !mergedCells[cellKey]?.mata_pelajaran
        ) {
          mergedCells[cellKey] = { ...cellVal };
        }
      }
    }

    next[key] = {
      ...hydrated,
      cells: mergedCells,
      updated_at: new Date().toISOString(),
    };
  }

  return next;
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

  const lessonSlots = generateDailyTimeSlots(config).filter(
    (s): s is Extract<TimetableTimeSlot, { kind: 'lesson' }> => s.kind === 'lesson'
  );
  const matched: number[] = [];

  for (const slot of lessonSlots) {
    const slotStart = parseTimeToMinutes(slot.jam_mulai);
    const slotEnd = parseTimeToMinutes(slot.jam_selesai);
    if (slotStart === null || slotEnd === null) continue;
    const overlap = Math.min(schEnd, slotEnd) - Math.max(schStart, slotStart);
    const slotDur = slotEnd - slotStart;
    if (overlap >= Math.min(15, Math.ceil(slotDur / 2))) {
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
