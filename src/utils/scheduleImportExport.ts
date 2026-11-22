import * as XLSX from 'xlsx';
import type {
  DayOfWeek,
  MasterSubject,
  SemesterKind,
  TeacherSchedule,
  TimetableConfig,
  UserAccount,
} from '../types';

type TimetableCellEntry = TimetableConfig['cells'][string];
import {
  generateDailyTimeSlots,
  makeTimetableCellKey,
} from './timetableLogic';
import { normalizeSemester } from './subjectAttendance';

const DAY_ALIASES: Record<string, DayOfWeek> = {
  senin: 'Senin',
  sen: 'Senin',
  monday: 'Senin',
  mon: 'Senin',
  selasa: 'Selasa',
  sel: 'Selasa',
  tuesday: 'Selasa',
  tue: 'Selasa',
  rabu: 'Rabu',
  rab: 'Rabu',
  wednesday: 'Rabu',
  wed: 'Rabu',
  kamis: 'Kamis',
  kam: 'Kamis',
  thursday: 'Kamis',
  thu: 'Kamis',
  jumat: 'Jumat',
  "jum'at": 'Jumat',
  jum: 'Jumat',
  friday: 'Jumat',
  fri: 'Jumat',
  sabtu: 'Sabtu',
  sab: 'Sabtu',
  saturday: 'Sabtu',
  sat: 'Sabtu',
};

export function normalizeDayOfWeek(raw: unknown): DayOfWeek | null {
  if (raw === null || raw === undefined) return null;
  const cleaned = String(raw).trim().toLowerCase().replace(/^hari\s+/i, '');
  if (!cleaned) return null;
  return DAY_ALIASES[cleaned] ?? null;
}

export function normalizeTimeHHMM(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;

  // Handle Excel serial numeric time (fraction of 24-hour day, e.g. 0.3020833 -> 07:15)
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const frac = raw >= 1 ? raw % 1 : raw;
    if (frac >= 0 && frac < 1) {
      const totalMinutes = Math.round(frac * 24 * 60);
      const hh = Math.floor(totalMinutes / 60) % 24;
      const mm = totalMinutes % 60;
      return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }
    return null;
  }

  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const hh = raw.getHours();
    const mm = raw.getMinutes();
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  const text = String(raw).trim().replace(/\./g, ':');
  const match = text.match(/^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function parseTimeRangeCell(
  raw: unknown
): { start: string; end: string } | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw)
    .trim()
    .replace(/\s*(?:s\.?d\.?|sampai|hingga|to)\s*/gi, ' - ')
    .replace(/[–—]/g, '-');
  const match = text.match(
    /(\d{1,2}[:.]\d{2})(?::\d{2})?\s*-\s*(\d{1,2}[:.]\d{2})(?::\d{2})?/
  );
  if (!match) return null;
  const start = normalizeTimeHHMM(match[1]);
  const end = normalizeTimeHHMM(match[2]);
  if (!start || !end) return null;
  return { start, end };
}

function normalizeNameForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/,\s*(s\.?pd|m\.?pd|s\.?si|m\.?si|s\.?ag|s\.?kom|s\.?e|m\.?m|dr\.?|drs\.?|hj\.?|h\.?)[\w.\s,]*/gi, '')
    .replace(/^(bpk\.?|ibu|pak|bu|ust\.?|ustadzah?)\s+/i, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolveTeacherAccount(
  rawTeacher: string,
  teachingAccounts: UserAccount[]
): UserAccount | null {
  const query = rawTeacher.trim();
  if (!query || teachingAccounts.length === 0) return null;
  const qLower = query.toLowerCase();
  const qNorm = normalizeNameForMatch(query);

  // 1. Exact username or exact full name match
  const exact = teachingAccounts.find(
    (acc) =>
      acc.username.trim().toLowerCase() === qLower ||
      acc.nama.trim().toLowerCase() === qLower
  );
  if (exact) return exact;

  // 2. Normalized name exact match (ignoring academic titles like ", S.Pd")
  if (qNorm) {
    const normExact = teachingAccounts.find(
      (acc) => normalizeNameForMatch(acc.nama) === qNorm
    );
    if (normExact) return normExact;

    // 3. Substring containment match
    const partial = teachingAccounts.find((acc) => {
      const accNorm = normalizeNameForMatch(acc.nama);
      return (
        accNorm.includes(qNorm) ||
        qNorm.includes(accNorm) ||
        acc.nama.toLowerCase().includes(qLower)
      );
    });
    if (partial) return partial;
  }

  return null;
}

export function parseMatrixCellText(
  rawCell: unknown,
  teachingAccounts: UserAccount[]
): {
  mata_pelajaran: string;
  teacher_user_id: string;
  teacher_name: string;
  teacherMatched: boolean;
} | null {
  if (rawCell === null || rawCell === undefined) return null;
  const text = String(rawCell).trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  if (
    lower === '-' ||
    lower === '—' ||
    lower === '–' ||
    lower === 'kosong' ||
    lower === 'libur' ||
    lower.startsWith('istirahat')
  ) {
    return null;
  }

  let subject = text;
  let teacherQuery = '';

  // Format 1: "Matematika (Siti Aminah, S.Pd)"
  const parenMatch = text.match(/^(.+?)\s*\(([^()]+)\)\s*$/);
  if (parenMatch) {
    subject = parenMatch[1].trim();
    teacherQuery = parenMatch[2].trim();
  } else if (/\s+[-–|]\s+/.test(text)) {
    // Format 2: "Matematika - Siti Aminah" or "Matematika | Siti Aminah"
    const parts = text.split(/\s+[-–|]\s+/);
    subject = parts[0].trim();
    teacherQuery = parts.slice(1).join(' - ').trim();
  } else if (text.includes('\n')) {
    // Format 3: multiline cell "Matematika\nSiti Aminah"
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    subject = lines[0] || '';
    teacherQuery = lines.slice(1).join(' ').trim();
  }

  if (!subject) return null;

  const matchedTeacher = teacherQuery
    ? resolveTeacherAccount(teacherQuery, teachingAccounts)
    : null;

  if (matchedTeacher) {
    return {
      mata_pelajaran: subject,
      teacher_user_id: matchedTeacher.id,
      teacher_name: matchedTeacher.nama,
      teacherMatched: true,
    };
  }

  // Fallback: if teacherQuery was supplied but not found in accounts, preserve name cleanly
  if (teacherQuery) {
    return {
      mata_pelajaran: subject,
      teacher_user_id: '',
      teacher_name: teacherQuery,
      teacherMatched: false,
    };
  }

  return {
    mata_pelajaran: subject,
    teacher_user_id: '',
    teacher_name: '',
    teacherMatched: false,
  };
}

function parseJpRange(raw: unknown): number[] {
  if (raw === null || raw === undefined || raw === '') return [];
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= 20) {
    return [raw];
  }
  const text = String(raw)
    .trim()
    .toLowerCase()
    .replace(/^(jam\s*ke[-\s]*|jp[-\s]*)/i, '');

  const rangeMatch = text.match(/^(\d{1,2})\s*[-–]\s*(\d{1,2})$/);
  if (rangeMatch) {
    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    if (start >= 1 && end >= start && end <= 20) {
      const nums: number[] = [];
      for (let i = start; i <= end; i++) nums.push(i);
      return nums;
    }
  }

  const singleMatch = text.match(/^(\d{1,2})$/);
  if (singleMatch) {
    const num = Number(singleMatch[1]);
    if (num >= 1 && num <= 20) return [num];
  }
  return [];
}

function normalizeHeaderKey(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export interface TimetableMatrixImportResult {
  formatDetected: 'matrix' | 'list';
  cells: Record<string, TimetableCellEntry>;
  detectedClasses: string[];
  maxJp: number;
  hasSaturday: boolean;
  parsedCount: number;
  skippedRows: number;
  unmatchedTeachers: string[];
  warnings: string[];
  errors: string[];
}

export function parseTimetableMatrixRows(
  rows: unknown[][],
  teachingAccounts: UserAccount[],
  baseDraft: TimetableConfig
): TimetableMatrixImportResult {
  const emptyResult: TimetableMatrixImportResult = {
    formatDetected: 'matrix',
    cells: {},
    detectedClasses: [],
    maxJp: baseDraft.jumlah_jp,
    hasSaturday: baseDraft.jumlah_hari === 6,
    parsedCount: 0,
    skippedRows: 0,
    unmatchedTeachers: [],
    warnings: [],
    errors: [],
  };

  if (!rows || rows.length < 2) {
    return {
      ...emptyResult,
      errors: ['File kosong atau hanya berisi baris judul tanpa data jadwal.'],
    };
  }

  // Locate header row (first non-empty row containing "Hari")
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i] || [];
    const normalized = row.map(normalizeHeaderKey);
    if (normalized.some((h) => h === 'hari' || h === 'day')) {
      headerRowIdx = i;
      break;
    }
  }

  if (headerRowIdx === -1) {
    return {
      ...emptyResult,
      errors: [
        'Header tabel tidak ditemukan. Pastikan terdapat kolom "Hari" dan "Jam ke" (format matriks) atau "Hari", "Kelas", "Mata Pelajaran" (format daftar).',
      ],
    };
  }

  const rawHeaders = (rows[headerRowIdx] || []).map((c) => String(c ?? '').trim());
  const normHeaders = rawHeaders.map(normalizeHeaderKey);

  const dayColIdx = normHeaders.findIndex((h) => h === 'hari' || h === 'day');
  const jpColIdx = normHeaders.findIndex((h) =>
    ['jam_ke', 'jp', 'jam', 'periode', 'jam_pelajaran'].includes(h)
  );
  const timeColIdx = normHeaders.findIndex((h) =>
    ['waktu', 'jam_waktu', 'pukul'].includes(h)
  );
  const startColIdx = normHeaders.findIndex((h) =>
    ['jam_mulai', 'mulai', 'start', 'waktu_mulai'].includes(h)
  );
  const endColIdx = normHeaders.findIndex((h) =>
    ['jam_selesai', 'selesai', 'end', 'waktu_selesai'].includes(h)
  );
  const kelasColIdx = normHeaders.findIndex((h) =>
    ['kelas', 'rombel', 'class'].includes(h)
  );
  const mapelColIdx = normHeaders.findIndex((h) =>
    ['mata_pelajaran', 'mapel', 'pelajaran', 'subject'].includes(h)
  );
  const guruColIdx = normHeaders.findIndex((h) =>
    ['guru', 'nama_guru', 'guru_pengampu', 'pengampu', 'teacher'].includes(h)
  );

  const isListFormat = kelasColIdx !== -1 && mapelColIdx !== -1;
  const cells: Record<string, TimetableCellEntry> = {};
  const classSet = new Set<string>();
  const unmatchedTeacherSet = new Set<string>();
  const warnings: string[] = [];
  let maxJp = baseDraft.jumlah_jp;
  let hasSaturday = baseDraft.jumlah_hari === 6;
  let parsedCount = 0;
  let skippedRows = 0;

  // Build slot lookup from baseDraft in case list format provides start/end times instead of JP
  const slotDefs = generateDailyTimeSlots({
    jam_mulai_sekolah: baseDraft.jam_mulai_sekolah,
    durasi_jp_menit: baseDraft.durasi_jp_menit,
    jumlah_jp: baseDraft.jumlah_jp,
    istirahat: baseDraft.istirahat,
  }).filter((r) => r.kind === 'lesson');

  if (isListFormat) {
    let lastDay: DayOfWeek | null = null;
    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      if (row.every((v) => String(v ?? '').trim() === '')) continue;

      const parsedDay: DayOfWeek | null = normalizeDayOfWeek(row[dayColIdx]) ?? lastDay;
      if (parsedDay) lastDay = parsedDay;
      const kelas = String(row[kelasColIdx] ?? '').trim();
      const mapel = String(row[mapelColIdx] ?? '').trim();
      const guruRaw = guruColIdx !== -1 ? String(row[guruColIdx] ?? '').trim() : '';

      if (!parsedDay || !kelas || !mapel) {
        skippedRows += 1;
        continue;
      }

      let jpNumbers = jpColIdx !== -1 ? parseJpRange(row[jpColIdx]) : [];
      if (jpNumbers.length === 0) {
        let start: string | null = null;
        let end: string | null = null;
        if (startColIdx !== -1 && endColIdx !== -1) {
          start = normalizeTimeHHMM(row[startColIdx]);
          end = normalizeTimeHHMM(row[endColIdx]);
        } else if (timeColIdx !== -1) {
          const parsedRange = parseTimeRangeCell(row[timeColIdx]);
          if (parsedRange) {
            start = parsedRange.start;
            end = parsedRange.end;
          }
        }
        if (start && end) {
          const matchedSlots = slotDefs.filter(
            (slot) => slot.jam_mulai >= start! && slot.jam_selesai <= end!
          );
          if (matchedSlots.length > 0) {
            jpNumbers = matchedSlots.map((s) => s.jamKe);
          } else {
            const firstMatch = slotDefs.find((slot) => slot.jam_mulai === start);
            if (firstMatch) jpNumbers = [firstMatch.jamKe];
          }
        }
      }

      if (jpNumbers.length === 0) {
        skippedRows += 1;
        warnings.push(`Baris ${r + 1}: Jam ke / waktu tidak cocok dengan slot jam pelajaran.`);
        continue;
      }

      const teacherAcc = guruRaw
        ? resolveTeacherAccount(guruRaw, teachingAccounts)
        : null;
      if (guruRaw && !teacherAcc) {
        unmatchedTeacherSet.add(guruRaw);
      }

      if (parsedDay === 'Sabtu') hasSaturday = true;
      classSet.add(kelas);

      for (const jp of jpNumbers) {
        if (jp > maxJp) maxJp = jp;
        const key = makeTimetableCellKey(parsedDay, jp, kelas);
        cells[key] = {
          mata_pelajaran: mapel,
          teacher_user_id: teacherAcc?.id ?? '',
          teacher_name: teacherAcc?.nama ?? guruRaw,
        };
        parsedCount += 1;
      }
    }

    return {
      formatDetected: 'list',
      cells,
      detectedClasses: Array.from(classSet),
      maxJp,
      hasSaturday,
      parsedCount,
      skippedRows,
      unmatchedTeachers: Array.from(unmatchedTeacherSet),
      warnings: warnings.slice(0, 8),
      errors:
        parsedCount === 0
          ? ['Tidak ada baris jadwal yang valid ditemukan dalam file.']
          : [],
    };
  }

  // Matrix Format: Hari | Jam ke | (Waktu) | Kelas 1 | Kelas 2 | ...
  const reservedIndices = new Set<number>(
    [dayColIdx, jpColIdx, timeColIdx, startColIdx, endColIdx].filter((idx) => idx !== -1)
  );
  const classColumns: Array<{ colIdx: number; kelas: string }> = [];
  for (let c = 0; c < rawHeaders.length; c++) {
    if (reservedIndices.has(c)) continue;
    const headerLabel = rawHeaders[c];
    const norm = normHeaders[c];
    if (!headerLabel) continue;
    if (['no', 'nomor', 'keterangan', 'catatan', 'semester', 'tahun_ajaran'].includes(norm)) {
      continue;
    }
    classColumns.push({ colIdx: c, kelas: headerLabel });
    classSet.add(headerLabel);
  }

  if (classColumns.length === 0) {
    return {
      ...emptyResult,
      errors: [
        'Kolom kelas tidak ditemukan pada file matriks. Tambahkan kolom kelas (misal: X IPA 1, X IPA 2) setelah kolom Hari, Jam ke, dan Waktu.',
      ],
    };
  }

  let lastDay: DayOfWeek | null = null;
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    if (row.every((v) => String(v ?? '').trim() === '')) continue;

    const rawDay = row[dayColIdx];
    const parsedDay: DayOfWeek | null = normalizeDayOfWeek(rawDay) ?? lastDay;
    if (parsedDay) lastDay = parsedDay;

    const rawJp = jpColIdx !== -1 ? row[jpColIdx] : '';
    const jpText = String(rawJp ?? '').trim().toLowerCase();
    // Skip break rows cleanly
    if (jpText.includes('istirahat') || jpText.includes('break')) {
      continue;
    }

    const jpNumbers = parseJpRange(rawJp);
    if (!parsedDay || jpNumbers.length === 0) {
      skippedRows += 1;
      continue;
    }

    if (parsedDay === 'Sabtu') hasSaturday = true;

    for (const jp of jpNumbers) {
      if (jp > maxJp) maxJp = jp;
      for (const { colIdx, kelas } of classColumns) {
        const parsedCell = parseMatrixCellText(row[colIdx], teachingAccounts);
        if (!parsedCell) continue;
        if (parsedCell.teacher_name && !parsedCell.teacherMatched) {
          unmatchedTeacherSet.add(parsedCell.teacher_name);
        }
        const key = makeTimetableCellKey(parsedDay, jp, kelas);
        cells[key] = {
          mata_pelajaran: parsedCell.mata_pelajaran,
          teacher_user_id: parsedCell.teacher_user_id,
          teacher_name: parsedCell.teacher_name,
        };
        parsedCount += 1;
      }
    }
  }

  return {
    formatDetected: 'matrix',
    cells,
    detectedClasses: Array.from(classSet),
    maxJp,
    hasSaturday,
    parsedCount,
    skippedRows,
    unmatchedTeachers: Array.from(unmatchedTeacherSet),
    warnings: warnings.slice(0, 8),
    errors:
      parsedCount === 0
        ? [
            'Tidak ada sel mata pelajaran yang terbaca. Pastikan isi sel menggunakan format "Nama Mapel (Nama Guru)" atau "Nama Mapel".',
          ]
        : [],
  };
}

export async function parseTimetableMatrixFile(
  file: File,
  teachingAccounts: UserAccount[],
  baseDraft: TimetableConfig
): Promise<TimetableMatrixImportResult> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return {
      formatDetected: 'matrix',
      cells: {},
      detectedClasses: [],
      maxJp: baseDraft.jumlah_jp,
      hasSaturday: baseDraft.jumlah_hari === 6,
      parsedCount: 0,
      skippedRows: 0,
      unmatchedTeachers: [],
      warnings: [],
      errors: ['File spreadsheet tidak memiliki lembar kerja (sheet).'],
    };
  }
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: true,
  });
  return parseTimetableMatrixRows(rows, teachingAccounts, baseDraft);
}

export function downloadTimetableMatrixTemplate(
  activeClasses: string[],
  teachingAccounts: UserAccount[],
  draft: TimetableConfig
): void {
  const classes =
    activeClasses.length > 0 ? activeClasses : ['X IPA 1', 'X IPA 2', 'XI IPA 1'];
  const sampleTeacherA = teachingAccounts[0]?.nama || 'Siti Aminah, S.Pd';
  const sampleTeacherB = teachingAccounts[1]?.nama || sampleTeacherA;
  const rows = generateDailyTimeSlots({
    jam_mulai_sekolah: draft.jam_mulai_sekolah,
    durasi_jp_menit: draft.durasi_jp_menit,
    jumlah_jp: draft.jumlah_jp,
    istirahat: draft.istirahat,
  });
  const days: DayOfWeek[] =
    draft.jumlah_hari === 6
      ? ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
      : ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];

  const sheetData: Array<Record<string, string | number>> = [];
  days.forEach((day, dayIdx) => {
    rows.forEach((slot) => {
      if (slot.kind === 'break') {
        const breakRow: Record<string, string | number> = {
          Hari: day,
          'Jam ke': slot.label,
          Waktu: `${slot.jam_mulai} - ${slot.jam_selesai}`,
        };
        classes.forEach((cls) => {
          breakRow[cls] = 'ISTIRAHAT';
        });
        sheetData.push(breakRow);
        return;
      }

      const rowObj: Record<string, string | number> = {
        Hari: day,
        'Jam ke': slot.jamKe,
        Waktu: `${slot.jam_mulai} - ${slot.jam_selesai}`,
      };
      classes.forEach((cls, clsIdx) => {
        // Fill only sample first 2 periods on Senin so user sees exact format clearly
        if (dayIdx === 0 && slot.jamKe === 1 && clsIdx === 0) {
          rowObj[cls] = `Matematika (${sampleTeacherA})`;
        } else if (dayIdx === 0 && slot.jamKe === 2 && clsIdx === 0) {
          rowObj[cls] = `Bahasa Indonesia (${sampleTeacherB})`;
        } else if (dayIdx === 0 && slot.jamKe === 1 && clsIdx === 1) {
          rowObj[cls] = `Bahasa Inggris (${sampleTeacherB})`;
        } else {
          rowObj[cls] = '';
        }
      });
      sheetData.push(rowObj);
    });
  });

  const ws = XLSX.utils.json_to_sheet(sheetData);
  ws['!cols'] = [
    { wch: 11 },
    { wch: 13 },
    { wch: 16 },
    ...classes.map(() => ({ wch: 28 })),
  ];

  const guideData = [
    { Petunjuk: '1. Jangan ubah nama kolom "Hari", "Jam ke", dan "Waktu".' },
    {
      Petunjuk:
        '2. Kolom setelah "Waktu" adalah nama kelas (misal X IPA 1, X IPA 2). Anda bisa menambah kolom kelas baru.',
    },
    {
      Petunjuk:
        '3. Format isi tiap sel kelas: Nama Mata Pelajaran (Nama Guru), contoh: Matematika (Siti Aminah, S.Pd).',
    },
    {
      Petunjuk:
        '4. Baris bertuliskan "Istirahat" akan otomatis dilewati saat proses import.',
    },
    {
      Petunjuk:
        '5. Simpan dalam format .xlsx atau .csv lalu unggah melalui tombol Import Excel/CSV di Pengaturan Jadwal.',
    },
  ];
  const guideWs = XLSX.utils.json_to_sheet(guideData);
  guideWs['!cols'] = [{ wch: 92 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Template Jadwal Matriks');
  XLSX.utils.book_append_sheet(wb, guideWs, 'Petunjuk');
  XLSX.writeFile(wb, 'Template_Pengaturan_Jadwal_Pelajaran.xlsx');
}

export interface ParsedTeacherScheduleInput {
  hari: DayOfWeek;
  teacher_user_id: string;
  teacher_name: string;
  kelas: string;
  mata_pelajaran: string;
  jam_mulai: string;
  jam_selesai: string;
  semester: SemesterKind;
}

export interface TeacherScheduleImportResult {
  validItems: ParsedTeacherScheduleInput[];
  duplicateCount: number;
  invalidRows: Array<{ rowNumber: number; reason: string }>;
  totalRows: number;
}

function readRowField(
  normalizedRow: Record<string, unknown>,
  candidates: string[]
): unknown {
  for (const key of candidates) {
    if (key in normalizedRow && String(normalizedRow[key] ?? '').trim() !== '') {
      return normalizedRow[key];
    }
  }
  return '';
}

function makeScheduleDedupKey(item: {
  hari: DayOfWeek;
  teacher_user_id: string;
  kelas: string;
  mata_pelajaran: string;
  jam_mulai: string;
  jam_selesai: string;
  semester: SemesterKind;
}): string {
  return [
    item.hari.toLowerCase(),
    item.teacher_user_id.toLowerCase(),
    item.kelas.trim().toLowerCase(),
    item.mata_pelajaran.trim().toLowerCase(),
    item.jam_mulai,
    item.jam_selesai,
    item.semester,
  ].join('|');
}

export function parseTeacherScheduleRows(
  rows: Record<string, unknown>[],
  options: {
    teachingAccounts: UserAccount[];
    existingSchedules: TeacherSchedule[];
    tahunAjaran: string;
    defaultSemester: SemesterKind;
    activeTimetableConfig?: TimetableConfig;
  }
): TeacherScheduleImportResult {
  const {
    teachingAccounts,
    existingSchedules,
    tahunAjaran,
    defaultSemester,
    activeTimetableConfig,
  } = options;

  const existingKeys = new Set<string>(
    existingSchedules
      .filter((s) => s.tahun_ajaran === tahunAjaran)
      .map((s) =>
        makeScheduleDedupKey({
          hari: s.hari,
          teacher_user_id: s.teacher_user_id,
          kelas: s.kelas,
          mata_pelajaran: s.mata_pelajaran,
          jam_mulai: s.jam_mulai,
          jam_selesai: s.jam_selesai,
          semester: normalizeSemester(s.semester, defaultSemester),
        })
      )
  );

  const slotDefs = activeTimetableConfig
    ? generateDailyTimeSlots({
        jam_mulai_sekolah: activeTimetableConfig.jam_mulai_sekolah,
        durasi_jp_menit: activeTimetableConfig.durasi_jp_menit,
        jumlah_jp: activeTimetableConfig.jumlah_jp,
        istirahat: activeTimetableConfig.istirahat,
      }).filter((r) => r.kind === 'lesson')
    : [];

  const validItems: ParsedTeacherScheduleInput[] = [];
  const invalidRows: Array<{ rowNumber: number; reason: string }> = [];
  let duplicateCount = 0;
  let totalRows = 0;

  rows.forEach((rawRow, idx) => {
    const normalizedRow: Record<string, unknown> = {};
    Object.entries(rawRow).forEach(([k, v]) => {
      normalizedRow[normalizeHeaderKey(k)] = v;
    });

    const hasAnyValue = Object.values(normalizedRow).some(
      (v) => String(v ?? '').trim() !== ''
    );
    if (!hasAnyValue) return;
    totalRows += 1;
    const rowNumber = idx + 2; // Excel row number (header = 1)

    const rawHari = readRowField(normalizedRow, ['hari', 'day']);
    const hari = normalizeDayOfWeek(rawHari);
    if (!hari) {
      invalidRows.push({
        rowNumber,
        reason: `Hari "${String(rawHari || '').trim() || '(kosong)'}" tidak valid (gunakan Senin–Sabtu).`,
      });
      return;
    }

    const kelas = String(
      readRowField(normalizedRow, ['kelas', 'rombel', 'class']) ?? ''
    ).trim();
    if (!kelas) {
      invalidRows.push({ rowNumber, reason: 'Kolom Kelas wajib diisi.' });
      return;
    }

    const mataPelajaran = String(
      readRowField(normalizedRow, [
        'mata_pelajaran',
        'mapel',
        'pelajaran',
        'subject',
      ]) ?? ''
    ).trim();
    if (!mataPelajaran) {
      invalidRows.push({ rowNumber, reason: 'Kolom Mata Pelajaran wajib diisi.' });
      return;
    }

    const rawGuru = String(
      readRowField(normalizedRow, [
        'guru',
        'nama_guru',
        'guru_pengampu',
        'pengampu',
        'teacher',
        'username_guru',
      ]) ?? ''
    ).trim();
    const matchedTeacher = resolveTeacherAccount(rawGuru, teachingAccounts);
    if (!matchedTeacher) {
      invalidRows.push({
        rowNumber,
        reason: rawGuru
          ? `Guru "${rawGuru}" tidak ditemukan di daftar akun Guru/Wali Kelas.`
          : 'Kolom Guru wajib diisi sesuai nama atau username akun guru.',
      });
      return;
    }

    // Resolve start & end time from Jam Mulai + Jam Selesai OR Waktu OR Jam ke
    let jamMulai = normalizeTimeHHMM(
      readRowField(normalizedRow, ['jam_mulai', 'mulai', 'start', 'waktu_mulai'])
    );
    let jamSelesai = normalizeTimeHHMM(
      readRowField(normalizedRow, ['jam_selesai', 'selesai', 'end', 'waktu_selesai'])
    );

    if (!jamMulai || !jamSelesai) {
      const waktuRaw = readRowField(normalizedRow, ['waktu', 'jam_pelajaran', 'pukul']);
      const parsedRange = parseTimeRangeCell(waktuRaw);
      if (parsedRange) {
        jamMulai = parsedRange.start;
        jamSelesai = parsedRange.end;
      }
    }

    if ((!jamMulai || !jamSelesai) && slotDefs.length > 0) {
      const jpRaw = readRowField(normalizedRow, ['jam_ke', 'jp', 'jam']);
      const jps = parseJpRange(jpRaw);
      if (jps.length > 0) {
        const firstSlot = slotDefs.find((s) => s.jamKe === jps[0]);
        const lastSlot = slotDefs.find((s) => s.jamKe === jps[jps.length - 1]);
        if (firstSlot && lastSlot) {
          jamMulai = firstSlot.jam_mulai;
          jamSelesai = lastSlot.jam_selesai;
        }
      }
    }

    if (!jamMulai || !jamSelesai) {
      invalidRows.push({
        rowNumber,
        reason:
          'Format jam tidak valid. Isi "Jam Mulai" & "Jam Selesai" (misal 07:15 & 08:45), "Waktu" (07:15 - 08:45), atau "Jam ke" (1-2).',
      });
      return;
    }

    if (jamMulai >= jamSelesai) {
      invalidRows.push({
        rowNumber,
        reason: `Jam Selesai (${jamSelesai}) harus lebih akhir dari Jam Mulai (${jamMulai}).`,
      });
      return;
    }

    const rawSem = String(readRowField(normalizedRow, ['semester', 'sem']) ?? '').trim();
    const semester: SemesterKind = rawSem
      ? normalizeSemester(rawSem, defaultSemester)
      : defaultSemester;

    const item: ParsedTeacherScheduleInput = {
      hari,
      teacher_user_id: matchedTeacher.id,
      teacher_name: matchedTeacher.nama,
      kelas,
      mata_pelajaran: mataPelajaran,
      jam_mulai: jamMulai,
      jam_selesai: jamSelesai,
      semester,
    };

    const dedupKey = makeScheduleDedupKey(item);
    if (existingKeys.has(dedupKey)) {
      duplicateCount += 1;
      return;
    }
    existingKeys.add(dedupKey);
    validItems.push(item);
  });

  return {
    validItems,
    duplicateCount,
    invalidRows,
    totalRows,
  };
}

export async function parseTeacherSchedulesFile(
  file: File,
  options: {
    teachingAccounts: UserAccount[];
    existingSchedules: TeacherSchedule[];
    tahunAjaran: string;
    defaultSemester: SemesterKind;
    activeTimetableConfig?: TimetableConfig;
  }
): Promise<TeacherScheduleImportResult> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return {
      validItems: [],
      duplicateCount: 0,
      invalidRows: [{ rowNumber: 1, reason: 'File spreadsheet tidak memiliki sheet.' }],
      totalRows: 0,
    };
  }
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: true,
  });
  return parseTeacherScheduleRows(rows, options);
}

export function downloadTeacherScheduleTemplate(
  activeClasses: string[],
  teachingAccounts: UserAccount[],
  masterSubjects: MasterSubject[],
  activeSemester: SemesterKind
): void {
  const cls1 = activeClasses[0] || 'X IPA 1';
  const cls2 = activeClasses[1] || cls1;
  const teacher1 = teachingAccounts[0]?.nama || 'Siti Aminah, S.Pd';
  const teacher2 = teachingAccounts[1]?.nama || teacher1;
  const subject1 = masterSubjects[0]?.nama || 'Matematika';
  const subject2 = masterSubjects[1]?.nama || 'Bahasa Indonesia';
  const semLabel = activeSemester === 'genap' ? 'Genap' : 'Ganjil';

  const sampleRows = [
    {
      Hari: 'Senin',
      'Jam Mulai': '07:15',
      'Jam Selesai': '08:45',
      Kelas: cls1,
      'Mata Pelajaran': subject1,
      Guru: teacher1,
      Semester: semLabel,
    },
    {
      Hari: 'Selasa',
      'Jam Mulai': '08:45',
      'Jam Selesai': '10:15',
      Kelas: cls2,
      'Mata Pelajaran': subject2,
      Guru: teacher2,
      Semester: semLabel,
    },
  ];

  const ws = XLSX.utils.json_to_sheet(sampleRows);
  ws['!cols'] = [
    { wch: 11 },
    { wch: 12 },
    { wch: 13 },
    { wch: 14 },
    { wch: 24 },
    { wch: 26 },
    { wch: 11 },
  ];

  const guideData = [
    { Petunjuk: '1. Kolom wajib: Hari, Jam Mulai, Jam Selesai (atau kolom Waktu / Jam ke), Kelas, Mata Pelajaran, Guru.' },
    { Petunjuk: '2. Kolom Hari diisi: Senin, Selasa, Rabu, Kamis, Jumat, atau Sabtu.' },
    { Petunjuk: '3. Kolom Jam Mulai & Jam Selesai menggunakan format HH:MM (contoh 07:15 dan 08:45).' },
    { Petunjuk: '4. Kolom Guru diisi sesuai Nama atau Username akun Guru/Wali Kelas yang terdaftar di Pengaturan Akun.' },
    { Petunjuk: '5. Kolom Semester opsional (Ganjil atau Genap; jika kosong otomatis mengikuti semester aktif).' },
  ];
  const guideWs = XLSX.utils.json_to_sheet(guideData);
  guideWs['!cols'] = [{ wch: 96 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Template Jadwal Guru');
  XLSX.utils.book_append_sheet(wb, guideWs, 'Petunjuk');
  XLSX.writeFile(wb, 'Template_Jadwal_Pelajaran_Guru.xlsx');
}
