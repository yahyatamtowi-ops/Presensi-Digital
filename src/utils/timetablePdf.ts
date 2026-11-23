import { jsPDF } from 'jspdf';
import type { DayOfWeek, SchoolSettings, TimetableConfig } from '../types';
import { getThemeAccentRgb, loadImageAsDataUrlAndDims } from './ecardPdf';
import { DEFAULT_APP_NAME, DEFAULT_SCHOOL_LOGO } from './seedData';
import { formatSemesterLabel } from './subjectAttendance';
import {
  generateDailyTimeSlots,
  makeTimetableCellKey,
} from './timetableLogic';

export const TIMETABLE_PDF_CONFIG = {
  // F4 Landscape: 330mm x 215mm (standard Indonesian school timetable print sheet)
  widthMm: 330,
  heightMm: 215,
  marginX: 11,
  marginTop: 10,
  marginBottom: 12,
  contentWidth: 308,
  maxClassesPerPageGroup: 7,
  fixedColumns: {
    hari: 21,
    jam: 17,
    waktu: 26,
  },
} as const;

export interface TimetablePdfColumnSpec {
  header: string;
  width: number;
  align?: 'left' | 'center';
  className?: string;
}

export function chunkTimetableClasses(
  classes: string[],
  maxPerGroup: number = TIMETABLE_PDF_CONFIG.maxClassesPerPageGroup
): string[][] {
  const clean = classes.map((c) => c.trim()).filter(Boolean);
  if (clean.length === 0) return [['Umum']];
  const chunks: string[][] = [];
  for (let i = 0; i < clean.length; i += maxPerGroup) {
    chunks.push(clean.slice(i, i + maxPerGroup));
  }
  return chunks;
}

export function getTimetablePdfColumns(classGroup: string[]): TimetablePdfColumnSpec[] {
  const { hari, jam, waktu } = TIMETABLE_PDF_CONFIG.fixedColumns;
  const fixedTotal = hari + jam + waktu;
  const remaining = TIMETABLE_PDF_CONFIG.contentWidth - fixedTotal;
  const count = Math.max(1, classGroup.length);
  const perClassWidth = Number((remaining / count).toFixed(4));

  const cols: TimetablePdfColumnSpec[] = [
    { header: 'Hari', width: hari, align: 'center' },
    { header: 'Jam ke', width: jam, align: 'center' },
    { header: 'Waktu', width: waktu, align: 'center' },
  ];

  let used = fixedTotal;
  classGroup.forEach((cls, idx) => {
    const isLast = idx === classGroup.length - 1;
    const width = isLast ? Number((TIMETABLE_PDF_CONFIG.contentWidth - used).toFixed(4)) : perClassWidth;
    used += width;
    cols.push({
      header: cls,
      width,
      align: 'center',
      className: cls,
    });
  });

  return cols;
}

function slugifyFilePart(value: string): string {
  return (value || 'jadwal')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

/**
 * Generates an F4 Landscape PDF of the Pengaturan Jadwal Mata Pelajaran matrix
 * with school letterhead, break rows, subject + teacher per class slot, and Principal signature.
 */
export async function generateTimetableMatrixPdf(params: {
  settings: SchoolSettings;
  config: TimetableConfig;
  visibleDays: DayOfWeek[];
  activeClasses: string[];
  filterDayLabel?: string;
}): Promise<{ blob: Blob; filename: string }> {
  const { settings, config, visibleDays, activeClasses, filterDayLabel } = params;
  const { widthMm, heightMm, marginX, marginTop, contentWidth } = TIMETABLE_PDF_CONFIG;

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [widthMm, heightMm],
  });

  const [accentR, accentG, accentB] = getThemeAccentRgb(settings.tema);
  const logoImg = await loadImageAsDataUrlAndDims(
    settings.logo_sekolah || DEFAULT_SCHOOL_LOGO
  );
  const semesterLabel = formatSemesterLabel(config.semester);
  const dayModeLabel =
    config.jumlah_hari === 6 ? '6 Hari (Senin–Sabtu)' : '5 Hari (Senin–Jumat)';
  const dailySlots = generateDailyTimeSlots(config);
  const classGroups = chunkTimetableClasses(activeClasses);

  function drawHeaderBanner(groupIdx: number, totalGroups: number): number {
    const bannerH = 24;
    doc.setFillColor(accentR, accentG, accentB);
    doc.roundedRect(marginX, marginTop, contentWidth, bannerH, 2.2, 2.2, 'F');

    let textX = marginX + 5;
    let maxTextW = contentWidth - 10;
    if (logoImg) {
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(marginX + 4, marginTop + 3.5, 17, 17, 2, 2, 'F');
      doc.addImage(logoImg.dataUrl, logoImg.format, marginX + 5, marginTop + 4.5, 15, 15);
      textX = marginX + 25;
      maxTextW = contentWidth - 30;
    }

    doc.setTextColor(241, 245, 249);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    doc.text(
      doc.splitTextToSize(settings.nama_sekolah.toUpperCase(), maxTextW)[0] || '',
      textX,
      marginTop + 6.5
    );

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    const groupNote =
      totalGroups > 1 ? ` · BAGIAN ${groupIdx + 1}/${totalGroups}` : '';
    doc.text(`JADWAL MATA PELAJARAN${groupNote}`, textX, marginTop + 13);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.8);
    doc.setTextColor(241, 245, 249);
    const filterInfo = filterDayLabel ? ` · Filter: ${filterDayLabel}` : '';
    doc.text(
      doc.splitTextToSize(
        `Tahun Ajaran ${config.tahun_ajaran} · Semester ${semesterLabel} · ${dayModeLabel} · ${config.durasi_jp_menit} Menit/JP · Mulai ${config.jam_mulai_sekolah}${filterInfo}`,
        maxTextW
      )[0] || '',
      textX,
      marginTop + 19.2
    );

    return marginTop + bannerH + 4;
  }

  function drawTableHeader(cols: TimetablePdfColumnSpec[], startY: number): number {
    const headerH = 8;
    doc.setFillColor(accentR, accentG, accentB);
    doc.rect(marginX, startY, contentWidth, headerH, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.4);

    let colX = marginX;
    for (const col of cols) {
      const clipped = doc.splitTextToSize(col.header, col.width - 2.4)[0] || col.header;
      const posX = col.align === 'center' ? colX + col.width / 2 : colX + 1.8;
      doc.text(clipped, posX, startY + 5.2, { align: col.align || 'left' });
      colX += col.width;
    }
    return startY + headerH;
  }

  const lessonRowH = 9.2;
  const breakRowH = 6.5;
  const footerGuardY = heightMm - 15;
  let lastY: number = marginTop;

  classGroups.forEach((classGroup, groupIdx) => {
    if (groupIdx > 0) {
      doc.addPage([widthMm, heightMm], 'landscape');
    }

    const cols = getTimetablePdfColumns(classGroup);
    let y = drawHeaderBanner(groupIdx, classGroups.length);
    y = drawTableHeader(cols, y);

    visibleDays.forEach((hari, dayIdx) => {
      dailySlots.forEach((slot, slotIdx) => {
        const rowH = slot.kind === 'break' ? breakRowH : lessonRowH;

        if (y + rowH > footerGuardY) {
          doc.addPage([widthMm, heightMm], 'landscape');
          y = marginTop;
          y = drawTableHeader(cols, y);
        }

        if (slot.kind === 'break') {
          // Warm amber break row
          doc.setFillColor(254, 243, 199);
          doc.rect(marginX, y, contentWidth, rowH, 'F');
          doc.setDrawColor(217, 119, 6);
          doc.setLineWidth(0.18);
          doc.rect(marginX, y, contentWidth, rowH, 'S');

          const fixedW = cols[0].width + cols[1].width + cols[2].width;
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(6.8);
          doc.setTextColor(146, 64, 14);
          doc.text(hari, marginX + cols[0].width / 2, y + 4.3, { align: 'center' });
          doc.text(
            doc.splitTextToSize(slot.label, cols[1].width - 2)[0] || slot.label,
            marginX + cols[0].width + cols[1].width / 2,
            y + 4.3,
            { align: 'center' }
          );
          doc.setFont('helvetica', 'normal');
          doc.text(
            `${slot.jam_mulai} - ${slot.jam_selesai}`,
            marginX + cols[0].width + cols[1].width + cols[2].width / 2,
            y + 4.3,
            { align: 'center' }
          );
          doc.setFont('helvetica', 'bold');
          doc.text(
            slot.label.toUpperCase(),
            marginX + fixedW + (contentWidth - fixedW) / 2,
            y + 4.3,
            { align: 'center' }
          );
        } else {
          // Lesson row
          if (slotIdx % 2 === 1) {
            doc.setFillColor(248, 250, 252);
            doc.rect(marginX, y, contentWidth, rowH, 'F');
          }

          let colX = marginX;
          cols.forEach((col, cIdx) => {
            doc.setDrawColor(203, 213, 225);
            doc.setLineWidth(0.16);
            doc.rect(colX, y, col.width, rowH, 'S');

            if (cIdx === 0) {
              doc.setFont('helvetica', 'bold');
              doc.setFontSize(7.2);
              doc.setTextColor(15, 23, 42);
              doc.text(slotIdx === 0 ? hari : '', colX + col.width / 2, y + 5.6, {
                align: 'center',
              });
            } else if (cIdx === 1) {
              doc.setFont('helvetica', 'bold');
              doc.setFontSize(7.2);
              doc.setTextColor(51, 65, 85);
              doc.text(`JP ${slot.jamKe}`, colX + col.width / 2, y + 5.6, {
                align: 'center',
              });
            } else if (cIdx === 2) {
              doc.setFont('helvetica', 'normal');
              doc.setFontSize(6.8);
              doc.setTextColor(71, 85, 105);
              doc.text(
                `${slot.jam_mulai} - ${slot.jam_selesai}`,
                colX + col.width / 2,
                y + 5.6,
                { align: 'center' }
              );
            } else if (col.className) {
              const cell = config.cells[makeTimetableCellKey(hari, slot.jamKe, col.className)];
              if (cell?.mata_pelajaran) {
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(6.8);
                doc.setTextColor(15, 23, 42);
                const mapelLine =
                  doc.splitTextToSize(cell.mata_pelajaran, col.width - 2.4)[0] ||
                  cell.mata_pelajaran;
                if (cell.teacher_name) {
                  doc.text(mapelLine, colX + col.width / 2, y + 4.1, { align: 'center' });
                  doc.setFont('helvetica', 'normal');
                  doc.setFontSize(5.7);
                  doc.setTextColor(100, 116, 139);
                  const teacherLine =
                    doc.splitTextToSize(cell.teacher_name, col.width - 2.4)[0] ||
                    cell.teacher_name;
                  doc.text(teacherLine, colX + col.width / 2, y + 7.5, {
                    align: 'center',
                  });
                } else {
                  doc.text(mapelLine, colX + col.width / 2, y + 5.6, { align: 'center' });
                }
              } else {
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(6.5);
                doc.setTextColor(148, 163, 184);
                doc.text('-', colX + col.width / 2, y + 5.6, { align: 'center' });
              }
            }

            colX += col.width;
          });
        }

        y += rowH;
      });

      // Subtle day divider line between days
      if (dayIdx < visibleDays.length - 1 && y + 1 < footerGuardY) {
        doc.setDrawColor(accentR, accentG, accentB);
        doc.setLineWidth(0.35);
        doc.line(marginX, y, marginX + contentWidth, y);
      }
    });

    lastY = y;
  });

  // Principal Signature Block
  if (settings.nama_kepala_sekolah?.trim()) {
    let sigY = lastY + 8;
    if (sigY + 32 > heightMm - 10) {
      doc.addPage([widthMm, heightMm], 'landscape');
      sigY = marginTop + 6;
    }
    const rightSigX = marginX + contentWidth - 45;
    const kepsekNama = settings.nama_kepala_sekolah.trim();
    const kepsekNip = (settings.nip_kepala_sekolah || '').trim();

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(51, 65, 85);
    doc.text('Mengetahui,', rightSigX, sigY, { align: 'center' });
    doc.text('Kepala Sekolah', rightSigX, sigY + 4.4, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text(kepsekNama, rightSigX, sigY + 21, { align: 'center' });
    const lineW = Math.min(64, doc.getTextWidth(kepsekNama));
    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.22);
    doc.line(rightSigX - lineW / 2, sigY + 22.1, rightSigX + lineW / 2, sigY + 22.1);

    if (kepsekNip) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.6);
      doc.setTextColor(51, 65, 85);
      doc.text(`NIP. ${kepsekNip}`, rightSigX, sigY + 26.2, { align: 'center' });
    }
  }

  // Page footers
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `${DEFAULT_APP_NAME} · Jadwal Mata Pelajaran TA ${config.tahun_ajaran} Semester ${semesterLabel} · ${settings.nama_sekolah}`,
      marginX,
      heightMm - 6
    );
    doc.text(`Halaman ${p} / ${totalPages}`, widthMm - marginX, heightMm - 6, {
      align: 'right',
    });
  }

  const filename = `Jadwal_Mata_Pelajaran_TA_${slugifyFilePart(config.tahun_ajaran)}_${slugifyFilePart(
    semesterLabel
  )}.pdf`;

  return {
    blob: doc.output('blob'),
    filename,
  };
}
