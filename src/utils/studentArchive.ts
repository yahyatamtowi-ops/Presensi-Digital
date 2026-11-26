import type { AttendanceRecord, Student } from '../types';
import { normalizeAcademicYear, resolveItemAcademicYear } from './attendanceLogic';

export interface StudentAcademicYearSummary {
  tahun_ajaran: string;
  studentCount: number;
  classCount: number;
  isActive: boolean;
}

/**
 * Builds a stable composite key `(tahun_ajaran, nis)` so the same student NISN
 * can coexist safely across multiple academic years without overwriting archives.
 */
export function getStudentYearKey(
  student: Pick<Student, 'nis' | 'tahun_ajaran'>,
  fallbackYear = '2026/2027'
): string {
  const year = resolveItemAcademicYear(student.tahun_ajaran, fallbackYear);
  const nis = String(student.nis || '').trim().toLowerCase();
  return `${year}|${nis}`;
}

/**
 * Stamps any students or records missing an explicit `tahun_ajaran` with `previousYear`
 * BEFORE switching `settings.tahun_ajaran` to `nextYear`.
 * Guarantees previous academic year students are permanently anchored in their original year.
 */
export function stampUntaggedItemsWithAcademicYear<T extends { tahun_ajaran?: string }>(
  items: T[],
  previousYear: string
): { items: T[]; changedItems: T[]; changed: boolean } {
  const safePrevYear = normalizeAcademicYear(previousYear) || '2026/2027';
  const changedItems: T[] = [];
  const nextItems = items.map((item) => {
    const existingYear = normalizeAcademicYear(item.tahun_ajaran);
    if (existingYear) return item;
    const stamped = { ...item, tahun_ajaran: safePrevYear };
    changedItems.push(stamped);
    return stamped;
  });

  return {
    items: nextItems,
    changedItems,
    changed: changedItems.length > 0,
  };
}

/**
 * Preserves all existing students and records under `previousYear` when switching to `nextYear`.
 */
export function preserveArchiveOnAcademicYearChange(params: {
  students: Student[];
  records: AttendanceRecord[];
  previousYear: string;
  nextYear: string;
}): {
  students: Student[];
  records: AttendanceRecord[];
  stampedStudents: Student[];
  stampedRecords: AttendanceRecord[];
  yearChanged: boolean;
} {
  const prevNorm = normalizeAcademicYear(params.previousYear) || '2026/2027';
  const nextNorm = normalizeAcademicYear(params.nextYear) || prevNorm;
  const yearChanged = prevNorm !== nextNorm;

  const studentRes = stampUntaggedItemsWithAcademicYear(params.students, prevNorm);
  const recordRes = stampUntaggedItemsWithAcademicYear(params.records, prevNorm);

  return {
    students: studentRes.items,
    records: recordRes.items,
    stampedStudents: studentRes.changedItems,
    stampedRecords: recordRes.changedItems,
    yearChanged,
  };
}

/**
 * Merges incoming synced students with existing students using `(tahun_ajaran, nis)` keys,
 * preserving archived academic years that may not be present in an incoming single-year sync.
 */
export function mergeStudentsPreservingArchives(
  existingStudents: Student[],
  incomingStudents: Student[],
  fallbackYear = '2026/2027'
): Student[] {
  const map = new Map<string, Student>();
  const normFallback = normalizeAcademicYear(fallbackYear) || '2026/2027';

  for (const s of existingStudents) {
    const yr = resolveItemAcademicYear(s.tahun_ajaran, normFallback);
    const key = `${yr}|${s.nis.trim().toLowerCase()}`;
    map.set(key, { ...s, tahun_ajaran: yr });
  }

  for (const s of incomingStudents) {
    const yr = resolveItemAcademicYear(s.tahun_ajaran, normFallback);
    const key = `${yr}|${s.nis.trim().toLowerCase()}`;
    const prev = map.get(key);
    map.set(key, {
      ...(prev || {}),
      ...s,
      tahun_ajaran: yr,
    });
  }

  return Array.from(map.values()).sort((a, b) => {
    const yrCmp = resolveItemAcademicYear(b.tahun_ajaran, normFallback).localeCompare(
      resolveItemAcademicYear(a.tahun_ajaran, normFallback)
    );
    if (yrCmp !== 0) return yrCmp;
    return a.nis.localeCompare(b.nis, 'id');
  });
}

/**
 * Summarizes stored student counts per academic year (sorted newest first).
 */
export function summarizeStudentsByAcademicYear(
  students: Student[],
  activeAcademicYear: string
): StudentAcademicYearSummary[] {
  const normActive = normalizeAcademicYear(activeAcademicYear) || '2026/2027';
  const bucket = new Map<string, { count: number; classes: Set<string> }>();
  bucket.set(normActive, { count: 0, classes: new Set<string>() });

  for (const s of students) {
    const yr = resolveItemAcademicYear(s.tahun_ajaran, normActive);
    if (!bucket.has(yr)) {
      bucket.set(yr, { count: 0, classes: new Set<string>() });
    }
    const entry = bucket.get(yr)!;
    entry.count++;
    if (s.kelas.trim()) {
      entry.classes.add(s.kelas.trim().toLowerCase());
    }
  }

  return Array.from(bucket.entries())
    .map(([tahun_ajaran, info]) => ({
      tahun_ajaran,
      studentCount: info.count,
      classCount: info.classes.size,
      isActive: tahun_ajaran === normActive,
    }))
    .sort((a, b) => {
      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;
      return b.tahun_ajaran.localeCompare(a.tahun_ajaran);
    });
}

/**
 * Promotes Indonesian grade prefixes by 1 level (X -> XI, XI -> XII, 7 -> 8, 8 -> 9, etc.).
 * Returns `null` when the student is in a graduating grade (XII / 12 / 9 / 6).
 */
export function promoteClassNameOneLevel(kelas: string): string | null {
  const trimmed = String(kelas || '').trim();
  if (!trimmed) return trimmed;

  // Roman numerals (SMA/SMK: X -> XI, XI -> XII, XII -> graduated)
  if (/^XII(\b|[\s.\-_])/i.test(trimmed)) {
    return null;
  }
  if (/^XI(\b|[\s.\-_])/i.test(trimmed)) {
    return trimmed.replace(/^XI/i, 'XII');
  }
  if (/^X(\b|[\s.\-_])/i.test(trimmed)) {
    return trimmed.replace(/^X/i, 'XI');
  }

  // Numeric grades (10 -> 11, 11 -> 12, 12 -> graduated; 7 -> 8, 8 -> 9, 9 -> graduated; 1..5 -> +1, 6 -> graduated)
  const numMatch = /^(1[0-2]|[1-9])(\b|[\s.\-_])(.*)$/.exec(trimmed);
  if (numMatch) {
    const grade = Number(numMatch[1]);
    const rest = `${numMatch[2]}${numMatch[3]}`;
    if (grade === 12 || grade === 9 || grade === 6) {
      return null;
    }
    return `${grade + 1}${rest}`;
  }

  return trimmed;
}

/**
 * Copies (or auto-promotes) students from a source academic year into `targetYear`,
 * strictly preserving all source-year student rows untouched and skipping NISNs already in `targetYear`.
 */
export function cloneStudentsToAcademicYear(params: {
  allStudents: Student[];
  sourceYear: string;
  targetYear: string;
  autoPromoteClass?: boolean;
}): {
  createdStudents: Student[];
  skippedDuplicates: number;
  graduatedCount: number;
} {
  const srcNorm = normalizeAcademicYear(params.sourceYear) || '2026/2027';
  const tgtNorm = normalizeAcademicYear(params.targetYear) || '2026/2027';
  if (srcNorm === tgtNorm) {
    return { createdStudents: [], skippedDuplicates: 0, graduatedCount: 0 };
  }

  const existingInTarget = new Set<string>();
  const sourceStudents: Student[] = [];

  for (const s of params.allStudents) {
    const yr = resolveItemAcademicYear(s.tahun_ajaran, srcNorm);
    if (yr === tgtNorm) {
      existingInTarget.add(s.nis.trim().toLowerCase());
    } else if (yr === srcNorm) {
      sourceStudents.push(s);
    }
  }

  const createdStudents: Student[] = [];
  let skippedDuplicates = 0;
  let graduatedCount = 0;

  for (const s of sourceStudents) {
    const nisNorm = s.nis.trim().toLowerCase();
    if (existingInTarget.has(nisNorm)) {
      skippedDuplicates++;
      continue;
    }

    let nextClass = s.kelas;
    if (params.autoPromoteClass) {
      const promoted = promoteClassNameOneLevel(s.kelas);
      if (promoted === null) {
        graduatedCount++;
        continue;
      }
      nextClass = promoted;
    }

    existingInTarget.add(nisNorm);
    createdStudents.push({
      ...s,
      kelas: nextClass,
      tahun_ajaran: tgtNorm,
    });
  }

  return {
    createdStudents,
    skippedDuplicates,
    graduatedCount,
  };
}
