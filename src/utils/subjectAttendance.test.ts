import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addMasterSubject,
  addSubjectAssignment,
  addTeacherSchedule,
  computeSubjectSessionSummary,
  formatIndonesianDateWithDay,
  formatSemesterLabel,
  getIndonesianDayOfWeek,
  getRecordsForAssignmentOnDate,
  normalizeSemester,
  processSubjectQrScan,
  resolveAssignmentsForDate,
  updateMasterSubject,
  updateTeacherSchedule,
  upsertSubjectAttendanceStatus,
  validateTransparentPngFile,
} from './subjectAttendance';
import {
  getMonthlyAnalyticsPdfColumns,
  getSubjectAttendancePdfColumns,
  resolveTeacherNip,
} from './subjectAttendancePdf';
import { RECAP_PDF_F4_CONFIG } from './recapPdf';
import type {
  MasterSubject,
  Student,
  SubjectAssignment,
  SubjectAttendanceRecord,
  TeacherSchedule,
  UserAccount,
} from '../types';

const SAMPLE_STUDENTS: Student[] = [
  { nis: '2026001', nama: 'Ahmad Fauzi', kelas: 'X IPA 1', gender: 'L', no_wa_ortu: '081201', tahun_ajaran: '2026/2027' },
  { nis: '2026002', nama: 'Aisyah Putri', kelas: 'X IPA 1', gender: 'P', no_wa_ortu: '081202', tahun_ajaran: '2026/2027' },
  { nis: '2026003', nama: 'Bagas Saputra', kelas: 'X IPA 1', gender: 'L', no_wa_ortu: '081203', tahun_ajaran: '2026/2027' },
  { nis: '2026004', nama: 'Citra Dewi', kelas: 'X IPA 2', gender: 'P', no_wa_ortu: '081204', tahun_ajaran: '2026/2027' },
];

test('validateTransparentPngFile accepts PNG and rejects non-PNG files', () => {
  assert.equal(validateTransparentPngFile({ name: 'ttd_kepsek.png', type: 'image/png', size: 12000 }).ok, true);
  assert.equal(validateTransparentPngFile({ name: 'CAP_SEKOLAH.PNG', type: '', size: 45000 }).ok, true);
  assert.equal(validateTransparentPngFile({ name: 'ttd.jpg', type: 'image/jpeg', size: 12000 }).ok, false);
  assert.equal(validateTransparentPngFile({ name: 'cap.webp', type: 'image/webp', size: 12000 }).ok, false);
  assert.equal(validateTransparentPngFile({ name: 'huge.png', type: 'image/png', size: 6 * 1024 * 1024 }).ok, false);
});

test('getIndonesianDayOfWeek and semester helpers format local calendar dates accurately', () => {
  assert.equal(getIndonesianDayOfWeek('2026-11-20'), 'Jumat');
  assert.equal(getIndonesianDayOfWeek('2026-11-21'), 'Sabtu');
  assert.equal(getIndonesianDayOfWeek('2026-11-22'), 'Minggu');
  assert.equal(getIndonesianDayOfWeek('2026-11-23'), 'Senin');

  assert.equal(formatIndonesianDateWithDay('2026-11-20'), 'Jumat, 20 November 2026');

  assert.equal(normalizeSemester('ganjil'), 'ganjil');
  assert.equal(normalizeSemester('Semester 2'), 'genap');
  assert.equal(normalizeSemester('2'), 'genap');
  assert.equal(normalizeSemester(''), 'ganjil');
  assert.equal(formatSemesterLabel('ganjil'), 'Ganjil');
  assert.equal(formatSemesterLabel('genap'), 'Genap');
});

test('MasterSubject CRUD validates duplicates and updates safely', () => {
  const initial: MasterSubject[] = [];
  const added = addMasterSubject(initial, { kode: 'mtk', nama: 'Matematika', deskripsi: 'Umum' });
  assert.equal(added.ok, true);
  if (!added.ok) return;
  assert.equal(added.subject.kode, 'MTK');
  assert.equal(added.subjects.length, 1);

  const dupName = addMasterSubject(added.subjects, { kode: 'M2', nama: 'matematika' });
  assert.equal(dupName.ok, false);

  const updated = updateMasterSubject(added.subjects, added.subject.id, {
    kode: 'MAT-01',
    nama: 'Matematika Wajib',
    deskripsi: 'Peminatan',
  });
  assert.equal(updated.ok, true);
  if (updated.ok) {
    assert.equal(updated.subjects[0].nama, 'Matematika Wajib');
    assert.equal(updated.subjects[0].kode, 'MAT-01');
  }
});

test('TeacherSchedule CRUD enforces time ordering and duplicate slot checks', () => {
  const badTime = addTeacherSchedule([], {
    hari: 'Jumat',
    teacher_user_id: 'usr_guru',
    teacher_name: 'Siti Aminah, S.Pd',
    kelas: 'X IPA 1',
    mata_pelajaran: 'Matematika',
    jam_mulai: '09:00',
    jam_selesai: '08:30',
    tahun_ajaran: '2026/2027',
    semester: 'ganjil',
  });
  assert.equal(badTime.ok, false);

  const okFirst = addTeacherSchedule([], {
    hari: 'Jumat',
    teacher_user_id: 'usr_guru',
    teacher_name: 'Siti Aminah, S.Pd',
    kelas: 'X IPA 1',
    mata_pelajaran: 'Matematika',
    jam_mulai: '07:30',
    jam_selesai: '09:00',
    tahun_ajaran: '2026/2027',
    semester: 'ganjil',
  });
  assert.equal(okFirst.ok, true);
  if (!okFirst.ok) return;

  const dupSlot = addTeacherSchedule(okFirst.schedules, {
    hari: 'Jumat',
    teacher_user_id: 'usr_guru',
    teacher_name: 'Siti Aminah, S.Pd',
    kelas: 'x ipa 1',
    mata_pelajaran: 'matematika',
    jam_mulai: '07:30',
    jam_selesai: '09:00',
    tahun_ajaran: '2026/2027',
    semester: 'ganjil',
  });
  assert.equal(dupSlot.ok, false);

  const edited = updateTeacherSchedule(okFirst.schedules, okFirst.schedule.id, {
    hari: 'Senin',
    teacher_user_id: 'usr_guru',
    teacher_name: 'Siti Aminah, S.Pd',
    kelas: 'X IPA 1',
    mata_pelajaran: 'Matematika',
    jam_mulai: '08:00',
    jam_selesai: '09:30',
    tahun_ajaran: '2026/2027',
    semester: 'ganjil',
  });
  assert.equal(edited.ok, true);
  if (edited.ok) {
    assert.equal(edited.schedules[0].hari, 'Senin');
    assert.equal(edited.schedules[0].jam_mulai, '08:00');
  }
});

test('resolveAssignmentsForDate strictly returns only schedules for that date day-of-week or actual records on that date', () => {
  const schedules: TeacherSchedule[] = [
    {
      id: 'sch_fri_mtk',
      hari: 'Jumat',
      teacher_user_id: 'usr_guru',
      teacher_name: 'Siti Aminah, S.Pd',
      kelas: 'X IPA 1',
      mata_pelajaran: 'Matematika',
      jam_mulai: '07:30',
      jam_selesai: '09:00',
      tahun_ajaran: '2026/2027',
      semester: 'ganjil',
    },
    {
      id: 'sch_mon_inf',
      hari: 'Senin',
      teacher_user_id: 'usr_guru',
      teacher_name: 'Siti Aminah, S.Pd',
      kelas: 'X IPA 2',
      mata_pelajaran: 'Informatika',
      jam_mulai: '08:00',
      jam_selesai: '09:30',
      tahun_ajaran: '2026/2027',
      semester: 'ganjil',
    },
    {
      id: 'sch_fri_fis',
      hari: 'Jumat',
      teacher_user_id: 'usr_walikelas',
      teacher_name: 'Budi Santoso, S.Pd',
      kelas: 'X IPA 2',
      mata_pelajaran: 'Fisika',
      jam_mulai: '09:15',
      jam_selesai: '10:45',
      tahun_ajaran: '2026/2027',
      semester: 'ganjil',
    },
  ];

  // Friday 2026-11-20 for Guru: only Matematika X IPA 1
  const guruFri = resolveAssignmentsForDate({
    selectedDate: '2026-11-20',
    academicYear: '2026/2027',
    semester: 'ganjil',
    schedules,
    manualAssignments: [],
    records: [],
    role: 'guru',
    teacherUserId: 'usr_guru',
  });
  assert.equal(guruFri.length, 1);
  assert.equal(guruFri[0].mata_pelajaran, 'Matematika');
  assert.equal(guruFri[0].source, 'schedule');

  // Friday 2026-11-20 for Master Admin: both Friday subjects
  const adminFri = resolveAssignmentsForDate({
    selectedDate: '2026-11-20',
    academicYear: '2026/2027',
    semester: 'ganjil',
    schedules,
    manualAssignments: [],
    records: [],
    role: 'master_admin',
  });
  assert.equal(adminFri.length, 2);

  // Saturday 2026-11-21 (no schedule, no records) -> empty array!
  const adminSat = resolveAssignmentsForDate({
    selectedDate: '2026-11-21',
    academicYear: '2026/2027',
    semester: 'ganjil',
    schedules,
    manualAssignments: [],
    records: [],
    role: 'master_admin',
  });
  assert.equal(adminSat.length, 0);

  // Historical record on Saturday 2026-11-21 surfaces only that recorded subject
  const satRecord: SubjectAttendanceRecord = {
    id: '2026-11-21_asg_ext_2026001',
    assignment_id: 'asg_ext',
    tanggal: '2026-11-21',
    nis: '2026001',
    nama: 'Ahmad Fauzi',
    kelas: 'X IPA 1',
    mata_pelajaran: 'Ekstrakurikuler',
    teacher_user_id: 'usr_guru',
    teacher_name: 'Siti Aminah, S.Pd',
    jam_masuk: '08:10:00',
    status: 'Hadir',
    tahun_ajaran: '2026/2027',
  };
  const adminSatWithRec = resolveAssignmentsForDate({
    selectedDate: '2026-11-21',
    academicYear: '2026/2027',
    semester: 'ganjil',
    schedules,
    manualAssignments: [],
    records: [satRecord],
    role: 'master_admin',
  });
  assert.equal(adminSatWithRec.length, 1);
  assert.equal(adminSatWithRec[0].mata_pelajaran, 'Ekstrakurikuler');

  // Matching records for an assignment on a given date
  const matched = getRecordsForAssignmentOnDate([satRecord], adminSatWithRec[0], '2026-11-21');
  assert.equal(matched.length, 1);
});

test('Subject PDF and Monthly Analytics PDF columns sum cleanly to F4 portrait contentWidth (187mm) without Keterangan', () => {
  const sum = (cols: Array<{ width: number }>) => cols.reduce((acc, c) => acc + c.width, 0);
  const subjectCols = getSubjectAttendancePdfColumns();
  assert.equal(sum(subjectCols), RECAP_PDF_F4_CONFIG.contentWidth);
  assert.deepEqual(
    subjectCols.map((c) => c.header),
    ['No', 'NISN', 'Nama Siswa', 'Jam Masuk', 'Status']
  );
  assert.equal(subjectCols.some((c) => c.header === 'Keterangan'), false);

  const monthlyCols = getMonthlyAnalyticsPdfColumns();
  assert.equal(sum(monthlyCols), RECAP_PDF_F4_CONFIG.contentWidth);
  assert.ok(monthlyCols.some((c) => c.header === '% Hadir'));
});

test('resolveTeacherNip matches by teacher_user_id, teacher_name, and fallbackNip cleanly', () => {
  const sampleAccounts: UserAccount[] = [
    {
      id: 'usr_guru',
      username: 'guru',
      password: '123',
      nama: 'Siti Aminah, S.Pd',
      jabatan: 'Guru Mata Pelajaran',
      role: 'guru',
      nip: '199008212018012004',
    },
    {
      id: 'usr_walikelas',
      username: 'walikelas',
      password: '123',
      nama: 'Budi Santoso, S.Pd',
      jabatan: 'Wali Kelas X IPA 1',
      role: 'wali_kelas',
      kelas_binaan: 'X IPA 1',
      nip: '198705142015031002',
    },
  ];

  assert.equal(
    resolveTeacherNip(sampleAccounts, 'usr_guru', 'Nama Lain'),
    '199008212018012004'
  );
  assert.equal(
    resolveTeacherNip(sampleAccounts, 'unknown_id', 'budi santoso, s.pd'),
    '198705142015031002'
  );
  assert.equal(
    resolveTeacherNip(sampleAccounts, 'unknown_id', 'Guru Baru', '199501012022011001'),
    '199501012022011001'
  );
  assert.equal(resolveTeacherNip(sampleAccounts, 'unknown_id', 'Guru Tanpa NIP'), '');
});

test('addSubjectAssignment creates assignments and prevents duplicates per teacher/class/subject/year', () => {
  const first = addSubjectAssignment([], {
    teacher_user_id: 'usr_guru',
    teacher_name: 'Siti Aminah, S.Pd',
    kelas: 'X IPA 1',
    mata_pelajaran: 'Matematika',
    jam_mulai: '07:30',
    tahun_ajaran: '2026/2027',
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.assignments.length, 1);
  assert.equal(first.assignment.jam_mulai, '07:30');

  // Same teacher, same class & subject -> rejected
  const dup = addSubjectAssignment(first.assignments, {
    teacher_user_id: 'usr_guru',
    teacher_name: 'Siti Aminah, S.Pd',
    kelas: 'x ipa 1',
    mata_pelajaran: 'matematika',
    tahun_ajaran: '2026/2027',
  });
  assert.equal(dup.ok, false);

  // Same teacher, different class -> allowed
  const secondClass = addSubjectAssignment(first.assignments, {
    teacher_user_id: 'usr_guru',
    teacher_name: 'Siti Aminah, S.Pd',
    kelas: 'X IPA 2',
    mata_pelajaran: 'Matematika',
    tahun_ajaran: '2026/2027',
  });
  assert.equal(secondClass.ok, true);

  // Different teacher (Wali Kelas) teaching Fisika in X IPA 1 -> allowed
  const waliSubject = addSubjectAssignment(first.assignments, {
    teacher_user_id: 'usr_walikelas',
    teacher_name: 'Budi Santoso, S.Pd',
    kelas: 'X IPA 1',
    mata_pelajaran: 'Fisika',
    tahun_ajaran: '2026/2027',
  });
  assert.equal(waliSubject.ok, true);
});

test('processSubjectQrScan handles Hadir, Terlambat, wrong_class, duplicate, and cross-subject scans', () => {
  const mathX1: SubjectAssignment = {
    id: 'asg_mtk_x1',
    teacher_user_id: 'usr_guru',
    teacher_name: 'Siti Aminah, S.Pd',
    kelas: 'X IPA 1',
    mata_pelajaran: 'Matematika',
    jam_mulai: '07:30',
    tahun_ajaran: '2026/2027',
  };
  const physicsX1: SubjectAssignment = {
    id: 'asg_fis_x1',
    teacher_user_id: 'usr_walikelas',
    teacher_name: 'Budi Santoso, S.Pd',
    kelas: 'X IPA 1',
    mata_pelajaran: 'Fisika',
    jam_mulai: '09:00',
    tahun_ajaran: '2026/2027',
  };

  let records: SubjectAttendanceRecord[] = [];

  // On-time scan
  const onTime = processSubjectQrScan({
    qrRaw: '2026001',
    assignment: mathX1,
    students: SAMPLE_STUDENTS,
    records,
    tanggal: '2026-11-20',
    currentTime: '07:25:00',
  });
  assert.equal(onTime.ok, true);
  if (onTime.ok) {
    assert.equal(onTime.record.status, 'Hadir');
    records = [onTime.record, ...records];
  }

  // Late scan (after jam_mulai 07:30)
  const late = processSubjectQrScan({
    qrRaw: '2026002',
    assignment: mathX1,
    students: SAMPLE_STUDENTS,
    records,
    tanggal: '2026-11-20',
    currentTime: '07:42:10',
  });
  assert.equal(late.ok, true);
  if (late.ok) {
    assert.equal(late.record.status, 'Terlambat');
    records = [late.record, ...records];
  }

  // Duplicate scan for same subject & date -> rejected
  const dup = processSubjectQrScan({
    qrRaw: '2026001',
    assignment: mathX1,
    students: SAMPLE_STUDENTS,
    records,
    tanggal: '2026-11-20',
    currentTime: '07:45:00',
  });
  assert.equal(dup.ok, false);
  if (!dup.ok) assert.equal(dup.reason, 'duplicate');

  // Wrong class student (2026004 is X IPA 2) -> rejected
  const wrongClass = processSubjectQrScan({
    qrRaw: '2026004',
    assignment: mathX1,
    students: SAMPLE_STUDENTS,
    records,
    tanggal: '2026-11-20',
    currentTime: '07:28:00',
  });
  assert.equal(wrongClass.ok, false);
  if (!wrongClass.ok) assert.equal(wrongClass.reason, 'wrong_class');

  // Same student (2026001) scanning into a DIFFERENT subject (Fisika) on same date -> allowed!
  const otherSubject = processSubjectQrScan({
    qrRaw: '2026001',
    assignment: physicsX1,
    students: SAMPLE_STUDENTS,
    records,
    tanggal: '2026-11-20',
    currentTime: '08:55:00',
  });
  assert.equal(otherSubject.ok, true);
});

test('upsertSubjectAttendanceStatus and computeSubjectSessionSummary track session counts accurately', () => {
  const mathX1: SubjectAssignment = {
    id: 'asg_mtk_x1',
    teacher_user_id: 'usr_guru',
    teacher_name: 'Siti Aminah, S.Pd',
    kelas: 'X IPA 1',
    mata_pelajaran: 'Matematika',
    tahun_ajaran: '2026/2027',
  };

  let records: SubjectAttendanceRecord[] = [];
  records = upsertSubjectAttendanceStatus({
    records,
    assignment: mathX1,
    student: SAMPLE_STUDENTS[0],
    tanggal: '2026-11-20',
    status: 'Hadir',
    currentTime: '07:20:00',
  }).records;

  records = upsertSubjectAttendanceStatus({
    records,
    assignment: mathX1,
    student: SAMPLE_STUDENTS[1],
    tanggal: '2026-11-20',
    status: 'Izin',
  }).records;

  // Update existing record status without duplicating
  records = upsertSubjectAttendanceStatus({
    records,
    assignment: mathX1,
    student: SAMPLE_STUDENTS[1],
    tanggal: '2026-11-20',
    status: 'Sakit',
  }).records;
  assert.equal(records.length, 2);

  const x1Students = SAMPLE_STUDENTS.filter((s) => s.kelas === 'X IPA 1');
  const summary = computeSubjectSessionSummary(x1Students, records);
  assert.equal(summary.totalStudents, 3);
  assert.equal(summary.hadir, 1);
  assert.equal(summary.sakit, 1);
  assert.equal(summary.belumPresensi, 1);
  assert.equal(summary.persentaseHadir, 33);
});
