import test from 'node:test';
import assert from 'node:assert/strict';
import type { AttendanceRecord, Student } from '../types';
import {
  cloneStudentsToAcademicYear,
  getStudentYearKey,
  mergeStudentsPreservingArchives,
  preserveArchiveOnAcademicYearChange,
  promoteClassNameOneLevel,
  summarizeStudentsByAcademicYear,
} from './studentArchive';

const sampleStudents2026: Student[] = [
  {
    nis: '0081111001',
    nama: 'Ahmad Fauzi',
    kelas: 'X IPA 1',
    gender: 'L',
    no_wa_ortu: '081234567890',
    tahun_ajaran: '2026/2027',
  },
  {
    nis: '0081111002',
    nama: 'Siti Rahma',
    kelas: 'XI IPS 2',
    gender: 'P',
    no_wa_ortu: '081298765432',
    // Untagged legacy row
  },
  {
    nis: '0081111003',
    nama: 'Budi Santoso',
    kelas: 'XII IPA 1',
    gender: 'L',
    no_wa_ortu: '081355566677',
    tahun_ajaran: '2026/2027',
  },
];

test('preserveArchiveOnAcademicYearChange anchors untagged students & records to previousYear before switching', () => {
  const sampleRecords: AttendanceRecord[] = [
    {
      id: '2026-11-20_0081111001',
      tanggal: '2026-11-20',
      nis: '0081111001',
      nama: 'Ahmad Fauzi',
      kelas: 'X IPA 1',
      jam_masuk: '07:05:00',
      status: 'Hadir',
    },
  ];

  const res = preserveArchiveOnAcademicYearChange({
    students: sampleStudents2026,
    records: sampleRecords,
    previousYear: '2026/2027',
    nextYear: '2027/2028',
  });

  assert.equal(res.yearChanged, true);
  assert.equal(res.students.length, 3);
  assert.equal(res.stampedStudents.length, 1);
  assert.equal(res.stampedStudents[0].nis, '0081111002');
  assert.equal(res.stampedStudents[0].tahun_ajaran, '2026/2027');
  assert.ok(res.students.every((s) => s.tahun_ajaran === '2026/2027'));

  assert.equal(res.stampedRecords.length, 1);
  assert.equal(res.records[0].tahun_ajaran, '2026/2027');
});

test('mergeStudentsPreservingArchives keeps same-NISN students across different academic years intact', () => {
  const existing: Student[] = [
    {
      nis: '0081111001',
      nama: 'Ahmad Fauzi',
      kelas: 'X IPA 1',
      gender: 'L',
      no_wa_ortu: '081234567890',
      tahun_ajaran: '2026/2027',
    },
    {
      nis: '0081111002',
      nama: 'Siti Rahma',
      kelas: 'X IPA 2',
      gender: 'P',
      no_wa_ortu: '081298765432',
      tahun_ajaran: '2026/2027',
    },
  ];

  const incoming: Student[] = [
    {
      nis: '0081111001',
      nama: 'Ahmad Fauzi',
      kelas: 'XI IPA 1',
      gender: 'L',
      no_wa_ortu: '081234567890',
      tahun_ajaran: '2027/2028',
    },
  ];

  const merged = mergeStudentsPreservingArchives(existing, incoming, '2027/2028');
  assert.equal(merged.length, 3);

  const key2026 = getStudentYearKey({ nis: '0081111001', tahun_ajaran: '2026/2027' });
  const key2027 = getStudentYearKey({ nis: '0081111001', tahun_ajaran: '2027/2028' });
  assert.notEqual(key2026, key2027);

  const row2026 = merged.find((s) => s.nis === '0081111001' && s.tahun_ajaran === '2026/2027');
  const row2027 = merged.find((s) => s.nis === '0081111001' && s.tahun_ajaran === '2027/2028');
  assert.equal(row2026?.kelas, 'X IPA 1');
  assert.equal(row2027?.kelas, 'XI IPA 1');
});

test('promoteClassNameOneLevel promotes Roman and numeric Indonesian class levels and marks graduating grades null', () => {
  assert.equal(promoteClassNameOneLevel('X IPA 1'), 'XI IPA 1');
  assert.equal(promoteClassNameOneLevel('XI.D'), 'XII.D');
  assert.equal(promoteClassNameOneLevel('XII IPS 2'), null);
  assert.equal(promoteClassNameOneLevel('7A'), '7A');
  assert.equal(promoteClassNameOneLevel('7 A'), '8 A');
  assert.equal(promoteClassNameOneLevel('8-B'), '9-B');
  assert.equal(promoteClassNameOneLevel('9 B'), null);
  assert.equal(promoteClassNameOneLevel('10 TKJ 1'), '11 TKJ 1');
  assert.equal(promoteClassNameOneLevel('12 TKJ 1'), null);
});

test('cloneStudentsToAcademicYear promotes or copies students to new year while keeping archive untouched', () => {
  const anchored = preserveArchiveOnAcademicYearChange({
    students: sampleStudents2026,
    records: [],
    previousYear: '2026/2027',
    nextYear: '2027/2028',
  }).students;

  const promoted = cloneStudentsToAcademicYear({
    allStudents: anchored,
    sourceYear: '2026/2027',
    targetYear: '2027/2028',
    autoPromoteClass: true,
  });

  assert.equal(promoted.createdStudents.length, 2);
  assert.equal(promoted.graduatedCount, 1);
  assert.equal(promoted.skippedDuplicates, 0);
  assert.equal(promoted.createdStudents[0].kelas, 'XI IPA 1');
  assert.equal(promoted.createdStudents[0].tahun_ajaran, '2027/2028');
  assert.equal(promoted.createdStudents[1].kelas, 'XII IPS 2');

  // Original archive array remains 100% untouched
  assert.equal(anchored[0].kelas, 'X IPA 1');
  assert.equal(anchored[0].tahun_ajaran, '2026/2027');

  // Re-running clone after adding created students skips duplicates cleanly
  const combined = [...anchored, ...promoted.createdStudents];
  const secondRun = cloneStudentsToAcademicYear({
    allStudents: combined,
    sourceYear: '2026/2027',
    targetYear: '2027/2028',
    autoPromoteClass: true,
  });
  assert.equal(secondRun.createdStudents.length, 0);
  assert.equal(secondRun.skippedDuplicates, 2);

  // Summary reports both active 2027/2028 and archived 2026/2027 accurately
  const summaries = summarizeStudentsByAcademicYear(combined, '2027/2028');
  assert.equal(summaries.length, 2);
  assert.equal(summaries[0].tahun_ajaran, '2027/2028');
  assert.equal(summaries[0].isActive, true);
  assert.equal(summaries[0].studentCount, 2);
  assert.equal(summaries[1].tahun_ajaran, '2026/2027');
  assert.equal(summaries[1].isActive, false);
  assert.equal(summaries[1].studentCount, 3);
});
