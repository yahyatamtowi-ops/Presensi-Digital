import type { AttendanceRecord, SubjectAttendanceRecord } from '../types';
import { resolveItemAcademicYear } from './attendanceLogic';
import {
  formatBytesReadable,
  type FirestoreQuotaSnapshot,
  type QuotaHealthLevel,
} from './firestoreUsage';

export const LOCAL_STORAGE_SOFT_LIMIT_BYTES = 5 * 1024 * 1024; // 5 MiB browser localStorage spec limit
export const INDEXEDDB_FALLBACK_MAX_BYTES = 100 * 1024 * 1024; // 100 MiB fallback when Storage API unavailable
export const STORAGE_ERROR_EVENT = 'presensiqr:storage-error';

export type ClearStorageScope = 'device_cache' | 'app_local';

export interface StorageLike {
  length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
}

export interface AcademicYearAttendanceStat {
  tahun_ajaran: string;
  dailyCount: number;
  subjectCount: number;
  totalCount: number;
  estimatedBytes: number;
}

export interface DeleteByYearResult {
  nextRecords: AttendanceRecord[];
  nextSubjectRecords: SubjectAttendanceRecord[];
  removedRecords: AttendanceRecord[];
  removedSubjectRecords: SubjectAttendanceRecord[];
  freedBytes: number;
}

export interface StorageMetricDetail {
  usedBytes: number;
  limitBytes: number;
  remainingBytes: number;
  percent: number;
  level: QuotaHealthLevel;
}

export interface LocalStorageBreakdown {
  studentsBytes: number;
  attendanceBytes: number;
  settingsBytes: number;
  otherBytes: number;
}

export interface LocalStorageUsageSnapshot extends StorageMetricDetail {
  itemCount: number;
  breakdown: LocalStorageBreakdown;
}

export interface AppLocalMaxStorageSnapshot extends LocalStorageUsageSnapshot {
  storageEngine: 'indexeddb_max' | 'local_storage_only';
  quickCache: StorageMetricDetail;
}

export interface ExternalStorageSnapshot {
  device: StorageMetricDetail & {
    source: 'storage_api' | 'local_storage_fallback';
    persisted: boolean;
  };
  appLocal: AppLocalMaxStorageSnapshot;
  cloud: StorageMetricDetail & {
    connected: boolean;
  };
  checkedAt: string;
}

export interface StorageAlertItem {
  id: string;
  severity: 'warning' | 'critical';
  source: 'local' | 'external' | 'cloud' | 'write_error';
  title: string;
  message: string;
  percent?: number;
}

function estimateJsonUtf16Bytes(value: unknown): number {
  try {
    return JSON.stringify(value).length * 2;
  } catch {
    return 0;
  }
}

export function classifyStorageLevel(percent: number): QuotaHealthLevel {
  if (percent >= 90) return 'critical';
  if (percent >= 70) return 'warning';
  return 'safe';
}

export function buildStorageMetric(usedBytes: number, limitBytes: number): StorageMetricDetail {
  const safeLimit = Math.max(1, Math.round(limitBytes));
  const safeUsed = Math.max(0, Math.round(usedBytes));
  const remainingBytes = Math.max(0, safeLimit - safeUsed);
  const percent = Math.min(100, Number(((safeUsed / safeLimit) * 100).toFixed(1)));
  return {
    usedBytes: safeUsed,
    limitBytes: safeLimit,
    remainingBytes,
    percent,
    level: classifyStorageLevel(percent),
  };
}

/**
 * Summarizes daily and subject attendance records grouped by academic year,
 * sorted newest academic year first, with estimated JSON storage size per year.
 */
export function summarizeAttendanceByAcademicYear(
  records: AttendanceRecord[],
  subjectRecords: SubjectAttendanceRecord[],
  fallbackAcademicYear?: string
): AcademicYearAttendanceStat[] {
  const map = new Map<
    string,
    { daily: AttendanceRecord[]; subject: SubjectAttendanceRecord[] }
  >();

  for (const r of records) {
    const yr = resolveItemAcademicYear(r.tahun_ajaran, fallbackAcademicYear);
    const bucket = map.get(yr) ?? { daily: [], subject: [] };
    bucket.daily.push(r);
    map.set(yr, bucket);
  }

  for (const sr of subjectRecords) {
    const yr = resolveItemAcademicYear(sr.tahun_ajaran, fallbackAcademicYear);
    const bucket = map.get(yr) ?? { daily: [], subject: [] };
    bucket.subject.push(sr);
    map.set(yr, bucket);
  }

  const stats: AcademicYearAttendanceStat[] = [];
  for (const [tahun_ajaran, bucket] of map.entries()) {
    const dailyCount = bucket.daily.length;
    const subjectCount = bucket.subject.length;
    const totalCount = dailyCount + subjectCount;
    if (totalCount === 0) continue;
    const estimatedBytes =
      estimateJsonUtf16Bytes(bucket.daily) + estimateJsonUtf16Bytes(bucket.subject);
    stats.push({
      tahun_ajaran,
      dailyCount,
      subjectCount,
      totalCount,
      estimatedBytes,
    });
  }

  return stats.sort((a, b) => b.tahun_ajaran.localeCompare(a.tahun_ajaran, 'id'));
}

/**
 * Purely partitions daily and subject attendance records into remaining vs removed
 * for the selected academic year.
 */
export function deleteAttendanceByAcademicYear(
  records: AttendanceRecord[],
  subjectRecords: SubjectAttendanceRecord[],
  targetAcademicYear: string,
  fallbackAcademicYear?: string
): DeleteByYearResult {
  const target = targetAcademicYear.trim();
  const nextRecords: AttendanceRecord[] = [];
  const removedRecords: AttendanceRecord[] = [];

  for (const r of records) {
    const yr = resolveItemAcademicYear(r.tahun_ajaran, fallbackAcademicYear);
    if (yr === target) {
      removedRecords.push(r);
    } else {
      nextRecords.push(r);
    }
  }

  const nextSubjectRecords: SubjectAttendanceRecord[] = [];
  const removedSubjectRecords: SubjectAttendanceRecord[] = [];

  for (const sr of subjectRecords) {
    const yr = resolveItemAcademicYear(sr.tahun_ajaran, fallbackAcademicYear);
    if (yr === target) {
      removedSubjectRecords.push(sr);
    } else {
      nextSubjectRecords.push(sr);
    }
  }

  const freedBytes =
    estimateJsonUtf16Bytes(removedRecords) + estimateJsonUtf16Bytes(removedSubjectRecords);

  return {
    nextRecords,
    nextSubjectRecords,
    removedRecords,
    removedSubjectRecords,
    freedBytes,
  };
}

/**
 * Measures UTF-16 byte usage of browser localStorage (or injected StorageLike for tests)
 * against a configurable soft limit (default 5 MiB browser localStorage spec).
 */
export function measureLocalStorageUsage(
  storageLike?: StorageLike | null,
  limitBytes = LOCAL_STORAGE_SOFT_LIMIT_BYTES
): LocalStorageUsageSnapshot {
  const store =
    storageLike !== undefined
      ? storageLike
      : typeof window !== 'undefined'
        ? window.localStorage
        : null;

  let totalBytes = 0;
  let studentsBytes = 0;
  let attendanceBytes = 0;
  let settingsBytes = 0;
  let otherBytes = 0;
  let itemCount = 0;

  if (store) {
    try {
      const len = store.length;
      for (let i = 0; i < len; i++) {
        const k = store.key(i);
        if (!k) continue;
        const v = store.getItem(k) ?? '';
        const entryBytes = (k.length + v.length) * 2;
        totalBytes += entryBytes;
        itemCount += 1;

        const lowerKey = k.toLowerCase();
        if (lowerKey.includes('students')) {
          studentsBytes += entryBytes;
        } else if (
          lowerKey.includes('records') ||
          lowerKey.includes('subject_records') ||
          lowerKey.includes('late_correction') ||
          lowerKey.includes('late_requests')
        ) {
          attendanceBytes += entryBytes;
        } else if (
          lowerKey.includes('settings') ||
          lowerKey.includes('default_identity')
        ) {
          settingsBytes += entryBytes;
        } else {
          otherBytes += entryBytes;
        }
      }
    } catch {
      // Ignore storage access restriction
    }
  }

  const metric = buildStorageMetric(totalBytes, limitBytes);
  return {
    ...metric,
    itemCount,
    breakdown: {
      studentsBytes,
      attendanceBytes,
      settingsBytes,
      otherBytes,
    },
  };
}

/**
 * Estimates total live app dataset bytes across in-memory collections so datasets
 * exceeding localStorage's 5 MiB ceiling (persisted in IndexedDB) are accurately reflected.
 */
export function estimateLiveAppDataBreakdown(params: {
  students: unknown;
  records: unknown;
  subjectRecords: unknown;
  settings: unknown;
  otherCollections?: unknown;
}): LocalStorageBreakdown & { totalBytes: number } {
  const studentsBytes = estimateJsonUtf16Bytes(params.students);
  const attendanceBytes =
    estimateJsonUtf16Bytes(params.records) + estimateJsonUtf16Bytes(params.subjectRecords);
  const settingsBytes = estimateJsonUtf16Bytes(params.settings);
  const otherBytes = params.otherCollections
    ? estimateJsonUtf16Bytes(params.otherCollections)
    : 0;
  return {
    studentsBytes,
    attendanceBytes,
    settingsBytes,
    otherBytes,
    totalBytes: studentsBytes + attendanceBytes + settingsBytes + otherBytes,
  };
}

/**
 * Combines real browser Storage Quota API estimate (maximum IndexedDB/browser disk quota)
 * with localStorage quick-cache usage, live IndexedDB-backed app storage usage,
 * and Cloud Firestore storage usage into a unified ExternalStorageSnapshot.
 */
export function buildExternalStorageSnapshot(params: {
  deviceUsageBytes?: number | null;
  deviceQuotaBytes?: number | null;
  devicePersisted?: boolean;
  indexedDbSupported?: boolean;
  localUsage: LocalStorageUsageSnapshot;
  liveAppBreakdown?: LocalStorageBreakdown & { totalBytes: number };
  cloudStorage: {
    used: number;
    limit: number;
    remaining: number;
    percent: number;
    level: QuotaHealthLevel;
  };
  cloudConnected: boolean;
  checkedAt?: string;
}): ExternalStorageSnapshot {
  const hasRealDeviceQuota =
    typeof params.deviceQuotaBytes === 'number' &&
    Number.isFinite(params.deviceQuotaBytes) &&
    params.deviceQuotaBytes > 0;

  const hasIdb =
    params.indexedDbSupported !== undefined
      ? params.indexedDbSupported
      : typeof indexedDB !== 'undefined';

  // Effective maximum capacity for Storage Lokal Aplikasi:
  // When IndexedDB + Storage Quota API are available, use the browser's full max quota
  // (hundreds of MB to tens of GB instead of localStorage's 5 MiB cap).
  const appLocalMaxLimitBytes = hasIdb
    ? hasRealDeviceQuota
      ? Math.max(params.deviceQuotaBytes as number, LOCAL_STORAGE_SOFT_LIMIT_BYTES)
      : INDEXEDDB_FALLBACK_MAX_BYTES
    : params.localUsage.limitBytes;

  const liveBreakdown = params.liveAppBreakdown;
  const mergedBreakdown: LocalStorageBreakdown = liveBreakdown
    ? {
        studentsBytes: Math.max(params.localUsage.breakdown.studentsBytes, liveBreakdown.studentsBytes),
        attendanceBytes: Math.max(
          params.localUsage.breakdown.attendanceBytes,
          liveBreakdown.attendanceBytes
        ),
        settingsBytes: Math.max(params.localUsage.breakdown.settingsBytes, liveBreakdown.settingsBytes),
        otherBytes: Math.max(params.localUsage.breakdown.otherBytes, liveBreakdown.otherBytes),
      }
    : params.localUsage.breakdown;

  const appLocalUsedBytes = Math.max(
    params.localUsage.usedBytes,
    liveBreakdown ? liveBreakdown.totalBytes : 0
  );

  const appLocalMetric = buildStorageMetric(appLocalUsedBytes, appLocalMaxLimitBytes);

  const deviceMetric = hasRealDeviceQuota
    ? buildStorageMetric(
        Math.max(params.deviceUsageBytes ?? 0, appLocalUsedBytes),
        params.deviceQuotaBytes as number
      )
    : buildStorageMetric(appLocalUsedBytes, appLocalMaxLimitBytes);

  return {
    device: {
      ...deviceMetric,
      source: hasRealDeviceQuota ? 'storage_api' : 'local_storage_fallback',
      persisted: Boolean(params.devicePersisted),
    },
    appLocal: {
      ...appLocalMetric,
      itemCount: params.localUsage.itemCount,
      breakdown: mergedBreakdown,
      storageEngine: hasIdb ? 'indexeddb_max' : 'local_storage_only',
      quickCache: buildStorageMetric(params.localUsage.usedBytes, params.localUsage.limitBytes),
    },
    cloud: {
      usedBytes: params.cloudStorage.used,
      limitBytes: params.cloudStorage.limit,
      remainingBytes: params.cloudStorage.remaining,
      percent: params.cloudStorage.percent,
      level: params.cloudStorage.level,
      connected: params.cloudConnected,
    },
    checkedAt: params.checkedAt || new Date().toISOString(),
  };
}

/**
 * Evaluates application storage health for Master Admin warning notifications.
 * Returns actionable alerts whenever localStorage quick-cache, IndexedDB max local storage,
 * external/device storage, cloud Firestore storage/quota, or a live write error indicates pressure.
 */
export function evaluateMasterAdminStorageAlerts(params: {
  localUsage: LocalStorageUsageSnapshot;
  externalStorage: ExternalStorageSnapshot;
  firestoreQuota: FirestoreQuotaSnapshot;
  cloudConnected: boolean;
  storageWriteError?: string | null;
}): StorageAlertItem[] {
  const alerts: StorageAlertItem[] = [];

  if (params.storageWriteError && params.storageWriteError.trim()) {
    alerts.push({
      id: 'storage-write-error',
      severity: 'critical',
      source: 'write_error',
      title: 'Penyimpanan Aplikasi Penuh — Perlu Pembersihan',
      message: `${params.storageWriteError.trim()} Segera backup data lalu bersihkan cache atau hapus riwayat presensi tahun ajaran lama di menu Backup & Reset.`,
    });
  }

  if (params.localUsage.percent >= 70) {
    const isCritical = params.localUsage.percent >= 90;
    alerts.push({
      id: 'local-storage-quota',
      severity: isCritical ? 'critical' : 'warning',
      source: 'local',
      title: isCritical
        ? 'Cache Cepat Browser (localStorage) Hampir Penuh'
        : 'Cache Cepat Browser (localStorage) Mulai Padat',
      message: `Cache cepat localStorage terpakai ${formatBytesReadable(
        params.localUsage.usedBytes
      )} dari ${formatBytesReadable(params.localUsage.limitBytes)} (${
        params.localUsage.percent
      }%), tersisa ${formatBytesReadable(
        params.localUsage.remainingBytes
      )}. Data besar otomatis diamankan di IndexedDB, namun hapus presensi tahun ajaran lama di Pengaturan → Backup & Reset agar aplikasi tetap ringan.`,
      percent: params.localUsage.percent,
    });
  }

  if (
    params.externalStorage.device.source === 'storage_api' &&
    params.externalStorage.device.percent >= 70
  ) {
    const isCritical = params.externalStorage.device.percent >= 90;
    alerts.push({
      id: 'external-device-storage',
      severity: isCritical ? 'critical' : 'warning',
      source: 'external',
      title: isCritical
        ? 'Penyimpanan Perangkat / Eksternal Hampir Penuh'
        : 'Kapasitas Penyimpanan Perangkat Mulai Menipis',
      message: `Penyimpanan browser/perangkat terpakai ${formatBytesReadable(
        params.externalStorage.device.usedBytes
      )} (${params.externalStorage.device.percent}%), tersisa ${formatBytesReadable(
        params.externalStorage.device.remainingBytes
      )}.`,
      percent: params.externalStorage.device.percent,
    });
  }

  if (params.cloudConnected && params.firestoreQuota.storage.percent >= 70) {
    const isCritical = params.firestoreQuota.storage.percent >= 90;
    alerts.push({
      id: 'cloud-firestore-storage',
      severity: isCritical ? 'critical' : 'warning',
      source: 'cloud',
      title: isCritical
        ? 'Penyimpanan Cloud Firebase Hampir Penuh'
        : 'Penyimpanan Cloud Firebase Mulai Penuh',
      message: `Cloud Firestore terpakai ${formatBytesReadable(
        params.firestoreQuota.storage.used
      )} dari ${formatBytesReadable(params.firestoreQuota.storage.limit)} (${
        params.firestoreQuota.storage.percent
      }%), tersisa ${formatBytesReadable(
        params.firestoreQuota.storage.remaining
      )}. Pertimbangkan menghapus arsip presensi tahun ajaran lama.`,
      percent: params.firestoreQuota.storage.percent,
    });
  }

  if (
    params.cloudConnected &&
    (params.firestoreQuota.writes.percent >= 80 || params.firestoreQuota.reads.percent >= 80)
  ) {
    const maxPct = Math.max(
      params.firestoreQuota.writes.percent,
      params.firestoreQuota.reads.percent
    );
    const isCritical = maxPct >= 95;
    alerts.push({
      id: 'cloud-firestore-daily-quota',
      severity: isCritical ? 'critical' : 'warning',
      source: 'cloud',
      title: isCritical
        ? 'Kuota Harian Cloud Firebase Hampir Habis'
        : 'Penggunaan Kuota Harian Cloud Firebase Tinggi',
      message: `Aktivitas baca/tulis Cloud hari ini mencapai ${maxPct}% dari batas gratis harian. Backup data Anda secara berkala di menu Backup & Reset.`,
      percent: maxPct,
    });
  }

  return alerts;
}

export function notifyStorageWriteError(message: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(
      new CustomEvent(STORAGE_ERROR_EVENT, {
        detail: { message },
      })
    );
  } catch {
    // Ignore event dispatch failure
  }
}
