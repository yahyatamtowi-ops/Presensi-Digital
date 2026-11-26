import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  areTimetableConfigsEqual,
  buildTeacherSchedulesFromTimetable,
  createDefaultTimetableConfig,
  detectTimetableTeacherConflicts,
  findSlotRangeLabelForSchedule,
  generateDailyTimeSlots,
  getSchoolDaysForCount,
  hydrateTimetableCellsFromSchedules,
  makeTimetableCellKey,
  renameSubjectInTimetableConfigs,
  sanitizeTimetableConfigs,
  syncTimetableConfigsFromSchedules,
} from './timetableLogic';
import {
  deleteTeachingEntryBidirectional,
  getDateForDayInSameWeek,
  getIndonesianDayOfWeek,
  processSubjectQrScan,
  reconcileSchedulesAndAssignments,
  resolveAssignmentsForDate,
  syncAssignmentToTeacherSchedules,
  syncScheduleToSubjectAssignments,
  updateTeachingEntryBidirectional,
} from './subjectAttendance';
import type { Student, SubjectAssignment, TeacherSchedule } from '../types';

describe('Timetable Matrix Logic (Pengaturan Jadwal Mata Pelajaran)', () => {
  it('generates exact daily time slots with manual breaks (Istirahat 1, Istirahat 2, dst)', () => {
    const slots = generateDailyTimeSlots({
      jam_mulai_sekolah: '07:15',
      durasi_jp_menit: 45,
      jumlah_jp: 8,
      istirahat: [
        { id: 'b1', label: 'Istirahat 1', jam_mulai: '09:30', jam_selesai: '09:45' },
        { id: 'b2', label: 'Istirahat 2', jam_mulai: '12:00', jam_selesai: '12:30' },
      ],
    });

    assert.equal(slots.length, 10); // 8 lessons + 2 breaks
    assert.deepEqual(slots[0], {
      kind: 'lesson',
      jamKe: 1,
      jam_mulai: '07:15',
      jam_selesai: '08:00',
    });
    assert.deepEqual(slots[2], {
      kind: 'lesson',
      jamKe: 3,
      jam_mulai: '08:45',
      jam_selesai: '09:30',
    });
    assert.deepEqual(slots[3], {
      kind: 'break',
      breakId: 'b1',
      label: 'Istirahat 1',
      jam_mulai: '09:30',
      jam_selesai: '09:45',
    });
    assert.deepEqual(slots[4], {
      kind: 'lesson',
      jamKe: 4,
      jam_mulai: '09:45',
      jam_selesai: '10:30',
    });
    assert.deepEqual(slots[7], {
      kind: 'break',
      breakId: 'b2',
      label: 'Istirahat 2',
      jam_mulai: '12:00',
      jam_selesai: '12:30',
    });
    assert.deepEqual(slots[8], {
      kind: 'lesson',
      jamKe: 7,
      jam_mulai: '12:30',
      jam_selesai: '13:15',
    });
    assert.deepEqual(slots[9], {
      kind: 'lesson',
      jamKe: 8,
      jam_mulai: '13:15',
      jam_selesai: '14:00',
    });
  });

  it('supports 5-day (Senin-Jumat) and 6-day (Senin-Sabtu) school schedules', () => {
    assert.deepEqual(getSchoolDaysForCount(5), [
      'Senin',
      'Selasa',
      'Rabu',
      'Kamis',
      'Jumat',
    ]);
    assert.deepEqual(getSchoolDaysForCount(6), [
      'Senin',
      'Selasa',
      'Rabu',
      'Kamis',
      'Jumat',
      'Sabtu',
    ]);
  });

  it('merges consecutive JPs into a single TeacherSchedule and splits cleanly across breaks', () => {
    const cfg = createDefaultTimetableConfig('2026/2027', 'ganjil', '07:15');
    // JP 1 & JP 2: Matematika (Siti) in X IPA 1 -> merged 07:15 - 08:45
    cfg.cells[makeTimetableCellKey('Senin', 1, 'X IPA 1')] = {
      mata_pelajaran: 'Matematika',
      teacher_user_id: 'usr_guru',
      teacher_name: 'Siti Aminah, S.Pd',
    };
    cfg.cells[makeTimetableCellKey('Senin', 2, 'X IPA 1')] = {
      mata_pelajaran: 'Matematika',
      teacher_user_id: 'usr_guru',
      teacher_name: 'Siti Aminah, S.Pd',
    };
    // JP 3 (before Istirahat 1) & JP 4 (after Istirahat 1): Fisika (Budi) -> split into 2 blocks
    cfg.cells[makeTimetableCellKey('Senin', 3, 'X IPA 1')] = {
      mata_pelajaran: 'Fisika',
      teacher_user_id: 'usr_walikelas',
      teacher_name: 'Budi Santoso, S.Pd',
    };
    cfg.cells[makeTimetableCellKey('Senin', 4, 'X IPA 1')] = {
      mata_pelajaran: 'Fisika',
      teacher_user_id: 'usr_walikelas',
      teacher_name: 'Budi Santoso, S.Pd',
    };

    const schedules = buildTeacherSchedulesFromTimetable(cfg, ['X IPA 1']);
    assert.equal(schedules.length, 3);
    assert.equal(schedules[0].mata_pelajaran, 'Matematika');
    assert.equal(schedules[0].jam_mulai, '07:15');
    assert.equal(schedules[0].jam_selesai, '08:45');
    assert.equal(schedules[1].mata_pelajaran, 'Fisika');
    assert.equal(schedules[1].jam_mulai, '08:45');
    assert.equal(schedules[1].jam_selesai, '09:30');
    assert.equal(schedules[2].mata_pelajaran, 'Fisika');
    assert.equal(schedules[2].jam_mulai, '09:45');
    assert.equal(schedules[2].jam_selesai, '10:30');
  });

  it('detects teacher double-booking conflicts across classes at the same day & period', () => {
    const cfg = createDefaultTimetableConfig('2026/2027', 'ganjil', '07:15');
    cfg.cells[makeTimetableCellKey('Selasa', 2, 'X IPA 1')] = {
      mata_pelajaran: 'Matematika',
      teacher_user_id: 'usr_guru',
      teacher_name: 'Siti Aminah, S.Pd',
    };
    cfg.cells[makeTimetableCellKey('Selasa', 2, 'X IPA 2')] = {
      mata_pelajaran: 'Matematika',
      teacher_user_id: 'usr_guru',
      teacher_name: 'Siti Aminah, S.Pd',
    };

    const conflicts = detectTimetableTeacherConflicts(cfg, ['X IPA 1', 'X IPA 2']);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].hari, 'Selasa');
    assert.equal(conflicts[0].jamKe, 2);
    assert.deepEqual(conflicts[0].classes, ['X IPA 1', 'X IPA 2']);
  });

  it('hydrates existing TeacherSchedules back into timetable cells accurately', () => {
    const cfg = createDefaultTimetableConfig('2026/2027', 'ganjil', '07:15');
    const existing: TeacherSchedule[] = [
      {
        id: 'sch_1',
        hari: 'Rabu',
        teacher_user_id: 'usr_guru',
        teacher_name: 'Siti Aminah, S.Pd',
        kelas: 'X IPA 2',
        mata_pelajaran: 'Biologi',
        jam_mulai: '07:15',
        jam_selesai: '08:45',
        tahun_ajaran: '2026/2027',
        semester: 'ganjil',
      },
    ];
    const hydrated = hydrateTimetableCellsFromSchedules(cfg, existing);
    assert.equal(hydrated.cells[makeTimetableCellKey('Rabu', 1, 'X IPA 2')]?.mata_pelajaran, 'Biologi');
    assert.equal(hydrated.cells[makeTimetableCellKey('Rabu', 2, 'X IPA 2')]?.mata_pelajaran, 'Biologi');
    assert.equal(hydrated.cells[makeTimetableCellKey('Rabu', 3, 'X IPA 2')], undefined);

    const sanitized = sanitizeTimetableConfigs({ '2026/2027__ganjil': hydrated });
    assert.equal(
      sanitized['2026/2027__ganjil']?.cells[makeTimetableCellKey('Rabu', 1, 'X IPA 2')]
        ?.mata_pelajaran,
      'Biologi'
    );
  });
});

describe('Bidirectional Sync: Jadwal Pelajaran Guru <-> Menu Mapel Guru', () => {
  it('auto-populates TeacherSchedules when a teacher adds a class & subject from their account', () => {
    const teacherAssignment: SubjectAssignment = {
      id: 'asg_manual_1',
      teacher_user_id: 'usr_guru',
      teacher_name: 'Siti Aminah, S.Pd',
      kelas: 'XI IPA 1',
      mata_pelajaran: 'Kimia',
      hari: 'Kamis',
      jam_mulai: '08:00',
      tahun_ajaran: '2026/2027',
      semester: 'ganjil',
      source: 'manual',
    };

    const { schedules, upsertedSchedule } = syncAssignmentToTeacherSchedules(
      [],
      teacherAssignment,
      'ganjil'
    );

    assert.ok(upsertedSchedule);
    assert.equal(schedules.length, 1);
    assert.equal(schedules[0].hari, 'Kamis');
    assert.equal(schedules[0].kelas, 'XI IPA 1');
    assert.equal(schedules[0].mata_pelajaran, 'Kimia');
    assert.equal(schedules[0].jam_mulai, '08:00');
    assert.equal(schedules[0].jam_selesai, '09:30'); // auto +90 mins when jam_selesai omitted
  });

  it('auto-populates teacher SubjectAssignments and Menu Mapel when Master Admin adds a TeacherSchedule', () => {
    const adminSchedule: TeacherSchedule = {
      id: 'sch_admin_1',
      hari: 'Selasa',
      teacher_user_id: 'usr_guru',
      teacher_name: 'Siti Aminah, S.Pd',
      kelas: 'X IPA 1',
      mata_pelajaran: 'Informatika',
      jam_mulai: '09:45',
      jam_selesai: '11:15',
      tahun_ajaran: '2026/2027',
      semester: 'ganjil',
    };

    const { assignments, upsertedAssignment } = syncScheduleToSubjectAssignments(
      [],
      adminSchedule,
      'ganjil'
    );
    assert.equal(assignments.length, 1);
    assert.equal(upsertedAssignment.mata_pelajaran, 'Informatika');
    assert.equal(upsertedAssignment.source, 'schedule');

    // Verify teacher's Presensi Mapel resolves it on any Tuesday (e.g., 2026-11-24 is Tuesday)
    const tuesdayDate = getDateForDayInSameWeek('2026-11-22', 'Selasa');
    assert.equal(getIndonesianDayOfWeek(tuesdayDate), 'Selasa');

    const resolved = resolveAssignmentsForDate({
      selectedDate: tuesdayDate,
      academicYear: '2026/2027',
      semester: 'ganjil',
      schedules: [adminSchedule],
      manualAssignments: assignments,
      records: [],
      role: 'guru',
      teacherUserId: 'usr_guru',
    });

    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].mata_pelajaran, 'Informatika');
    assert.equal(resolved[0].kelas, 'X IPA 1');
    assert.equal(resolved[0].jam_mulai, '09:45');
    assert.equal(resolved[0].jam_selesai, '11:15');
  });

  it('reconciles both directions without duplicates', () => {
    const schedules: TeacherSchedule[] = [
      {
        id: 'sch_1',
        hari: 'Senin',
        teacher_user_id: 'usr_guru',
        teacher_name: 'Siti Aminah, S.Pd',
        kelas: 'X IPA 1',
        mata_pelajaran: 'Matematika',
        jam_mulai: '07:15',
        jam_selesai: '08:45',
        tahun_ajaran: '2026/2027',
        semester: 'ganjil',
      },
    ];
    const assignments: SubjectAssignment[] = [
      {
        id: 'asg_1',
        teacher_user_id: 'usr_guru',
        teacher_name: 'Siti Aminah, S.Pd',
        kelas: 'X IPA 2',
        mata_pelajaran: 'Biologi',
        hari: 'Rabu',
        jam_mulai: '10:00',
        jam_selesai: '11:30',
        tahun_ajaran: '2026/2027',
        semester: 'ganjil',
        source: 'manual',
      },
    ];

    const res = reconcileSchedulesAndAssignments(schedules, assignments, 'ganjil');
    assert.equal(res.schedules.length, 2);
    assert.equal(res.assignments.length, 2);
    assert.equal(res.addedSchedules.length, 1);
    assert.equal(res.addedAssignments.length, 1);

    // Running again is idempotent
    const res2 = reconcileSchedulesAndAssignments(res.schedules, res.assignments, 'ganjil');
    assert.equal(res2.schedules.length, 2);
    assert.equal(res2.assignments.length, 2);
    assert.equal(res2.addedSchedules.length, 0);
    assert.equal(res2.addedAssignments.length, 0);
  });

  it('auto-syncs TimetableConfigs when schedules are added, edited, or deleted in Mapel & Jadwal', () => {
    // Existing saved timetable with custom 40-min JP duration & an incomplete draft cell
    const initial = createDefaultTimetableConfig('2026/2027', 'ganjil', '07:15');
    initial.durasi_jp_menit = 40;
    initial.cells[makeTimetableCellKey('Senin', 1, 'X IPA 1')] = {
      mata_pelajaran: 'Matematika',
      teacher_user_id: 'usr_guru',
      teacher_name: 'Siti Aminah, S.Pd',
    };
    initial.cells[makeTimetableCellKey('Jumat', 1, 'X IPA 1')] = {
      mata_pelajaran: 'Seni Budaya', // draft without teacher
    };

    const configs = { '2026/2027__ganjil': initial };

    // 1. Add a Saturday schedule + edit Monday schedule in Mapel & Jadwal
    const updatedSchedules: TeacherSchedule[] = [
      {
        id: 'sch_mon',
        hari: 'Senin',
        teacher_user_id: 'usr_guru',
        teacher_name: 'Siti Aminah, S.Pd',
        kelas: 'X IPA 1',
        mata_pelajaran: 'Fisika', // changed from Matematika -> Fisika
        jam_mulai: '07:15',
        jam_selesai: '07:55',
        tahun_ajaran: '2026/2027',
        semester: 'ganjil',
      },
      {
        id: 'sch_sat',
        hari: 'Sabtu',
        teacher_user_id: 'usr_walikelas',
        teacher_name: 'Budi Santoso, S.Pd',
        kelas: 'X IPS 1',
        mata_pelajaran: 'Ekonomi',
        jam_mulai: '07:15',
        jam_selesai: '08:35',
        tahun_ajaran: '2026/2027',
        semester: 'ganjil',
      },
    ];

    const synced = syncTimetableConfigsFromSchedules(configs, updatedSchedules, '07:15');
    const cfg = synced['2026/2027__ganjil'];
    assert.ok(cfg);
    // Preserved custom duration
    assert.equal(cfg.durasi_jp_menit, 40);
    // Auto-expanded to 6 school days because Saturday schedule was added
    assert.equal(cfg.jumlah_hari, 6);
    // Monday cell updated to Fisika
    assert.equal(cfg.cells[makeTimetableCellKey('Senin', 1, 'X IPA 1')]?.mata_pelajaran, 'Fisika');
    // Saturday 2-JP schedule hydrated & class added
    assert.ok((cfg.custom_classes ?? []).includes('X IPS 1'));
    assert.equal(cfg.cells[makeTimetableCellKey('Sabtu', 1, 'X IPS 1')]?.mata_pelajaran, 'Ekonomi');
    assert.equal(cfg.cells[makeTimetableCellKey('Sabtu', 2, 'X IPS 1')]?.mata_pelajaran, 'Ekonomi');
    // Unassigned draft cell preserved
    assert.equal(cfg.cells[makeTimetableCellKey('Jumat', 1, 'X IPA 1')]?.mata_pelajaran, 'Seni Budaya');

    // 2. Delete Monday schedule -> Monday cell cleared automatically
    const afterDelete = syncTimetableConfigsFromSchedules(synced, [updatedSchedules[1]], '07:15');
    assert.equal(
      afterDelete['2026/2027__ganjil']?.cells[makeTimetableCellKey('Senin', 1, 'X IPA 1')],
      undefined
    );
    assert.equal(
      afterDelete['2026/2027__ganjil']?.cells[makeTimetableCellKey('Sabtu', 1, 'X IPS 1')]
        ?.mata_pelajaran,
      'Ekonomi'
    );
  });

  it('cascades MasterSubject rename into TimetableConfigs and computes Jam ke range labels', () => {
    const cfg = createDefaultTimetableConfig('2026/2027', 'ganjil', '07:15');
    cfg.cells[makeTimetableCellKey('Rabu', 2, 'X IPA 1')] = {
      mata_pelajaran: 'Informatika',
      teacher_user_id: 'usr_guru',
      teacher_name: 'Siti Aminah, S.Pd',
    };

    const renamed = renameSubjectInTimetableConfigs(
      { '2026/2027__ganjil': cfg },
      'Informatika',
      'Informatika & Koding'
    );
    assert.equal(
      renamed['2026/2027__ganjil']?.cells[makeTimetableCellKey('Rabu', 2, 'X IPA 1')]
        ?.mata_pelajaran,
      'Informatika & Koding'
    );

    const rangeSingle = findSlotRangeLabelForSchedule(cfg, '07:15', '08:00');
    assert.deepEqual(rangeSingle, { startJp: 1, endJp: 1, label: 'Jam ke-1' });

    const rangeDouble = findSlotRangeLabelForSchedule(cfg, '08:00', '09:30');
    assert.deepEqual(rangeDouble, { startJp: 2, endJp: 3, label: 'Jam ke-2–3' });
  });

  it('places same-teacher morning & afternoon classes in exact chronological slots with zero false conflicts and canonicalized class names', () => {
    const baseCfg = createDefaultTimetableConfig('2026/2027', 'ganjil', '07:30');
    baseCfg.durasi_jp_menit = 35;
    baseCfg.jumlah_jp = 8; // Ends at 12:35 before auto-expansion

    const liveSchedules: TeacherSchedule[] = [
      {
        id: 'sch_morning',
        hari: 'Senin',
        teacher_user_id: 'usr_1795310911780',
        teacher_name: 'Tamtowi Yahya, S.Pd',
        kelas: 'X I.E', // typo with space + dot
        mata_pelajaran: 'Bahasa Indonesia',
        jam_mulai: '07:30',
        jam_selesai: '08:05',
        tahun_ajaran: '2026/2027',
        semester: 'ganjil',
      },
      {
        id: 'sch_afternoon',
        hari: 'Senin',
        teacher_user_id: 'usr_1795310911780',
        teacher_name: 'Tamtowi Yahya, S.Pd',
        kelas: 'XII.E', // dot instead of space
        mata_pelajaran: 'Bahasa Indonesia',
        jam_mulai: '13:25',
        jam_selesai: '14:35',
        tahun_ajaran: '2026/2027',
        semester: 'ganjil',
      },
    ];

    const canonicalClasses = ['XI E', 'XII E'];
    const hydrated = hydrateTimetableCellsFromSchedules(
      baseCfg,
      liveSchedules,
      true,
      canonicalClasses
    );

    // jumlah_jp auto-expanded beyond 8 so 13:25–14:35 is not squeezed into JP 8
    assert.ok(hydrated.jumlah_jp >= 10, `Expected jumlah_jp >= 10, got ${hydrated.jumlah_jp}`);

    // Morning class lands in JP 1 under canonical "XI E"
    assert.equal(
      hydrated.cells[makeTimetableCellKey('Senin', 1, 'XI E')]?.mata_pelajaran,
      'Bahasa Indonesia'
    );
    assert.equal(hydrated.cells[makeTimetableCellKey('Senin', 1, 'X I.E')], undefined);

    // Afternoon class lands in chronological afternoon JPs (NOT JP 1 and NOT snapped into JP 8)
    const afternoonJps = Object.keys(hydrated.cells)
      .filter((k) => k.startsWith('Senin|') && k.endsWith('|XII E'))
      .map((k) => Number(k.split('|')[1]))
      .sort((a, b) => a - b);
    assert.ok(afternoonJps.length >= 1);
    assert.ok(afternoonJps[0] >= 9, `Expected afternoon JP >= 9, got ${afternoonJps.join(',')}`);

    // Zero false conflicts!
    const conflicts = detectTimetableTeacherConflicts(hydrated, canonicalClasses);
    assert.equal(conflicts.length, 0);
  });

  it('prevents false conflicts for consecutive non-overlapping classes on a misaligned grid while still detecting true overlaps', () => {
    // Grid starts at 07:15 with 45-min JPs (JP1 07:15-08:00, JP2 08:00-08:45, JP3 08:45-09:30)
    const cfg = createDefaultTimetableConfig('2026/2027', 'ganjil', '07:15');
    const nonOverlapping: TeacherSchedule[] = [
      {
        id: 'sch_a',
        hari: 'Selasa',
        teacher_user_id: 'usr_guru',
        teacher_name: 'Siti Aminah, S.Pd',
        kelas: 'X A',
        mata_pelajaran: 'Matematika',
        jam_mulai: '07:30',
        jam_selesai: '08:15',
        tahun_ajaran: '2026/2027',
        semester: 'ganjil',
      },
      {
        id: 'sch_b',
        hari: 'Selasa',
        teacher_user_id: 'usr_guru',
        teacher_name: 'Siti Aminah, S.Pd',
        kelas: 'X B',
        mata_pelajaran: 'Matematika',
        jam_mulai: '08:15',
        jam_selesai: '09:00',
        tahun_ajaran: '2026/2027',
        semester: 'ganjil',
      },
    ];

    const hydratedOk = hydrateTimetableCellsFromSchedules(cfg, nonOverlapping, true, ['X A', 'X B']);
    assert.equal(hydratedOk.cells[makeTimetableCellKey('Selasa', 1, 'X A')]?.mata_pelajaran, 'Matematika');
    assert.equal(hydratedOk.cells[makeTimetableCellKey('Selasa', 2, 'X A')], undefined);
    assert.equal(hydratedOk.cells[makeTimetableCellKey('Selasa', 2, 'X B')]?.mata_pelajaran, 'Matematika');
    assert.equal(detectTimetableTeacherConflicts(hydratedOk, ['X A', 'X B']).length, 0);

    // True overlapping schedule (07:15-08:45 in X A AND 08:00-08:45 in X B) MUST still be detected!
    const overlapping: TeacherSchedule[] = [
      {
        ...nonOverlapping[0],
        jam_mulai: '07:15',
        jam_selesai: '08:45',
      },
      {
        ...nonOverlapping[1],
        jam_mulai: '08:00',
        jam_selesai: '08:45',
      },
    ];
    const hydratedConflict = hydrateTimetableCellsFromSchedules(cfg, overlapping, true, ['X A', 'X B']);
    const detected = detectTimetableTeacherConflicts(hydratedConflict, ['X A', 'X B']);
    assert.equal(detected.length, 1);
    assert.equal(detected[0].jamKe, 2);
  });

  it('matches student class canonically during Presensi Mapel QR scan (e.g. "XI E" student in "X I.E" schedule)', () => {
    const students: Student[] = [
      { nis: '2026999', nama: 'Rina Marlina', kelas: 'XI E', gender: 'P', no_wa_ortu: '081234' },
    ];
    const assignment: SubjectAssignment = {
      id: 'asg_xie',
      teacher_user_id: 'usr_1795310911780',
      teacher_name: 'Tamtowi Yahya, S.Pd',
      kelas: 'X I.E',
      mata_pelajaran: 'Bahasa Indonesia',
      hari: 'Senin',
      jam_mulai: '07:30',
      jam_selesai: '08:05',
      tahun_ajaran: '2026/2027',
    };

    const outcome = processSubjectQrScan({
      qrRaw: '2026999',
      assignment,
      students,
      records: [],
      tanggal: '2026-11-23',
      currentTime: '07:28:00',
    });
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.equal(outcome.student.nama, 'Rina Marlina');
      assert.equal(outcome.record.status, 'Hadir');
    }
  });

  it('auto-aligns Pengaturan Jadwal slot times to teacher-input times (07:30–08:40 -> 07:30–08:05 & 08:05–08:40) with lossless round-trip', () => {
    // Default config starts at 07:15 with 45-min JPs
    const defaultCfg = createDefaultTimetableConfig('2026/2027', 'ganjil', '07:15');
    const teacherInputSchedules: TeacherSchedule[] = [
      {
        id: 'sch_guru_1',
        hari: 'Senin',
        teacher_user_id: 'usr_guru',
        teacher_name: 'Siti Aminah, S.Pd',
        kelas: 'X IPA 1',
        mata_pelajaran: 'Matematika',
        jam_mulai: '07:30',
        jam_selesai: '08:40',
        tahun_ajaran: '2026/2027',
        semester: 'ganjil',
      },
      {
        id: 'sch_guru_2',
        hari: 'Senin',
        teacher_user_id: 'usr_walikelas',
        teacher_name: 'Budi Santoso, S.Pd',
        kelas: 'X IPA 1',
        mata_pelajaran: 'Bahasa Indonesia',
        jam_mulai: '08:40',
        jam_selesai: '09:15',
        tahun_ajaran: '2026/2027',
        semester: 'ganjil',
      },
      {
        id: 'sch_guru_3',
        hari: 'Senin',
        teacher_user_id: 'usr_guru',
        teacher_name: 'Siti Aminah, S.Pd',
        kelas: 'XI IPA 1',
        mata_pelajaran: 'Matematika',
        jam_mulai: '13:25',
        jam_selesai: '14:35',
        tahun_ajaran: '2026/2027',
        semester: 'ganjil',
      },
    ];

    const syncedMap = syncTimetableConfigsFromSchedules(
      { '2026/2027__ganjil': defaultCfg },
      teacherInputSchedules,
      '07:15',
      ['X IPA 1', 'XI IPA 1']
    );
    const alignedCfg = syncedMap['2026/2027__ganjil'];
    assert.ok(alignedCfg);
    assert.equal(alignedCfg.jam_mulai_sekolah, '07:30');
    assert.equal(alignedCfg.durasi_jp_menit, 35);

    const lessonSlots = generateDailyTimeSlots(alignedCfg).filter(
      (s): s is Extract<ReturnType<typeof generateDailyTimeSlots>[number], { kind: 'lesson' }> =>
        s.kind === 'lesson'
    );

    // Exact slot boundaries: JP1 07:30-08:05, JP2 08:05-08:40, JP3 08:40-09:15
    assert.equal(lessonSlots[0]?.jam_mulai, '07:30');
    assert.equal(lessonSlots[0]?.jam_selesai, '08:05');
    assert.equal(lessonSlots[1]?.jam_mulai, '08:05');
    assert.equal(lessonSlots[1]?.jam_selesai, '08:40');
    assert.equal(lessonSlots[2]?.jam_mulai, '08:40');
    assert.equal(lessonSlots[2]?.jam_selesai, '09:15');

    // Matematika (07:30–08:40) is placed on BOTH 07:30–08:05 (JP 1) and 08:05–08:40 (JP 2)
    assert.equal(
      alignedCfg.cells[makeTimetableCellKey('Senin', 1, 'X IPA 1')]?.mata_pelajaran,
      'Matematika'
    );
    assert.equal(
      alignedCfg.cells[makeTimetableCellKey('Senin', 2, 'X IPA 1')]?.mata_pelajaran,
      'Matematika'
    );
    // Bahasa Indonesia (08:40–09:15) is placed on 08:40–09:15 (JP 3)
    assert.equal(
      alignedCfg.cells[makeTimetableCellKey('Senin', 3, 'X IPA 1')]?.mata_pelajaran,
      'Bahasa Indonesia'
    );

    // Zero false conflicts
    assert.equal(
      detectTimetableTeacherConflicts(alignedCfg, ['X IPA 1', 'XI IPA 1']).length,
      0
    );

    // Lossless round-trip: saving Pengaturan Jadwal exports exact original teacher times!
    const exported = buildTeacherSchedulesFromTimetable(alignedCfg, ['X IPA 1', 'XI IPA 1']);
    const expMtkMorning = exported.find(
      (s) => s.kelas === 'X IPA 1' && s.mata_pelajaran === 'Matematika'
    );
    const expBind = exported.find(
      (s) => s.kelas === 'X IPA 1' && s.mata_pelajaran === 'Bahasa Indonesia'
    );
    const expMtkAfternoon = exported.find(
      (s) => s.kelas === 'XI IPA 1' && s.mata_pelajaran === 'Matematika'
    );

    assert.equal(expMtkMorning?.jam_mulai, '07:30');
    assert.equal(expMtkMorning?.jam_selesai, '08:40');
    assert.equal(expBind?.jam_mulai, '08:40');
    assert.equal(expBind?.jam_selesai, '09:15');
    assert.equal(expMtkAfternoon?.jam_mulai, '13:25');
    assert.equal(expMtkAfternoon?.jam_selesai, '14:35');

    // Jam ke range labels match identically for Daftar Pelajaran
    assert.equal(
      findSlotRangeLabelForSchedule(alignedCfg, '07:30', '08:40')?.label,
      'Jam ke-1–2'
    );
    assert.equal(
      findSlotRangeLabelForSchedule(alignedCfg, '08:40', '09:15')?.label,
      'Jam ke-3'
    );
  });

  it('honors configured 1-JP duration (35m) to place 1-JP, 2-JP (07:30–08:40), and 3-JP (07:30–09:15) lessons cleanly', () => {
    const adminCfg = createDefaultTimetableConfig('2026/2027', 'ganjil', '07:30');
    adminCfg.durasi_jp_menit = 35;
    adminCfg.bell_locked_by_admin = true;
    adminCfg.istirahat = [
      { id: 'b1', label: 'Istirahat 1', jam_mulai: '09:15', jam_selesai: '09:30' },
      { id: 'b2', label: 'Istirahat 2', jam_mulai: '11:50', jam_selesai: '12:20' },
    ];

    const schedules: TeacherSchedule[] = [
      // 2 JP (70 min): 07:30–08:40 -> Jam ke-1 (07:30–08:05) & Jam ke-2 (08:05–08:40)
      {
        id: 'sch_2jp',
        hari: 'Senin',
        teacher_user_id: 'usr_guru',
        teacher_name: 'Siti Aminah, S.Pd',
        kelas: 'X IPA 1',
        mata_pelajaran: 'Matematika',
        jam_mulai: '07:30',
        jam_selesai: '08:40',
        tahun_ajaran: '2026/2027',
        semester: 'ganjil',
      },
      // 1 JP (35 min): 08:40–09:15 -> Jam ke-3 (08:40–09:15)
      {
        id: 'sch_1jp',
        hari: 'Senin',
        teacher_user_id: 'usr_walikelas',
        teacher_name: 'Budi Santoso, S.Pd',
        kelas: 'X IPA 1',
        mata_pelajaran: 'PPKn',
        jam_mulai: '08:40',
        jam_selesai: '09:15',
        tahun_ajaran: '2026/2027',
        semester: 'ganjil',
      },
      // 3 JP (105 min): 07:30–09:15 -> Jam ke-1, Jam ke-2, & Jam ke-3
      {
        id: 'sch_3jp',
        hari: 'Selasa',
        teacher_user_id: 'usr_guru',
        teacher_name: 'Siti Aminah, S.Pd',
        kelas: 'X IPA 1',
        mata_pelajaran: 'Fisika',
        jam_mulai: '07:30',
        jam_selesai: '09:15',
        tahun_ajaran: '2026/2027',
        semester: 'ganjil',
      },
    ];

    const hydrated = hydrateTimetableCellsFromSchedules(
      adminCfg,
      schedules,
      true,
      ['X IPA 1'],
      true
    );

    assert.equal(hydrated.durasi_jp_menit, 35);
    assert.equal(hydrated.jam_mulai_sekolah, '07:30');
    assert.equal(hydrated.bell_locked_by_admin, true);

    // 2 JP Matematika -> JP 1 & JP 2 ONLY
    assert.equal(hydrated.cells[makeTimetableCellKey('Senin', 1, 'X IPA 1')]?.mata_pelajaran, 'Matematika');
    assert.equal(hydrated.cells[makeTimetableCellKey('Senin', 2, 'X IPA 1')]?.mata_pelajaran, 'Matematika');
    // 1 JP PPKn -> JP 3 ONLY
    assert.equal(hydrated.cells[makeTimetableCellKey('Senin', 3, 'X IPA 1')]?.mata_pelajaran, 'PPKn');
    assert.equal(hydrated.cells[makeTimetableCellKey('Senin', 4, 'X IPA 1')], undefined);
    // 3 JP Fisika -> JP 1, JP 2, & JP 3
    assert.equal(hydrated.cells[makeTimetableCellKey('Selasa', 1, 'X IPA 1')]?.mata_pelajaran, 'Fisika');
    assert.equal(hydrated.cells[makeTimetableCellKey('Selasa', 2, 'X IPA 1')]?.mata_pelajaran, 'Fisika');
    assert.equal(hydrated.cells[makeTimetableCellKey('Selasa', 3, 'X IPA 1')]?.mata_pelajaran, 'Fisika');
    assert.equal(hydrated.cells[makeTimetableCellKey('Selasa', 4, 'X IPA 1')], undefined);

    // Zero conflicts and exact lossless export
    assert.equal(detectTimetableTeacherConflicts(hydrated, ['X IPA 1']).length, 0);
    const exported = buildTeacherSchedulesFromTimetable(hydrated, ['X IPA 1']);
    assert.equal(exported.find((s) => s.mata_pelajaran === 'Matematika')?.jam_mulai, '07:30');
    assert.equal(exported.find((s) => s.mata_pelajaran === 'Matematika')?.jam_selesai, '08:40');
    assert.equal(exported.find((s) => s.mata_pelajaran === 'PPKn')?.jam_mulai, '08:40');
    assert.equal(exported.find((s) => s.mata_pelajaran === 'PPKn')?.jam_selesai, '09:15');
    assert.equal(exported.find((s) => s.mata_pelajaran === 'Fisika')?.jam_mulai, '07:30');
    assert.equal(exported.find((s) => s.mata_pelajaran === 'Fisika')?.jam_selesai, '09:15');
  });

  it('edits and deletes teaching schedules from Presensi Mapel (Guru/Wali Kelas) with bidirectional sync to Pengaturan Jadwal', () => {
    const initialSchedules: TeacherSchedule[] = [
      {
        id: 'sch_admin_1',
        hari: 'Senin',
        teacher_user_id: 'usr_guru',
        teacher_name: 'Siti Aminah, S.Pd',
        kelas: 'X IPA 1',
        mata_pelajaran: 'Matematika',
        jam_mulai: '07:30',
        jam_selesai: '08:40',
        tahun_ajaran: '2026/2027',
        semester: 'ganjil',
      },
      {
        id: 'sch_admin_2',
        hari: 'Senin',
        teacher_user_id: 'usr_guru',
        teacher_name: 'Siti Aminah, S.Pd',
        kelas: 'X IPA 2',
        mata_pelajaran: 'Kimia',
        jam_mulai: '08:40',
        jam_selesai: '09:15',
        tahun_ajaran: '2026/2027',
        semester: 'ganjil',
      },
    ];
    const initialAssignments: SubjectAssignment[] = [
      {
        id: 'asg_from_sch_admin_1',
        teacher_user_id: 'usr_guru',
        teacher_name: 'Siti Aminah, S.Pd',
        kelas: 'X IPA 1',
        mata_pelajaran: 'Matematika',
        hari: 'Senin',
        jam_mulai: '07:30',
        jam_selesai: '08:40',
        tahun_ajaran: '2026/2027',
        semester: 'ganjil',
        source: 'schedule',
      },
      {
        id: 'asg_from_sch_admin_2',
        teacher_user_id: 'usr_guru',
        teacher_name: 'Siti Aminah, S.Pd',
        kelas: 'X IPA 2',
        mata_pelajaran: 'Kimia',
        hari: 'Senin',
        jam_mulai: '08:40',
        jam_selesai: '09:15',
        tahun_ajaran: '2026/2027',
        semester: 'ganjil',
        source: 'schedule',
      },
    ];

    const resolvedMonday = resolveAssignmentsForDate({
      selectedDate: '2026-11-23', // Monday
      academicYear: '2026/2027',
      semester: 'ganjil',
      schedules: initialSchedules,
      manualAssignments: initialAssignments,
      records: [],
      role: 'guru',
      teacherUserId: 'usr_guru',
    });
    assert.equal(resolvedMonday.length, 2);
    const targetMtk = resolvedMonday.find((a) => a.mata_pelajaran === 'Matematika')!;
    assert.equal(targetMtk.id, 'sch_admin_1');

    // Validation: reject jam_selesai <= jam_mulai
    const badTime = updateTeachingEntryBidirectional({
      schedules: initialSchedules,
      assignments: initialAssignments,
      target: targetMtk,
      input: {
        hari: 'Senin',
        kelas: 'X IPA 1',
        mata_pelajaran: 'Matematika',
        jam_mulai: '08:40',
        jam_selesai: '08:00',
      },
      tahunAjaran: '2026/2027',
      semester: 'ganjil',
    });
    assert.equal(badTime.ok, false);

    // Validation: reject same-teacher overlap clash with Kimia (X IPA 2 08:40-09:15)
    const clashRes = updateTeachingEntryBidirectional({
      schedules: initialSchedules,
      assignments: initialAssignments,
      target: targetMtk,
      input: {
        hari: 'Senin',
        kelas: 'X IPA 1',
        mata_pelajaran: 'Matematika',
        jam_mulai: '08:40',
        jam_selesai: '09:15',
      },
      tahunAjaran: '2026/2027',
      semester: 'ganjil',
    });
    assert.equal(clashRes.ok, false);

    // Valid edit: change Matematika -> Biologi on Selasa 07:30-08:40
    const edited = updateTeachingEntryBidirectional({
      schedules: initialSchedules,
      assignments: initialAssignments,
      target: targetMtk,
      input: {
        hari: 'Selasa',
        kelas: 'X IPA 1',
        mata_pelajaran: 'Biologi',
        jam_mulai: '07:30',
        jam_selesai: '08:40',
      },
      tahunAjaran: '2026/2027',
      semester: 'ganjil',
    });
    assert.equal(edited.ok, true);
    if (!edited.ok) return;
    assert.equal(edited.updatedSchedule.id, 'sch_admin_1');
    assert.equal(edited.updatedSchedule.hari, 'Selasa');
    assert.equal(edited.updatedSchedule.mata_pelajaran, 'Biologi');
    assert.equal(edited.schedules.length, 2);
    assert.equal(edited.assignments.length, 2);

    // Sync to TimetableConfig -> Senin X IPA 1 cleared, Selasa JP1-2 filled with Biologi
    const syncedConfigs = syncTimetableConfigsFromSchedules(
      {},
      edited.schedules,
      '07:30',
      ['X IPA 1', 'X IPA 2']
    );
    const cfg = syncedConfigs['2026/2027__ganjil'];
    assert.ok(cfg);
    assert.equal(cfg.cells[makeTimetableCellKey('Senin', 1, 'X IPA 1')], undefined);
    assert.equal(cfg.cells[makeTimetableCellKey('Selasa', 1, 'X IPA 1')]?.mata_pelajaran, 'Biologi');
    assert.equal(cfg.cells[makeTimetableCellKey('Selasa', 2, 'X IPA 1')]?.mata_pelajaran, 'Biologi');
    assert.equal(detectTimetableTeacherConflicts(cfg, ['X IPA 1', 'X IPA 2']).length, 0);

    // Delete Kimia (schedule-sourced entry) from Presensi Mapel
    const targetKimia = resolvedMonday.find((a) => a.mata_pelajaran === 'Kimia')!;
    const deleted = deleteTeachingEntryBidirectional({
      schedules: edited.schedules,
      assignments: edited.assignments,
      target: targetKimia,
    });
    assert.equal(deleted.schedules.length, 1);
    assert.equal(deleted.assignments.length, 1);
    assert.deepEqual(deleted.removedScheduleIds, ['sch_admin_2']);
    assert.deepEqual(deleted.removedAssignmentIds, ['asg_from_sch_admin_2']);

    // Sync to TimetableConfig after deletion -> Kimia slot cleared cleanly
    const afterDeleteConfigs = syncTimetableConfigsFromSchedules(
      syncedConfigs,
      deleted.schedules,
      '07:30',
      ['X IPA 1', 'X IPA 2']
    );
    const cfgAfterDel = afterDeleteConfigs['2026/2027__ganjil'];
    assert.equal(cfgAfterDel.cells[makeTimetableCellKey('Senin', 3, 'X IPA 2')], undefined);
    assert.equal(cfgAfterDel.cells[makeTimetableCellKey('Selasa', 1, 'X IPA 1')]?.mata_pelajaran, 'Biologi');
    assert.notEqual(cfgAfterDel.updated_at, '');
  });

  it('does NOT bump updated_at or mutate reference on repeated background syncs with unchanged schedules', () => {
    const schedules: TeacherSchedule[] = [
      {
        id: 'sch_poll_1',
        hari: 'Senin',
        teacher_user_id: 'usr_guru',
        teacher_name: 'Siti Aminah, S.Pd',
        kelas: 'X IPA 1',
        mata_pelajaran: 'Matematika',
        jam_mulai: '07:00',
        jam_selesai: '08:20',
        tahun_ajaran: '2026/2027',
        semester: 'ganjil',
      },
    ];

    const lockedAdminCfg = {
      ...createDefaultTimetableConfig('2026/2027', 'ganjil', '07:00'),
      durasi_jp_menit: 40,
      jumlah_jp: 9,
      bell_locked_by_admin: true,
      istirahat: [
        { id: 'brk_1', label: 'Istirahat 1', jam_mulai: '09:40', jam_selesai: '10:00' },
      ],
      updated_at: '2026-11-25T07:00:00.000Z',
    };

    // First sync hydrates cells from schedules
    const afterFirstSync = syncTimetableConfigsFromSchedules(
      { '2026/2027__ganjil': lockedAdminCfg },
      schedules,
      '07:15',
      ['X IPA 1']
    );
    const firstCfg = afterFirstSync['2026/2027__ganjil'];
    assert.equal(firstCfg.jam_mulai_sekolah, '07:00');
    assert.equal(firstCfg.durasi_jp_menit, 40);
    assert.equal(firstCfg.jumlah_jp, 9);
    assert.equal(firstCfg.bell_locked_by_admin, true);
    assert.equal(firstCfg.istirahat[0]?.jam_mulai, '09:40');
    assert.equal(firstCfg.istirahat[0]?.jam_selesai, '10:00');
    assert.equal(firstCfg.cells[makeTimetableCellKey('Senin', 1, 'X IPA 1')]?.mata_pelajaran, 'Matematika');
    assert.equal(firstCfg.cells[makeTimetableCellKey('Senin', 2, 'X IPA 1')]?.mata_pelajaran, 'Matematika');

    // Second sync (simulating 10-second polling with identical remote schedules) MUST be a strict no-op!
    const afterSecondSync = syncTimetableConfigsFromSchedules(
      afterFirstSync,
      schedules,
      '07:15',
      ['X IPA 1']
    );
    assert.strictEqual(
      afterSecondSync,
      afterFirstSync,
      'Unchanged background poll must return the exact same config map reference'
    );
    assert.strictEqual(
      afterSecondSync['2026/2027__ganjil'].updated_at,
      firstCfg.updated_at,
      'Unchanged background poll must NOT bump updated_at'
    );

    // Semantic equality helper ignores updated_at but detects real time changes
    assert.equal(
      areTimetableConfigsEqual(firstCfg, { ...firstCfg, updated_at: '2026-11-25T99:00:00.000Z' }),
      true
    );
    assert.equal(
      areTimetableConfigsEqual(firstCfg, { ...firstCfg, jam_mulai_sekolah: '07:30' }),
      false
    );
  });
});




