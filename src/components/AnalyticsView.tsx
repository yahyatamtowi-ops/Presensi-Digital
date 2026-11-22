import { useMemo, useState } from 'react';
import {
  BarChart3,
  Calendar,
  Filter,
  Search,
  TrendingUp,
  Users,
  AlertTriangle,
  Award,
  GraduationCap,
  Download,
  FileSpreadsheet,
  Info,
} from 'lucide-react';
import type {
  AnalyticsPeriodType,
  AttendanceRecord,
  SchoolSettings,
  SemesterKind,
  Student,
} from '../types';
import {
  computeAttendanceAnalytics,
  getTodayDateString,
  type PeriodSummaryRow,
} from '../utils/attendanceLogic';
import {
  buildAttendanceComparisonExplanation,
  buildClassAttendanceExplanation,
} from '../utils/analyticsExplanation';
import {
  exportMonthlyAnalyticsExcel,
  generateMonthlyAnalyticsPdf,
} from '../utils/subjectAttendancePdf';

interface MasterYearControl {
  selectedYear: string;
  availableYears: string[];
  onChangeYear: (year: string) => void;
}

interface AnalyticsViewProps {
  students: Student[];
  records: AttendanceRecord[];
  settings: SchoolSettings;
  assignedClass?: string;
  masterYearControl?: MasterYearControl;
}

type SortKey = 'pct_desc' | 'pct_asc' | 'nama_asc' | 'alpa_desc';

const PERIOD_ORDER: AnalyticsPeriodType[] = [
  'harian',
  'mingguan',
  'bulanan',
  'semester',
  'tahunan',
];

function getPctBadge(row: PeriodSummaryRow): { label: string; className: string } {
  if (row.totalTercatat === 0) {
    return {
      label: 'Belum Ada Data',
      className: 'bg-slate-100 text-slate-600 border-slate-200',
    };
  }
  if (row.kehadiranPct >= 90) {
    return {
      label: 'Sangat Baik',
      className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    };
  }
  if (row.kehadiranPct >= 75) {
    return {
      label: 'Baik',
      className: 'bg-sky-50 text-sky-700 border-sky-200',
    };
  }
  return {
    label: 'Perlu Perhatian',
    className: 'bg-rose-50 text-rose-700 border-rose-200',
  };
}

function getBarColorClass(pct: number): string {
  if (pct >= 90) return 'bg-emerald-500';
  if (pct >= 75) return 'bg-indigo-500';
  if (pct >= 50) return 'bg-amber-500';
  return 'bg-rose-500';
}

export function AnalyticsView({
  students,
  records,
  settings,
  assignedClass,
  masterYearControl,
}: AnalyticsViewProps) {
  const today = getTodayDateString();
  const [selectedPeriod, setSelectedPeriod] = useState<AnalyticsPeriodType>('bulanan');
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedMonth, setSelectedMonth] = useState(today.slice(0, 7));
  const [selectedSemester, setSelectedSemester] = useState<SemesterKind>(
    Number(today.slice(5, 7)) >= 7 ? 'ganjil' : 'genap'
  );
  const [selectedSemesterYear, setSelectedSemesterYear] = useState<number>(
    Number(today.slice(0, 4)) || new Date().getFullYear()
  );
  const [selectedClass, setSelectedClass] = useState<string>(assignedClass || 'ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('pct_desc');
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [showComparisonInfo, setShowComparisonInfo] = useState(true);
  const [showClassInfo, setShowClassInfo] = useState(true);

  const classes = useMemo(() => {
    const set = new Set<string>();
    for (const s of students) {
      if (s.kelas.trim()) set.add(s.kelas.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [students]);

  const effectiveClass = assignedClass ? assignedClass : selectedClass;

  const filteredStudents = useMemo(() => {
    if (effectiveClass === 'ALL') return students;
    const norm = effectiveClass.trim().toLowerCase();
    return students.filter((s) => s.kelas.trim().toLowerCase() === norm);
  }, [students, effectiveClass]);

  const filteredRecords = useMemo(() => {
    if (effectiveClass === 'ALL') return records;
    const norm = effectiveClass.trim().toLowerCase();
    return records.filter((r) => r.kelas.trim().toLowerCase() === norm);
  }, [records, effectiveClass]);

  const effectiveAcademicYear =
    masterYearControl &&
    masterYearControl.selectedYear !== 'ACTIVE' &&
    masterYearControl.selectedYear !== 'ALL'
      ? masterYearControl.selectedYear
      : settings.tahun_ajaran;

  const analytics = useMemo(
    () =>
      computeAttendanceAnalytics({
        students: filteredStudents,
        records: filteredRecords,
        selectedPeriod,
        date: selectedDate,
        month: selectedMonth,
        semester: selectedSemester,
        semesterYear: selectedSemesterYear,
        academicYear: effectiveAcademicYear,
      }),
    [
      filteredStudents,
      filteredRecords,
      selectedPeriod,
      selectedDate,
      selectedMonth,
      selectedSemester,
      selectedSemesterYear,
      effectiveAcademicYear,
    ]
  );

  const visibleStudentRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = q
      ? analytics.studentRows.filter(
          (r) =>
            r.nama.toLowerCase().includes(q) ||
            r.nis.toLowerCase().includes(q) ||
            r.kelas.toLowerCase().includes(q)
        )
      : [...analytics.studentRows];

    list.sort((a, b) => {
      if (sortBy === 'pct_desc') {
        return (
          b.kehadiranPct - a.kehadiranPct ||
          b.totalTercatat - a.totalTercatat ||
          a.nama.localeCompare(b.nama)
        );
      }
      if (sortBy === 'pct_asc') {
        return (
          a.kehadiranPct - b.kehadiranPct ||
          b.alpa - a.alpa ||
          a.nama.localeCompare(b.nama)
        );
      }
      if (sortBy === 'alpa_desc') {
        return (
          b.alpa - a.alpa ||
          b.terlambat - a.terlambat ||
          a.kehadiranPct - b.kehadiranPct ||
          a.nama.localeCompare(b.nama)
        );
      }
      return a.nama.localeCompare(b.nama);
    });

    return list;
  }, [analytics.studentRows, searchQuery, sortBy]);

  const { selectedOverview } = analytics;

  async function handleDownloadMonthlyPdf() {
    setDownloadingPdf(true);
    try {
      const classLabel =
        effectiveClass === 'ALL' ? 'Semua Kelas' : `Kelas ${effectiveClass}`;
      const { blob, filename } = await generateMonthlyAnalyticsPdf({
        settings,
        monthLabel: analytics.overviews.bulanan.subtitle,
        monthKey: selectedMonth,
        academicYearLabel: effectiveAcademicYear,
        classLabel,
        overview: analytics.overviews.bulanan,
        rows: visibleStudentRows,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setDownloadingPdf(false);
    }
  }

  function handleDownloadMonthlyExcel() {
    const classLabel =
      effectiveClass === 'ALL' ? 'Semua_Kelas' : effectiveClass;
    exportMonthlyAnalyticsExcel({
      monthKey: selectedMonth,
      classLabel,
      rows: visibleStudentRows,
    });
  }
  const statusBreakdown = [
    {
      label: 'Hadir Tepat Waktu',
      count: selectedOverview.hadir,
      color: 'bg-emerald-500',
      text: 'text-emerald-700',
    },
    {
      label: 'Terlambat',
      count: selectedOverview.terlambat,
      color: 'bg-amber-500',
      text: 'text-amber-700',
    },
    {
      label: 'Sakit',
      count: selectedOverview.sakit,
      color: 'bg-sky-500',
      text: 'text-sky-700',
    },
    {
      label: 'Izin',
      count: selectedOverview.izin,
      color: 'bg-indigo-400',
      text: 'text-indigo-700',
    },
    {
      label: 'Alpa',
      count: selectedOverview.alpa,
      color: 'bg-rose-500',
      text: 'text-rose-700',
    },
  ];
  const totalStatusEntries = Math.max(1, selectedOverview.totalTercatat);

  return (
    <div className="space-y-6">
      {/* Master Admin Academic Year Banner or Wali Kelas Scope */}
      {(masterYearControl || assignedClass) && (
        <div className="bg-white rounded-2xl border border-slate-200/80 px-5 py-3.5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-xs">
            <GraduationCap className="h-4 w-4 text-indigo-600 shrink-0" aria-hidden="true" />
            {assignedClass ? (
              <span className="font-medium text-slate-700">
                Analisis khusus kelas binaan:{' '}
                <strong className="text-slate-900">{assignedClass}</strong> · Tahun Ajaran{' '}
                <strong className="font-mono text-indigo-700">{settings.tahun_ajaran}</strong>
              </span>
            ) : (
              <span className="font-medium text-slate-700">
                Tahun Ajaran Aktif:{' '}
                <strong className="font-mono text-indigo-700">{settings.tahun_ajaran}</strong>
              </span>
            )}
          </div>

          {masterYearControl && (
            <div className="flex items-center gap-2">
              <label
                htmlFor="analytics-academic-year"
                className="text-xs font-medium text-slate-500"
              >
                Arsip Tahun Ajaran:
              </label>
              <select
                id="analytics-academic-year"
                value={masterYearControl.selectedYear}
                onChange={(e) => masterYearControl.onChangeYear(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono font-medium text-slate-700 focus:border-indigo-500 focus:outline-none"
              >
                <option value="ACTIVE">Aktif ({settings.tahun_ajaran})</option>
                {masterYearControl.availableYears
                  .filter((y) => y !== settings.tahun_ajaran)
                  .map((y) => (
                    <option key={y} value={y}>
                      Arsip {y}
                    </option>
                  ))}
                <option value="ALL">Semua Tahun Ajaran</option>
              </select>
            </div>
          )}
        </div>
      )}

      {/* 5-Period Percentage Summary Cards: Harian, Mingguan, Bulanan, Semester, Tahunan */}
      <section aria-label="Ringkasan persentase kehadiran per periode">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
          {PERIOD_ORDER.map((periodKey) => {
            const ov = analytics.overviews[periodKey];
            const isSelected = selectedPeriod === periodKey;
            return (
              <button
                key={periodKey}
                type="button"
                data-analytics-period={periodKey}
                aria-pressed={isSelected}
                onClick={() => setSelectedPeriod(periodKey)}
                className={`text-left rounded-2xl border p-4 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  isSelected
                    ? 'bg-indigo-50/50 border-indigo-500 ring-2 ring-indigo-500/20 shadow-sm'
                    : 'bg-white border-slate-200/80 hover:border-indigo-200 hover:bg-slate-50/70 shadow-[0_1px_3px_rgba(15,23,42,0.04)]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                    {ov.shortLabel}
                  </span>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${
                      isSelected
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {isSelected ? 'Aktif' : `${ov.activeDays} hari`}
                  </span>
                </div>

                <div className="mt-2.5 flex items-baseline gap-1.5">
                  <span className="text-3xl font-bold tracking-tight font-mono tabular-nums text-slate-900">
                    {ov.kehadiranPct}%
                  </span>
                  <span className="text-[11px] text-slate-500">hadir</span>
                </div>

                <div className="mt-2.5 h-1.5 w-full rounded-full bg-slate-200/70 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${getBarColorClass(
                      ov.kehadiranPct
                    )}`}
                    style={{ width: `${Math.min(100, Math.max(0, ov.kehadiranPct))}%` }}
                  />
                </div>

                <p className="mt-2 text-[11px] text-slate-500 truncate" title={ov.subtitle}>
                  {ov.subtitle}
                </p>
                <p className="mt-0.5 text-[11px] font-mono tabular-nums text-slate-600">
                  H:{ov.hadir} · T:{ov.terlambat} · S/I/A:{ov.sakit + ov.izin + ov.alpa}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Filter Controls Bar */}
      <section className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-end gap-3.5">
          <div>
            <label
              htmlFor="analytics-date"
              className="flex items-center gap-1.5 text-xs font-medium text-slate-600 mb-1.5"
            >
              <Calendar className="h-3.5 w-3.5 text-indigo-600" aria-hidden="true" />
              <span>Tanggal Acuan (Harian &amp; Mingguan)</span>
            </label>
            <input
              id="analytics-date"
              type="date"
              value={selectedDate}
              onChange={(e) => {
                const v = e.target.value;
                setSelectedDate(v);
                if (v.length >= 7) setSelectedMonth(v.slice(0, 7));
              }}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          <div>
            <label
              htmlFor="analytics-month"
              className="block text-xs font-medium text-slate-600 mb-1.5"
            >
              Bulan (Bulanan)
            </label>
            <input
              id="analytics-month"
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-mono text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          <div>
            <label
              htmlFor="analytics-semester"
              className="block text-xs font-medium text-slate-600 mb-1.5"
            >
              Semester
            </label>
            <div className="flex items-center gap-2">
              <select
                id="analytics-semester"
                value={selectedSemester}
                onChange={(e) => setSelectedSemester(e.target.value as SemesterKind)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
              >
                <option value="ganjil">Ganjil (Jul–Des)</option>
                <option value="genap">Genap (Jan–Jun)</option>
              </select>
              <input
                type="number"
                min={2020}
                max={2035}
                aria-label="Tahun semester"
                value={selectedSemesterYear}
                onChange={(e) =>
                  setSelectedSemesterYear(Number(e.target.value) || new Date().getFullYear())
                }
                className="w-20 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-mono text-slate-900 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          {!assignedClass && (
            <div>
              <label
                htmlFor="analytics-class"
                className="flex items-center gap-1.5 text-xs font-medium text-slate-600 mb-1.5"
              >
                <Filter className="h-3.5 w-3.5 text-indigo-600" aria-hidden="true" />
                <span>Filter Kelas</span>
              </label>
              <select
                id="analytics-class"
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
              >
                <option value="ALL">Semua Kelas ({students.length} siswa)</option>
                {classes.map((cls) => (
                  <option key={cls} value={cls}>
                    {cls}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </section>

      {/* Bento Analytics Visuals Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Cross-Period Comparison + Selected Period Status Distribution */}
        <section className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/80 p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                <TrendingUp className="h-4.5 w-4.5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Perbandingan Persentase Kehadiran
                </h2>
                <p className="text-xs text-slate-500">
                  Grafik persentase hadir (tepat waktu + terlambat) dari Harian hingga Tahunan
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs font-mono tabular-nums px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-medium">
                {filteredStudents.length} siswa
              </span>
              <button
                type="button"
                data-testid="analytics-comparison-info-btn"
                onClick={() => setShowComparisonInfo((prev) => !prev)}
                aria-expanded={showComparisonInfo}
                aria-label="Penjelasan Perbandingan Persentase Kehadiran"
                title="Lihat penjelasan hasil analisis Perbandingan Persentase Kehadiran"
                className={`inline-flex items-center justify-center h-7 w-7 rounded-full border transition-colors ${
                  showComparisonInfo
                    ? 'bg-indigo-600 border-indigo-600 text-white'
                    : 'bg-white border-slate-200 text-indigo-600 hover:bg-indigo-50 hover:border-indigo-200'
                }`}
              >
                <Info className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>

          {showComparisonInfo && (() => {
            const exp = buildAttendanceComparisonExplanation(
              analytics.overviews,
              selectedPeriod
            );
            return (
              <div
                data-testid="analytics-comparison-info-bar"
                role="region"
                aria-label="Informasi Perbandingan Persentase Kehadiran"
                className="rounded-xl border border-indigo-200/80 bg-indigo-50/50 p-3.5 flex items-start gap-3"
              >
                <span
                  aria-hidden="true"
                  className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-indigo-600 text-white text-xs font-bold shrink-0 mt-0.5 select-none"
                >
                  i
                </span>
                <div className="min-w-0 space-y-1 text-xs text-slate-700 leading-relaxed">
                  <p className="font-semibold text-slate-900">{exp.headline}</p>
                  <p className="text-slate-700">{exp.dynamicSummary}</p>
                  <p className="text-[11px] text-slate-600">
                    <strong className="text-slate-800">Rumus:</strong> {exp.formulaNote}
                  </p>
                  <p className="text-[11px] text-slate-600">
                    <strong className="text-slate-800">Arti Warna:</strong> {exp.colorLegend}
                  </p>
                  <p className="text-[11px] text-indigo-700">{exp.interactionHint}</p>
                </div>
              </div>
            );
          })()}

          {/* 5-Period Vertical Bar Chart */}
          <div className="grid grid-cols-5 gap-3 sm:gap-5 items-end pt-2 h-48 border-b border-slate-100 pb-3">
            {PERIOD_ORDER.map((periodKey) => {
              const ov = analytics.overviews[periodKey];
              const isSelected = selectedPeriod === periodKey;
              const barHeightPct = Math.max(6, ov.kehadiranPct);
              return (
                <button
                  key={periodKey}
                  type="button"
                  onClick={() => setSelectedPeriod(periodKey)}
                  className="flex flex-col items-center justify-end h-full group focus-visible:outline-none"
                >
                  <span
                    className={`text-xs font-mono tabular-nums font-bold mb-1.5 ${
                      isSelected ? 'text-indigo-700' : 'text-slate-700'
                    }`}
                  >
                    {ov.kehadiranPct}%
                  </span>
                  <div className="w-full max-w-[54px] h-28 rounded-xl bg-slate-100 flex items-end overflow-hidden p-1">
                    <div
                      className={`w-full rounded-lg transition-all duration-300 ${
                        isSelected ? 'bg-indigo-600' : getBarColorClass(ov.kehadiranPct)
                      }`}
                      style={{ height: `${barHeightPct}%` }}
                    />
                  </div>
                  <span
                    className={`mt-2 text-[11px] font-semibold ${
                      isSelected ? 'text-indigo-700' : 'text-slate-600'
                    }`}
                  >
                    {ov.shortLabel}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Selected Period Status Breakdown */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-800 uppercase tracking-wide">
                Distribusi Status · {selectedOverview.label}
              </h3>
              <span className="text-xs font-mono tabular-nums text-slate-500">
                {selectedOverview.totalTercatat} catatan ({selectedOverview.activeDays} hari aktif)
              </span>
            </div>

            <div className="space-y-2.5">
              {statusBreakdown.map((item) => {
                const pct =
                  selectedOverview.totalTercatat > 0
                    ? Math.round((item.count / totalStatusEntries) * 100)
                    : 0;
                return (
                  <div key={item.label} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-700">{item.label}</span>
                      <span className="font-mono tabular-nums text-slate-600">
                        <strong className={item.text}>{item.count}</strong> ({pct}%)
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${item.color} transition-all duration-300`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Right: Class Ranking + Attention & Top Highlights */}
        <div className="lg:col-span-5 space-y-6">
          <section className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="h-9 w-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                  <BarChart3 className="h-4.5 w-4.5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-slate-900">
                    Persentase per Kelas ({selectedOverview.shortLabel})
                  </h2>
                  <p className="text-xs text-slate-500">{selectedOverview.subtitle}</p>
                </div>
              </div>
              <button
                type="button"
                data-testid="analytics-class-info-btn"
                onClick={() => setShowClassInfo((prev) => !prev)}
                aria-expanded={showClassInfo}
                aria-label={`Penjelasan Persentase per Kelas (${selectedOverview.shortLabel})`}
                title={`Lihat penjelasan hasil analisis Persentase per Kelas (${selectedOverview.shortLabel})`}
                className={`inline-flex items-center justify-center h-7 w-7 rounded-full border transition-colors shrink-0 ${
                  showClassInfo
                    ? 'bg-emerald-600 border-emerald-600 text-white'
                    : 'bg-white border-slate-200 text-emerald-600 hover:bg-emerald-50 hover:border-emerald-200'
                }`}
              >
                <Info className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>

            {showClassInfo && (() => {
              const exp = buildClassAttendanceExplanation(
                analytics.classAnalytics,
                selectedOverview
              );
              return (
                <div
                  data-testid="analytics-class-info-bar"
                  role="region"
                  aria-label="Informasi Persentase per Kelas"
                  className="rounded-xl border border-emerald-200/80 bg-emerald-50/50 p-3.5 flex items-start gap-3"
                >
                  <span
                    aria-hidden="true"
                    className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-emerald-600 text-white text-xs font-bold shrink-0 mt-0.5 select-none"
                  >
                    i
                  </span>
                  <div className="min-w-0 space-y-1 text-xs text-slate-700 leading-relaxed">
                    <p className="font-semibold text-slate-900">{exp.headline}</p>
                    <p className="text-slate-700">{exp.dynamicSummary}</p>
                    <p className="text-[11px] text-slate-600">{exp.legendNote}</p>
                    <p className="text-[11px] text-emerald-800">{exp.actionNote}</p>
                  </div>
                </div>
              );
            })()}

            {analytics.classAnalytics.length === 0 ? (
              <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200/70 rounded-xl px-4 py-5 text-center">
                Belum ada data kelas atau siswa pada tahun ajaran ini.
              </p>
            ) : (
              <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                {analytics.classAnalytics.map((cls) => (
                  <div key={cls.kelas} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-slate-900 truncate">
                        {cls.kelas}{' '}
                        <span className="font-normal text-slate-500">
                          ({cls.totalSiswa} siswa)
                        </span>
                      </span>
                      <span className="font-mono tabular-nums font-bold text-slate-800">
                        {cls.kehadiranPct}%
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${getBarColorClass(
                          cls.kehadiranPct
                        )}`}
                        style={{ width: `${Math.min(100, cls.kehadiranPct)}%` }}
                      />
                    </div>
                    <p className="text-[11px] font-mono tabular-nums text-slate-500">
                      H:{cls.hadir} · T:{cls.terlambat} · S:{cls.sakit} · I:{cls.izin} · A:{cls.alpa}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Students Needing Attention or Top Attendance */}
          <section className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-4">
            <div className="flex items-center gap-2.5">
              <div
                className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${
                  analytics.attentionStudents.length > 0
                    ? 'bg-rose-50 text-rose-600'
                    : 'bg-emerald-50 text-emerald-600'
                }`}
              >
                {analytics.attentionStudents.length > 0 ? (
                  <AlertTriangle className="h-4.5 w-4.5" aria-hidden="true" />
                ) : (
                  <Award className="h-4.5 w-4.5" aria-hidden="true" />
                )}
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  {analytics.attentionStudents.length > 0
                    ? `Siswa Perlu Perhatian (${analytics.attentionStudents.length})`
                    : 'Kehadiran Siswa Terbaik'}
                </h2>
                <p className="text-xs text-slate-500">
                  {analytics.attentionStudents.length > 0
                    ? 'Kehadiran di bawah 80% atau memiliki catatan Alpa pada periode ini'
                    : 'Siswa dengan tingkat kehadiran tertinggi pada periode terpilih'}
                </p>
              </div>
            </div>

            {analytics.attentionStudents.length > 0 ? (
              <ul className="divide-y divide-slate-100">
                {analytics.attentionStudents.map((s) => (
                  <li
                    key={s.nis}
                    className="py-2.5 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 truncate">{s.nama}</p>
                      <p className="text-[11px] text-slate-500 font-mono">
                        {s.nis} · {s.kelas} · Alpa: {s.alpa}
                      </p>
                    </div>
                    <span className="px-2.5 py-1 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 font-mono tabular-nums font-bold shrink-0">
                      {s.kehadiranPct}%
                    </span>
                  </li>
                ))}
              </ul>
            ) : analytics.topStudents.length > 0 ? (
              <ul className="divide-y divide-slate-100">
                {analytics.topStudents.map((s) => (
                  <li
                    key={s.nis}
                    className="py-2.5 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 truncate">{s.nama}</p>
                      <p className="text-[11px] text-slate-500 font-mono">
                        {s.nis} · {s.kelas} · Hadir: {s.hadir}
                      </p>
                    </div>
                    <span className="px-2.5 py-1 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 font-mono tabular-nums font-bold shrink-0">
                      {s.kehadiranPct}%
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200/70 rounded-xl px-4 py-4 text-center">
                Belum ada catatan presensi pada periode {selectedOverview.label}.
              </p>
            )}
          </section>
        </div>
      </div>

      {/* Full Student Attendance Analytics Table */}
      <section className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              <Users className="h-4.5 w-4.5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-900">
                Analisis Kehadiran Seluruh Siswa · {selectedOverview.label}
              </h2>
              <p className="text-xs text-slate-500">
                {selectedOverview.subtitle} · Menampilkan {visibleStudentRows.length} siswa
              </p>
            </div>
          </div>

          <div className="flex flex-wrap xl:flex-nowrap items-center gap-2 shrink-0">
            <div className="relative">
              <Search
                className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari NISN, nama, kelas..."
                aria-label="Cari siswa pada tabel analisis"
                className="w-44 rounded-xl border border-slate-200 bg-white pl-9 pr-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              aria-label="Urutkan tabel analisis siswa"
              className="rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 focus:border-indigo-500 focus:outline-none"
            >
              <option value="pct_desc">% Kehadiran Tertinggi</option>
              <option value="pct_asc">% Kehadiran Terendah</option>
              <option value="alpa_desc">Alpa Terbanyak</option>
              <option value="nama_asc">Nama Siswa (A–Z)</option>
            </select>

            {selectedPeriod === 'bulanan' && (
              <>
                <button
                  type="button"
                  data-testid="btn-download-analytics-monthly-pdf"
                  disabled={downloadingPdf}
                  onClick={handleDownloadMonthlyPdf}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-60 transition-colors whitespace-nowrap"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{downloadingPdf ? 'Menyiapkan PDF...' : 'Unduh PDF Bulanan'}</span>
                </button>
                <button
                  type="button"
                  data-testid="btn-download-analytics-monthly-excel"
                  onClick={handleDownloadMonthlyExcel}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                  <span>Excel</span>
                </button>
              </>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200/80 text-xs font-semibold text-slate-500">
                <th className="py-3 px-4 w-12 text-center">No</th>
                <th className="py-3 px-4">NISN</th>
                <th className="py-3 px-4">Nama Siswa</th>
                <th className="py-3 px-4">Kelas</th>
                <th className="py-3 px-3 text-center">Hadir</th>
                <th className="py-3 px-3 text-center">Telat</th>
                <th className="py-3 px-3 text-center">Sakit</th>
                <th className="py-3 px-3 text-center">Izin</th>
                <th className="py-3 px-3 text-center">Alpa</th>
                <th className="py-3 px-3 text-center">Total</th>
                <th className="py-3 px-4 min-w-[140px]">% Kehadiran</th>
                <th className="py-3 px-4">Kategori</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleStudentRows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-10 px-6 text-center text-xs text-slate-500">
                    Tidak ada data siswa yang sesuai filter atau pencarian.
                  </td>
                </tr>
              ) : (
                visibleStudentRows.map((row, idx) => {
                  const badge = getPctBadge(row);
                  return (
                    <tr key={row.nis} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-4 text-center text-xs font-mono text-slate-500">
                        {idx + 1}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-xs font-medium text-slate-700 whitespace-nowrap">
                        {row.nis}
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">
                        {row.nama}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600 whitespace-nowrap">
                        {row.kelas}
                      </td>
                      <td className="py-3 px-3 text-center font-mono tabular-nums text-xs font-semibold text-emerald-700">
                        {row.hadir}
                      </td>
                      <td className="py-3 px-3 text-center font-mono tabular-nums text-xs font-semibold text-amber-700">
                        {row.terlambat}
                      </td>
                      <td className="py-3 px-3 text-center font-mono tabular-nums text-xs text-sky-700">
                        {row.sakit}
                      </td>
                      <td className="py-3 px-3 text-center font-mono tabular-nums text-xs text-indigo-700">
                        {row.izin}
                      </td>
                      <td className="py-3 px-3 text-center font-mono tabular-nums text-xs font-semibold text-rose-700">
                        {row.alpa}
                      </td>
                      <td className="py-3 px-3 text-center font-mono tabular-nums text-xs text-slate-700">
                        {row.totalTercatat}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${getBarColorClass(
                                row.kehadiranPct
                              )}`}
                              style={{ width: `${Math.min(100, row.kehadiranPct)}%` }}
                            />
                          </div>
                          <span className="font-mono tabular-nums text-xs font-bold text-slate-800 w-10 text-right">
                            {row.kehadiranPct}%
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-lg border text-[11px] font-semibold ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
