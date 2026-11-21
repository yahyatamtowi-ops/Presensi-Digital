import { jsPDF } from 'jspdf';
import type { RecapPeriodType, SchoolSettings } from '../types';
import type { DailyRecapRow, PeriodSummaryRow } from './attendanceLogic';
import { getThemeAccentRgb, loadImageAsDataUrlAndDims } from './ecardPdf';

export const RECAP_PDF_F4_CONFIG = {
  orientation: 'portrait' as const,
  widthMm: 215,
  heightMm: 330,
  marginX: 14,
  contentWidth: 187, // 215 - (14 * 2)
};

export interface RecapPdfColumnSpec {
  header: string;
  width: number;
  align?: 'left' | 'center' | 'right';
}

export function getRecapPdfColumns(
  period: RecapPeriodType,
  showCheckoutColumn: boolean
): RecapPdfColumnSpec[] {
  if (period === 'harian') {
    if (showCheckoutColumn) {
      // Total = 10 + 25 + 62 + 26 + 21 + 21 + 22 = 187mm
      return [
        { header: 'No', width: 10, align: 'center' },
        { header: 'NIS', width: 25 },
        { header: 'Nama Siswa', width: 62 },
        { header: 'Kelas', width: 26 },
        { header: 'Masuk', width: 21, align: 'center' },
        { header: 'Pulang', width: 21, align: 'center' },
        { header: 'Status', width: 22, align: 'center' },
      ];
    }
    // Total = 11 + 28 + 72 + 28 + 24 + 24 = 187mm
    return [
      { header: 'No', width: 11, align: 'center' },
      { header: 'NIS', width: 28 },
      { header: 'Nama Siswa', width: 72 },
      { header: 'Kelas', width: 28 },
      { header: 'Jam Masuk', width: 24, align: 'center' },
      { header: 'Status', width: 24, align: 'center' },
    ];
  }

  // Period summary (Mingguan / Bulanan / Semester)
  // Total = 9 + 22 + 52 + 21 + 12 + 12 + 11 + 11 + 11 + 12 + 14 = 187mm
  return [
    { header: 'No', width: 9, align: 'center' },
    { header: 'NIS', width: 22 },
    { header: 'Nama Siswa', width: 52 },
    { header: 'Kelas', width: 21 },
    { header: 'Hadir', width: 12, align: 'center' },
    { header: 'Telat', width: 12, align: 'center' },
    { header: 'Sakit', width: 11, align: 'center' },
    { header: 'Izin', width: 11, align: 'center' },
    { header: 'Alpa', width: 11, align: 'center' },
    { header: 'Total', width: 12, align: 'center' },
    { header: '% Hadir', width: 14, align: 'center' },
  ];
}

interface RecapPdfParams {
  period: RecapPeriodType;
  periodTitle: string;
  periodSubtitle: string;
  academicYearLabel: string;
  classLabel: string;
  settings: SchoolSettings;
  dailyRows?: DailyRecapRow[];
  periodRows?: PeriodSummaryRow[];
  showCheckoutColumn?: boolean;
  waliKelasNama?: string;
  waliKelasNip?: string;
  waliKelasLabel?: string;
}

export async function generateRecapPdf(
  params: RecapPdfParams
): Promise<{ blob: Blob; filename: string }> {
  const {
    period,
    periodTitle,
    periodSubtitle,
    academicYearLabel,
    classLabel,
    settings,
    dailyRows = [],
    periodRows = [],
    showCheckoutColumn = false,
    waliKelasNama,
    waliKelasNip,
    waliKelasLabel,
  } = params;

  const { widthMm: pageWidth, heightMm: pageHeight, marginX, contentWidth } =
    RECAP_PDF_F4_CONFIG;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [pageWidth, pageHeight],
  });

  const [accentR, accentG, accentB] = getThemeAccentRgb(settings.tema);

  const logoImg = settings.logo_sekolah
    ? await loadImageAsDataUrlAndDims(settings.logo_sekolah)
    : null;

  function drawHeader() {
    doc.setFillColor(accentR, accentG, accentB);
    doc.roundedRect(marginX, 12, contentWidth, 26, 2.5, 2.5, 'F');

    let textX = marginX + 5;
    let maxTextW = contentWidth - 10;
    if (logoImg) {
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(marginX + 4, 16, 18, 18, 2, 2, 'F');
      doc.addImage(logoImg.dataUrl, logoImg.format, marginX + 5, 17, 16, 16);
      textX = marginX + 26;
      maxTextW = contentWidth - 31;
    }

    doc.setTextColor(241, 245, 249);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    const schoolTitle = doc.splitTextToSize(settings.nama_sekolah.toUpperCase(), maxTextW)[0] || '';
    doc.text(schoolTitle, textX, 18.5);

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12.2);
    const mainTitle = doc.splitTextToSize(periodTitle.toUpperCase(), maxTextW)[0] || '';
    doc.text(mainTitle, textX, 24.8);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.8);
    doc.setTextColor(241, 245, 249);
    const metaLine1 = `Periode: ${periodSubtitle}`;
    const metaLine2 = `Kelas: ${classLabel}   ·   Tahun Ajaran: ${academicYearLabel}`;
    const combinedMeta = `${metaLine1}   ·   ${metaLine2}`;
    if (doc.getTextWidth(combinedMeta) <= maxTextW) {
      doc.text(combinedMeta, textX, 31.2);
    } else {
      doc.text(doc.splitTextToSize(metaLine1, maxTextW)[0] || metaLine1, textX, 30.2);
      doc.text(doc.splitTextToSize(metaLine2, maxTextW)[0] || metaLine2, textX, 34.4);
    }
  }

  drawHeader();

  // Summary counters
  let totalHadir = 0;
  let totalTerlambat = 0;
  let totalSakit = 0;
  let totalIzin = 0;
  let totalAlpa = 0;
  let totalBelum = 0;

  if (period === 'harian') {
    for (const r of dailyRows) {
      if (r.status === 'Hadir') totalHadir++;
      else if (r.status === 'Terlambat') totalTerlambat++;
      else if (r.status === 'Sakit') totalSakit++;
      else if (r.status === 'Izin') totalIzin++;
      else if (r.status === 'Alpa') totalAlpa++;
      else totalBelum++;
    }
  } else {
    for (const r of periodRows) {
      totalHadir += r.hadir;
      totalTerlambat += r.terlambat;
      totalSakit += r.sakit;
      totalIzin += r.izin;
      totalAlpa += r.alpa;
    }
  }

  // Proportional KPI summary boxes spanning full 187mm width
  let cursorY = 42;
  const kpiItems: Array<{ label: string; value: number; rgb: [number, number, number] }> =
    period === 'harian'
      ? [
          { label: 'Total Siswa', value: dailyRows.length, rgb: [15, 23, 42] },
          { label: 'Hadir', value: totalHadir, rgb: [5, 150, 105] },
          { label: 'Terlambat', value: totalTerlambat, rgb: [217, 119, 6] },
          { label: 'Sakit', value: totalSakit, rgb: [2, 132, 199] },
          { label: 'Izin', value: totalIzin, rgb: [2, 132, 199] },
          { label: 'Alpa', value: totalAlpa, rgb: [225, 29, 72] },
          { label: 'Belum Absen', value: totalBelum, rgb: [100, 116, 139] },
        ]
      : [
          { label: 'Total Siswa', value: periodRows.length, rgb: [15, 23, 42] },
          { label: 'Total Hadir', value: totalHadir, rgb: [5, 150, 105] },
          { label: 'Terlambat', value: totalTerlambat, rgb: [217, 119, 6] },
          { label: 'Total Sakit', value: totalSakit, rgb: [2, 132, 199] },
          { label: 'Total Izin', value: totalIzin, rgb: [2, 132, 199] },
          { label: 'Total Alpa', value: totalAlpa, rgb: [225, 29, 72] },
        ];

  const kpiBoxH = 14;
  const kpiGap = 2;
  const kpiCellW = (contentWidth - kpiGap * (kpiItems.length - 1)) / kpiItems.length;

  kpiItems.forEach((item, idx) => {
    const bx = marginX + idx * (kpiCellW + kpiGap);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.25);
    doc.roundedRect(bx, cursorY, kpiCellW, kpiBoxH, 1.5, 1.5, 'FD');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.6);
    doc.setTextColor(100, 116, 139);
    doc.text(item.label, bx + kpiCellW / 2, cursorY + 4.8, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(item.rgb[0], item.rgb[1], item.rgb[2]);
    doc.text(String(item.value), bx + kpiCellW / 2, cursorY + 11.2, { align: 'center' });
  });

  cursorY += kpiBoxH + 5;

  const columns = getRecapPdfColumns(period, showCheckoutColumn);
  const headerH = 8.2;
  const rowH = 7.2;

  function drawTableHeader(y: number) {
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.25);
    doc.rect(marginX, y, contentWidth, headerH, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.6);
    doc.setTextColor(51, 65, 85);

    let x = marginX;
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      if (i > 0) {
        doc.setDrawColor(203, 213, 225);
        doc.line(x, y, x, y + headerH);
      }
      const tx =
        col.align === 'center'
          ? x + col.width / 2
          : col.align === 'right'
            ? x + col.width - 2
            : x + 2;
      doc.text(col.header, tx, y + 5.4, {
        align: col.align === 'center' ? 'center' : col.align === 'right' ? 'right' : 'left',
      });
      x += col.width;
    }
  }

  drawTableHeader(cursorY);
  cursorY += headerH;

  const dataRows: string[][] =
    period === 'harian'
      ? dailyRows.map((r, i) =>
          showCheckoutColumn
            ? [
                String(i + 1),
                r.nis,
                r.nama,
                r.kelas,
                r.jam_masuk,
                r.jam_pulang || '-',
                r.status,
              ]
            : [
                String(i + 1),
                r.nis,
                r.nama,
                r.kelas,
                r.jam_masuk,
                r.status,
              ]
        )
      : periodRows.map((r, i) => [
          String(i + 1),
          r.nis,
          r.nama,
          r.kelas,
          String(r.hadir),
          String(r.terlambat),
          String(r.sakit),
          String(r.izin),
          String(r.alpa),
          String(r.totalTercatat),
          `${r.kehadiranPct}%`,
        ]);

  const statusColIndex =
    period === 'harian' ? (showCheckoutColumn ? 6 : 5) : -1;

  for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
    if (cursorY + rowH > pageHeight - 18) {
      doc.addPage([pageWidth, pageHeight], 'portrait');
      drawHeader();
      cursorY = 42;
      drawTableHeader(cursorY);
      cursorY += headerH;
    }

    const rowValues = dataRows[rowIdx];
    if (rowIdx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
    } else {
      doc.setFillColor(255, 255, 255);
    }
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    doc.rect(marginX, cursorY, contentWidth, rowH, 'FD');

    let x = marginX;
    for (let c = 0; c < columns.length; c++) {
      const col = columns[c];
      if (c > 0) {
        doc.setDrawColor(226, 232, 240);
        doc.line(x, cursorY, x, cursorY + rowH);
      }

      const rawVal = rowValues[c] ?? '';
      doc.setFont('helvetica', c === statusColIndex ? 'bold' : 'normal');
      doc.setFontSize(7.6);

      if (c === statusColIndex) {
        if (rawVal === 'Hadir') doc.setTextColor(5, 150, 105);
        else if (rawVal === 'Terlambat') doc.setTextColor(217, 119, 6);
        else if (rawVal === 'Alpa') doc.setTextColor(225, 29, 72);
        else if (rawVal === 'Sakit' || rawVal === 'Izin') doc.setTextColor(2, 132, 199);
        else doc.setTextColor(100, 116, 139);
      } else {
        doc.setTextColor(15, 23, 42);
      }

      const clipped = doc.splitTextToSize(rawVal, Math.max(4, col.width - 3.2))[0] || rawVal;
      const tx =
        col.align === 'center'
          ? x + col.width / 2
          : col.align === 'right'
            ? x + col.width - 2
            : x + 2;
      doc.text(clipped, tx, cursorY + 4.8, {
        align: col.align === 'center' ? 'center' : col.align === 'right' ? 'right' : 'left',
      });
      x += col.width;
    }

    cursorY += rowH;
  }

  // Signature block: Mengetahui, Wali Kelas + NIP
  const sigBlockHeight = 46;
  if (cursorY + sigBlockHeight > pageHeight - 16) {
    doc.addPage([pageWidth, pageHeight], 'portrait');
    drawHeader();
    cursorY = 44;
  } else {
    cursorY += 10;
  }

  const formattedDate = new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());

  const sigWidth = 68;
  const sigX = pageWidth - marginX - sigWidth;
  const roleLine = waliKelasLabel
    ? `Wali Kelas ${waliKelasLabel}`
    : classLabel && classLabel !== 'Semua Kelas'
      ? `Wali Kelas ${classLabel}`
      : 'Wali Kelas';
  const displayNama = waliKelasNama?.trim()
    ? waliKelasNama.trim()
    : '____________________________';
  const displayNip = waliKelasNip?.trim()
    ? `NIP. ${waliKelasNip.trim()}`
    : 'NIP. _______________________';

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text(formattedDate, sigX, cursorY + 4);

  doc.setTextColor(15, 23, 42);
  doc.text('Mengetahui,', sigX, cursorY + 9);
  doc.setFont('helvetica', 'bold');
  doc.text(roleLine, sigX, cursorY + 13.5);

  const nameY = cursorY + 32;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(displayNama, sigX, nameY);

  if (waliKelasNama?.trim()) {
    const nameWidth = Math.min(sigWidth, doc.getTextWidth(displayNama));
    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.25);
    doc.line(sigX, nameY + 1.2, sigX + nameWidth, nameY + 1.2);
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(51, 65, 85);
  doc.text(displayNip, sigX, nameY + 5.8);

  // Page numbers & footer
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    doc.line(marginX, pageHeight - 13, pageWidth - marginX, pageHeight - 13);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.4);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `Dicetak melalui Sistem Presensi Digital · ${settings.nama_sekolah} · Kertas F4 Potret`,
      marginX,
      pageHeight - 8.5
    );
    doc.text(`Halaman ${p} dari ${totalPages}`, pageWidth - marginX, pageHeight - 8.5, {
      align: 'right',
    });
  }

  const blob = doc.output('blob');
  const safeSchool = settings.nama_sekolah.replace(/[^a-zA-Z0-9]+/g, '_');
  const safeClass = classLabel.replace(/[^a-zA-Z0-9]+/g, '_');
  const filename = `Rekap_F4_${period.toUpperCase()}_${safeSchool}_${safeClass}.pdf`;
  return { blob, filename };
}
