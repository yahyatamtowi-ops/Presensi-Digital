import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFirestoreQuotaSnapshot,
  buildQuotaMetric,
  estimateFirestoreStorageUsage,
  FIRESTORE_FREE_LIMITS,
  formatBytesReadable,
  getFirestoreQuotaDate,
} from './firestoreUsage';
import type { SchoolSettings } from '../types';

const SAMPLE_SETTINGS: SchoolSettings = {
  nama_sekolah: 'SMA Negeri 1 Nusantara',
  batas_jam_masuk: '07:15',
  mode_presensi: 'masuk_pulang',
  jam_pulang_standar: '15:00',
  tahun_ajaran: '2026/2027',
  semester: 'ganjil',
  tema: 'indigo',
  script_url: '',
};

describe('Firestore Free-Tier Quota Tracking & Estimation', () => {
  it('computes quota metric levels accurately (safe, warning, critical)', () => {
    const safe = buildQuotaMetric(500, FIRESTORE_FREE_LIMITS.DAILY_READS);
    assert.equal(safe.level, 'safe');
    assert.equal(safe.percent, 1);
    assert.equal(safe.remaining, 49_500);

    const warn = buildQuotaMetric(15_000, FIRESTORE_FREE_LIMITS.DAILY_WRITES);
    assert.equal(warn.level, 'warning');
    assert.equal(warn.percent, 75);

    const crit = buildQuotaMetric(19_000, FIRESTORE_FREE_LIMITS.DAILY_DELETES);
    assert.equal(crit.level, 'critical');
    assert.equal(crit.percent, 95);

    const over = buildQuotaMetric(60_000, FIRESTORE_FREE_LIMITS.DAILY_READS);
    assert.equal(over.percent, 100);
    assert.equal(over.remaining, 0);
    assert.equal(over.level, 'critical');
  });

  it('formats Pacific-time quota date as YYYY-MM-DD', () => {
    const dateStr = getFirestoreQuotaDate(new Date('2026-05-15T12:00:00Z'));
    assert.match(dateStr, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(dateStr, '2026-05-15');
  });

  it('estimates document counts and byte storage accurately', () => {
    const storage = estimateFirestoreStorageUsage({
      settings: SAMPLE_SETTINGS,
      students: [
        {
          nis: '2026001',
          nama: 'Naufal',
          kelas: 'X IPA 1',
          gender: 'L',
          no_wa_ortu: '628123456789',
          tahun_ajaran: '2026/2027',
        },
      ],
      records: [],
      masterSubjects: [],
      teacherSchedules: [],
      subjectAssignments: [],
      subjectRecords: [],
      accounts: [],
    });

    assert.equal(storage.totalDocuments, 2); // 1 settings + 1 student
    assert.equal(storage.breakdown.students, 1);
    assert.ok(storage.used > 200);
    assert.equal(storage.limit, FIRESTORE_FREE_LIMITS.STORAGE_BYTES);
    assert.equal(storage.level, 'safe');
  });

  it('builds complete snapshot and human-readable byte sizes', () => {
    const snap = buildFirestoreQuotaSnapshot(
      {
        quotaDate: '2026-05-15',
        reads: 250,
        writes: 40,
        deletes: 2,
        lastUpdatedAt: '2026-05-15T12:00:00.000Z',
      },
      {
        settings: SAMPLE_SETTINGS,
        students: [],
        records: [],
        masterSubjects: [],
        teacherSchedules: [],
        subjectAssignments: [],
        subjectRecords: [],
        accounts: [],
      }
    );
    assert.equal(snap.reads.used, 250);
    assert.equal(snap.writes.used, 40);
    assert.equal(snap.deletes.used, 2);
    assert.equal(formatBytesReadable(512), '512 B');
    assert.equal(formatBytesReadable(2048), '2.0 KB');
    assert.equal(formatBytesReadable(2 * 1024 * 1024), '2.00 MB');
  });
});
