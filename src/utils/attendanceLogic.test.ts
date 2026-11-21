import test from 'node:test';
import assert from 'node:assert/strict';
import {
  determineAttendanceStatus,
  extractNisFromQrPayload,
  hasScannedOnDate,
  processQrScan,
  computeDashboardMetrics,
  buildDailyRecapRows,
  filterByAcademicYear,
  getPeriodDateRange,
  buildPeriodSummaryRows,
  evaluateWaliKelasLoginReminder,
  normalizeTimeHHMM,
  normalizeScheduleMode,
  getAcademicYearDateRange,
  computeAttendanceAnalytics,
  isBeforeCheckoutTime,
} from './attendanceLogic';
import type { AttendanceRecord, Student } from '../types';

const sampleStudents: Student[] = [
  {
    nis: '2026001',
    nama: 'Ahmad Fauzi',
    kelas: 'X IPA 1',
    gender: 'L',
    no_wa_ortu: '081234567890',
  },
  {
    nis: '2026002',
    nama: 'Siti Rahma',
    kelas: 'X IPA 1',
    gender: 'P',
    no_wa_ortu: '081298765432',
  },
  {
    nis: '2026003',
    nama: 'Budi Santoso',
    kelas: 'XI IPS 2',
    gender: 'L',
    no_wa_ortu: '081355566677',
  },
];

test('determineAttendanceStatus classifies on-time vs late accurately', () => {
  assert.equal(determineAttendanceStatus('06:55:00', '07:15'), 'Hadir');
  assert.equal(determineAttendanceStatus('07:15:59', '07:15'), 'Hadir');
  assert.equal(determineAttendanceStatus('07:16:00', '07:15'), 'Terlambat');
  assert.equal(determineAttendanceStatus('08:05:10', '07:15'), 'Terlambat');
});

test('extractNisFromQrPayload supports plain NIS, prefixed NIS, and JSON payloads', () => {
  assert.equal(extractNisFromQrPayload('  2026001  '), '2026001');
  assert.equal(extractNisFromQrPayload('NIS:2026002'), '2026002');
  assert.equal(extractNisFromQrPayload('{"nis":"2026003"}'), '2026003');
  assert.equal(extractNisFromQrPayload('   '), '');
});

test('processQrScan records Hadir before cutoff, Terlambat after cutoff, and blocks duplicate scans same day', () => {
  const onTimeDate = new Date(2026, 10, 20, 7, 10, 0);
  const firstScan = processQrScan({
    qrRaw: '2026001',
    students: sampleStudents,
    records: [],
    batasJamMasuk: '07:15',
    now: onTimeDate,
  });

  assert.equal(firstScan.ok, true);
  if (firstScan.ok) {
    assert.equal(firstScan.record.status, 'Hadir');
    assert.equal(firstScan.record.tanggal, '2026-11-20');
    assert.equal(firstScan.record.jam_masuk, '07:10:00');
  }

  const existingRecords: AttendanceRecord[] = firstScan.ok ? [firstScan.record] : [];
  assert.ok(hasScannedOnDate(existingRecords, '2026001', '2026-11-20'));

  const duplicateScan = processQrScan({
    qrRaw: '2026001',
    students: sampleStudents,
    records: existingRecords,
    batasJamMasuk: '07:15',
    now: new Date(2026, 10, 20, 7, 12, 0),
  });

  assert.equal(duplicateScan.ok, false);
  if (!duplicateScan.ok) {
    assert.equal(duplicateScan.reason, 'duplicate');
  }

  const lateScan = processQrScan({
    qrRaw: '2026002',
    students: sampleStudents,
    records: existingRecords,
    batasJamMasuk: '07:15',
    now: new Date(2026, 10, 20, 7, 30, 0),
  });

  assert.equal(lateScan.ok, true);
  if (lateScan.ok) {
    assert.equal(lateScan.record.status, 'Terlambat');
  }

  const unknownScan = processQrScan({
    qrRaw: '9999999',
    students: sampleStudents,
    records: existingRecords,
    batasJamMasuk: '07:15',
    now: onTimeDate,
  });

  assert.equal(unknownScan.ok, false);
  if (!unknownScan.ok) {
    assert.equal(unknownScan.reason, 'not_found');
  }
});

test('computeDashboardMetrics calculates counts, attendance percentage, and class breakdown', () => {
  const records: AttendanceRecord[] = [
    {
      id: '2026-11-20_2026001',
      tanggal: '2026-11-20',
      nis: '2026001',
      nama: 'Ahmad Fauzi',
      kelas: 'X IPA 1',
      jam_masuk: '07:02:00',
      status: 'Hadir',
    },
    {
      id: '2026-11-20_2026002',
      tanggal: '2026-11-20',
      nis: '2026002',
      nama: 'Siti Rahma',
      kelas: 'X IPA 1',
      jam_masuk: '07:25:00',
      status: 'Terlambat',
    },
    {
      id: '2026-11-20_2026003',
      tanggal: '2026-11-20',
      nis: '2026003',
      nama: 'Budi Santoso',
      kelas: 'XI IPS 2',
      jam_masuk: '-',
      status: 'Sakit',
    },
  ];

  const metrics = computeDashboardMetrics(sampleStudents, records, '2026-11-20');
  assert.equal(metrics.totalSiswa, 3);
  assert.equal(metrics.hadir, 1);
  assert.equal(metrics.terlambat, 1);
  assert.equal(metrics.tidakHadir, 1);
  assert.equal(metrics.sakit, 1);
  assert.equal(metrics.belumScan, 0);
  assert.equal(metrics.kehadiranPct, 67);
  assert.equal(metrics.classBreakdown.length, 2);
});

test('buildDailyRecapRows merges recorded and unrecorded students cleanly', () => {
  const records: AttendanceRecord[] = [
    {
      id: '2026-11-20_2026001',
      tanggal: '2026-11-20',
      nis: '2026001',
      nama: 'Ahmad Fauzi',
      kelas: 'X IPA 1',
      jam_masuk: '07:02:00',
      status: 'Hadir',
    },
  ];

  const rows = buildDailyRecapRows(sampleStudents, records, '2026-11-20');
  assert.equal(rows.length, 3);
  const ahmad = rows.find((r) => r.nis === '2026001');
  const siti = rows.find((r) => r.nis === '2026002');
  assert.equal(ahmad?.status, 'Hadir');
  assert.equal(ahmad?.isRecorded, true);
  assert.equal(siti?.status, 'Belum Absen');
  assert.equal(siti?.isRecorded, false);
});

test('processQrScan supports masuk_pulang schedule mode with early-scan guard and explicit checkout', () => {
  const checkIn = processQrScan({
    qrRaw: '2026001',
    students: sampleStudents,
    records: [],
    batasJamMasuk: '07:15',
    modePresensi: 'masuk_pulang',
    jamPulangStandar: '15:00',
    scanAction: 'auto',
    now: new Date(2026, 10, 20, 7, 5, 0),
  });
  assert.equal(checkIn.ok, true);
  if (!checkIn.ok) return;
  assert.equal(checkIn.scanType, 'masuk');

  const recordsAfterIn: AttendanceRecord[] = [checkIn.record];

  const tooEarlyAuto = processQrScan({
    qrRaw: '2026001',
    students: sampleStudents,
    records: recordsAfterIn,
    batasJamMasuk: '07:15',
    modePresensi: 'masuk_pulang',
    jamPulangStandar: '15:00',
    scanAction: 'auto',
    now: new Date(2026, 10, 20, 12, 30, 0),
  });
  assert.equal(tooEarlyAuto.ok, false);
  if (!tooEarlyAuto.ok) {
    assert.equal(tooEarlyAuto.reason, 'before_checkout_time');
  }

  // Even explicit 'pulang' mode before jam pulang requires early-checkout reason confirmation
  const tooEarlyExplicitNoReason = processQrScan({
    qrRaw: '2026001',
    students: sampleStudents,
    records: recordsAfterIn,
    batasJamMasuk: '07:15',
    modePresensi: 'masuk_pulang',
    jamPulangStandar: '15:00',
    scanAction: 'pulang',
    now: new Date(2026, 10, 20, 12, 30, 0),
  });
  assert.equal(tooEarlyExplicitNoReason.ok, false);
  if (!tooEarlyExplicitNoReason.ok) {
    assert.equal(tooEarlyExplicitNoReason.reason, 'before_checkout_time');
  }

  // Confirmed early checkout with reason succeeds and records alasan_pulang_cepat
  assert.equal(isBeforeCheckoutTime('12:30:00', '15:00'), true);
  assert.equal(isBeforeCheckoutTime('15:00:00', '15:00'), false);
  const earlyWithReason = processQrScan({
    qrRaw: '2026001',
    students: sampleStudents,
    records: recordsAfterIn,
    batasJamMasuk: '07:15',
    modePresensi: 'masuk_pulang',
    jamPulangStandar: '15:00',
    scanAction: 'pulang',
    alasanPulangCepat: 'Sakit / Kurang sehat',
    now: new Date(2026, 10, 20, 12, 30, 0),
  });
  assert.equal(earlyWithReason.ok, true);
  if (earlyWithReason.ok) {
    assert.equal(earlyWithReason.scanType, 'pulang');
    assert.equal(earlyWithReason.record.jam_pulang, '12:30:00');
    assert.equal(earlyWithReason.record.alasan_pulang_cepat, 'Sakit / Kurang sehat');
    assert.ok(earlyWithReason.record.keterangan?.includes('Pulang cepat 12:30:00'));
    assert.ok(earlyWithReason.record.keterangan?.includes('Sakit / Kurang sehat'));
    const recapRows = buildDailyRecapRows(sampleStudents, [earlyWithReason.record], '2026-11-20');
    const ahmadRow = recapRows.find((r) => r.nis === '2026001');
    assert.equal(ahmadRow?.alasan_pulang_cepat, 'Sakit / Kurang sehat');
  }

  const checkOut = processQrScan({
    qrRaw: '2026001',
    students: sampleStudents,
    records: recordsAfterIn,
    batasJamMasuk: '07:15',
    modePresensi: 'masuk_pulang',
    jamPulangStandar: '15:00',
    scanAction: 'auto',
    now: new Date(2026, 10, 20, 15, 10, 0),
  });
  assert.equal(checkOut.ok, true);
  if (!checkOut.ok) return;
  assert.equal(checkOut.scanType, 'pulang');
  assert.equal(checkOut.record.jam_pulang, '15:10:00');
  assert.equal(checkOut.record.alasan_pulang_cepat, undefined);

  const thirdScan = processQrScan({
    qrRaw: '2026001',
    students: sampleStudents,
    records: [checkOut.record],
    batasJamMasuk: '07:15',
    modePresensi: 'masuk_pulang',
    jamPulangStandar: '15:00',
    scanAction: 'auto',
    now: new Date(2026, 10, 20, 15, 15, 0),
  });
  assert.equal(thirdScan.ok, false);
  if (!thirdScan.ok) {
    assert.equal(thirdScan.reason, 'duplicate_checkout');
  }

  const unCheckedInOut = processQrScan({
    qrRaw: '2026002',
    students: sampleStudents,
    records: [checkOut.record],
    batasJamMasuk: '07:15',
    modePresensi: 'masuk_pulang',
    jamPulangStandar: '15:00',
    scanAction: 'pulang',
    now: new Date(2026, 10, 20, 15, 15, 0),
  });
  assert.equal(unCheckedInOut.ok, false);
  if (!unCheckedInOut.ok) {
    assert.equal(unCheckedInOut.reason, 'not_checked_in');
  }
});

test('filterByAcademicYear hides previous academic year data except when accessed by Master Admin', () => {
  const multiYearStudents: Student[] = [
    { ...sampleStudents[0], tahun_ajaran: '2026/2027' },
    { ...sampleStudents[1], tahun_ajaran: '2027/2028' },
  ];

  // Non-master admin when active year is 2027/2028 only sees 2027/2028
  const nonMasterVisible = filterByAcademicYear(multiYearStudents, {
    activeAcademicYear: '2027/2028',
    isMasterAdmin: false,
  });
  assert.equal(nonMasterVisible.length, 1);
  assert.equal(nonMasterVisible[0].nis, '2026002');

  // Master admin can still inspect 2026/2027 or ALL years
  const masterArchive = filterByAcademicYear(multiYearStudents, {
    activeAcademicYear: '2027/2028',
    isMasterAdmin: true,
    masterYearFilter: '2026/2027',
  });
  assert.equal(masterArchive.length, 1);
  assert.equal(masterArchive[0].nis, '2026001');

  const masterAll = filterByAcademicYear(multiYearStudents, {
    activeAcademicYear: '2027/2028',
    isMasterAdmin: true,
    masterYearFilter: 'ALL',
  });
  assert.equal(masterAll.length, 2);
});

test('getPeriodDateRange and buildPeriodSummaryRows compute Harian, Mingguan, Bulanan, and Semester accurately', () => {
  const weekly = getPeriodDateRange({ period: 'mingguan', date: '2026-11-20' });
  assert.equal(weekly.startDate, '2026-11-16');
  assert.equal(weekly.endDate, '2026-11-22');

  const monthly = getPeriodDateRange({ period: 'bulanan', date: '2026-11-20', month: '2026-02' });
  assert.equal(monthly.startDate, '2026-02-01');
  assert.equal(monthly.endDate, '2026-02-28');

  const semGanjil = getPeriodDateRange({ period: 'semester', date: '2026-11-20', semester: 'ganjil', semesterYear: 2026 });
  assert.equal(semGanjil.startDate, '2026-07-01');
  assert.equal(semGanjil.endDate, '2026-12-31');

  const semGenap = getPeriodDateRange({ period: 'semester', date: '2026-03-10', semester: 'genap', semesterYear: 2026 });
  assert.equal(semGenap.startDate, '2026-01-01');
  assert.equal(semGenap.endDate, '2026-06-30');

  const periodRecords: AttendanceRecord[] = [
    { id: '1', tanggal: '2026-11-16', nis: '2026001', nama: 'Ahmad Fauzi', kelas: 'X IPA 1', jam_masuk: '07:00:00', status: 'Hadir' },
    { id: '2', tanggal: '2026-11-17', nis: '2026001', nama: 'Ahmad Fauzi', kelas: 'X IPA 1', jam_masuk: '07:20:00', status: 'Terlambat' },
    { id: '3', tanggal: '2026-11-18', nis: '2026001', nama: 'Ahmad Fauzi', kelas: 'X IPA 1', jam_masuk: '-', status: 'Sakit' },
    { id: '4', tanggal: '2026-10-10', nis: '2026001', nama: 'Ahmad Fauzi', kelas: 'X IPA 1', jam_masuk: '07:00:00', status: 'Hadir' },
  ];

  const summary = buildPeriodSummaryRows(sampleStudents, periodRecords, weekly.startDate, weekly.endDate);
  const ahmad = summary.find((r) => r.nis === '2026001');
  assert.equal(ahmad?.hadir, 1);
  assert.equal(ahmad?.terlambat, 1);
  assert.equal(ahmad?.sakit, 1);
  assert.equal(ahmad?.totalTercatat, 3);
  assert.equal(ahmad?.kehadiranPct, 67);
});

test('evaluateWaliKelasLoginReminder generates attendance and checkout voice reminders accurately', () => {
  const targetDate = '2026-11-20';

  // Case 1: masuk_saja with 1 checked-in and 1 not yet checked-in in X IPA 1
  const resMasukSaja = evaluateWaliKelasLoginReminder({
    students: sampleStudents,
    records: [
      {
        id: '2026-11-20_2026001',
        tanggal: targetDate,
        nis: '2026001',
        nama: 'Ahmad Fauzi',
        kelas: 'X IPA 1',
        jam_masuk: '07:05:00',
        status: 'Hadir',
      },
    ],
    kelasBinaan: 'X IPA 1',
    targetDate,
    modePresensi: 'masuk_saja',
  });
  assert.equal(resMasukSaja.totalSiswaKelas, 2);
  assert.equal(resMasukSaja.belumHadirCount, 1);
  assert.equal(resMasukSaja.belumPulangCount, 0);
  assert.deepEqual(resMasukSaja.messages, [
    'Bapak/Ibu Wali Kelas, Mohon cek siswa kelas bapak/ibu yang masih belum melakukan presensi kehadiran',
  ]);

  // Case 2: masuk_pulang where both checked in, neither checked out
  const resBelumPulangOnly = evaluateWaliKelasLoginReminder({
    students: sampleStudents,
    records: [
      {
        id: '2026-11-20_2026001',
        tanggal: targetDate,
        nis: '2026001',
        nama: 'Ahmad Fauzi',
        kelas: 'X IPA 1',
        jam_masuk: '07:05:00',
        status: 'Hadir',
      },
      {
        id: '2026-11-20_2026002',
        tanggal: targetDate,
        nis: '2026002',
        nama: 'Siti Rahma',
        kelas: 'X IPA 1',
        jam_masuk: '07:20:00',
        status: 'Terlambat',
      },
    ],
    kelasBinaan: 'X IPA 1',
    targetDate,
    modePresensi: 'masuk_pulang',
  });
  assert.equal(resBelumPulangOnly.belumHadirCount, 0);
  assert.equal(resBelumPulangOnly.belumPulangCount, 2);
  assert.deepEqual(resBelumPulangOnly.messages, [
    'Bapak/Ibu Wali Kelas, ada 2 siswa yang belum melakukan presensi pulang. Silakan konfirmasi presensi pulang siswa',
  ]);

  // Case 3: masuk_pulang with 1 missing check-in AND 1 missing check-out
  const resBoth = evaluateWaliKelasLoginReminder({
    students: sampleStudents,
    records: [
      {
        id: '2026-11-20_2026001',
        tanggal: targetDate,
        nis: '2026001',
        nama: 'Ahmad Fauzi',
        kelas: 'X IPA 1',
        jam_masuk: '07:05:00',
        status: 'Hadir',
      },
    ],
    kelasBinaan: 'X IPA 1',
    targetDate,
    modePresensi: 'masuk_pulang',
  });
  assert.equal(resBoth.belumHadirCount, 1);
  assert.equal(resBoth.belumPulangCount, 1);
  assert.deepEqual(resBoth.messages, [
    'Bapak/Ibu Wali Kelas, Mohon cek siswa kelas bapak/ibu yang masih belum melakukan presensi kehadiran',
    'Bapak/Ibu Wali Kelas, ada 1 siswa yang belum melakukan presensi pulang. Silakan konfirmasi presensi pulang siswa',
  ]);

  // Case 4: All students in class checked in and checked out (or Sakit) -> no messages
  const resComplete = evaluateWaliKelasLoginReminder({
    students: sampleStudents,
    records: [
      {
        id: '2026-11-20_2026001',
        tanggal: targetDate,
        nis: '2026001',
        nama: 'Ahmad Fauzi',
        kelas: 'X IPA 1',
        jam_masuk: '07:05:00',
        jam_pulang: '15:05:00',
        status: 'Hadir',
      },
      {
        id: '2026-11-20_2026002',
        tanggal: targetDate,
        nis: '2026002',
        nama: 'Siti Rahma',
        kelas: 'X IPA 1',
        jam_masuk: '-',
        status: 'Sakit',
      },
    ],
    kelasBinaan: 'X IPA 1',
    targetDate,
    modePresensi: 'masuk_pulang',
  });
  assert.equal(resComplete.belumHadirCount, 0);
  assert.equal(resComplete.belumPulangCount, 0);
  assert.deepEqual(resComplete.messages, []);
});

test('normalizeTimeHHMM and normalizeScheduleMode sanitize spreadsheet time formats and schedule modes', () => {
  assert.equal(normalizeTimeHHMM('7:15', '07:15'), '07:15');
  assert.equal(normalizeTimeHHMM('15:00:00', '15:00'), '15:00');
  assert.equal(normalizeTimeHHMM('3:05 PM', '15:00'), '15:05');
  assert.equal(normalizeTimeHHMM('12:00 AM', '07:15'), '00:00');
  assert.equal(normalizeTimeHHMM('12:30 PM', '15:00'), '12:30');
  assert.equal(normalizeTimeHHMM('07.30', '07:15'), '07:30');
  assert.equal(normalizeTimeHHMM('invalid', '14:45'), '14:45');

  assert.equal(normalizeScheduleMode('masuk_pulang'), 'masuk_pulang');
  assert.equal(normalizeScheduleMode('Masuk dan Pulang'), 'masuk_pulang');
  assert.equal(normalizeScheduleMode('masuk-pulang'), 'masuk_pulang');
  assert.equal(normalizeScheduleMode('masuk_saja'), 'masuk_saja');
  assert.equal(normalizeScheduleMode('Masuk Saja'), 'masuk_saja');
  assert.equal(normalizeScheduleMode('', 'masuk_pulang'), 'masuk_pulang');
});

test('getAcademicYearDateRange and computeAttendanceAnalytics calculate Harian, Mingguan, Bulanan, Semester, and Tahunan accurately', () => {
  const yrRange = getAcademicYearDateRange('2026/2027', '2026-11-20');
  assert.equal(yrRange.startDate, '2026-07-01');
  assert.equal(yrRange.endDate, '2027-06-30');

  const singleRange = getAcademicYearDateRange('2026', '2026-11-20');
  assert.equal(singleRange.startDate, '2026-01-01');
  assert.equal(singleRange.endDate, '2026-12-31');

  const records: AttendanceRecord[] = [
    // Today (2026-11-20): 2 of 3 attended (67%)
    { id: 'r1', tanggal: '2026-11-20', nis: '2026001', nama: 'Ahmad Fauzi', kelas: 'X IPA 1', jam_masuk: '07:01:00', status: 'Hadir' },
    { id: 'r2', tanggal: '2026-11-20', nis: '2026002', nama: 'Siti Rahma', kelas: 'X IPA 1', jam_masuk: '07:20:00', status: 'Terlambat' },
    { id: 'r3', tanggal: '2026-11-20', nis: '2026003', nama: 'Budi Santoso', kelas: 'XI IPS 2', jam_masuk: '-', status: 'Alpa' },
    // Same week (2026-11-18): 1 Hadir
    { id: 'r4', tanggal: '2026-11-18', nis: '2026001', nama: 'Ahmad Fauzi', kelas: 'X IPA 1', jam_masuk: '07:00:00', status: 'Hadir' },
    // Earlier in November (2026-11-05): 1 Sakit
    { id: 'r5', tanggal: '2026-11-05', nis: '2026002', nama: 'Siti Rahma', kelas: 'X IPA 1', jam_masuk: '-', status: 'Sakit' },
    // Earlier in Semester Ganjil (2026-08-10): 1 Hadir
    { id: 'r6', tanggal: '2026-08-10', nis: '2026001', nama: 'Ahmad Fauzi', kelas: 'X IPA 1', jam_masuk: '06:58:00', status: 'Hadir' },
    // Second semester within same academic year 2026/2027 (2027-02-10): 1 Izin
    { id: 'r7', tanggal: '2027-02-10', nis: '2026003', nama: 'Budi Santoso', kelas: 'XI IPS 2', jam_masuk: '-', status: 'Izin' },
  ];

  const result = computeAttendanceAnalytics({
    students: sampleStudents,
    records,
    selectedPeriod: 'tahunan',
    date: '2026-11-20',
    month: '2026-11',
    semester: 'ganjil',
    semesterYear: 2026,
    academicYear: '2026/2027',
  });

  // Harian: 2 attended / 3 students = 67%
  assert.equal(result.overviews.harian.kehadiranPct, 67);
  // Mingguan (16..22 Nov): r1(H), r2(T), r3(A), r4(H) -> 3/4 = 75%
  assert.equal(result.overviews.mingguan.totalTercatat, 4);
  assert.equal(result.overviews.mingguan.kehadiranPct, 75);
  // Bulanan (Nov): r1..r5 -> 3/5 = 60%
  assert.equal(result.overviews.bulanan.totalTercatat, 5);
  assert.equal(result.overviews.bulanan.kehadiranPct, 60);
  // Semester Ganjil (Jul..Dec 2026): r1..r6 -> 4/6 = 67%
  assert.equal(result.overviews.semester.totalTercatat, 6);
  assert.equal(result.overviews.semester.kehadiranPct, 67);
  // Tahunan (Jul 2026..Jun 2027): r1..r7 -> 4/7 = 57%
  assert.equal(result.overviews.tahunan.totalTercatat, 7);
  assert.equal(result.overviews.tahunan.kehadiranPct, 57);

  // Class breakdown & attention highlights
  assert.equal(result.classAnalytics.length, 2);
  assert.equal(result.classAnalytics[0].kelas, 'X IPA 1');
  assert.ok(result.attentionStudents.some((s) => s.nis === '2026003'));
  assert.ok(result.topStudents.some((s) => s.nis === '2026001'));
});




