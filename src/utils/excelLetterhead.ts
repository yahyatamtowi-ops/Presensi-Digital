import * as XLSX from 'xlsx';
import type { SchoolSettings } from '../types';
import { DEFAULT_APP_NAME } from './seedData';
import { formatSemesterLabel } from './subjectAttendance';

export interface LetterheadExcelOptions {
  settings: SchoolSettings;
  documentTitle: string;
  subtitleLines?: string[];
  headers: string[];
  rows: Array<Array<string | number>>;
  includeSignature?: boolean;
  printedDateLabel?: string;
}

export interface LetterheadSheetMeta {
  headerRowIndex: number; // 0-based index of the table column header row
  dataStartRowIndex: number; // 0-based index of first data row
  totalColumns: number;
  titleRowIndex: number;
}

function formatPrintedDateIndonesian(now = new Date()): string {
  try {
    return new Intl.DateTimeFormat('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/**
 * Builds an Excel worksheet with a formal school letterhead (Kop Surat),
 * uppercase document title, contextual metadata lines, auto-sized columns,
 * merged banner cells, and optional Principal signature block.
 */
export function buildLetterheadExcelSheet(
  options: LetterheadExcelOptions
): { sheet: XLSX.WorkSheet; meta: LetterheadSheetMeta } {
  const {
    settings,
    documentTitle,
    subtitleLines = [],
    headers,
    rows,
    includeSignature = true,
    printedDateLabel,
  } = options;

  const colCount = Math.max(2, headers.length);
  const schoolName = (settings.nama_sekolah || 'SMA Negeri 1 Kabun').trim().toUpperCase();
  const semesterLabel = formatSemesterLabel(settings.semester);
  const appLine = `${DEFAULT_APP_NAME.toUpperCase()} · TAHUN AJARAN ${settings.tahun_ajaran} · SEMESTER ${semesterLabel.toUpperCase()}`;
  const dividerLine = '══════════════════════════════════════════════════════════════════════════════';
  const cleanTitle = documentTitle.trim().toUpperCase();
  const printedDate = printedDateLabel || formatPrintedDateIndonesian();

  const makeMergedRow = (text: string): Array<string | number> => {
    const row: Array<string | number> = new Array(colCount).fill('');
    row[0] = text;
    return row;
  };

  const aoa: Array<Array<string | number>> = [];
  const merges: XLSX.Range[] = [];
  const rowHeights: Array<{ hpt?: number }> = [];

  // Row 0: School Name (Kop Surat)
  aoa.push(makeMergedRow(schoolName));
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: colCount - 1 } });
  rowHeights.push({ hpt: 24 });

  // Row 1: App & Academic Year subtitle
  aoa.push(makeMergedRow(appLine));
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: colCount - 1 } });
  rowHeights.push({ hpt: 18 });

  // Row 2: Visual letterhead divider
  aoa.push(makeMergedRow(dividerLine));
  merges.push({ s: { r: 2, c: 0 }, e: { r: 2, c: colCount - 1 } });
  rowHeights.push({ hpt: 12 });

  // Row 3: Document Title
  const titleRowIndex = aoa.length;
  aoa.push(makeMergedRow(cleanTitle));
  merges.push({ s: { r: titleRowIndex, c: 0 }, e: { r: titleRowIndex, c: colCount - 1 } });
  rowHeights.push({ hpt: 22 });

  // Subtitle / filter metadata rows
  const effectiveSubtitles = subtitleLines.filter((line) => line.trim().length > 0);
  effectiveSubtitles.push(`Dicetak pada: ${printedDate}`);
  for (const line of effectiveSubtitles) {
    const rIdx = aoa.length;
    aoa.push(makeMergedRow(line.trim()));
    merges.push({ s: { r: rIdx, c: 0 }, e: { r: rIdx, c: colCount - 1 } });
    rowHeights.push({ hpt: 17 });
  }

  // Blank spacer row before table
  aoa.push(new Array(colCount).fill(''));
  rowHeights.push({ hpt: 10 });

  // Table header row
  const headerRowIndex = aoa.length;
  const normalizedHeaders = [...headers];
  while (normalizedHeaders.length < colCount) normalizedHeaders.push('');
  aoa.push(normalizedHeaders);
  rowHeights.push({ hpt: 22 });

  // Data rows
  const dataStartRowIndex = aoa.length;
  if (rows.length === 0) {
    const emptyRowIdx = aoa.length;
    aoa.push(makeMergedRow('Tidak ada data pada filter yang dipilih.'));
    merges.push({ s: { r: emptyRowIdx, c: 0 }, e: { r: emptyRowIdx, c: colCount - 1 } });
    rowHeights.push({ hpt: 20 });
  } else {
    for (const r of rows) {
      const padded = [...r];
      while (padded.length < colCount) padded.push('');
      aoa.push(padded.slice(0, colCount));
      rowHeights.push({ hpt: 19 });
    }
  }

  // Optional Principal signature footer
  if (includeSignature && settings.nama_kepala_sekolah?.trim()) {
    const sigColStart = Math.max(0, colCount - 3);
    const sigColEnd = colCount - 1;
    const addSigRow = (text: string, height = 18) => {
      const rIdx = aoa.length;
      const row: Array<string | number> = new Array(colCount).fill('');
      row[sigColStart] = text;
      aoa.push(row);
      if (sigColEnd > sigColStart) {
        merges.push({ s: { r: rIdx, c: sigColStart }, e: { r: rIdx, c: sigColEnd } });
      }
      rowHeights.push({ hpt: height });
    };

    aoa.push(new Array(colCount).fill(''));
    rowHeights.push({ hpt: 12 });
    addSigRow('Mengetahui,', 18);
    addSigRow('Kepala Sekolah,', 18);
    aoa.push(new Array(colCount).fill(''));
    rowHeights.push({ hpt: 24 });
    addSigRow(settings.nama_kepala_sekolah.trim(), 19);
    if (settings.nip_kepala_sekolah?.trim()) {
      addSigRow(`NIP. ${settings.nip_kepala_sekolah.trim()}`, 17);
    }
  }

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet['!merges'] = merges;
  sheet['!rows'] = rowHeights;

  // Compute readable auto column widths based on table headers + data rows
  const colWidths: Array<{ wch: number }> = [];
  for (let c = 0; c < colCount; c++) {
    let maxLen = String(headers[c] ?? '').length;
    for (const r of rows) {
      const cellLen = String(r[c] ?? '').length;
      if (cellLen > maxLen) maxLen = cellLen;
    }
    colWidths.push({ wch: Math.min(44, Math.max(10, maxLen + 4)) });
  }
  sheet['!cols'] = colWidths;

  return {
    sheet,
    meta: {
      headerRowIndex,
      dataStartRowIndex,
      totalColumns: colCount,
      titleRowIndex,
    },
  };
}
