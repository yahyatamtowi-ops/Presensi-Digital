import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AttendanceRecord, SubjectAttendanceRecord } from '../types';
import { buildQuotaMetric, FIRESTORE_FREE_LIMITS, type FirestoreQuotaSnapshot } from './firestoreUsage';
import {
  buildExternalStorageSnapshot,
  deleteAttendanceByAcademicYear,
  evaluateMasterAdminStorageAlerts,
  LOCAL_STORAGE_SOFT_LIMIT_BYTES,
  measureLocalStorageUsage,
  summarizeAttendanceByAcademicYear,
  type StorageLike,
} from './storageHealth';

function createMemoryStorage(entries: Record<string, string>): StorageLike {
  const keys = Object.keys(entries);
  return {
    get length() {
      return keys.length;
    },
    key(index: number) {
      return keys[index] ?? null;
    },
    getItem(k: string) {
      return Object.prototype.hasOwnProperty.call(entries, k) ? entries[k] : null;
    },
  };
}

function makeQuotaSnapshot(overrides?: {
  storageUsed?: number;
  readsUsed?: number;
  writesUsed?: number;
}): FirestoreQuotaSnapshot {
  const storageMetric = buildQuotaMetric(
    overrides?.storageUsed ?? 1024 * 1024,
    FIRESTORE_FREE_LIMITS.STORAGE_BYTES
  );
  return {
    quotaDate: '2026-08-10',
    reads: buildQuotaMetric(overrides?.readsUsed ?? 100, FIRESTORE_FREE_LIMITS.DAILY_READS),
    writes: buildQuotaMetric(overrides?.writesUsed ?? 50, FIRESTORE_FREE_LIMITS.DAILY_WRITES),
    deletes: buildQuotaMetric(10, FIRESTORE_FREE_LIMITS.DAILY_DELETES),
    storage: {
      ...storageMetric,
      totalDocuments: 20,
      breakdown: {
        settings: 1024,
        students: 2048,
        attendance: 4096,
        subjects: 512,
        schedules: 512,
        subjectAssignments: 512,
        subjectRecords: 1024,
        accounts: 512,
      },
    },
    lastUpdatedAt: '2026-08-10T07:00:00.000Z',
  };
}

describe('storageHealth', () => {
  const dailyRecords: AttendanceRecord[] = [
    {
      id: '2025-09-01_1001',
      tanggal: '2025-09-01',
      nis: '1001',
      nama: 'Budi Santoso',
      kelas: 'X-A',
      jam_masuk: '07:05:00',
      status: 'Hadir',
      tahun_ajaran: '2025/2026',
    },
    {
      id: '2025-09-02_1001',
      tanggal: '2025-09-02',
      nis: '1001',
      nama: 'Budi Santoso',
      kelas: 'X-A',
      jam_masuk: '07:20:00',
      status: 'Terlambat',
      tahun_ajaran: '2025/2026',
    },
    {
      id: '2026-08-10_1001',
      tanggal: '2026-08-10',
      nis: '1001',
      nama: 'Budi Santoso',
      kelas: 'XI-A',
      jam_masuk: '07:02:00',
      status: 'Hadir',
      tahun_ajaran: '2026/2027',
    },
  ];

  const subjectRecords: SubjectAttendanceRecord[] = [
    {
      id: 'srec_1',
      assignment_id: 'asg_1',
      tanggal: '2025-09-01',
      kelas: 'X-A',
      mata_pelajaran: 'Matematika',
      teacher_user_id: 'u1',
      teacher_name: 'Ibu Sari',
      nis: '1001',
      nama: 'Budi Santoso',
      jam_masuk: '08:00:00',
      status: 'Hadir',
      tahun_ajaran: '2025/2026',
    },
    {
      id: 'srec_2',
      assignment_id: 'asg_2',
      tanggal: '2026-08-10',
      kelas: 'XI-A',
      mata_pelajaran: 'Fisika',
      teacher_user_id: 'u2',
      teacher_name: 'Pak Andi',
      nis: '1001',
      nama: 'Budi Santoso',
      jam_masuk: '09:00:00',
      status: 'Hadir',
      tahun_ajaran: '2026/2027',
    },
  ];

  it('summarizes daily and subject attendance grouped by academic year newest first', () => {
    const stats = summarizeAttendanceByAcademicYear(
      dailyRecords,
      subjectRecords,
      '2026/2027'
    );
    assert.equal(stats.length, 2);
    assert.equal(stats[0].tahun_ajaran, '2026/2027');
    assert.equal(stats[0].dailyCount, 1);
    assert.equal(stats[0].subjectCount, 1);
    assert.equal(stats[0].totalCount, 2);
    assert.ok(stats[0].estimatedBytes > 0);

    assert.equal(stats[1].tahun_ajaran, '2025/2026');
    assert.equal(stats[1].dailyCount, 2);
    assert.equal(stats[1].subjectCount, 1);
    assert.equal(stats[1].totalCount, 3);
  });

  it('deletes attendance strictly for the targeted academic year while preserving others', () => {
    const res = deleteAttendanceByAcademicYear(
      dailyRecords,
      subjectRecords,
      '2025/2026',
      '2026/2027'
    );
    assert.equal(res.removedRecords.length, 2);
    assert.equal(res.removedSubjectRecords.length, 1);
    assert.equal(res.nextRecords.length, 1);
    assert.equal(res.nextSubjectRecords.length, 1);
    assert.equal(res.nextRecords[0].tahun_ajaran, '2026/2027');
    assert.equal(res.nextSubjectRecords[0].tahun_ajaran, '2026/2027');
    assert.ok(res.freedBytes > 0);
  });

  it('measures localStorage UTF-16 byte usage, remaining space, and alert levels accurately', () => {
    // 1000-char payload = 2000 bytes (+ key length * 2)
    const smallStore = createMemoryStorage({
      presensiqr_students_v2: 'a'.repeat(500),
      presensiqr_records_v2: 'b'.repeat(1000),
      presensiqr_settings_v2: 'c'.repeat(250),
    });
    const smallSnap = measureLocalStorageUsage(smallStore, 100_000);
    assert.equal(smallSnap.itemCount, 3);
    assert.equal(smallSnap.level, 'safe');
    assert.equal(smallSnap.usedBytes + smallSnap.remainingBytes, 100_000);
    assert.ok(smallSnap.breakdown.attendanceBytes > smallSnap.breakdown.studentsBytes);

    // 75% usage triggers warning
    const warnStore = createMemoryStorage({
      presensiqr_records_v2: 'x'.repeat(37_500), // 75,000 bytes
    });
    const warnSnap = measureLocalStorageUsage(warnStore, 100_000);
    assert.equal(warnSnap.level, 'warning');
    assert.ok(warnSnap.percent >= 75);

    // 95% usage triggers critical
    const critStore = createMemoryStorage({
      presensiqr_records_v2: 'y'.repeat(47_500), // 95,000 bytes
    });
    const critSnap = measureLocalStorageUsage(critStore, 100_000);
    assert.equal(critSnap.level, 'critical');
    assert.ok(critSnap.percent >= 95);
  });

  it('builds external storage snapshot with max-capacity IndexedDB limits (> 5 MB) and quickCache tracking', () => {
    const localUsage = measureLocalStorageUsage(
      createMemoryStorage({ presensiqr_records_v2: 'r'.repeat(5000) }),
      LOCAL_STORAGE_SOFT_LIMIT_BYTES
    );
    const quota = makeQuotaSnapshot();

    const apiSnap = buildExternalStorageSnapshot({
      deviceUsageBytes: 250 * 1024 * 1024,
      deviceQuotaBytes: 10 * 1024 * 1024 * 1024, // 10 GiB browser disk quota
      devicePersisted: true,
      indexedDbSupported: true,
      localUsage,
      cloudStorage: quota.storage,
      cloudConnected: true,
    });
    assert.equal(apiSnap.device.source, 'storage_api');
    assert.equal(apiSnap.device.persisted, true);
    assert.equal(apiSnap.device.usedBytes, 250 * 1024 * 1024);
    assert.equal(apiSnap.device.remainingBytes, 10 * 1024 * 1024 * 1024 - 250 * 1024 * 1024);
    assert.equal(apiSnap.appLocal.storageEngine, 'indexeddb_max');
    assert.equal(apiSnap.appLocal.limitBytes, 10 * 1024 * 1024 * 1024);
    assert.ok(apiSnap.appLocal.limitBytes > LOCAL_STORAGE_SOFT_LIMIT_BYTES);
    assert.equal(apiSnap.appLocal.quickCache.limitBytes, LOCAL_STORAGE_SOFT_LIMIT_BYTES);
    assert.equal(apiSnap.cloud.connected, true);

    const fallbackSnap = buildExternalStorageSnapshot({
      deviceUsageBytes: null,
      deviceQuotaBytes: null,
      indexedDbSupported: true,
      localUsage,
      cloudStorage: quota.storage,
      cloudConnected: false,
    });
    assert.equal(fallbackSnap.device.source, 'local_storage_fallback');
    assert.ok(fallbackSnap.appLocal.limitBytes > LOCAL_STORAGE_SOFT_LIMIT_BYTES);
    assert.equal(
      fallbackSnap.appLocal.usedBytes + fallbackSnap.appLocal.remainingBytes,
      fallbackSnap.appLocal.limitBytes
    );
  });

  it('evaluates Master Admin storage alerts for healthy, warning, critical, and write error states', () => {
    const healthyLocal = measureLocalStorageUsage(
      createMemoryStorage({ presensiqr_records_v2: 'ok' }),
      100_000
    );
    const healthyQuota = makeQuotaSnapshot();
    const healthyExt = buildExternalStorageSnapshot({
      deviceUsageBytes: 10_000,
      deviceQuotaBytes: 1_000_000,
      localUsage: healthyLocal,
      cloudStorage: healthyQuota.storage,
      cloudConnected: true,
    });

    const noAlerts = evaluateMasterAdminStorageAlerts({
      localUsage: healthyLocal,
      externalStorage: healthyExt,
      firestoreQuota: healthyQuota,
      cloudConnected: true,
      storageWriteError: null,
    });
    assert.equal(noAlerts.length, 0);

    // Warning when localStorage >= 70%
    const warnLocal = measureLocalStorageUsage(
      createMemoryStorage({ presensiqr_records_v2: 'z'.repeat(38_000) }),
      100_000
    );
    const warnAlerts = evaluateMasterAdminStorageAlerts({
      localUsage: warnLocal,
      externalStorage: healthyExt,
      firestoreQuota: healthyQuota,
      cloudConnected: false,
      storageWriteError: null,
    });
    assert.equal(warnAlerts.length, 1);
    assert.equal(warnAlerts[0].severity, 'warning');
    assert.equal(warnAlerts[0].source, 'local');

    // Critical when write error + cloud storage >= 90%
    const highCloudQuota = makeQuotaSnapshot({
      storageUsed: Math.round(FIRESTORE_FREE_LIMITS.STORAGE_BYTES * 0.92),
    });
    const critAlerts = evaluateMasterAdminStorageAlerts({
      localUsage: healthyLocal,
      externalStorage: healthyExt,
      firestoreQuota: highCloudQuota,
      cloudConnected: true,
      storageWriteError: 'QuotaExceededError: Penyimpanan penuh',
    });
    assert.equal(critAlerts.length, 2);
    assert.equal(critAlerts[0].severity, 'critical');
    assert.equal(critAlerts[0].source, 'write_error');
    assert.equal(critAlerts[1].severity, 'critical');
    assert.equal(critAlerts[1].source, 'cloud');
  });
});
