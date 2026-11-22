import test from 'node:test';
import assert from 'node:assert/strict';
import type { AuthSession, SubjectAssignment, TeacherSchedule } from '../types';
import { createDefaultTimetableConfig } from './timetableLogic';
import {
  collectPersonalTeacherLessons,
  filterPersonalLessonsByDay,
  getAvailablePersonalScheduleDays,
  getLessonTimeState,
  resolveDayForDate,
} from './teacherScheduleFilter';

const GURU_SESSION: AuthSession = {
  userId: 'usr_guru',
  username: 'guru',
  nama: 'Siti Aminah, S.Pd',
  role: 'guru',
  jabatan: 'Guru Mata Pelajaran',
};

const WALI_SESSION: AuthSession = {
  userId: 'usr_walikelas',
  username: 'walikelas',
  nama: 'Budi Santoso, S.Pd',
  role: 'wali_kelas',
  jabatan: 'Wali Kelas X IPA 1',
  kelas_binaan: 'X IPA 1',
};

test('Personal Daftar Pelajaran (Guru & Wali Kelas)', async (t) => {
  const sampleSchedules: TeacherSchedule[] = [
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
    {
      id: 'sch_2',
      hari: 'Rabu',
      teacher_user_id: 'usr_guru',
      teacher_name: 'Siti Aminah, S.Pd',
      kelas: 'X IPA 2',
      mata_pelajaran: 'Fisika',
      jam_mulai: '08:45',
      jam_selesai: '09:30',
      tahun_ajaran: '2026/2027',
      semester: 'ganjil',
    },
    {
      id: 'sch_3',
      hari: 'Senin',
      teacher_user_id: 'usr_walikelas',
      teacher_name: 'Budi Santoso, S.Pd',
      kelas: 'X IPA 1',
      mata_pelajaran: 'Bahasa Indonesia',
      jam_mulai: '09:45',
      jam_selesai: '11:15',
      tahun_ajaran: '2026/2027',
      semester: 'ganjil',
    },
    {
      id: 'sch_4',
      hari: 'Sabtu',
      teacher_user_id: 'usr_guru',
      teacher_name: 'Siti Aminah, S.Pd',
      kelas: 'XI IPA 1',
      mata_pelajaran: 'Informatika',
      jam_mulai: '07:15',
      jam_selesai: '08:00',
      tahun_ajaran: '2026/2027',
      semester: 'ganjil',
    },
  ];

  const sampleAssignments: SubjectAssignment[] = [
    {
      id: 'asg_manual_1',
      teacher_user_id: 'usr_guru',
      teacher_name: 'Siti Aminah, S.Pd',
      kelas: 'X IPA 1',
      mata_pelajaran: 'Matematika',
      hari: 'Senin',
      jam_mulai: '07:15',
      jam_selesai: '08:45',
      tahun_ajaran: '2026/2027',
      semester: 'ganjil',
    },
    {
      id: 'asg_manual_2',
      teacher_user_id: 'usr_walikelas',
      teacher_name: 'Budi Santoso, S.Pd',
      kelas: 'X IPA 1',
      mata_pelajaran: 'PPKn',
      hari: 'Kamis',
      jam_mulai: '07:15',
      jam_selesai: '08:00',
      tahun_ajaran: '2026/2027',
      semester: 'ganjil',
    },
  ];

  await t.test('only returns schedules belonging to the logged-in Guru and attaches Jam ke labels', () => {
    const cfg = createDefaultTimetableConfig('2026/2027', 'ganjil', '07:15');
    const lessons = collectPersonalTeacherLessons({
      schedules: sampleSchedules,
      assignments: sampleAssignments,
      session: GURU_SESSION,
      tahunAjaran: '2026/2027',
      semester: 'ganjil',
      activeTimetableConfig: cfg,
    });

    assert.equal(lessons.length, 3);
    assert.ok(lessons.every((l) => l.teacher_user_id === 'usr_guru'));
    assert.equal(lessons[0].hari, 'Senin');
    assert.equal(lessons[0].mata_pelajaran, 'Matematika');
    assert.equal(lessons[0].jamKeLabel, 'Jam ke-1–2');
    assert.equal(lessons[1].hari, 'Rabu');
    assert.equal(lessons[2].hari, 'Sabtu');
  });

  await t.test('filters strictly for Wali Kelas including manual subject assignments', () => {
    const lessons = collectPersonalTeacherLessons({
      schedules: sampleSchedules,
      assignments: sampleAssignments,
      session: WALI_SESSION,
      tahunAjaran: '2026/2027',
      semester: 'ganjil',
    });

    assert.equal(lessons.length, 2);
    assert.deepEqual(
      lessons.map((l) => `${l.hari}:${l.mata_pelajaran}`),
      ['Senin:Bahasa Indonesia', 'Kamis:PPKn']
    );
  });

  await t.test('filters by accessed date day-of-week, specific day tab, or ALL', () => {
    const lessons = collectPersonalTeacherLessons({
      schedules: sampleSchedules,
      session: GURU_SESSION,
      tahunAjaran: '2026/2027',
      semester: 'ganjil',
    });

    // 2026-11-23 is Senin
    const mondayDay = resolveDayForDate('2026-11-23');
    assert.equal(mondayDay, 'Senin');
    const mondayLessons = filterPersonalLessonsByDay(lessons, mondayDay);
    assert.equal(mondayLessons.length, 1);
    assert.equal(mondayLessons[0].mata_pelajaran, 'Matematika');

    // 2026-11-22 is Minggu -> 0 lessons
    const sundayDay = resolveDayForDate('2026-11-22');
    assert.equal(sundayDay, 'Minggu');
    assert.equal(filterPersonalLessonsByDay(lessons, sundayDay).length, 0);

    // ALL returns every day
    assert.equal(filterPersonalLessonsByDay(lessons, 'ALL').length, 3);

    // Saturday schedule auto-expands available day pills to 6 days
    const days = getAvailablePersonalScheduleDays(lessons);
    assert.equal(days.length, 6);
    assert.equal(days[5], 'Sabtu');
  });

  await t.test('evaluates lesson time state (upcoming, ongoing, done) accurately', () => {
    const lesson = { jam_mulai: '08:00', jam_selesai: '09:30' };
    assert.equal(getLessonTimeState(lesson, '07:45'), 'upcoming');
    assert.equal(getLessonTimeState(lesson, '08:15'), 'ongoing');
    assert.equal(getLessonTimeState(lesson, '09:31'), 'done');
  });
});
