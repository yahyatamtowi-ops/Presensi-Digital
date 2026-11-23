import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  AnalyticsPeriodType,
  TeacherSchedule,
  UserAccount,
} from '../types';
import {
  buildAttendanceComparisonExplanation,
  buildClassAttendanceExplanation,
} from './analyticsExplanation';
import type {
  ClassAnalyticsRow,
  PeriodAnalyticsOverview,
} from './attendanceLogic';
import {
  fitSingleLineText,
  getECardLayoutMetrics,
  getECardNameFontSizeClass,
} from './ecardPdf';
import {
  normalizeDayOfWeek,
  normalizeTimeHHMM,
  parseMatrixCellText,
  parseTeacherScheduleRows,
  parseTimetableMatrixRows,
  parseTimeRangeCell,
} from './scheduleImportExport';
import {
  createDefaultTimetableConfig,
  makeTimetableCellKey,
} from './timetableLogic';
import { buildLetterheadExcelSheet } from './excelLetterhead';
import {
  chunkTimetableClasses,
  getTimetablePdfColumns,
  TIMETABLE_PDF_CONFIG,
} from './timetablePdf';
import { SEED_SETTINGS } from './seedData';
import * as XLSX from 'xlsx';

const SAMPLE_TEACHERS: UserAccount[] = [
  {
    id: 'usr-guru-1',
    username: 'siti',
    password: '123',
    nama: 'Siti Aminah, S.Pd',
    role: 'guru',
    jabatan: 'Guru Matematika',
  },
  {
    id: 'usr-guru-2',
    username: 'budi',
    password: '123',
    nama: 'Budi Santoso, M.Pd',
    role: 'wali_kelas',
    jabatan: 'Wali Kelas X IPA 1',
  },
];

test('ECard layout metrics enforce exact KTP ISO/IEC 7810 ID-1 size (85.6mm x 54mm) and strict 1-line name fitter', () => {
  const metrics = getECardLayoutMetrics();
  assert.equal(metrics.cardW, 85.6);
  assert.equal(metrics.cardH, 54);
  assert.equal(metrics.principalBlockPosition, 'bottom-left');

  // Linear synthetic width measurer: ~0.55mm per char at 8.4pt
  const measure = (str: string, fontSize: number) => str.length * fontSize * 0.19;

  // Short name fits at initial font size without truncation
  const shortFit = fitSingleLineText('Ayu Lestari', 46.9, 8.4, 5.6, measure);
  assert.equal(shortFit.text, 'Ayu Lestari');
  assert.equal(shortFit.fontSize, 8.4);

  // Medium-long Indonesian name shrinks font size to stay strictly 1 line without ellipsis
  const mediumName = 'Muhammad Rizky Pratama Putra Wijaya';
  const mediumFit = fitSingleLineText(mediumName, 46.9, 8.4, 5.6, measure);
  assert.equal(mediumFit.text, mediumName);
  assert.ok(mediumFit.fontSize < 8.4 && mediumFit.fontSize >= 5.6);
  assert.ok(measure(mediumFit.text, mediumFit.fontSize) <= 46.9);

  // Extremely long name shrinks to minFontSize and truncates cleanly with ellipsis on 1 line
  const ultraLong =
    'Muhammad Fathurrahman Al-Farizi Ramadhan Hidayatullah Kusumawardhana';
  const longFit = fitSingleLineText(ultraLong, 46.9, 8.4, 5.6, measure);
  assert.equal(longFit.fontSize, 5.6);
  assert.ok(longFit.text.endsWith('…'));
  assert.ok(!longFit.text.includes('\n'));
  assert.ok(measure(longFit.text, longFit.fontSize) <= 46.9);

  // UI helper scales down for long names
  assert.equal(getECardNameFontSizeClass('Budi', 'batch'), 'text-[13px]');
  assert.equal(
    getECardNameFontSizeClass('Muhammad Fathurrahman Al-Farizi Ramadhan', 'batch'),
    'text-[8.5px] tracking-tight'
  );
  assert.equal(
    getECardNameFontSizeClass('Muhammad Fathurrahman Al-Farizi Ramadhan', 'single'),
    'text-[10.5px]'
  );
});

test('buildAttendanceComparisonExplanation and buildClassAttendanceExplanation generate clear Indonesian insights', () => {
  const makeOverview = (
    period: AnalyticsPeriodType,
    shortLabel: string,
    pct: number,
    hadir: number,
    terlambat: number,
    alpa: number
  ): PeriodAnalyticsOverview => {
    const total = hadir + terlambat + alpa;
    return {
      period,
      label: `Rekap ${shortLabel}`,
      shortLabel,
      subtitle: 'Periode aktif',
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      totalSiswa: 30,
      activeDays: 10,
      totalTercatat: total,
      hadir,
      terlambat,
      sakit: 0,
      izin: 0,
      alpa,
      belumPresensi: 0,
      kehadiranPct: pct,
      tepatWaktuPct: total > 0 ? Math.round((hadir / total) * 100) : 0,
      skorKehadiranPct: pct,
    };
  };

  const overviews: Record<AnalyticsPeriodType, PeriodAnalyticsOverview> = {
    harian: makeOverview('harian', 'Harian', 95, 19, 0, 1),
    mingguan: makeOverview('mingguan', 'Mingguan', 88, 40, 4, 6),
    bulanan: makeOverview('bulanan', 'Bulanan', 82, 74, 8, 18),
    semester: makeOverview('semester', 'Semester', 90, 170, 10, 20),
    tahunan: makeOverview('tahunan', 'Tahunan', 85, 320, 20, 60),
  };

  const comp = buildAttendanceComparisonExplanation(overviews, 'bulanan');
  assert.ok(comp.formulaNote.includes('Hadir Tepat Waktu'));
  assert.ok(comp.formulaNote.includes('Terlambat'));
  assert.ok(comp.formulaNote.includes('Izin lebih dari 7 kali dalam sebulan'));
  assert.ok(comp.formulaNote.includes('Sakit lebih dari 7 hari berturut-turut'));
  assert.ok(comp.colorLegend.includes('Sangat Baik'));
  assert.ok(comp.colorLegend.includes('Kurang Baik'));
  assert.ok(comp.dynamicSummary.includes('Bulanan'));
  assert.ok(comp.dynamicSummary.includes('82%'));
  assert.ok(comp.dynamicSummary.includes('Harian (95%)'));

  const classes: ClassAnalyticsRow[] = [
    {
      kelas: 'X IPA 1',
      totalSiswa: 30,
      totalTercatat: 100,
      hadir: 90,
      terlambat: 4,
      sakit: 2,
      izin: 2,
      alpa: 2,
      kehadiranPct: 94,
      tepatWaktuPct: 90,
      skorKehadiranPct: 93,
    },
    {
      kelas: 'XI IPS 2',
      totalSiswa: 28,
      totalTercatat: 100,
      hadir: 40,
      terlambat: 20,
      sakit: 8,
      izin: 4,
      alpa: 28,
      kehadiranPct: 60,
      tepatWaktuPct: 40,
      skorKehadiranPct: 53,
    },
  ];

  const clsExp = buildClassAttendanceExplanation(classes, overviews.bulanan);
  assert.ok(clsExp.headline.includes('Bulanan'));
  assert.ok(clsExp.legendNote.includes('H = Hadir tepat waktu'));
  assert.ok(clsExp.legendNote.includes('Izin > 7×/bulan'));
  assert.ok(clsExp.legendNote.includes('Sakit > 7 hari berturut-turut'));
  assert.ok(clsExp.dynamicSummary.includes('X IPA 1 (93%'));
  assert.ok(clsExp.dynamicSummary.includes('XI IPS 2 (53%)'));
  assert.ok(clsExp.actionNote.includes('Kurang Baik / Perlu Perhatian'));
});

test('schedule time and day normalizers handle Indonesian aliases, dot separators, and Excel numeric serial times', () => {
  assert.equal(normalizeDayOfWeek('senin'), 'Senin');
  assert.equal(normalizeDayOfWeek("Jum'at"), 'Jumat');
  assert.equal(normalizeDayOfWeek('Hari Sabtu'), 'Sabtu');
  assert.equal(normalizeDayOfWeek('Wednesday'), 'Rabu');
  assert.equal(normalizeDayOfWeek('Minggu'), null);

  assert.equal(normalizeTimeHHMM('7:15'), '07:15');
  assert.equal(normalizeTimeHHMM('08.45'), '08:45');
  assert.equal(normalizeTimeHHMM('14:30:00'), '14:30');
  // 07:15 as Excel day fraction = (7*60 + 15) / 1440 = 0.3020833333...
  assert.equal(normalizeTimeHHMM((7 * 60 + 15) / 1440), '07:15');

  const range = parseTimeRangeCell('07.15 s.d. 08.45');
  assert.deepEqual(range, { start: '07:15', end: '08:45' });

  const parsedCell = parseMatrixCellText('Matematika (Siti Aminah)', SAMPLE_TEACHERS);
  assert.ok(parsedCell);
  assert.equal(parsedCell.mata_pelajaran, 'Matematika');
  assert.equal(parsedCell.teacher_user_id, 'usr-guru-1');
  assert.equal(parsedCell.teacher_name, 'Siti Aminah, S.Pd');
  assert.equal(parsedCell.teacherMatched, true);

  assert.equal(parseMatrixCellText('ISTIRAHAT', SAMPLE_TEACHERS), null);
  assert.equal(parseMatrixCellText('-', SAMPLE_TEACHERS), null);
});

test('parseTimetableMatrixRows parses Excel matrix format, skips breaks, expands Sabtu and new classes', () => {
  const baseDraft = createDefaultTimetableConfig('2025/2026', 'ganjil');
  const rows: unknown[][] = [
    ['Hari', 'Jam ke', 'Waktu', 'X IPA 1', 'X IPA 2', 'XII IPS 1'],
    ['Senin', 1, '07:15 - 08:00', 'Matematika (Siti Aminah, S.Pd)', 'Fisika - Budi Santoso', ''],
    ['', 2, '08:00 - 08:45', 'Matematika (siti)', '-', 'Ekonomi'],
    ['Senin', 'Istirahat 1', '09:30 - 09:45', 'ISTIRAHAT', 'ISTIRAHAT', 'ISTIRAHAT'],
    ['Sabtu', 11, '14:00 - 14:45', 'Bahasa Inggris (Guru Baru)', '', ''],
  ];

  const result = parseTimetableMatrixRows(rows, SAMPLE_TEACHERS, baseDraft);
  assert.equal(result.formatDetected, 'matrix');
  assert.equal(result.errors.length, 0);
  assert.equal(result.parsedCount, 5);
  assert.equal(result.hasSaturday, true);
  assert.equal(result.maxJp, 11);
  assert.deepEqual(result.detectedClasses, ['X IPA 1', 'X IPA 2', 'XII IPS 1']);
  assert.deepEqual(result.unmatchedTeachers, ['Guru Baru']);

  assert.equal(
    result.cells[makeTimetableCellKey('Senin', 1, 'X IPA 1')]?.mata_pelajaran,
    'Matematika'
  );
  assert.equal(
    result.cells[makeTimetableCellKey('Senin', 1, 'X IPA 1')]?.teacher_user_id,
    'usr-guru-1'
  );
  // Carried-down Hari ("") inherits Senin
  assert.equal(
    result.cells[makeTimetableCellKey('Senin', 2, 'X IPA 1')]?.teacher_user_id,
    'usr-guru-1'
  );
  assert.equal(
    result.cells[makeTimetableCellKey('Senin', 2, 'XII IPS 1')]?.mata_pelajaran,
    'Ekonomi'
  );
  assert.equal(
    result.cells[makeTimetableCellKey('Senin', 1, 'X IPA 2')]?.teacher_user_id,
    'usr-guru-2'
  );
});

test('parseTimetableMatrixRows also supports flat row-list Excel format fallback', () => {
  const baseDraft = createDefaultTimetableConfig('2025/2026', 'ganjil');
  const rows: unknown[][] = [
    ['Hari', 'Jam ke', 'Kelas', 'Mata Pelajaran', 'Guru'],
    ['Selasa', '1-2', 'X IPA 1', 'Matematika', 'Siti Aminah'],
    ['Rabu', '3', 'X IPA 2', 'Fisika', 'budi'],
  ];

  const result = parseTimetableMatrixRows(rows, SAMPLE_TEACHERS, baseDraft);
  assert.equal(result.formatDetected, 'list');
  assert.equal(result.errors.length, 0);
  assert.equal(result.parsedCount, 3);
  assert.equal(
    result.cells[makeTimetableCellKey('Selasa', 1, 'X IPA 1')]?.mata_pelajaran,
    'Matematika'
  );
  assert.equal(
    result.cells[makeTimetableCellKey('Selasa', 2, 'X IPA 1')]?.teacher_user_id,
    'usr-guru-1'
  );
  assert.equal(
    result.cells[makeTimetableCellKey('Rabu', 3, 'X IPA 2')]?.teacher_user_id,
    'usr-guru-2'
  );
});

test('parseTeacherScheduleRows validates rows, resolves Waktu/Jam ke, detects duplicates and reports errors', () => {
  const activeTimetable = createDefaultTimetableConfig('2025/2026', 'ganjil');
  const existingSchedules: TeacherSchedule[] = [
    {
      id: 'sch-1',
      tahun_ajaran: '2025/2026',
      semester: 'ganjil',
      hari: 'Senin',
      teacher_user_id: 'usr-guru-1',
      teacher_name: 'Siti Aminah, S.Pd',
      kelas: 'X IPA 1',
      mata_pelajaran: 'Matematika',
      jam_mulai: '07:15',
      jam_selesai: '08:45',
    },
  ];

  const rows: Record<string, unknown>[] = [
    // Duplicate of existing schedule
    {
      Hari: 'Senin',
      'Jam Mulai': '07:15',
      'Jam Selesai': '08:45',
      Kelas: 'X IPA 1',
      'Mata Pelajaran': 'Matematika',
      Guru: 'Siti Aminah',
    },
    // Valid row using Excel numeric serial times
    {
      Hari: 'Selasa',
      'Jam Mulai': (8 * 60 + 0) / 1440,
      'Jam Selesai': (9 * 60 + 30) / 1440,
      Kelas: 'X IPA 2',
      'Mata Pelajaran': 'Matematika',
      Guru: 'siti',
      Semester: 'Ganjil',
    },
    // Valid row using Jam ke resolved from activeTimetable (JP 1-2 -> 07:15 - 08:45)
    {
      Hari: 'Rabu',
      'Jam ke': '1-2',
      Kelas: 'X IPA 1',
      Mapel: 'Fisika',
      Pengampu: 'Budi Santoso',
    },
    // Invalid row: unknown teacher
    {
      Hari: 'Kamis',
      Waktu: '07:15 - 08:45',
      Kelas: 'X IPA 1',
      Mapel: 'Kimia',
      Guru: 'Tidak Ada',
    },
    // Invalid row: jam_selesai <= jam_mulai
    {
      Hari: 'Jumat',
      'Jam Mulai': '10:00',
      'Jam Selesai': '09:00',
      Kelas: 'X IPA 1',
      Mapel: 'Biologi',
      Guru: 'siti',
    },
  ];

  const res = parseTeacherScheduleRows(rows, {
    teachingAccounts: SAMPLE_TEACHERS,
    existingSchedules,
    tahunAjaran: '2025/2026',
    defaultSemester: 'ganjil',
    activeTimetableConfig: activeTimetable,
  });

  assert.equal(res.totalRows, 5);
  assert.equal(res.duplicateCount, 1);
  assert.equal(res.validItems.length, 2);
  assert.equal(res.invalidRows.length, 2);

  assert.equal(res.validItems[0].hari, 'Selasa');
  assert.equal(res.validItems[0].jam_mulai, '08:00');
  assert.equal(res.validItems[0].jam_selesai, '09:30');
  assert.equal(res.validItems[0].teacher_user_id, 'usr-guru-1');

  assert.equal(res.validItems[1].hari, 'Rabu');
  assert.equal(res.validItems[1].jam_mulai, '07:15');
  assert.equal(res.validItems[1].jam_selesai, '08:45');
  assert.equal(res.validItems[1].teacher_user_id, 'usr-guru-2');
});

test('buildLetterheadExcelSheet renders Kop Surat, uppercase document title, metadata, merges, and signature block', () => {
  const { sheet, meta } = buildLetterheadExcelSheet({
    settings: {
      ...SEED_SETTINGS,
      nama_sekolah: 'SMA Negeri 1 Kabun',
      nama_kepala_sekolah: 'Drs. Ahmad Hidayat, M.Pd',
      nip_kepala_sekolah: '197001011995011001',
      tahun_ajaran: '2025/2026',
      semester: 'ganjil',
    },
    documentTitle: 'Rekapitulasi Presensi Siswa (Bulanan)',
    subtitleLines: ['Periode: November 2026 · Kelas: X IPA 1'],
    headers: ['No', 'NISN', 'Nama Siswa', 'Status'],
    rows: [
      [1, '2026001', 'Ahmad Fauzi', 'Hadir'],
      [2, '2026002', 'Siti Rahma', 'Terlambat'],
    ],
    includeSignature: true,
    printedDateLabel: '22 November 2026',
  });

  const aoa = XLSX.utils.sheet_to_json<Array<string | number>>(sheet, {
    header: 1,
    defval: '',
  });

  assert.equal(aoa[0][0], 'SMA NEGERI 1 KABUN');
  assert.ok(String(aoa[1][0]).includes('PRESENSI DIGITAL'));
  assert.ok(String(aoa[1][0]).includes('2025/2026'));
  assert.ok(String(aoa[2][0]).includes('═'));
  assert.equal(aoa[meta.titleRowIndex][0], 'REKAPITULASI PRESENSI SISWA (BULANAN)');
  assert.equal(aoa[meta.titleRowIndex + 1][0], 'Periode: November 2026 · Kelas: X IPA 1');
  assert.equal(aoa[meta.titleRowIndex + 2][0], 'Dicetak pada: 22 November 2026');
  assert.deepEqual(aoa[meta.headerRowIndex], ['No', 'NISN', 'Nama Siswa', 'Status']);
  assert.deepEqual(aoa[meta.dataStartRowIndex], [1, '2026001', 'Ahmad Fauzi', 'Hadir']);

  const allText = aoa.flat().map(String).join(' | ');
  assert.ok(allText.includes('Kepala Sekolah,'));
  assert.ok(allText.includes('Drs. Ahmad Hidayat, M.Pd'));
  assert.ok(allText.includes('NIP. 197001011995011001'));
  assert.ok((sheet['!merges']?.length ?? 0) >= 6);
  assert.equal(sheet['!cols']?.length, 4);
});

test('timetablePdf chunks class columns cleanly and matches exact F4 landscape contentWidth (308mm)', () => {
  assert.equal(TIMETABLE_PDF_CONFIG.widthMm, 330);
  assert.equal(TIMETABLE_PDF_CONFIG.heightMm, 215);
  assert.equal(TIMETABLE_PDF_CONFIG.contentWidth, 308);

  const chunks = chunkTimetableClasses([
    'X IPA 1',
    'X IPA 2',
    'X IPS 1',
    'XI IPA 1',
    'XI IPA 2',
    'XI IPS 1',
    'XII IPA 1',
    'XII IPA 2',
    'XII IPS 1',
  ]);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].length, 7);
  assert.equal(chunks[1].length, 2);

  for (const group of chunks) {
    const cols = getTimetablePdfColumns(group);
    assert.equal(cols.length, 3 + group.length);
    const totalWidth = cols.reduce((acc, c) => acc + c.width, 0);
    assert.ok(Math.abs(totalWidth - TIMETABLE_PDF_CONFIG.contentWidth) < 0.01);
  }
});
