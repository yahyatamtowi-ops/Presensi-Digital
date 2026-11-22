import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  coalesceOfflineQueue,
  isLikelyNetworkError,
  summarizeOfflineQueue,
} from './offlineStore';
import { GOOGLE_APPS_SCRIPT_TEMPLATE, type PendingSyncItem } from './gasApi';
import {
  sanitizeMasterSubjects,
  sanitizeSubjectAssignments,
  sanitizeSubjectRecords,
  sanitizeTeacherSchedules,
} from './subjectAttendance';

describe('Offline Attendance Queue & Cross-Device Sync', () => {
  it('coalesces offline check-in followed by offline checkout for the same student without losing jam_masuk or Terlambat status', () => {
    let queue: PendingSyncItem[] = [];

    queue = coalesceOfflineQueue(queue, {
      id: 'sync_1',
      action: 'recordPresensi',
      createdAt: '2026-08-01T07:35:00.000Z',
      payload: {
        id: '2026-08-01_2026001',
        tanggal: '2026-08-01',
        nis: '2026001',
        nama: 'Ahmad Fauzi',
        kelas: 'X IPA 1',
        jam_masuk: '07:35:00',
        jam_pulang: '-',
        status: 'Terlambat',
        keterangan: 'Melewati batas jam masuk 07:15',
      },
    });

    queue = coalesceOfflineQueue(queue, {
      id: 'sync_2',
      action: 'recordPresensi',
      createdAt: '2026-08-01T07:36:00.000Z',
      payload: {
        id: '2026-08-01_2026002',
        tanggal: '2026-08-01',
        nis: '2026002',
        nama: 'Siti Rahma',
        kelas: 'X IPA 1',
        jam_masuk: '07:10:00',
        jam_pulang: '-',
        status: 'Hadir',
      },
    });

    // Same student 2026001 checks out early while still offline
    queue = coalesceOfflineQueue(queue, {
      id: 'sync_3',
      action: 'recordPresensi',
      createdAt: '2026-08-01T11:30:00.000Z',
      payload: {
        id: '2026-08-01_2026001',
        tanggal: '2026-08-01',
        nis: '2026001',
        nama: 'Ahmad Fauzi',
        kelas: 'X IPA 1',
        jam_masuk: '-',
        jam_pulang: '11:30:00',
        alasan_pulang_cepat: 'Sakit demam dijemput orang tua',
        status: 'Terlambat',
        keterangan: 'Melewati batas jam masuk 07:15 · Pulang cepat 11:30:00 (Alasan: Sakit demam dijemput orang tua)',
      },
    });

    assert.equal(queue.length, 2);
    assert.equal(queue[0].id, 'sync_1');
    const mergedFirst = queue[0].payload.record as Record<string, unknown>;
    assert.equal(mergedFirst.nis, '2026001');
    assert.equal(mergedFirst.jam_masuk, '07:35:00');
    assert.equal(mergedFirst.jam_pulang, '11:30:00');
    assert.equal(mergedFirst.status, 'Terlambat');
    assert.equal(mergedFirst.alasan_pulang_cepat, 'Sakit demam dijemput orang tua');
    assert.equal(queue[1].payload.nis, '2026002');
  });

  it('coalesces duplicate savePengaturan and syncAkun queue entries while keeping attendance entries intact', () => {
    let queue: PendingSyncItem[] = [];
    queue = coalesceOfflineQueue(queue, {
      id: 'q1',
      action: 'recordPresensi',
      createdAt: '2026-08-01T07:00:00.000Z',
      payload: { tanggal: '2026-08-01', nis: '1001', status: 'Hadir' },
    });
    queue = coalesceOfflineQueue(queue, {
      id: 'q2',
      action: 'savePengaturan',
      createdAt: '2026-08-01T07:01:00.000Z',
      payload: { nama_sekolah: 'Versi Lama' },
    });
    queue = coalesceOfflineQueue(queue, {
      id: 'q3',
      action: 'savePengaturan',
      createdAt: '2026-08-01T07:02:00.000Z',
      payload: { nama_sekolah: 'SMA Negeri 1 Kabun' },
    });
    queue = coalesceOfflineQueue(queue, {
      id: 'q4',
      action: 'recordPresensiMapel',
      createdAt: '2026-08-01T08:00:00.000Z',
      payload: {
        tanggal: '2026-08-01',
        assignment_id: 'asg_mtk',
        nis: '1001',
        status: 'Hadir',
      },
    });
    queue = coalesceOfflineQueue(queue, {
      id: 'q5',
      action: 'recordPresensiMapel',
      createdAt: '2026-08-01T08:05:00.000Z',
      payload: {
        tanggal: '2026-08-01',
        assignment_id: 'asg_mtk',
        nis: '1001',
        status: 'Izin',
      },
    });

    assert.equal(queue.length, 3);
    const summary = summarizeOfflineQueue(queue);
    assert.equal(summary.total, 3);
    assert.equal(summary.attendanceCount, 1);
    assert.equal(summary.subjectAttendanceCount, 1);
    assert.equal(summary.otherCount, 1);
    assert.equal(summary.oldestCreatedAt, '2026-08-01T07:00:00.000Z');
    assert.equal(queue[1].payload.nama_sekolah, 'SMA Negeri 1 Kabun');
    assert.equal(queue[2].payload.status, 'Izin');
  });

  it('detects network errors accurately vs business validation errors', () => {
    assert.equal(isLikelyNetworkError(new TypeError('Failed to fetch')), true);
    assert.equal(
      isLikelyNetworkError(new Error('Koneksi ke Google Apps Script timeout (melebihi 15 detik).')),
      true
    );
    assert.equal(
      isLikelyNetworkError(new Error('NIS sudah terdaftar')),
      false
    );
  });

  it('parses MasterMapel, JadwalGuru, MapelKelas, and PresensiMapel with case-insensitive Sheet headers', () => {
    const subjects = sanitizeMasterSubjects([
      { ID: 'm1', Kode: 'bio', 'Nama Mapel': 'Biologi Lanjut', Deskripsi: 'IPA' },
    ]);
    assert.equal(subjects.length, 1);
    assert.equal(subjects[0].kode, 'BIO');
    assert.equal(subjects[0].nama, 'Biologi Lanjut');

    const schedules = sanitizeTeacherSchedules([
      {
        ID: 'sch1',
        Hari: 'Senin',
        'Teacher User ID': 'usr_guru',
        'Teacher Name': 'Ibu Siti',
        Kelas: 'X IPA 1',
        'Mata Pelajaran': 'Biologi Lanjut',
        'Jam Mulai': '07:30',
        'Jam Selesai': '09:00',
        'Tahun Ajaran': '2026/2027',
        Semester: 'genap',
      },
    ]);
    assert.equal(schedules.length, 1);
    assert.equal(schedules[0].mata_pelajaran, 'Biologi Lanjut');
    assert.equal(schedules[0].semester, 'genap');

    const assignments = sanitizeSubjectAssignments([
      {
        ID: 'asg1',
        'Teacher User ID': 'usr_guru',
        'Teacher Name': 'Ibu Siti',
        Kelas: 'X IPA 1',
        'Mata Pelajaran': 'Biologi Lanjut',
        Hari: 'Senin',
        'Jam Mulai': '07:30',
        'Tahun Ajaran': '2026/2027',
      },
    ]);
    assert.equal(assignments.length, 1);
    assert.equal(assignments[0].kelas, 'X IPA 1');

    const subjectRecords = sanitizeSubjectRecords([
      {
        ID: 'sr1',
        'Assignment ID': 'asg1',
        Tanggal: '2026-08-01',
        Kelas: 'X IPA 1',
        'Mata Pelajaran': 'Biologi Lanjut',
        'Teacher User ID': 'usr_guru',
        'Teacher Name': 'Ibu Siti',
        NIS: '2026001',
        Nama: 'Ahmad Fauzi',
        'Jam Masuk': '07:40:00',
        Status: 'Terlambat',
        Keterangan: 'Masuk mapel melewati jam 07:30',
        'Tahun Ajaran': '2026/2027',
      },
    ]);
    assert.equal(subjectRecords.length, 1);
    assert.equal(subjectRecords[0].status, 'Terlambat');
    assert.equal(subjectRecords[0].nis, '2026001');
  });

  it('Code.gs template guards 50,000-char cell limits and normalizes Pengaturan keys case-insensitively', () => {
    assert.ok(GOOGLE_APPS_SCRIPT_TEMPLATE.includes('function safeCellText('));
    assert.ok(GOOGLE_APPS_SCRIPT_TEMPLATE.includes('49000'));
    assert.ok(GOOGLE_APPS_SCRIPT_TEMPLATE.includes("replace(/[\\s-]+/g, '_')"));
  });
});
