import type {
  AttendanceRecord,
  MasterSubject,
  SchoolSettings,
  Student,
  SubjectAssignment,
  SubjectAttendanceRecord,
  TeacherSchedule,
  UserAccount,
} from '../types';

/**
 * Official Cloud Firestore Free Tier (Spark Plan) daily & storage quotas.
 */
export const FIRESTORE_FREE_LIMITS = {
  DAILY_READS: 50_000,
  DAILY_WRITES: 20_000,
  DAILY_DELETES: 20_000,
  STORAGE_BYTES: 1_073_741_824, // 1 GiB
} as const;

export const FIRESTORE_USAGE_STORAGE_KEY = 'presensiqr_firestore_usage_v1';

export interface FirestoreDailyUsage {
  quotaDate: string; // YYYY-MM-DD in America/Los_Angeles (Firebase daily reset timezone)
  reads: number;
  writes: number;
  deletes: number;
  lastUpdatedAt: string;
}

export type QuotaHealthLevel = 'safe' | 'warning' | 'critical';

export interface QuotaMetricSummary {
  used: number;
  limit: number;
  remaining: number;
  percent: number;
  level: QuotaHealthLevel;
}

export interface StorageEstimateSummary extends QuotaMetricSummary {
  totalDocuments: number;
  breakdown: {
    settings: number;
    students: number;
    attendance: number;
    subjects: number;
    schedules: number;
    subjectAssignments: number;
    subjectRecords: number;
    accounts: number;
  };
}

export interface FirestoreQuotaSnapshot {
  quotaDate: string;
  reads: QuotaMetricSummary;
  writes: QuotaMetricSummary;
  deletes: QuotaMetricSummary;
  storage: StorageEstimateSummary;
  lastUpdatedAt: string;
}

const listeners = new Set<() => void>();

/**
 * Returns YYYY-MM-DD in Pacific Time (America/Los_Angeles),
 * matching Firebase Firestore's midnight PT daily free-tier quota reset.
 */
export function getFirestoreQuotaDate(now: Date = new Date()): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(now);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    // Fallback to UTC-8 approximation
  }
  const shifted = new Date(now.getTime() - 8 * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function createEmptyDailyUsage(now: Date = new Date()): FirestoreDailyUsage {
  return {
    quotaDate: getFirestoreQuotaDate(now),
    reads: 0,
    writes: 0,
    deletes: 0,
    lastUpdatedAt: now.toISOString(),
  };
}

export function loadFirestoreDailyUsage(now: Date = new Date()): FirestoreDailyUsage {
  const today = getFirestoreQuotaDate(now);
  if (typeof localStorage === 'undefined') {
    return createEmptyDailyUsage(now);
  }
  try {
    const raw = localStorage.getItem(FIRESTORE_USAGE_STORAGE_KEY);
    if (!raw) return createEmptyDailyUsage(now);
    const parsed = JSON.parse(raw) as Partial<FirestoreDailyUsage>;
    if (!parsed || parsed.quotaDate !== today) {
      const fresh = createEmptyDailyUsage(now);
      localStorage.setItem(FIRESTORE_USAGE_STORAGE_KEY, JSON.stringify(fresh));
      return fresh;
    }
    return {
      quotaDate: today,
      reads: Math.max(0, Number(parsed.reads) || 0),
      writes: Math.max(0, Number(parsed.writes) || 0),
      deletes: Math.max(0, Number(parsed.deletes) || 0),
      lastUpdatedAt:
        typeof parsed.lastUpdatedAt === 'string' ? parsed.lastUpdatedAt : now.toISOString(),
    };
  } catch {
    return createEmptyDailyUsage(now);
  }
}

export function saveFirestoreDailyUsage(usage: FirestoreDailyUsage): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(FIRESTORE_USAGE_STORAGE_KEY, JSON.stringify(usage));
  } catch {
    // Ignore storage quota errors
  }
}

function notifyUsageListeners(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Ignore subscriber errors
    }
  }
}

export function subscribeFirestoreUsage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function recordFirestoreOps(
  delta: { reads?: number; writes?: number; deletes?: number },
  now: Date = new Date()
): FirestoreDailyUsage {
  const current = loadFirestoreDailyUsage(now);
  const next: FirestoreDailyUsage = {
    quotaDate: current.quotaDate,
    reads: current.reads + Math.max(0, Math.floor(delta.reads || 0)),
    writes: current.writes + Math.max(0, Math.floor(delta.writes || 0)),
    deletes: current.deletes + Math.max(0, Math.floor(delta.deletes || 0)),
    lastUpdatedAt: now.toISOString(),
  };
  saveFirestoreDailyUsage(next);
  notifyUsageListeners();
  return next;
}

export function resetFirestoreDailyUsage(now: Date = new Date()): FirestoreDailyUsage {
  const fresh = createEmptyDailyUsage(now);
  saveFirestoreDailyUsage(fresh);
  notifyUsageListeners();
  return fresh;
}

export function buildQuotaMetric(used: number, limit: number): QuotaMetricSummary {
  const safeUsed = Math.max(0, used);
  const safeLimit = Math.max(1, limit);
  const remaining = Math.max(0, safeLimit - safeUsed);
  const percent = Math.min(100, Number(((safeUsed / safeLimit) * 100).toFixed(2)));
  const level: QuotaHealthLevel =
    percent >= 90 ? 'critical' : percent >= 70 ? 'warning' : 'safe';
  return {
    used: safeUsed,
    limit: safeLimit,
    remaining,
    percent,
    level,
  };
}

function utf8ByteLength(str: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str).length;
  }
  return str.length * 2;
}

/**
 * Estimates Firestore stored document size (including per-document metadata overhead).
 */
export function estimateFirestoreStorageUsage(datasets: {
  settings: SchoolSettings;
  students: Student[];
  records: AttendanceRecord[];
  masterSubjects: MasterSubject[];
  teacherSchedules: TeacherSchedule[];
  subjectAssignments: SubjectAssignment[];
  subjectRecords: SubjectAttendanceRecord[];
  accounts: UserAccount[];
}): StorageEstimateSummary {
  const DOC_OVERHEAD_BYTES = 128; // Approximate Firestore document name + index metadata overhead

  const breakdown = {
    settings: 1,
    students: datasets.students.length,
    attendance: datasets.records.length,
    subjects: datasets.masterSubjects.length,
    schedules: datasets.teacherSchedules.length,
    subjectAssignments: datasets.subjectAssignments.length,
    subjectRecords: datasets.subjectRecords.length,
    accounts: datasets.accounts.length,
  };

  const totalDocuments =
    breakdown.settings +
    breakdown.students +
    breakdown.attendance +
    breakdown.subjects +
    breakdown.schedules +
    breakdown.subjectAssignments +
    breakdown.subjectRecords +
    breakdown.accounts;

  const payloadBytes =
    utf8ByteLength(JSON.stringify(datasets.settings)) +
    utf8ByteLength(JSON.stringify(datasets.students)) +
    utf8ByteLength(JSON.stringify(datasets.records)) +
    utf8ByteLength(JSON.stringify(datasets.masterSubjects)) +
    utf8ByteLength(JSON.stringify(datasets.teacherSchedules)) +
    utf8ByteLength(JSON.stringify(datasets.subjectAssignments)) +
    utf8ByteLength(JSON.stringify(datasets.subjectRecords)) +
    utf8ByteLength(JSON.stringify(datasets.accounts));

  const estimatedBytes = payloadBytes + totalDocuments * DOC_OVERHEAD_BYTES;
  const metric = buildQuotaMetric(estimatedBytes, FIRESTORE_FREE_LIMITS.STORAGE_BYTES);

  return {
    ...metric,
    totalDocuments,
    breakdown,
  };
}

export function buildFirestoreQuotaSnapshot(
  daily: FirestoreDailyUsage,
  datasets: Parameters<typeof estimateFirestoreStorageUsage>[0]
): FirestoreQuotaSnapshot {
  return {
    quotaDate: daily.quotaDate,
    reads: buildQuotaMetric(daily.reads, FIRESTORE_FREE_LIMITS.DAILY_READS),
    writes: buildQuotaMetric(daily.writes, FIRESTORE_FREE_LIMITS.DAILY_WRITES),
    deletes: buildQuotaMetric(daily.deletes, FIRESTORE_FREE_LIMITS.DAILY_DELETES),
    storage: estimateFirestoreStorageUsage(datasets),
    lastUpdatedAt: daily.lastUpdatedAt,
  };
}

export function formatBytesReadable(bytes: number): string {
  const safe = Math.max(0, bytes);
  if (safe < 1024) return `${safe} B`;
  if (safe < 1024 * 1024) return `${(safe / 1024).toFixed(1)} KB`;
  if (safe < 1024 * 1024 * 1024) return `${(safe / (1024 * 1024)).toFixed(2)} MB`;
  return `${(safe / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}
