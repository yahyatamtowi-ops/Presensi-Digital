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
  computeFairAttendanceScore,
  evaluateAttendanceCategory,
  analyzeStudentAttendancePenalties,
  IZIN_MONTHLY_FAIR_LIMIT,
  SAKIT_CONSECUTIVE_FAIR_LIMIT,
  isBeforeCheckoutTime,
  resetAttendanceRecordsForDate,
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

test('extractNisFromQrPayload supports plain NISN, prefixed NISN/NIS, and JSON payloads', () => {
  assert.equal(extractNisFromQrPayload('  2026001  '), '2026001');
  assert.equal(extractNisFromQrPayload('NISN:2026002'), '2026002');
  assert.equal(extractNisFromQrPayload('NIS:2026002'), '2026002');
  assert.equal(extractNisFromQrPayload('{"nisn":"2026004"}'), '2026004');
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
  assert.equal(siti?.status, 'Belum Presensi');
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

test('determineAttendanceStatus handles dot-separated & AM/PM cutoff formats and checkout preserves Terlambat status', () => {
  assert.equal(determineAttendanceStatus('07:20:00', '07.15'), 'Terlambat');
  assert.equal(determineAttendanceStatus('07.20.00', '07:15'), 'Terlambat');
  assert.equal(determineAttendanceStatus('08:05:00', '7:15 AM'), 'Terlambat');
  assert.equal(determineAttendanceStatus('07:10:00', '07.15'), 'Hadir');

  const lateIn = processQrScan({
    qrRaw: '2026002',
    students: sampleStudents,
    records: [],
    batasJamMasuk: '07:15',
    modePresensi: 'masuk_pulang',
    jamPulangStandar: '15:00',
    scanAction: 'auto',
    now: new Date(2026, 10, 20, 7, 35, 0),
  });
  assert.equal(lateIn.ok, true);
  if (!lateIn.ok) return;
  assert.equal(lateIn.record.status, 'Terlambat');

  // Checking out later in the day MUST preserve Terlambat status (never flip to Hadir)
  const lateOut = processQrScan({
    qrRaw: '2026002',
    students: sampleStudents,
    records: [lateIn.record],
    batasJamMasuk: '07:15',
    modePresensi: 'masuk_pulang',
    jamPulangStandar: '15:00',
    scanAction: 'auto',
    now: new Date(2026, 10, 20, 15, 5, 0),
  });
  assert.equal(lateOut.ok, true);
  if (!lateOut.ok) return;
  assert.equal(lateOut.scanType, 'pulang');
  assert.equal(lateOut.record.status, 'Terlambat');
  assert.equal(lateOut.record.jam_pulang, '15:05:00');

  // Early checkout of a late student MUST also preserve Terlambat status and save alasan_pulang_cepat
  const lateEarlyOut = processQrScan({
    qrRaw: '2026002',
    students: sampleStudents,
    records: [lateIn.record],
    batasJamMasuk: '07:15',
    modePresensi: 'masuk_pulang',
    jamPulangStandar: '15:00',
    scanAction: 'pulang',
    alasanPulangCepat: 'Izin keperluan keluarga',
    now: new Date(2026, 10, 20, 11, 30, 0),
  });
  assert.equal(lateEarlyOut.ok, true);
  if (!lateEarlyOut.ok) return;
  assert.equal(lateEarlyOut.record.status, 'Terlambat');
  assert.equal(lateEarlyOut.record.alasan_pulang_cepat, 'Izin keperluan keluarga');
});

test('computeFairAttendanceScore & evaluateAttendanceCategory reward on-time Hadir as Sangat Baik and penalize Terlambat as Kurang Baik fairly across all categories', () => {
  // 1. 100% Hadir Tepat Waktu => 100% score, Sangat Baik
  const onTimeOnly = computeFairAttendanceScore({
    hadir: 10,
    terlambat: 0,
    sakit: 0,
    izin: 0,
    alpa: 0,
    totalTercatat: 10,
  });
  assert.equal(onTimeOnly.skorKehadiranPct, 100);
  assert.equal(onTimeOnly.tepatWaktuPct, 100);
  assert.equal(
    evaluateAttendanceCategory({
      hadir: 10,
      terlambat: 0,
      sakit: 0,
      izin: 0,
      alpa: 0,
      totalTercatat: 10,
    }).label,
    'Sangat Baik'
  );

  // 2. 100% Hadir tapi Terlambat => 50% score, Kurang Baik (NEVER Sangat Baik!)
  const lateOnly = computeFairAttendanceScore({
    hadir: 0,
    terlambat: 5,
    sakit: 0,
    izin: 0,
    alpa: 0,
    totalTercatat: 5,
  });
  assert.equal(lateOnly.skorKehadiranPct, 50);
  assert.equal(lateOnly.tepatWaktuPct, 0);
  assert.equal(
    evaluateAttendanceCategory({
      hadir: 0,
      terlambat: 5,
      sakit: 0,
      izin: 0,
      alpa: 0,
      totalTercatat: 5,
    }).label,
    'Kurang Baik'
  );

  // 3. Single day Terlambat => Kurang Baik
  assert.equal(
    evaluateAttendanceCategory({
      hadir: 0,
      terlambat: 1,
      sakit: 0,
      izin: 0,
      alpa: 0,
      totalTercatat: 1,
    }).label,
    'Kurang Baik'
  );

  // 4. More late than on-time (2 Hadir, 3 Terlambat) => Kurang Baik
  assert.equal(
    evaluateAttendanceCategory({
      hadir: 2,
      terlambat: 3,
      sakit: 0,
      izin: 0,
      alpa: 0,
      totalTercatat: 5,
    }).label,
    'Kurang Baik'
  );

  // 5. 80% on-time + 20% Terlambat (8H, 2T) => Baik (NOT Sangat Baik, since on-time < 90%)
  assert.equal(
    evaluateAttendanceCategory({
      hadir: 8,
      terlambat: 2,
      sakit: 0,
      izin: 0,
      alpa: 0,
      totalTercatat: 10,
    }).label,
    'Baik'
  );

  // 6. Fair distinction between excused Sakit (<= 7 consecutive days) vs Alpa:
  //    8H + 2S (0 Alpa, excused) => 100% score, Sangat Baik (Sakit <= 7 hari tidak merugikan)
  //    8H + 2A (20% Alpa) => 80% score, Kurang Baik (Alpa > 10% bernilai kurang baik)
  const sickCase = computeFairAttendanceScore({
    hadir: 8,
    terlambat: 0,
    sakit: 2,
    izin: 0,
    alpa: 0,
    totalTercatat: 10,
  });
  const alpaCase = computeFairAttendanceScore({
    hadir: 8,
    terlambat: 0,
    sakit: 0,
    izin: 0,
    alpa: 2,
    totalTercatat: 10,
  });
  assert.equal(sickCase.skorKehadiranPct, 100);
  assert.equal(alpaCase.skorKehadiranPct, 80);
  assert.ok(sickCase.skorKehadiranPct > alpaCase.skorKehadiranPct);
  assert.equal(
    evaluateAttendanceCategory({
      hadir: 8,
      terlambat: 0,
      sakit: 2,
      izin: 0,
      alpa: 0,
      totalTercatat: 10,
    }).label,
    'Sangat Baik'
  );
  assert.equal(
    evaluateAttendanceCategory({
      hadir: 8,
      terlambat: 0,
      sakit: 0,
      izin: 0,
      alpa: 2,
      totalTercatat: 10,
    }).label,
    'Kurang Baik'
  );

  // 7. Heavy Alpa => Perlu Perhatian
  assert.equal(
    evaluateAttendanceCategory({
      hadir: 2,
      terlambat: 0,
      sakit: 0,
      izin: 0,
      alpa: 8,
      totalTercatat: 10,
    }).label,
    'Perlu Perhatian'
  );

  // 8. computeAttendanceAnalytics excludes late-only students from topStudents and includes them in attentionStudents
  const analytics = computeAttendanceAnalytics({
    students: sampleStudents,
    records: [
      { id: 'f1', tanggal: '2026-11-20', nis: '2026001', nama: 'Ahmad Fauzi', kelas: 'X IPA 1', jam_masuk: '07:00:00', status: 'Hadir' },
      { id: 'f2', tanggal: '2026-11-20', nis: '2026002', nama: 'Siti Rahma', kelas: 'X IPA 1', jam_masuk: '07:35:00', status: 'Terlambat' },
      { id: 'f3', tanggal: '2026-11-20', nis: '2026003', nama: 'Budi Santoso', kelas: 'XI IPS 2', jam_masuk: '-', status: 'Alpa' },
    ],
    selectedPeriod: 'bulanan',
    date: '2026-11-20',
    month: '2026-11',
    semester: 'ganjil',
    semesterYear: 2026,
    academicYear: '2026/2027',
  });

  // Ahmad (100% Hadir) is in topStudents; Siti (100% Terlambat) is NOT in topStudents, IS in attentionStudents!
  assert.deepEqual(
    analytics.topStudents.map((s) => s.nis),
    ['2026001']
  );
  assert.ok(analytics.attentionStudents.some((s) => s.nis === '2026002'));
  assert.ok(analytics.attentionStudents.some((s) => s.nis === '2026003'));

  const sitiRow = analytics.studentRows.find((r) => r.nis === '2026002');
  assert.ok(sitiRow);
  assert.equal(sitiRow.skorKehadiranPct, 50);
  assert.equal(sitiRow.tepatWaktuPct, 0);
  assert.equal(evaluateAttendanceCategory(sitiRow).label, 'Kurang Baik');
});

test('Izin > 7x/bulan and Sakit > 7 hari berturut-turut are flagged Kurang Baik while <= 7 remains fair', () => {
  assert.equal(IZIN_MONTHLY_FAIR_LIMIT, 7);
  assert.equal(SAKIT_CONSECUTIVE_FAIR_LIMIT, 7);

  const mkRec = (
    id: string,
    tanggal: string,
    nis: string,
    nama: string,
    status: AttendanceRecord['status']
  ): AttendanceRecord => ({
    id,
    tanggal,
    nis,
    nama,
    kelas: 'X IPA 1',
    jam_masuk: status === 'Hadir' ? '07:00:00' : status === 'Terlambat' ? '07:30:00' : '-',
    status,
  });

  // 1. Izin exactly 7x in one month => NOT penalized
  const izin7Records = Array.from({ length: 7 }, (_, i) =>
    mkRec(`iz7-${i}`, `2026-11-${String(i + 1).padStart(2, '0')}`, 'S1', 'Izin Tujuh', 'Izin')
  );
  const pIzin7 = analyzeStudentAttendancePenalties(izin7Records);
  assert.equal(pIzin7.maxMonthlyIzin, 7);
  assert.equal(pIzin7.penalizedIzinDays, 0);

  // 2. Izin 8x in one month => penalized (all 8 days in that month penalized)
  const izin8Records = [
    ...izin7Records,
    mkRec('iz8', '2026-11-10', 'S1', 'Izin Delapan', 'Izin'),
  ];
  const pIzin8 = analyzeStudentAttendancePenalties(izin8Records);
  assert.equal(pIzin8.maxMonthlyIzin, 8);
  assert.equal(pIzin8.penalizedIzinDays, 8);

  // 3. Izin 5x in Oct + 5x in Nov (10 total, <= 7 per month) => NOT penalized
  const izinSplitMonths = [
    ...Array.from({ length: 5 }, (_, i) =>
      mkRec(`oct-${i}`, `2026-10-${String(i + 1).padStart(2, '0')}`, 'S1', 'Izin Split', 'Izin')
    ),
    ...Array.from({ length: 5 }, (_, i) =>
      mkRec(`nov-${i}`, `2026-11-${String(i + 1).padStart(2, '0')}`, 'S1', 'Izin Split', 'Izin')
    ),
  ];
  const pIzinSplit = analyzeStudentAttendancePenalties(izinSplitMonths);
  assert.equal(pIzinSplit.maxMonthlyIzin, 5);
  assert.equal(pIzinSplit.penalizedIzinDays, 0);

  // 4. Sakit 7 consecutive days (Nov 1..7) => NOT penalized
  const sakit7Consec = Array.from({ length: 7 }, (_, i) =>
    mkRec(`sk7-${i}`, `2026-11-${String(i + 1).padStart(2, '0')}`, 'S2', 'Sakit Tujuh', 'Sakit')
  );
  const pSakit7 = analyzeStudentAttendancePenalties(sakit7Consec);
  assert.equal(pSakit7.maxConsecutiveSakitDays, 7);
  assert.equal(pSakit7.penalizedSakitDays, 0);

  // 5. Sakit 8 consecutive days (Nov 1..8) => penalized (all 8 days in streak penalized)
  const sakit8Consec = [
    ...sakit7Consec,
    mkRec('sk8', '2026-11-08', 'S2', 'Sakit Delapan', 'Sakit'),
  ];
  const pSakit8 = analyzeStudentAttendancePenalties(sakit8Consec);
  assert.equal(pSakit8.maxConsecutiveSakitDays, 8);
  assert.equal(pSakit8.penalizedSakitDays, 8);

  // 6. Sakit 10 total days split into 5 consecutive + gap + 5 consecutive => NOT penalized
  const sakitSplit = [
    ...Array.from({ length: 5 }, (_, i) =>
      mkRec(`skA-${i}`, `2026-11-${String(i + 1).padStart(2, '0')}`, 'S2', 'Sakit Split', 'Sakit')
    ),
    // Gap on Nov 6-9 (Hadir)
    mkRec('skGap', '2026-11-07', 'S2', 'Sakit Split', 'Hadir'),
    ...Array.from({ length: 5 }, (_, i) =>
      mkRec(`skB-${i}`, `2026-11-${String(i + 10).padStart(2, '0')}`, 'S2', 'Sakit Split', 'Sakit')
    ),
  ];
  const pSakitSplit = analyzeStudentAttendancePenalties(sakitSplit);
  assert.equal(pSakitSplit.maxConsecutiveSakitDays, 5);
  assert.equal(pSakitSplit.penalizedSakitDays, 0);

  // 7. End-to-end computeAttendanceAnalytics verification
  const testStudents: Student[] = [
    { nis: '901', nama: 'Izin Aman 5x', kelas: 'X IPA 1', gender: 'L', no_wa_ortu: '' },
    { nis: '902', nama: 'Izin Berlebih 8x', kelas: 'X IPA 1', gender: 'P', no_wa_ortu: '' },
    { nis: '903', nama: 'Sakit Aman 6hr', kelas: 'X IPA 1', gender: 'L', no_wa_ortu: '' },
    { nis: '904', nama: 'Sakit Beruntun 8hr', kelas: 'X IPA 1', gender: 'P', no_wa_ortu: '' },
  ];

  const allRecords: AttendanceRecord[] = [
    // 901: 10 Hadir + 5 Izin => Sangat Baik
    ...Array.from({ length: 10 }, (_, i) =>
      mkRec(`901h-${i}`, `2026-11-${String(i + 1).padStart(2, '0')}`, '901', 'Izin Aman 5x', 'Hadir')
    ),
    ...Array.from({ length: 5 }, (_, i) =>
      mkRec(`901i-${i}`, `2026-11-${String(i + 12).padStart(2, '0')}`, '901', 'Izin Aman 5x', 'Izin')
    ),
    // 902: 10 Hadir + 8 Izin in Nov => Kurang Baik
    ...Array.from({ length: 10 }, (_, i) =>
      mkRec(`902h-${i}`, `2026-11-${String(i + 1).padStart(2, '0')}`, '902', 'Izin Berlebih 8x', 'Hadir')
    ),
    ...Array.from({ length: 8 }, (_, i) =>
      mkRec(`902i-${i}`, `2026-11-${String(i + 12).padStart(2, '0')}`, '902', 'Izin Berlebih 8x', 'Izin')
    ),
    // 903: 10 Hadir + 6 consecutive Sakit => Sangat Baik
    ...Array.from({ length: 10 }, (_, i) =>
      mkRec(`903h-${i}`, `2026-11-${String(i + 10).padStart(2, '0')}`, '903', 'Sakit Aman 6hr', 'Hadir')
    ),
    ...Array.from({ length: 6 }, (_, i) =>
      mkRec(`903s-${i}`, `2026-11-${String(i + 1).padStart(2, '0')}`, '903', 'Sakit Aman 6hr', 'Sakit')
    ),
    // 904: 10 Hadir + 8 consecutive Sakit => Kurang Baik
    ...Array.from({ length: 10 }, (_, i) =>
      mkRec(`904h-${i}`, `2026-11-${String(i + 12).padStart(2, '0')}`, '904', 'Sakit Beruntun 8hr', 'Hadir')
    ),
    ...Array.from({ length: 8 }, (_, i) =>
      mkRec(`904s-${i}`, `2026-11-${String(i + 1).padStart(2, '0')}`, '904', 'Sakit Beruntun 8hr', 'Sakit')
    ),
  ];

  const analytics = computeAttendanceAnalytics({
    students: testStudents,
    records: allRecords,
    selectedPeriod: 'bulanan',
    date: '2026-11-20',
    month: '2026-11',
    semester: 'ganjil',
    semesterYear: 2026,
    academicYear: '2026/2027',
  });

  const row901 = analytics.studentRows.find((r) => r.nis === '901')!;
  const row902 = analytics.studentRows.find((r) => r.nis === '902')!;
  const row903 = analytics.studentRows.find((r) => r.nis === '903')!;
  const row904 = analytics.studentRows.find((r) => r.nis === '904')!;

  assert.equal(evaluateAttendanceCategory(row901).label, 'Sangat Baik');
  assert.equal(row901.skorKehadiranPct, 100);
  assert.equal(row901.penalizedIzinDays, 0);

  assert.equal(evaluateAttendanceCategory(row902).label, 'Kurang Baik');
  assert.equal(row902.penalizedIzinDays, 8);
  assert.equal(row902.maxMonthlyIzin, 8);

  assert.equal(evaluateAttendanceCategory(row903).label, 'Sangat Baik');
  assert.equal(row903.skorKehadiranPct, 100);
  assert.equal(row903.penalizedSakitDays, 0);

  assert.equal(evaluateAttendanceCategory(row904).label, 'Kurang Baik');
  assert.equal(row904.penalizedSakitDays, 8);
  assert.equal(row904.maxConsecutiveSakitDays, 8);

  // 901 & 903 are top students; 902 & 904 are in attentionStudents!
  const topIds = analytics.topStudents.map((s) => s.nis).sort();
  const attentionIds = analytics.attentionStudents.map((s) => s.nis).sort();
  assert.deepEqual(topIds, ['901', '903']);
  assert.deepEqual(attentionIds, ['902', '904']);
});

test('resetAttendanceRecordsForDate reverts single and collective recorded statuses back to Belum Presensi without affecting other dates', () => {
  const seedRecords: AttendanceRecord[] = [
    {
      id: '2026-11-20_2026001',
      tanggal: '2026-11-20',
      nis: '2026001',
      nama: 'Ahmad Fauzi',
      kelas: 'X IPA 1',
      jam_masuk: '07:05:00',
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
    {
      id: '2026-11-19_2026001',
      tanggal: '2026-11-19',
      nis: '2026001',
      nama: 'Ahmad Fauzi',
      kelas: 'X IPA 1',
      jam_masuk: '07:01:00',
      status: 'Hadir',
    },
  ];

  // Single reset: revert 2026001 on 2026-11-20 only
  const singleRes = resetAttendanceRecordsForDate(seedRecords, '2026-11-20', ['2026001']);
  assert.equal(singleRes.removedRecords.length, 1);
  assert.equal(singleRes.removedRecords[0].nis, '2026001');
  assert.equal(singleRes.nextRecords.length, 3);
  const rowsAfterSingle = buildDailyRecapRows(
    sampleStudents,
    singleRes.nextRecords,
    '2026-11-20'
  );
  assert.equal(
    rowsAfterSingle.find((r) => r.nis === '2026001')?.status,
    'Belum Presensi'
  );
  assert.equal(
    rowsAfterSingle.find((r) => r.nis === '2026002')?.status,
    'Terlambat'
  );

  // Collective reset: revert 2026002 & 2026003 on 2026-11-20
  const collectiveRes = resetAttendanceRecordsForDate(
    singleRes.nextRecords,
    '2026-11-20',
    ['2026002', '2026003']
  );
  assert.equal(collectiveRes.removedRecords.length, 2);
  assert.equal(collectiveRes.nextRecords.length, 1);
  assert.equal(collectiveRes.nextRecords[0].tanggal, '2026-11-19');

  const rowsAfterCollective = buildDailyRecapRows(
    sampleStudents,
    collectiveRes.nextRecords,
    '2026-11-20'
  );
  assert.equal(
    rowsAfterCollective.every((r) => r.status === 'Belum Presensi'),
    true
  );
});
