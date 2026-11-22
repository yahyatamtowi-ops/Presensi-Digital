import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTeacherSchedulesFromTimetable,
  createDefaultTimetableConfig,
  detectTimetableTeacherConflicts,
  generateDailyTimeSlots,
  getSchoolDaysForCount,
  hydrateTimetableCellsFromSchedules,
  makeTimetableCellKey,
  sanitizeTimetableConfigs,
} from './timetableLogic';
import {
  getDateForDayInSameWeek,
  getIndonesianDayOfWeek,
  reconcileSchedulesAndAssignments,
  resolveAssignmentsForDate,
  syncAssignmentToTeacherSchedules,
  syncScheduleToSubjectAssignments,
} from './subjectAttendance';
import type { SubjectAssignment, TeacherSchedule } from '../types';

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
});
