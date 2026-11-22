import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import type {
  SchoolSettings,
  Student,
  SubjectAssignment,
  SubjectAttendanceRecord,
  UserAccount,
} from '../types';
import type { PeriodAnalyticsOverview, PeriodSummaryRow } from './attendanceLogic';
import { getThemeAccentRgb, loadImageAsDataUrlAndDims } from './ecardPdf';
import { RECAP_PDF_F4_CONFIG, type RecapPdfColumnSpec } from './recapPdf';
import { DEFAULT_APP_NAME, DEFAULT_SCHOOL_LOGO } from './seedData';
import {
  computeSubjectSessionSummary,
  formatIndonesianDateWithDay,
  formatSemesterLabel,
} from './subjectAttendance';

export function resolveTeacherNip(
  accounts: UserAccount[],
  teacherUserId?: string,
  teacherName?: string,
  fallbackNip?: string
): string {
  const byId = teacherUserId
    ? accounts.find((acc) => acc.id === teacherUserId)
    : undefined;
  if (byId?.nip?.trim()) return byId.nip.trim();

  const normalizedName = (teacherName || '').trim().toLowerCase();
  if (normalizedName) {
    const byName = accounts.find(
      (acc) => acc.nama.trim().toLowerCase() === normalizedName
    );
    if (byName?.nip?.trim()) return byName.nip.trim();
  }

  return (fallbackNip || '').trim();
}

export function getSubjectAttendancePdfColumns(): RecapPdfColumnSpec[] {
  // Total = 11 + 30 + 86 + 30 + 30 = 187mm (exact F4 contentWidth, without Keterangan)
  return [
    { header: 'No', width: 11, align: 'center' },
    { header: 'NISN', width: 30 },
    { header: 'Nama Siswa', width: 86 },
    { header: 'Jam Masuk', width: 30, align: 'center' },
    { header: 'Status', width: 30, align: 'center' },
  ];
}

export function getMonthlyAnalyticsPdfColumns(): RecapPdfColumnSpec[] {
  // Total = 9 + 21 + 43 + 19 + 11 + 11 + 10 + 10 + 10 + 11 + 13 + 19 = 187mm
  return [
    { header: 'No', width: 9, align: 'center' },
    { header: 'NISN', width: 21 },
    { header: 'Nama Siswa', width: 43 },
    { header: 'Kelas', width: 19 },
    { header: 'Hadir', width: 11, align: 'center' },
    { header: 'Telat', width: 11, align: 'center' },
    { header: 'Sakit', width: 10, align: 'center' },
    { header: 'Izin', width: 10, align: 'center' },
    { header: 'Alpa', width: 10, align: 'center' },
    { header: 'Total', width: 11, align: 'center' },
    { header: '% Hadir', width: 13, align: 'center' },
    { header: 'Kategori', width: 19, align: 'center' },
  ];
}

function getStatusTextColor(status: string): [number, number, number] {
  if (status === 'Hadir') return [4, 120, 87];
  if (status === 'Terlambat') return [180, 83, 9];
  if (status === 'Sakit') return [3, 105, 161];
  if (status === 'Izin') return [67, 56, 202];
  if (status === 'Alpa') return [190, 18, 60];
  return [100, 116, 139];
}

function getAnalyticsCategory(row: PeriodSummaryRow): string {
  if (row.totalTercatat === 0) return 'Belum Ada Data';
  if (row.kehadiranPct >= 90) return 'Sangat Baik';
  if (row.kehadiranPct >= 75) return 'Baik';
  return 'Perlu Perhatian';
}

function slugifyFilePart(value: string): string {
  return (value || 'data')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

/**
 * Generates a neat F4 portrait PDF table matching Daftar Kehadiran Siswa
 * for a single subject/class session (used by Guru, Wali Kelas, and Master Admin).
 */
export async function generateSubjectAttendancePdf(params: {
  assignment: SubjectAssignment;
  tanggal: string;
  classStudents: Student[];
  sessionRecords: SubjectAttendanceRecord[];
  settings: SchoolSettings;
  teacherNip?: string;
}): Promise<{ blob: Blob; filename: string }> {
  const { assignment, tanggal, classStudents, sessionRecords, settings, teacherNip } = params;
  const { widthMm: pageWidth, heightMm: pageHeight, marginX, contentWidth } =
    RECAP_PDF_F4_CONFIG;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [pageWidth, pageHeight],
  });

  const [accentR, accentG, accentB] = getThemeAccentRgb(settings.tema);
  const logoImg = await loadImageAsDataUrlAndDims(
    settings.logo_sekolah || DEFAULT_SCHOOL_LOGO
  );

  const sortedStudents = [...classStudents].sort((a, b) => a.nama.localeCompare(b.nama));
  const recByNis = new Map<string, SubjectAttendanceRecord>();
  for (const r of sessionRecords) {
    recByNis.set(r.nis.trim().toLowerCase(), r);
  }

  const summary = computeSubjectSessionSummary(sortedStudents, sessionRecords);
  const formattedDate = formatIndonesianDateWithDay(tanggal);
  const semesterLabel = formatSemesterLabel(settings.semester);
  const jamLabel = assignment.jam_mulai
    ? assignment.jam_selesai
      ? `${assignment.jam_mulai} – ${assignment.jam_selesai}`
      : `Mulai ${assignment.jam_mulai}`
    : '-';

  // Header Banner
  doc.setFillColor(accentR, accentG, accentB);
  doc.roundedRect(marginX, 12, contentWidth, 27, 2.5, 2.5, 'F');

  let textX = marginX + 5;
  let maxTextW = contentWidth - 10;
  if (logoImg) {
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(marginX + 4, 16.5, 18, 18, 2, 2, 'F');
    doc.addImage(logoImg.dataUrl, logoImg.format, marginX + 5, 17.5, 16, 16);
    textX = marginX + 26;
    maxTextW = contentWidth - 31;
  }

  doc.setTextColor(241, 245, 249);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.2);
  doc.text(
    doc.splitTextToSize(settings.nama_sekolah.toUpperCase(), maxTextW)[0] || '',
    textX,
    18.5
  );

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('DAFTAR KEHADIRAN MATA PELAJARAN', textX, 24.8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.setTextColor(241, 245, 249);
  doc.text(
    doc.splitTextToSize(
      `Tahun Ajaran ${assignment.tahun_ajaran || settings.tahun_ajaran} · Semester ${semesterLabel}`,
      maxTextW
    )[0] || '',
    textX,
    30.4
  );
  doc.text(
    doc.splitTextToSize(`Hari / Tanggal: ${formattedDate}`, maxTextW)[0] || '',
    textX,
    34.8
  );

  // Subject Metadata Box
  let y = 43;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.25);
  doc.roundedRect(marginX, y, contentWidth, 16, 2, 2, 'FD');

  const metaLeftX = marginX + 4;
  const metaRightX = marginX + contentWidth / 2 + 4;
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.setFont('helvetica', 'normal');
  doc.text('Mata Pelajaran', metaLeftX, y + 5.6);
  doc.text('Kelas', metaLeftX, y + 11.8);
  doc.text('Guru Pengampu', metaRightX, y + 5.6);
  doc.text('Jam Pelajaran', metaRightX, y + 11.8);

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.text(
    `: ${doc.splitTextToSize(assignment.mata_pelajaran, 62)[0] || assignment.mata_pelajaran}`,
    metaLeftX + 24,
    y + 5.6
  );
  doc.text(`: ${assignment.kelas}`, metaLeftX + 24, y + 11.8);
  doc.text(
    `: ${doc.splitTextToSize(assignment.teacher_name, 58)[0] || assignment.teacher_name}`,
    metaRightX + 24,
    y + 5.6
  );
  doc.text(`: ${jamLabel}`, metaRightX + 24, y + 11.8);

  // KPI Summary Strip
  y += 20;
  const kpiItems = [
    { label: 'Total Siswa', value: String(summary.totalStudents), color: [15, 23, 42] as [number, number, number] },
    { label: 'Hadir', value: String(summary.hadir), color: [4, 120, 87] as [number, number, number] },
    { label: 'Terlambat', value: String(summary.terlambat), color: [180, 83, 9] as [number, number, number] },
    { label: 'Sakit / Izin / Alpa', value: `${summary.sakit}/${summary.izin}/${summary.alpa}`, color: [190, 18, 60] as [number, number, number] },
    { label: 'Belum Presensi', value: String(summary.belumPresensi), color: [100, 116, 139] as [number, number, number] },
    { label: '% Kehadiran', value: `${summary.persentaseHadir}%`, color: [accentR, accentG, accentB] as [number, number, number] },
  ];
  const kpiGap = 2.4;
  const kpiW = (contentWidth - kpiGap * (kpiItems.length - 1)) / kpiItems.length;
  kpiItems.forEach((item, idx) => {
    const x = marginX + idx * (kpiW + kpiGap);
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(x, y, kpiW, 13, 1.5, 1.5, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(item.label, x + kpiW / 2, y + 4.4, { align: 'center' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(item.color[0], item.color[1], item.color[2]);
    doc.text(item.value, x + kpiW / 2, y + 10.4, { align: 'center' });
  });

  // Table matching Daftar Kehadiran Siswa
  y += 17.5;
  const cols = getSubjectAttendancePdfColumns();
  const headerH = 8;
  const rowH = 7.2;
  const footerGuardY = pageHeight - 16;

  function drawTableHeader(startY: number) {
    doc.setFillColor(accentR, accentG, accentB);
    doc.rect(marginX, startY, contentWidth, headerH, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.6);
    let colX = marginX;
    for (const col of cols) {
      const textPosX =
        col.align === 'center'
          ? colX + col.width / 2
          : col.align === 'right'
            ? colX + col.width - 2
            : colX + 2.2;
      doc.text(col.header, textPosX, startY + 5.2, {
        align: col.align || 'left',
      });
      colX += col.width;
    }
  }

  drawTableHeader(y);
  y += headerH;

  if (sortedStudents.length === 0) {
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.rect(marginX, y, contentWidth, 12, 'FD');
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8.2);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `Belum ada data siswa terdaftar di kelas ${assignment.kelas}.`,
      marginX + contentWidth / 2,
      y + 7.5,
      { align: 'center' }
    );
    y += 12;
  } else {
    sortedStudents.forEach((student, idx) => {
      if (y + rowH > footerGuardY) {
        doc.addPage([pageWidth, pageHeight], 'portrait');
        y = 14;
        drawTableHeader(y);
        y += headerH;
      }

      const rec = recByNis.get(student.nis.trim().toLowerCase());
      const statusText = rec ? rec.status : 'Belum Presensi';
      const jamMasukText = rec?.jam_masuk || '-';

      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(marginX, y, contentWidth, rowH, 'F');
      }
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.18);
      doc.rect(marginX, y, contentWidth, rowH, 'S');

      const cells = [
        String(idx + 1),
        student.nis,
        student.nama,
        jamMasukText,
        statusText,
      ];

      let colX = marginX;
      cols.forEach((col, cIdx) => {
        const val = cells[cIdx];
        doc.setFont('helvetica', cIdx === 4 ? 'bold' : 'normal');
        doc.setFontSize(7.6);
        if (cIdx === 4) {
          const [r, g, b] = getStatusTextColor(statusText);
          doc.setTextColor(r, g, b);
        } else if (cIdx === 0) {
          doc.setTextColor(71, 85, 105);
        } else {
          doc.setTextColor(15, 23, 42);
        }
        const clipped = doc.splitTextToSize(val, col.width - 3.2)[0] || val;
        const posX =
          col.align === 'center'
            ? colX + col.width / 2
            : col.align === 'right'
              ? colX + col.width - 1.8
              : colX + 2.2;
        doc.text(clipped, posX, y + 4.8, { align: col.align || 'left' });
        colX += col.width;
      });

      y += rowH;
    });
  }

  // Signature block (Kepala Sekolah + NIP on left, Guru Mata Pelajaran + NIP on right)
  const sigBlockH = 42;
  if (y + sigBlockH + 8 > pageHeight - 12) {
    doc.addPage([pageWidth, pageHeight], 'portrait');
    y = 18;
  } else {
    y += 10;
  }

  const leftSigX = marginX + 38;
  const rightSigX = marginX + contentWidth - 42;

  if (settings.nama_kepala_sekolah?.trim()) {
    const kepsekNama = settings.nama_kepala_sekolah.trim();
    const kepsekNip = (settings.nip_kepala_sekolah || '').trim();
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.2);
    doc.setTextColor(51, 65, 85);
    doc.text('Mengetahui,', leftSigX, y, { align: 'center' });
    doc.text('Kepala Sekolah', leftSigX, y + 4.5, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.6);
    doc.setTextColor(15, 23, 42);
    doc.text(kepsekNama, leftSigX, y + 24, { align: 'center' });
    const kepsekW = Math.min(62, doc.getTextWidth(kepsekNama));
    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.22);
    doc.line(leftSigX - kepsekW / 2, y + 25.1, leftSigX + kepsekW / 2, y + 25.1);

    if (kepsekNip) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.8);
      doc.setTextColor(51, 65, 85);
      doc.text(`NIP. ${kepsekNip}`, leftSigX, y + 29.2, { align: 'center' });
    }
  }

  const guruNama = (assignment.teacher_name || 'Guru Pengampu').trim();
  const cleanTeacherNip = (teacherNip || '').trim();
  const displayGuruNip = cleanTeacherNip ? `NIP. ${cleanTeacherNip}` : 'NIP. -';

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.2);
  doc.setTextColor(51, 65, 85);
  doc.text(formattedDate, rightSigX, y, { align: 'center' });
  doc.text(`Guru Mata Pelajaran ${assignment.mata_pelajaran}`, rightSigX, y + 4.5, {
    align: 'center',
  });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.6);
  doc.setTextColor(15, 23, 42);
  doc.text(guruNama, rightSigX, y + 24, {
    align: 'center',
  });
  const guruNameW = Math.min(64, doc.getTextWidth(guruNama));
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.22);
  doc.line(rightSigX - guruNameW / 2, y + 25.1, rightSigX + guruNameW / 2, y + 25.1);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.setTextColor(51, 65, 85);
  doc.text(displayGuruNip, rightSigX, y + 29.2, { align: 'center' });

  // Page footers
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `${DEFAULT_APP_NAME} · ${settings.nama_sekolah} · ${assignment.mata_pelajaran} (${assignment.kelas})`,
      marginX,
      pageHeight - 8
    );
    doc.text(
      `Halaman ${p} / ${totalPages}`,
      pageWidth - marginX,
      pageHeight - 8,
      { align: 'right' }
    );
  }

  const filename = `Presensi_Mapel_${slugifyFilePart(assignment.mata_pelajaran)}_${slugifyFilePart(
    assignment.kelas
  )}_${tanggal}.pdf`;

  return {
    blob: doc.output('blob'),
    filename,
  };
}

/**
 * Generates an F4 portrait PDF for Analisis Kehadiran Seluruh Siswa · Bulanan
 */
export async function generateMonthlyAnalyticsPdf(params: {
  settings: SchoolSettings;
  monthLabel: string;
  monthKey: string;
  academicYearLabel: string;
  classLabel: string;
  overview: PeriodAnalyticsOverview;
  rows: PeriodSummaryRow[];
}): Promise<{ blob: Blob; filename: string }> {
  const {
    settings,
    monthLabel,
    monthKey,
    academicYearLabel,
    classLabel,
    overview,
    rows,
  } = params;
  const { widthMm: pageWidth, heightMm: pageHeight, marginX, contentWidth } =
    RECAP_PDF_F4_CONFIG;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [pageWidth, pageHeight],
  });

  const [accentR, accentG, accentB] = getThemeAccentRgb(settings.tema);
  const logoImg = await loadImageAsDataUrlAndDims(
    settings.logo_sekolah || DEFAULT_SCHOOL_LOGO
  );
  const semesterLabel = formatSemesterLabel(settings.semester);

  // Header Banner
  doc.setFillColor(accentR, accentG, accentB);
  doc.roundedRect(marginX, 12, contentWidth, 27, 2.5, 2.5, 'F');

  let textX = marginX + 5;
  let maxTextW = contentWidth - 10;
  if (logoImg) {
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(marginX + 4, 16.5, 18, 18, 2, 2, 'F');
    doc.addImage(logoImg.dataUrl, logoImg.format, marginX + 5, 17.5, 16, 16);
    textX = marginX + 26;
    maxTextW = contentWidth - 31;
  }

  doc.setTextColor(241, 245, 249);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.2);
  doc.text(
    doc.splitTextToSize(settings.nama_sekolah.toUpperCase(), maxTextW)[0] || '',
    textX,
    18.5
  );

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.6);
  doc.text('ANALISIS KEHADIRAN SELURUH SISWA · BULANAN', textX, 24.8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.setTextColor(241, 245, 249);
  doc.text(
    doc.splitTextToSize(
      `Periode: ${monthLabel}   ·   Kelas: ${classLabel}`,
      maxTextW
    )[0] || '',
    textX,
    30.4
  );
  doc.text(
    doc.splitTextToSize(
      `Tahun Ajaran: ${academicYearLabel} · Semester ${semesterLabel} · Hari Aktif: ${overview.activeDays} hari`,
      maxTextW
    )[0] || '',
    textX,
    34.8
  );

  // KPI Strip
  let y = 43;
  const kpis = [
    { label: 'Total Siswa', value: String(rows.length), color: [15, 23, 42] as [number, number, number] },
    { label: 'Rata-rata Hadir', value: `${overview.kehadiranPct}%`, color: [accentR, accentG, accentB] as [number, number, number] },
    { label: 'Hadir', value: String(overview.hadir), color: [4, 120, 87] as [number, number, number] },
    { label: 'Terlambat', value: String(overview.terlambat), color: [180, 83, 9] as [number, number, number] },
    { label: 'Sakit / Izin', value: `${overview.sakit} / ${overview.izin}`, color: [3, 105, 161] as [number, number, number] },
    { label: 'Alpa', value: String(overview.alpa), color: [190, 18, 60] as [number, number, number] },
  ];
  const kpiGap = 2.4;
  const kpiW = (contentWidth - kpiGap * (kpis.length - 1)) / kpis.length;
  kpis.forEach((item, idx) => {
    const x = marginX + idx * (kpiW + kpiGap);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(x, y, kpiW, 13.5, 1.5, 1.5, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(item.label, x + kpiW / 2, y + 4.5, { align: 'center' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(item.color[0], item.color[1], item.color[2]);
    doc.text(item.value, x + kpiW / 2, y + 10.6, { align: 'center' });
  });

  // Table
  y += 18;
  const cols = getMonthlyAnalyticsPdfColumns();
  const headerH = 8;
  const rowH = 7;
  const footerGuardY = pageHeight - 16;

  function drawTableHeader(startY: number) {
    doc.setFillColor(accentR, accentG, accentB);
    doc.rect(marginX, startY, contentWidth, headerH, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    let colX = marginX;
    for (const col of cols) {
      const posX =
        col.align === 'center'
          ? colX + col.width / 2
          : colX + 1.8;
      doc.text(col.header, posX, startY + 5.2, { align: col.align || 'left' });
      colX += col.width;
    }
  }

  drawTableHeader(y);
  y += headerH;

  if (rows.length === 0) {
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.rect(marginX, y, contentWidth, 12, 'FD');
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      'Tidak ada data siswa pada filter analisis bulanan ini.',
      marginX + contentWidth / 2,
      y + 7.5,
      { align: 'center' }
    );
    y += 12;
  } else {
    rows.forEach((row, idx) => {
      if (y + rowH > footerGuardY) {
        doc.addPage([pageWidth, pageHeight], 'portrait');
        y = 14;
        drawTableHeader(y);
        y += headerH;
      }

      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(marginX, y, contentWidth, rowH, 'F');
      }
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.18);
      doc.rect(marginX, y, contentWidth, rowH, 'S');

      const category = getAnalyticsCategory(row);
      const cells = [
        String(idx + 1),
        row.nis,
        row.nama,
        row.kelas,
        String(row.hadir),
        String(row.terlambat),
        String(row.sakit),
        String(row.izin),
        String(row.alpa),
        String(row.totalTercatat),
        `${row.kehadiranPct}%`,
        category,
      ];

      let colX = marginX;
      cols.forEach((col, cIdx) => {
        const val = cells[cIdx];
        doc.setFont('helvetica', cIdx === 10 || cIdx === 11 ? 'bold' : 'normal');
        doc.setFontSize(6.9);
        if (cIdx === 11) {
          if (category === 'Sangat Baik') doc.setTextColor(4, 120, 87);
          else if (category === 'Baik') doc.setTextColor(3, 105, 161);
          else if (category === 'Perlu Perhatian') doc.setTextColor(190, 18, 60);
          else doc.setTextColor(100, 116, 139);
        } else if (cIdx === 8 && row.alpa > 0) {
          doc.setTextColor(190, 18, 60);
        } else {
          doc.setTextColor(15, 23, 42);
        }
        const clipped = doc.splitTextToSize(val, col.width - 2.4)[0] || val;
        const posX =
          col.align === 'center' ? colX + col.width / 2 : colX + 1.8;
        doc.text(clipped, posX, y + 4.7, { align: col.align || 'left' });
        colX += col.width;
      });
      y += rowH;
    });
  }

  // Principal Signature + NIP if configured
  if (settings.nama_kepala_sekolah?.trim()) {
    if (y + 38 > pageHeight - 12) {
      doc.addPage([pageWidth, pageHeight], 'portrait');
      y = 18;
    } else {
      y += 10;
    }
    const rightSigX = marginX + contentWidth - 40;
    const kepsekNama = settings.nama_kepala_sekolah.trim();
    const kepsekNip = (settings.nip_kepala_sekolah || '').trim();
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(51, 65, 85);
    doc.text('Mengetahui,', rightSigX, y, { align: 'center' });
    doc.text('Kepala Sekolah', rightSigX, y + 4.5, { align: 'center' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text(kepsekNama, rightSigX, y + 23, {
      align: 'center',
    });
    const kepsekW = Math.min(62, doc.getTextWidth(kepsekNama));
    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.22);
    doc.line(rightSigX - kepsekW / 2, y + 24.1, rightSigX + kepsekW / 2, y + 24.1);
    if (kepsekNip) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.6);
      doc.setTextColor(51, 65, 85);
      doc.text(`NIP. ${kepsekNip}`, rightSigX, y + 28.2, { align: 'center' });
    }
  }

  // Footers
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `${DEFAULT_APP_NAME} · Analisis Bulanan ${monthLabel} · ${settings.nama_sekolah}`,
      marginX,
      pageHeight - 8
    );
    doc.text(`Halaman ${p} / ${totalPages}`, pageWidth - marginX, pageHeight - 8, {
      align: 'right',
    });
  }

  const filename = `Analisis_Kehadiran_Bulanan_${slugifyFilePart(monthKey)}_${slugifyFilePart(
    classLabel
  )}.pdf`;

  return {
    blob: doc.output('blob'),
    filename,
  };
}

export function exportMonthlyAnalyticsExcel(params: {
  monthKey: string;
  classLabel: string;
  rows: PeriodSummaryRow[];
}): void {
  const sheetRows = params.rows.map((r, idx) => ({
    No: idx + 1,
    NISN: r.nis,
    'Nama Siswa': r.nama,
    Kelas: r.kelas,
    Hadir: r.hadir,
    Terlambat: r.terlambat,
    Sakit: r.sakit,
    Izin: r.izin,
    Alpa: r.alpa,
    Total: r.totalTercatat,
    '% Kehadiran': `${r.kehadiranPct}%`,
    Kategori: getAnalyticsCategory(r),
  }));

  const ws = XLSX.utils.json_to_sheet(sheetRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Analisis_Bulanan');
  XLSX.writeFile(
    wb,
    `Analisis_Kehadiran_Bulanan_${slugifyFilePart(params.monthKey)}_${slugifyFilePart(
      params.classLabel
    )}.xlsx`
  );
}
