import * as XLSX from 'xlsx';
import type { Gender, Student } from '../types';

export interface ParsedStudentImportResult {
  valid: Student[];
  duplicates: string[];
  invalidRows: number[];
}

function pickColumnValue(row: Record<string, unknown>, candidates: string[]): string {
  const entries = Object.entries(row);
  for (const candidate of candidates) {
    const target = candidate.toLowerCase();
    for (const [key, value] of entries) {
      if (key.trim().toLowerCase() === target && value !== undefined && value !== null) {
        return String(value).trim();
      }
    }
  }
  return '';
}

function normalizeGender(raw: string): Gender {
  const val = raw.trim().toUpperCase();
  if (val === 'P' || val.startsWith('PEREMPUAN') || val === 'F' || val === 'FEMALE' || val === 'WANITA') {
    return 'P';
  }
  return 'L';
}

export function parseStudentSheetRows(
  rawRows: Record<string, unknown>[],
  existingStudents: Student[]
): ParsedStudentImportResult {
  const existingNis = new Set(existingStudents.map((s) => s.nis.trim().toLowerCase()));
  const batchNis = new Set<string>();

  const valid: Student[] = [];
  const duplicates: string[] = [];
  const invalidRows: number[] = [];

  rawRows.forEach((row, index) => {
    const rowNumber = index + 2; // 1-indexed + header row
    const nis = pickColumnValue(row, ['nisn', 'nis', 'no induk', 'nomor induk', 'id']);
    const nama = pickColumnValue(row, ['nama', 'nama siswa', 'nama lengkap', 'name']);
    const kelas = pickColumnValue(row, ['kelas', 'class', 'rombel']);
    const genderRaw = pickColumnValue(row, ['gender', 'l/p', 'jenis kelamin', 'jk']);
    const waRaw = pickColumnValue(row, [
      'no_wa_ortu',
      'no wa ortu',
      'no. wa ortu',
      'wa ortu',
      'whatsapp',
      'no wa',
      'telepon',
      'hp',
    ]);

    if (!nis || !nama || !kelas) {
      invalidRows.push(rowNumber);
      return;
    }

    const normNis = nis.toLowerCase();
    if (existingNis.has(normNis) || batchNis.has(normNis)) {
      duplicates.push(nis);
      return;
    }

    batchNis.add(normNis);
    valid.push({
      nis,
      nama,
      kelas,
      gender: normalizeGender(genderRaw),
      no_wa_ortu: waRaw,
    });
  });

  return { valid, duplicates, invalidRows };
}

export async function parseStudentsFile(
  file: File,
  existingStudents: Student[]
): Promise<ParsedStudentImportResult> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return { valid: [], duplicates: [], invalidRows: [] };
  }
  const sheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  return parseStudentSheetRows(rawRows, existingStudents);
}

export function downloadStudentImportTemplate(): void {
  const sampleRows = [
    {
      NISN: '2026101',
      Nama: 'Rafi Pratama',
      Kelas: 'X IPA 1',
      Gender: 'L',
      'No WA Ortu': '081234567890',
    },
    {
      NISN: '2026102',
      Nama: 'Salsaabila Putri',
      Kelas: 'X IPA 2',
      Gender: 'P',
      'No WA Ortu': '081298765432',
    },
  ];
  const ws = XLSX.utils.json_to_sheet(sampleRows);
  ws['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 12 }, { wch: 10 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Template Siswa');
  XLSX.writeFile(wb, 'Template_Import_Data_Siswa.xlsx');
}
