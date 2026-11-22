import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  CalendarDays,
  CalendarRange,
  Clock,
  Coffee,
  Download,
  FileSpreadsheet,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type {
  DayOfWeek,
  MasterSubject,
  SchoolDayCount,
  SchoolSettings,
  SemesterKind,
  TeacherSchedule,
  TimetableBreak,
  TimetableConfig,
  UserAccount,
} from '../types';
import {
  buildTeacherSchedulesFromTimetable,
  createDefaultTimetableConfig,
  DEFAULT_TIMETABLE_CLASSES,
  detectTimetableTeacherConflicts,
  generateDailyTimeSlots,
  getSchoolDaysForCount,
  getTimetableConfigKey,
  hydrateTimetableCellsFromSchedules,
  makeTimetableCellKey,
} from '../utils/timetableLogic';
import {
  downloadTimetableMatrixTemplate,
  parseTimetableMatrixFile,
  type TimetableMatrixImportResult,
} from '../utils/scheduleImportExport';
import { formatSemesterLabel, normalizeSemester } from '../utils/subjectAttendance';

interface TimetableMatrixViewProps {
  settings: SchoolSettings;
  accounts: UserAccount[];
  availableClasses: string[];
  availableYears: string[];
  masterSubjects: MasterSubject[];
  schedules: TeacherSchedule[];
  timetableConfigs: Record<string, TimetableConfig>;
  onSaveTimetable: (
    config: TimetableConfig,
    syncedSchedules: TeacherSchedule[],
    activeClasses: string[],
    options?: { silent?: boolean }
  ) => void;
  onNavigateToScheduleManagement?: () => void;
}

const ACADEMIC_YEAR_PRESETS = [
  '2024/2025',
  '2025/2026',
  '2026/2027',
  '2027/2028',
  '2028/2029',
];

export function TimetableMatrixView({
  settings,
  accounts,
  availableClasses,
  availableYears,
  masterSubjects,
  schedules,
  timetableConfigs,
  onSaveTimetable,
  onNavigateToScheduleManagement,
}: TimetableMatrixViewProps) {
  const [selectedYear, setSelectedYear] = useState<string>(settings.tahun_ajaran);
  const [selectedSemester, setSelectedSemester] = useState<SemesterKind>(() =>
    normalizeSemester(settings.semester, 'ganjil')
  );
  const [filterDay, setFilterDay] = useState<DayOfWeek | 'ALL'>('ALL');
  const [newClassName, setNewClassName] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const lastSelfSyncedStampRef = useRef<string | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importMode, setImportMode] = useState<'replace' | 'merge'>('replace');
  const [importFileName, setImportFileName] = useState('');
  const [importParsing, setImportParsing] = useState(false);
  const [importPreview, setImportPreview] = useState<TimetableMatrixImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const configKey = useMemo(
    () => getTimetableConfigKey(selectedYear, selectedSemester),
    [selectedYear, selectedSemester]
  );

  // Build active editable draft for the selected (tahun_ajaran, semester)
  const buildDraftForKey = (
    year: string,
    semester: SemesterKind,
    storedConfigs: Record<string, TimetableConfig>,
    existingSchedules: TeacherSchedule[]
  ): TimetableConfig => {
    const key = getTimetableConfigKey(year, semester);
    const saved = storedConfigs[key];
    if (saved) {
      return {
        ...saved,
        istirahat: saved.istirahat.map((b) => ({ ...b })),
        custom_classes: [...(saved.custom_classes || [])],
        cells: { ...saved.cells },
      };
    }
    const base = createDefaultTimetableConfig(
      year,
      semester,
      settings.batas_jam_masuk || '07:15'
    );
    return hydrateTimetableCellsFromSchedules(base, existingSchedules, false);
  };

  const [draft, setDraft] = useState<TimetableConfig>(() =>
    buildDraftForKey(selectedYear, selectedSemester, timetableConfigs, schedules)
  );

  const storedConfigStamp = timetableConfigs[configKey]?.updated_at ?? '';

  // Reload draft whenever Tahun Ajaran / Semester changes OR when Mapel & Jadwal / Guru / Cloud updates schedules externally
  useEffect(() => {
    if (
      storedConfigStamp &&
      lastSelfSyncedStampRef.current &&
      storedConfigStamp === lastSelfSyncedStampRef.current
    ) {
      return;
    }
    setDraft(
      buildDraftForKey(selectedYear, selectedSemester, timetableConfigs, schedules)
    );
    setHasUnsavedChanges(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey, storedConfigStamp]);

  // All academic year choices
  const yearOptions = useMemo(() => {
    const set = new Set<string>([
      settings.tahun_ajaran,
      ...ACADEMIC_YEAR_PRESETS,
      ...availableYears,
    ]);
    for (const s of schedules) {
      if (s.tahun_ajaran?.trim()) set.add(s.tahun_ajaran.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [settings.tahun_ajaran, availableYears, schedules]);

  // Eligible teachers (Guru & Wali Kelas)
  const teachingAccounts = useMemo(
    () =>
      accounts
        .filter((a) => a.role === 'guru' || a.role === 'wali_kelas')
        .sort((a, b) => a.nama.localeCompare(b.nama)),
    [accounts]
  );

  // Sorted master subject options (plus any subject currently used in cells/schedules)
  const subjectOptions = useMemo(() => {
    const map = new Map<string, { nama: string; kode?: string }>();
    for (const m of masterSubjects) {
      map.set(m.nama.trim().toLowerCase(), { nama: m.nama.trim(), kode: m.kode });
    }
    for (const cell of Object.values(draft.cells)) {
      const name = cell?.mata_pelajaran?.trim();
      if (name && !map.has(name.toLowerCase())) {
        map.set(name.toLowerCase(), { nama: name });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.nama.localeCompare(b.nama));
  }, [masterSubjects, draft.cells]);

  // Class columns for the table (students + schedules + custom added classes, fallback to default classes if school is still empty)
  const activeClasses = useMemo(() => {
    const set = new Set<string>();
    for (const c of availableClasses) {
      if (c.trim()) set.add(c.trim());
    }
    for (const s of schedules) {
      if (
        s.tahun_ajaran === selectedYear &&
        (!s.semester || normalizeSemester(s.semester) === selectedSemester) &&
        s.kelas.trim()
      ) {
        set.add(s.kelas.trim());
      }
    }
    for (const c of draft.custom_classes || []) {
      if (c.trim()) set.add(c.trim());
    }
    if (set.size === 0) {
      for (const c of DEFAULT_TIMETABLE_CLASSES) set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [availableClasses, schedules, selectedYear, selectedSemester, draft.custom_classes]);

  const schoolDays = useMemo(
    () => getSchoolDaysForCount(draft.jumlah_hari),
    [draft.jumlah_hari]
  );

  const visibleDays = useMemo(() => {
    if (filterDay === 'ALL') return schoolDays;
    return schoolDays.includes(filterDay) ? [filterDay] : schoolDays;
  }, [schoolDays, filterDay]);

  const dailySlots = useMemo(() => generateDailyTimeSlots(draft), [draft]);

  const conflicts = useMemo(
    () => detectTimetableTeacherConflicts(draft, activeClasses),
    [draft, activeClasses]
  );

  const conflictCellSet = useMemo(() => {
    const set = new Set<string>();
    for (const c of conflicts) {
      for (const cls of c.classes) {
        set.add(makeTimetableCellKey(c.hari, c.jamKe, cls));
      }
    }
    return set;
  }, [conflicts]);

  const filledCellsCount = useMemo(() => {
    const validDays = new Set(schoolDays);
    const validClasses = new Set(activeClasses);
    let count = 0;
    for (const [k, val] of Object.entries(draft.cells)) {
      if (!val?.mata_pelajaran?.trim()) continue;
      const [h, jpStr, ...clsParts] = k.split('|');
      const jp = Number(jpStr);
      const cls = clsParts.join('|');
      if (
        validDays.has(h as DayOfWeek) &&
        jp >= 1 &&
        jp <= draft.jumlah_jp &&
        validClasses.has(cls)
      ) {
        count++;
      }
    }
    return count;
  }, [draft.cells, draft.jumlah_jp, schoolDays, activeClasses]);

  // === Draft Updaters (with instant automatic sync to Mapel & Jadwal + Menu Mapel Guru) ===
  function persistAndSyncDraft(
    nextDraft: TimetableConfig,
    classesOverride?: string[],
    silent = true
  ) {
    const targetClasses = Array.from(
      new Set([...(classesOverride ?? activeClasses), ...(nextDraft.custom_classes || [])])
    ).sort((a, b) => a.localeCompare(b));
    const stamp = new Date().toISOString();
    const normalizedConfig: TimetableConfig = {
      ...nextDraft,
      tahun_ajaran: selectedYear,
      semester: selectedSemester,
      custom_classes: targetClasses,
      updated_at: stamp,
    };
    lastSelfSyncedStampRef.current = stamp;
    const syncedSchedules = buildTeacherSchedulesFromTimetable(
      normalizedConfig,
      targetClasses
    );
    onSaveTimetable(normalizedConfig, syncedSchedules, targetClasses, { silent });
    setHasUnsavedChanges(false);
  }

  function updateDraft(patch: Partial<TimetableConfig>) {
    const nextDraft: TimetableConfig = { ...draft, ...patch };
    setDraft(nextDraft);
    persistAndSyncDraft(nextDraft, undefined, true);
  }

  function handleBreakChange(
    breakId: string,
    patch: Partial<TimetableBreak>
  ) {
    const nextDraft: TimetableConfig = {
      ...draft,
      istirahat: draft.istirahat.map((b) =>
        b.id === breakId ? { ...b, ...patch } : b
      ),
    };
    setDraft(nextDraft);
    persistAndSyncDraft(nextDraft, undefined, true);
  }

  function handleAddBreak() {
    const nextNum = draft.istirahat.length + 1;
    const last = draft.istirahat[draft.istirahat.length - 1];
    const defaultStart = last?.jam_selesai === '09:45'
      ? '12:00'
      : last?.jam_selesai === '12:30'
        ? '14:00'
        : '10:00';
    const defaultEnd = defaultStart === '12:00'
      ? '12:30'
      : defaultStart === '14:00'
        ? '14:15'
        : '10:15';
    const nextDraft: TimetableConfig = {
      ...draft,
      istirahat: [
        ...draft.istirahat,
        {
          id: `brk_${Date.now()}_${nextNum}`,
          label: `Istirahat ${nextNum}`,
          jam_mulai: defaultStart,
          jam_selesai: defaultEnd,
        },
      ],
    };
    setDraft(nextDraft);
    persistAndSyncDraft(nextDraft, undefined, true);
  }

  function handleRemoveBreak(breakId: string) {
    const nextDraft: TimetableConfig = {
      ...draft,
      istirahat: draft.istirahat.filter((b) => b.id !== breakId),
    };
    setDraft(nextDraft);
    persistAndSyncDraft(nextDraft, undefined, true);
  }

  function handleAddCustomClass(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = newClassName.trim();
    if (!cleaned) return;
    if (activeClasses.some((c) => c.toLowerCase() === cleaned.toLowerCase())) {
      setNewClassName('');
      return;
    }
    const nextClasses = [...activeClasses, cleaned];
    const nextDraft: TimetableConfig = {
      ...draft,
      custom_classes: [...(draft.custom_classes || []), cleaned],
    };
    setDraft(nextDraft);
    setNewClassName('');
    persistAndSyncDraft(nextDraft, nextClasses, true);
  }

  function handleCellSubjectChange(
    hari: DayOfWeek,
    jamKe: number,
    kelas: string,
    mataPelajaran: string
  ) {
    const key = makeTimetableCellKey(hari, jamKe, kelas);
    const nextCells = { ...draft.cells };
    if (!mataPelajaran.trim()) {
      delete nextCells[key];
    } else {
      const existing = draft.cells[key];
      nextCells[key] = {
        mata_pelajaran: mataPelajaran.trim(),
        teacher_user_id: existing?.teacher_user_id || teachingAccounts[0]?.id,
        teacher_name: existing?.teacher_name || teachingAccounts[0]?.nama,
      };
    }
    const nextDraft: TimetableConfig = { ...draft, cells: nextCells };
    setDraft(nextDraft);
    persistAndSyncDraft(nextDraft, undefined, true);
  }

  function handleCellTeacherChange(
    hari: DayOfWeek,
    jamKe: number,
    kelas: string,
    teacherId: string
  ) {
    const key = makeTimetableCellKey(hari, jamKe, kelas);
    const existing = draft.cells[key];
    if (!existing) return;
    const teacher = teachingAccounts.find((t) => t.id === teacherId);
    const nextDraft: TimetableConfig = {
      ...draft,
      cells: {
        ...draft.cells,
        [key]: {
          ...existing,
          teacher_user_id: teacher?.id || undefined,
          teacher_name: teacher?.nama || undefined,
        },
      },
    };
    setDraft(nextDraft);
    persistAndSyncDraft(nextDraft, undefined, true);
  }

  function handleClearCell(hari: DayOfWeek, jamKe: number, kelas: string) {
    const key = makeTimetableCellKey(hari, jamKe, kelas);
    if (!draft.cells[key]) return;
    const nextCells = { ...draft.cells };
    delete nextCells[key];
    const nextDraft: TimetableConfig = { ...draft, cells: nextCells };
    setDraft(nextDraft);
    persistAndSyncDraft(nextDraft, undefined, true);
  }

  function handleLoadFromTeacherSchedules() {
    const nextDraft = hydrateTimetableCellsFromSchedules(draft, schedules, true);
    setDraft(nextDraft);
    persistAndSyncDraft(nextDraft, undefined, false);
  }

  function handleSaveAndSync() {
    persistAndSyncDraft(draft, undefined, false);
  }

  function handleExportExcel() {
    const rows: Array<Record<string, string | number>> = [];
    for (const hari of visibleDays) {
      for (const slot of dailySlots) {
        if (slot.kind === 'break') {
          const row: Record<string, string | number> = {
            Hari: hari,
            'Jam ke': slot.label,
            Waktu: `${slot.jam_mulai} - ${slot.jam_selesai}`,
          };
          for (const cls of activeClasses) {
            row[cls] = slot.label.toUpperCase();
          }
          rows.push(row);
        } else {
          const row: Record<string, string | number> = {
            Hari: hari,
            'Jam ke': slot.jamKe,
            Waktu: `${slot.jam_mulai} - ${slot.jam_selesai}`,
          };
          for (const cls of activeClasses) {
            const cell = draft.cells[makeTimetableCellKey(hari, slot.jamKe, cls)];
            row[cls] = cell?.mata_pelajaran
              ? cell.teacher_name
                ? `${cell.mata_pelajaran} (${cell.teacher_name})`
                : cell.mata_pelajaran
              : '-';
          }
          rows.push(row);
        }
      }
    }

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Jadwal_Mapel');
    const safeYear = selectedYear.replace(/[^0-9]+/g, '_');
    XLSX.writeFile(
      wb,
      `Jadwal_Mata_Pelajaran_TA_${safeYear}_${formatSemesterLabel(selectedSemester)}.xlsx`
    );
  }

  return (
    <div className="space-y-5" data-testid="timetable-matrix-view">
      {/* Top Filter & Schedule Parameter Bar */}
      <section className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              <CalendarRange className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-900">
                Pengaturan Jadwal Mata Pelajaran
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                TA <span className="font-mono font-semibold text-indigo-700">{selectedYear}</span>{' '}
                · Semester <strong className="text-slate-700">{formatSemesterLabel(selectedSemester)}</strong>{' '}
                · {draft.jumlah_hari} Hari ({draft.jumlah_hari === 6 ? 'Senin–Sabtu' : 'Senin–Jumat'}) ·{' '}
                <span className="font-mono tabular-nums">{draft.durasi_jp_menit}</span> menit/JP ·{' '}
                <span className="font-mono tabular-nums">{filledCellsCount}</span> slot terisi
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onNavigateToScheduleManagement && (
              <button
                type="button"
                data-testid="btn-open-mapel-jadwal"
                onClick={onNavigateToScheduleManagement}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-indigo-200 bg-indigo-50 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors whitespace-nowrap"
              >
                <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Lihat di Mapel &amp; Jadwal</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleLoadFromTeacherSchedules}
              title="Sinkron ulang tabel dari daftar Jadwal Pelajaran Guru di menu Mapel & Jadwal"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              <RefreshCw className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
              <span>Muat dari Jadwal Guru</span>
            </button>

            <button
              type="button"
              data-testid="btn-import-timetable-excel"
              onClick={() => {
                setImportModalOpen(true);
                setImportFileName('');
                setImportPreview(null);
                setImportError(null);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-indigo-200 bg-indigo-50/70 text-xs font-semibold text-indigo-700 hover:bg-indigo-100/70 transition-colors whitespace-nowrap"
            >
              <Upload className="h-3.5 w-3.5 text-indigo-600" aria-hidden="true" />
              <span>Import Excel / CSV</span>
            </button>

            <button
              type="button"
              onClick={handleExportExcel}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              <span>Export Excel</span>
            </button>

            <button
              type="button"
              data-testid="btn-save-timetable"
              onClick={handleSaveAndSync}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors whitespace-nowrap"
            >
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
              <span>
                {hasUnsavedChanges
                  ? 'Simpan & Sinkronkan Jadwal'
                  : 'Simpan & Sinkronkan'}
              </span>
            </button>
          </div>
        </div>

        {/* Filter Controls Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-4 border-t border-slate-100">
          <div>
            <label
              htmlFor="tt-tahun-ajaran"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Tahun Ajaran
            </label>
            <select
              id="tt-tahun-ajaran"
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              {yearOptions.map((yr) => (
                <option key={yr} value={yr}>
                  {yr}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="tt-semester"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Semester
            </label>
            <select
              id="tt-semester"
              value={selectedSemester}
              onChange={(e) => setSelectedSemester(e.target.value as SemesterKind)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="ganjil">Ganjil</option>
              <option value="genap">Genap</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="tt-jumlah-hari"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Jumlah Hari Sekolah
            </label>
            <select
              id="tt-jumlah-hari"
              value={draft.jumlah_hari}
              onChange={(e) => {
                const nextDays = Number(e.target.value) === 6 ? 6 : 5;
                updateDraft({ jumlah_hari: nextDays as SchoolDayCount });
                if (nextDays === 5 && filterDay === 'Sabtu') {
                  setFilterDay('ALL');
                }
              }}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value={5}>Senin – Jumat (5 Hari)</option>
              <option value={6}>Senin – Sabtu (6 Hari)</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="tt-jam-mulai"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Jam Mulai Sekolah
            </label>
            <input
              id="tt-jam-mulai"
              type="time"
              value={draft.jam_mulai_sekolah}
              onChange={(e) =>
                updateDraft({ jam_mulai_sekolah: e.target.value || '07:15' })
              }
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          <div>
            <label
              htmlFor="tt-durasi-jp"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Jam Pelajaran (Menit)
            </label>
            <input
              id="tt-durasi-jp"
              type="number"
              min={15}
              max={180}
              step={5}
              value={draft.durasi_jp_menit}
              onChange={(e) =>
                updateDraft({
                  durasi_jp_menit: Math.max(
                    15,
                    Math.min(180, Number(e.target.value) || 45)
                  ),
                })
              }
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono tabular-nums text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          <div>
            <label
              htmlFor="tt-jumlah-jp"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Jumlah Jam / Hari
            </label>
            <input
              id="tt-jumlah-jp"
              type="number"
              min={1}
              max={16}
              value={draft.jumlah_jp}
              onChange={(e) =>
                updateDraft({
                  jumlah_jp: Math.max(
                    1,
                    Math.min(16, Number(e.target.value) || 8)
                  ),
                })
              }
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono tabular-nums text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>
        </div>

        {/* Manual Break Slots Section (Jam Istirahat: Istirahat 1, Istirahat 2, dst) */}
        <div className="pt-4 border-t border-slate-100 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Coffee className="h-4 w-4 text-amber-600" aria-hidden="true" />
              <span className="text-xs font-semibold text-slate-800">
                Jam Istirahat (Diatur Jamnya Manual)
              </span>
              <span className="text-[11px] text-slate-500">
                · Waktu jam pelajaran otomatis menyesuaikan setelah jam istirahat
              </span>
            </div>
            <button
              type="button"
              data-testid="btn-add-break"
              onClick={handleAddBreak}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition-colors whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Tambah Istirahat</span>
            </button>
          </div>

          {draft.istirahat.length === 0 ? (
            <p className="text-xs text-slate-500">
              Belum ada jam istirahat. Klik <strong>Tambah Istirahat</strong> untuk menambahkan Istirahat 1, Istirahat 2, dst.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
              {draft.istirahat.map((brk, idx) => (
                <div
                  key={brk.id}
                  data-testid={`break-slot-${idx + 1}`}
                  className="flex flex-wrap sm:flex-nowrap items-center gap-2 rounded-xl border border-amber-200/80 bg-amber-50/40 px-3 py-2"
                >
                  <input
                    type="text"
                    aria-label={`Nama istirahat ${idx + 1}`}
                    value={brk.label}
                    onChange={(e) =>
                      handleBreakChange(brk.id, { label: e.target.value })
                    }
                    className="w-28 min-w-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:border-indigo-500 focus:outline-none"
                  />
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <input
                      type="time"
                      aria-label={`Jam mulai ${brk.label}`}
                      value={brk.jam_mulai}
                      onChange={(e) =>
                        handleBreakChange(brk.id, { jam_mulai: e.target.value })
                      }
                      className="w-full min-w-[82px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-mono text-slate-900 focus:border-indigo-500 focus:outline-none"
                    />
                    <span className="text-[11px] text-slate-400 shrink-0">s.d.</span>
                    <input
                      type="time"
                      aria-label={`Jam selesai ${brk.label}`}
                      value={brk.jam_selesai}
                      onChange={(e) =>
                        handleBreakChange(brk.id, { jam_selesai: e.target.value })
                      }
                      className="w-full min-w-[82px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-mono text-slate-900 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveBreak(brk.id)}
                    aria-label={`Hapus ${brk.label}`}
                    title={`Hapus ${brk.label}`}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Day Filter Tabs + Add Custom Class */}
        <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="Filter tampilan hari jadwal"
            className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl overflow-x-auto max-w-full"
          >
            <button
              type="button"
              role="tab"
              aria-selected={filterDay === 'ALL'}
              onClick={() => setFilterDay('ALL')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                filterDay === 'ALL'
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Semua Hari ({schoolDays.length})
            </button>
            {schoolDays.map((day) => (
              <button
                key={day}
                type="button"
                role="tab"
                aria-selected={filterDay === day}
                onClick={() => setFilterDay(day)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  filterDay === day
                    ? 'bg-white text-indigo-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {day}
              </button>
            ))}
          </div>

          <form onSubmit={handleAddCustomClass} className="flex items-center gap-2">
            <input
              type="text"
              value={newClassName}
              onChange={(e) => setNewClassName(e.target.value)}
              placeholder="Tambah kolom kelas (mis. X IPA 3)"
              aria-label="Tambah kolom kelas baru"
              className="w-52 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!newClassName.trim()}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-indigo-200 bg-indigo-50 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Tambah Kelas</span>
            </button>
          </form>
        </div>
      </section>

      {/* Teacher Conflict Warning Banner */}
      {conflicts.length > 0 && (
        <div
          role="alert"
          className="rounded-2xl border border-rose-200 bg-rose-50/80 px-4 py-3.5 flex items-start gap-3"
        >
          <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-semibold text-rose-900">
              Terdeteksi {conflicts.length} Bentrok Jadwal Guru
            </p>
            <p className="text-xs text-rose-800">
              {conflicts
                .slice(0, 3)
                .map(
                  (c) =>
                    `${c.teacher_name} pada ${c.hari} Jam ke-${c.jamKe} (${c.classes.join(' & ')})`
                )
                .join(' · ')}
              {conflicts.length > 3 ? ` · dan ${conflicts.length - 3} lainnya` : ''}
            </p>
          </div>
        </div>
      )}

      {/* Timetable Matrix Table */}
      <section className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>
            Pilih <strong>Mata Pelajaran</strong> &amp; <strong>Guru Pengampu</strong> pada setiap kolom kelas, lalu klik <strong>Simpan &amp; Sinkronkan Jadwal</strong> agar otomatis tampil di <em>Jadwal Pelajaran Guru</em> dan <em>Menu Presensi Mapel</em> masing-masing guru.
          </span>
          {hasUnsavedChanges && (
            <span className="font-semibold text-amber-700 whitespace-nowrap">
              Ada perubahan belum disimpan
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table
            data-testid="timetable-matrix-table"
            className="w-full text-left border-collapse text-xs"
          >
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <th
                  rowSpan={2}
                  className="py-3 px-3.5 border-r border-slate-200/80 w-24 whitespace-nowrap align-middle"
                >
                  Hari
                </th>
                <th
                  rowSpan={2}
                  className="py-3 px-3 border-r border-slate-200/80 w-20 text-center whitespace-nowrap align-middle"
                >
                  Jam ke
                </th>
                <th
                  rowSpan={2}
                  className="py-3 px-3.5 border-r border-slate-200/80 w-32 whitespace-nowrap align-middle"
                >
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                    Waktu
                  </span>
                </th>
                <th
                  colSpan={activeClasses.length}
                  className="py-2 px-3 text-center border-b border-slate-200/80 text-indigo-700 bg-indigo-50/40"
                >
                  Kelas ({activeClasses.length} Kelas) — Daftar Mata Pelajaran per Jam Pelajaran
                </th>
              </tr>
              <tr className="bg-slate-50/90 border-b border-slate-200 text-slate-700 font-semibold">
                {activeClasses.map((cls) => (
                  <th
                    key={cls}
                    className="py-2.5 px-3 border-r last:border-r-0 border-slate-200/70 min-w-[175px] whitespace-nowrap"
                  >
                    {cls}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-200/70">
              {visibleDays.map((hari, dayIdx) =>
                dailySlots.map((slot, slotIdx) => {
                  const isFirstOfDay = slotIdx === 0;
                  const dayBorderTop =
                    isFirstOfDay && dayIdx > 0 ? 'border-t-2 border-t-slate-300' : '';

                  if (slot.kind === 'break') {
                    return (
                      <tr
                        key={`${hari}-brk-${slot.breakId}`}
                        className={`bg-amber-50/70 ${dayBorderTop}`}
                      >
                        {isFirstOfDay && (
                          <td
                            rowSpan={dailySlots.length}
                            className="py-3 px-3.5 font-bold text-slate-900 bg-white border-r border-slate-200/80 align-top whitespace-nowrap"
                          >
                            {hari}
                          </td>
                        )}
                        <td className="py-2.5 px-3 text-center font-semibold text-amber-800 border-r border-amber-200/70 whitespace-nowrap">
                          {slot.label}
                        </td>
                        <td className="py-2.5 px-3.5 font-mono tabular-nums font-medium text-amber-900 border-r border-amber-200/70 whitespace-nowrap">
                          {slot.jam_mulai} – {slot.jam_selesai}
                        </td>
                        <td
                          colSpan={activeClasses.length}
                          className="py-2.5 px-4 text-center text-xs font-semibold tracking-wide text-amber-800"
                        >
                          {slot.label} ({slot.jam_mulai} – {slot.jam_selesai})
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr
                      key={`${hari}-jp-${slot.jamKe}`}
                      className={`hover:bg-slate-50/50 transition-colors ${dayBorderTop}`}
                    >
                      {isFirstOfDay && (
                        <td
                          rowSpan={dailySlots.length}
                          className="py-3 px-3.5 font-bold text-slate-900 bg-white border-r border-slate-200/80 align-top whitespace-nowrap"
                        >
                          {hari}
                        </td>
                      )}
                      <td className="py-2.5 px-3 text-center font-mono tabular-nums font-semibold text-slate-700 border-r border-slate-200/70 whitespace-nowrap">
                        {slot.jamKe}
                      </td>
                      <td className="py-2.5 px-3.5 font-mono tabular-nums text-slate-600 border-r border-slate-200/70 whitespace-nowrap">
                        {slot.jam_mulai} – {slot.jam_selesai}
                      </td>

                      {activeClasses.map((cls) => {
                        const cellKey = makeTimetableCellKey(hari, slot.jamKe, cls);
                        const cell = draft.cells[cellKey];
                        const isFilled = Boolean(cell?.mata_pelajaran);
                        const isConflict = conflictCellSet.has(cellKey);

                        return (
                          <td
                            key={cellKey}
                            className={`p-1.5 border-r last:border-r-0 border-slate-200/70 align-top ${
                              isConflict
                                ? 'bg-rose-50/80'
                                : isFilled
                                  ? 'bg-indigo-50/35'
                                  : 'bg-white'
                            }`}
                          >
                            <div className="space-y-1">
                              <div className="flex items-center gap-1">
                                <select
                                  aria-label={`Mapel ${hari} jam ke ${slot.jamKe} kelas ${cls}`}
                                  data-cell-subject={cellKey}
                                  value={cell?.mata_pelajaran || ''}
                                  onChange={(e) =>
                                    handleCellSubjectChange(
                                      hari,
                                      slot.jamKe,
                                      cls,
                                      e.target.value
                                    )
                                  }
                                  className={`w-full min-w-0 rounded-lg border px-2 py-1.5 text-[11px] focus:border-indigo-500 focus:outline-none ${
                                    isConflict
                                      ? 'border-rose-300 bg-white font-semibold text-rose-900'
                                      : isFilled
                                        ? 'border-indigo-200 bg-white font-semibold text-slate-900'
                                        : 'border-slate-200/90 bg-slate-50/60 text-slate-500 hover:bg-white'
                                  }`}
                                >
                                  <option value="">— Kosong —</option>
                                  {subjectOptions.map((sub) => (
                                    <option key={sub.nama} value={sub.nama}>
                                      {sub.kode ? `[${sub.kode}] ${sub.nama}` : sub.nama}
                                    </option>
                                  ))}
                                </select>

                                {isFilled && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleClearCell(hari, slot.jamKe, cls)
                                    }
                                    aria-label={`Kosongkan ${hari} jam ke ${slot.jamKe} kelas ${cls}`}
                                    title="Kosongkan sel"
                                    className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors shrink-0"
                                  >
                                    <X className="h-3 w-3" aria-hidden="true" />
                                  </button>
                                )}
                              </div>

                              {isFilled && (
                                <select
                                  aria-label={`Guru ${hari} jam ke ${slot.jamKe} kelas ${cls}`}
                                  data-cell-teacher={cellKey}
                                  value={cell?.teacher_user_id || ''}
                                  onChange={(e) =>
                                    handleCellTeacherChange(
                                      hari,
                                      slot.jamKe,
                                      cls,
                                      e.target.value
                                    )
                                  }
                                  className={`w-full rounded-lg border px-2 py-1 text-[10.5px] focus:border-indigo-500 focus:outline-none ${
                                    isConflict
                                      ? 'border-rose-300 bg-rose-50 text-rose-800 font-semibold'
                                      : 'border-slate-200/80 bg-white text-slate-600'
                                  }`}
                                >
                                  <option value="">-- Pilih Guru --</option>
                                  {teachingAccounts.map((t) => (
                                    <option key={t.id} value={t.id}>
                                      {t.nama}
                                    </option>
                                  ))}
                                </select>
                              )}

                              {isConflict && (
                                <p className="text-[10px] font-semibold text-rose-700 px-1">
                                  Bentrok guru di jam ini
                                </p>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Modal: Import Pengaturan Jadwal dari Excel / CSV */}
      {importModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-timetable-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[1px]"
        >
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="h-9 w-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                  <FileSpreadsheet className="h-4.5 w-4.5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h3 id="import-timetable-title" className="text-base font-semibold text-slate-900 truncate">
                    Import Jadwal Pelajaran (Excel / CSV)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Mendukung file .xlsx, .xls, dan .csv (format matriks kelas atau daftar baris)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setImportModalOpen(false)}
                aria-label="Tutup modal import jadwal"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="text-xs text-slate-600 leading-relaxed">
                  <p className="font-semibold text-slate-800">Belum punya format file?</p>
                  <p className="mt-0.5">
                    Unduh template Excel yang sudah sesuai kolom kelas &amp; jam pelajaran aktif.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    downloadTimetableMatrixTemplate(activeClasses, teachingAccounts, draft)
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  <Download className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                  <span>Unduh Template .xlsx</span>
                </button>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700">
                  Mode Penggabungan Data
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setImportMode('replace')}
                    className={`px-3 py-2 rounded-xl border text-xs font-semibold text-left transition-colors ${
                      importMode === 'replace'
                        ? 'border-indigo-500 bg-indigo-50/60 text-indigo-800'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Ganti Isi Tabel Aktif
                  </button>
                  <button
                    type="button"
                    onClick={() => setImportMode('merge')}
                    className={`px-3 py-2 rounded-xl border text-xs font-semibold text-left transition-colors ${
                      importMode === 'merge'
                        ? 'border-indigo-500 bg-indigo-50/60 text-indigo-800'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Gabung dengan Data Lama
                  </button>
                </div>
              </div>

              <div>
                <label
                  htmlFor="timetable-excel-input"
                  className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 hover:border-indigo-400 bg-slate-50/50 hover:bg-indigo-50/30 px-4 py-6 cursor-pointer transition-colors text-center"
                >
                  <Upload className="h-6 w-6 text-indigo-500" aria-hidden="true" />
                  <span className="text-xs font-semibold text-slate-800">
                    {importFileName || 'Pilih file Excel (.xlsx / .xls) atau CSV (.csv)'}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Format sel matriks: <code className="font-mono text-slate-700">Matematika (Nama Guru)</code> atau <code className="font-mono text-slate-700">Matematika</code>
                  </span>
                  <input
                    id="timetable-excel-input"
                    data-testid="input-import-timetable-file"
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="sr-only"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      setImportFileName(file.name);
                      setImportError(null);
                      setImportParsing(true);
                      try {
                        const parsed = await parseTimetableMatrixFile(
                          file,
                          teachingAccounts,
                          draft
                        );
                        setImportPreview(parsed);
                        if (parsed.errors.length > 0) {
                          setImportError(parsed.errors[0]);
                        }
                      } catch {
                        setImportPreview(null);
                        setImportError(
                          'Gagal membaca file. Pastikan file berformat Excel (.xlsx/.xls) atau CSV yang valid.'
                        );
                      } finally {
                        setImportParsing(false);
                      }
                    }}
                  />
                </label>
              </div>

              {importParsing && (
                <p className="text-xs text-indigo-600 font-medium text-center">
                  Membaca file jadwal...
                </p>
              )}

              {importError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700">
                  {importError}
                </div>
              )}

              {importPreview && importPreview.parsedCount > 0 && (
                <div
                  data-testid="timetable-import-preview"
                  className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3.5 space-y-2 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-emerald-900">
                      Siap diterapkan: {importPreview.parsedCount} slot pelajaran
                    </span>
                    <span className="font-mono tabular-nums text-[11px] text-emerald-700">
                      {importPreview.detectedClasses.length} kelas · Format{' '}
                      {importPreview.formatDetected === 'matrix' ? 'Matriks' : 'Daftar'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600">
                    Kelas terdeteksi: {importPreview.detectedClasses.join(', ')}
                    {importPreview.hasSaturday ? ' · Termasuk hari Sabtu (6 hari)' : ''}
                  </p>
                  {importPreview.unmatchedTeachers.length > 0 && (
                    <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200/80 rounded-lg px-2.5 py-1.5">
                      Catatan: Guru berikut belum cocok dengan akun Guru terdaftar ({importPreview.unmatchedTeachers.slice(0, 4).join(', ')}). Anda tetap bisa memilih gurunya langsung di tabel.
                    </p>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setImportModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="button"
                  data-testid="btn-confirm-import-timetable"
                  disabled={!importPreview || importPreview.parsedCount === 0}
                  onClick={() => {
                    if (!importPreview || importPreview.parsedCount === 0) return;
                    const mergedClassesSet = new Set<string>([
                      ...(draft.custom_classes || []),
                      ...importPreview.detectedClasses.filter(
                        (cls) =>
                          !availableClasses.some(
                            (existing) => existing.toLowerCase() === cls.toLowerCase()
                          )
                      ),
                    ]);
                    const nextClassesList = Array.from(
                      new Set([...activeClasses, ...importPreview.detectedClasses])
                    );
                    const nextCells =
                      importMode === 'merge'
                        ? { ...draft.cells, ...importPreview.cells }
                        : { ...importPreview.cells };

                    const nextDraft: TimetableConfig = {
                      ...draft,
                      jumlah_hari: importPreview.hasSaturday ? 6 : draft.jumlah_hari,
                      jumlah_jp: Math.max(draft.jumlah_jp, Math.min(16, importPreview.maxJp)),
                      custom_classes: Array.from(mergedClassesSet),
                      cells: nextCells,
                      updated_at: new Date().toISOString(),
                    };
                    setDraft(nextDraft);
                    persistAndSyncDraft(nextDraft, nextClassesList, false);
                    setImportModalOpen(false);
                    setImportPreview(null);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Terapkan &amp; Sinkronkan</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
