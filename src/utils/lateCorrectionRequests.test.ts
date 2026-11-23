import test from 'node:test';
import assert from 'node:assert/strict';
import type { AttendanceRecord } from '../types';
import {
  approveLateCorrectionRequest,
  createLateCorrectionRequest,
  getPendingLateCorrectionRequests,
  rejectLateCorrectionRequest,
} from './lateCorrectionRequests';
import { buildLateCorrectionWhatsAppMessage, buildWhatsAppUrl } from './whatsapp';

test('createLateCorrectionRequest validates input, prevents duplicate pending requests, and creates a pending item', () => {
  const invalid = createLateCorrectionRequest([], {
    tanggal: '2026-11-23',
    nis: '2026001',
    nama: 'Ahmad Fauzi',
    kelas: 'X IPA 1',
    jam_masuk_asal: '07:32:00',
    alasan: 'abc',
    requested_by_user_id: 'usr_walikelas',
    requested_by_name: 'Ibu Siti Aminah',
    tahun_ajaran: '2026/2027',
  });
  assert.equal(invalid.ok, false);

  const created = createLateCorrectionRequest([], {
    tanggal: '2026-11-23',
    nis: '2026001',
    nama: 'Ahmad Fauzi',
    kelas: 'X IPA 1',
    jam_masuk_asal: '07:32:00',
    alasan: 'Ban motor bocor di perjalanan, sudah izin ke Wali Kelas',
    requested_by_user_id: 'usr_walikelas',
    requested_by_name: 'Ibu Siti Aminah',
    tahun_ajaran: '2026/2027',
  });
  assert.equal(created.ok, true);
  assert.equal(created.nextRequests.length, 1);
  assert.equal(created.request?.status, 'pending');
  assert.equal(getPendingLateCorrectionRequests(created.nextRequests).length, 1);

  const duplicate = createLateCorrectionRequest(created.nextRequests, {
    tanggal: '2026-11-23',
    nis: '2026001',
    nama: 'Ahmad Fauzi',
    kelas: 'X IPA 1',
    jam_masuk_asal: '07:32:00',
    alasan: 'Pengajuan ulang di tanggal yang sama',
    requested_by_user_id: 'usr_walikelas',
    requested_by_name: 'Ibu Siti Aminah',
    tahun_ajaran: '2026/2027',
  });
  assert.equal(duplicate.ok, false);
});

test('approveLateCorrectionRequest marks request approved and converts Terlambat record to Hadir tepat waktu', () => {
  const initialRecords: AttendanceRecord[] = [
    {
      id: '2026-11-23_2026001',
      tanggal: '2026-11-23',
      nis: '2026001',
      nama: 'Ahmad Fauzi',
      kelas: 'X IPA 1',
      jam_masuk: '07:34:10',
      jam_pulang: '-',
      status: 'Terlambat',
      keterangan: 'Scan QR (Terlambat)',
      tahun_ajaran: '2026/2027',
    },
  ];

  const created = createLateCorrectionRequest([], {
    tanggal: '2026-11-23',
    nis: '2026001',
    nama: 'Ahmad Fauzi',
    kelas: 'X IPA 1',
    jam_masuk_asal: '07:34:10',
    alasan: 'Hujan deras dan banjir di jalan menuju sekolah',
    requested_by_user_id: 'usr_walikelas',
    requested_by_name: 'Ibu Siti Aminah',
    tahun_ajaran: '2026/2027',
  });
  assert.equal(created.ok, true);
  assert.ok(created.request);

  const approved = approveLateCorrectionRequest({
    requests: created.nextRequests,
    records: initialRecords,
    requestId: created.request.id,
    adminName: 'Administrator Sekolah',
    batasJamMasuk: '07:15',
  });

  assert.equal(approved.ok, true);
  assert.equal(approved.updatedRequest?.status, 'approved');
  assert.equal(approved.updatedRecord?.status, 'Hadir');
  assert.equal(approved.updatedRecord?.jam_masuk, '07:15:00');
  assert.ok(approved.updatedRecord?.keterangan?.includes('Disetujui tepat waktu'));
  assert.equal(getPendingLateCorrectionRequests(approved.nextRequests).length, 0);
});

test('rejectLateCorrectionRequest marks request rejected without altering attendance record', () => {
  const created = createLateCorrectionRequest([], {
    tanggal: '2026-11-23',
    nis: '2026002',
    nama: 'Siti Rahma',
    kelas: 'X IPA 1',
    jam_masuk_asal: '07:45:00',
    alasan: 'Terjebak kemacetan di persimpangan utama',
    requested_by_user_id: 'usr_walikelas',
    requested_by_name: 'Ibu Siti Aminah',
    tahun_ajaran: '2026/2027',
  });
  assert.equal(created.ok, true);
  assert.ok(created.request);

  const rejected = rejectLateCorrectionRequest({
    requests: created.nextRequests,
    requestId: created.request.id,
    adminName: 'Administrator Sekolah',
    catatanAdmin: 'Tidak memenuhi syarat dispensasi',
  });
  assert.equal(rejected.ok, true);
  assert.equal(rejected.updatedRequest?.status, 'rejected');
  assert.equal(getPendingLateCorrectionRequests(rejected.nextRequests).length, 0);
});

test('buildLateCorrectionWhatsAppMessage formats complete request details and generates valid wa.me URL', () => {
  const msg = buildLateCorrectionWhatsAppMessage({
    namaSekolah: 'SMA Negeri 1 Kabun',
    tanggal: '2026-11-23',
    namaSiswa: 'Ahmad Fauzi',
    nis: '2026001',
    kelas: 'X IPA 1',
    jamMasukAsal: '07:34:10',
    alasan: 'Ban bocor di jalan dan sudah izin ke Wali Kelas',
    namaWaliKelas: 'Ibu Siti Aminah',
  });

  assert.ok(msg.includes('SMA Negeri 1 Kabun'));
  assert.ok(msg.includes('Ahmad Fauzi'));
  assert.ok(msg.includes('2026001'));
  assert.ok(msg.includes('X IPA 1'));
  assert.ok(msg.includes('07:34:10'));
  assert.ok(msg.includes('Ban bocor di jalan'));
  assert.ok(msg.includes('Ibu Siti Aminah'));
  assert.ok(!msg.toLowerCase().includes('absen'));

  const url = buildWhatsAppUrl('081234567890', msg);
  assert.ok(url);
  assert.ok(url.startsWith('https://wa.me/6281234567890?text='));
});
