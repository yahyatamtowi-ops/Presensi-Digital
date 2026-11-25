import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  attendanceDocId,
  buildAttendancePayload,
  buildSchoolConfigCreatePayload,
  buildSchoolConfigUpdatePayload,
  buildStudentPayload,
  extractSchoolSettingsFromDoc,
  sanitizeOptionalHttpsUrl,
  studentDocId,
  toSafeFirestoreDocId,
} from './firestorePayloads';
import type { AttendanceRecord, SchoolSettings, Student } from '../types';

const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

describe('Firestore Payload Sanitization & Blueprint Compliance', () => {
  it('converts arbitrary strings with slashes or spaces into valid Firestore IDs', () => {
    const id1 = toSafeFirestoreDocId('2026/2027_2026001');
    const id2 = toSafeFirestoreDocId('2026-2027_2026001');
    assert.match(id1, SAFE_ID_PATTERN);
    assert.match(id2, SAFE_ID_PATTERN);
    assert.notEqual(id1, id2);
  });

  it('produces deterministic student and attendance doc IDs', () => {
    const s: Student = {
      nis: '2026/001',
      nama: 'Naufal',
      kelas: 'X IPA 1',
      gender: 'L',
      no_wa_ortu: '628123456789',
      tahun_ajaran: '2026/2027',
    };
    const a = studentDocId(s);
    const b = studentDocId({ ...s, nis: '2026/001' });
    assert.equal(a, b);
    assert.match(a, SAFE_ID_PATTERN);

    const recId = attendanceDocId({
      id: '2026-05-01_2026/001',
      tanggal: '2026-05-01',
      nis: '2026/001',
    });
    assert.match(recId, SAFE_ID_PATTERN);
  });

  it('builds SchoolConfig create and update payloads matching blueprint allowlists', () => {
    const settings: SchoolSettings = {
      nama_sekolah: 'SMA Negeri 1 Nusantara',
      nama_kepala_sekolah: 'Drs. Ahmad',
      nip_kepala_sekolah: '196804121995121001',
      ttd_kepala_sekolah: 'data:image/png;base64,abc',
      cap_sekolah: 'data:image/png;base64,def',
      logo_sekolah: 'data:image/png;base64,ghi',
      batas_jam_masuk: '7:15',
      mode_presensi: 'masuk_pulang',
      jam_pulang_standar: '15:00',
      tahun_ajaran: '2026/2027',
      semester: 'ganjil',
      tema: 'dark-indigo',
      script_url: 'javascript:alert(1)',
    };

    const created = buildSchoolConfigCreatePayload('uid_123', settings, 'TS');
    assert.equal(created.ownerId, 'uid_123');
    assert.equal(created.batas_jam_masuk, '07:15');
    assert.equal(created.script_url, ''); // Rejects non-https URL
    assert.equal(created.createdAt, 'TS');
    assert.equal(created.updatedAt, 'TS');

    const updated = buildSchoolConfigUpdatePayload(
      { ...settings, script_url: 'https://script.google.com/macros/s/abc/exec' },
      'TS2'
    );
    assert.equal('ownerId' in updated, false);
    assert.equal('createdAt' in updated, false);
    assert.equal(updated.script_url, 'https://script.google.com/macros/s/abc/exec');
  });

  it('clamps AttendanceRecord early-checkout reason and preserves valid fields', () => {
    const longReason = 'A'.repeat(450);
    const rec: AttendanceRecord = {
      id: '2026-05-01_2026001',
      tanggal: '2026-05-01',
      nis: '2026001',
      nama: 'Naufal',
      kelas: 'X IPA 1',
      jam_masuk: '07:05:00',
      jam_pulang: '11:30:00',
      alasan_pulang_cepat: longReason,
      status: 'Hadir',
      keterangan: 'Pulang cepat',
      tahun_ajaran: '2026/2027',
    };

    const payload = buildAttendancePayload('uid_123', rec, 'TS');
    assert.equal(payload.alasan_pulang_cepat.length, 300);
    assert.equal(payload.tanggal, '2026-05-01');
    assert.equal(payload.status, 'Hadir');
  });

  it('sanitizes student payload and extracts settings cleanly', () => {
    const payload = buildStudentPayload(
      'uid_123',
      {
        nis: '2026001',
        nama: 'Naufal',
        kelas: 'X IPA 1',
        gender: 'L',
        no_wa_ortu: '628123456789',
        tahun_ajaran: '2026/2027',
      },
      'TS'
    );
    assert.equal(payload.ownerId, 'uid_123');
    assert.equal(payload.gender, 'L');
    assert.equal(sanitizeOptionalHttpsUrl('http://insecure.example'), '');
    assert.equal(
      sanitizeOptionalHttpsUrl('https://script.google.com/exec'),
      'https://script.google.com/exec'
    );

    const extracted = extractSchoolSettingsFromDoc(
      {
        nama_sekolah: 'SMA Cloud Sync',
        mode_presensi: 'masuk_pulang',
        jam_pulang_standar: '14:30',
        semester: 'genap',
        script_url: '',
      },
      {
        nama_sekolah: 'Fallback',
        batas_jam_masuk: '07:15',
        mode_presensi: 'masuk_saja',
        jam_pulang_standar: '15:00',
        tahun_ajaran: '2026/2027',
        semester: 'ganjil',
        tema: 'indigo',
        script_url: 'https://script.google.com/macros/s/default/exec',
      }
    );
    assert.equal(extracted.nama_sekolah, 'SMA Cloud Sync');
    assert.equal(extracted.mode_presensi, 'masuk_pulang');
    assert.equal(extracted.jam_pulang_standar, '14:30');
    assert.equal(extracted.semester, 'genap');
    assert.equal(
      extracted.script_url,
      'https://script.google.com/macros/s/default/exec'
    );
  });
});
