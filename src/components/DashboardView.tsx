import {
  Users,
  UserCheck,
  Clock,
  UserX,
  QrCode,
  ArrowRight,
  Calendar,
} from 'lucide-react';
import type { AttendanceRecord, SchoolSettings, Student, TabId } from '../types';
import {
  computeDashboardMetrics,
  computeWeeklyTrend,
  formatIndonesianDate,
  getTodayDateString,
} from '../utils/attendanceLogic';
import { StatusBadge } from './StatusBadge';

interface DashboardViewProps {
  students: Student[];
  records: AttendanceRecord[];
  settings: SchoolSettings;
  assignedClass?: string;
  canAccessScan?: boolean;
  masterYearControl?: {
    selectedYear: string;
    availableYears: string[];
    onChangeYear: (year: string) => void;
  };
  onNavigate: (tab: TabId) => void;
}

export function DashboardView({
  students,
  records,
  settings,
  assignedClass,
  canAccessScan = true,
  masterYearControl,
  onNavigate,
}: DashboardViewProps) {
  const today = getTodayDateString();
  const metrics = computeDashboardMetrics(students, records, today);
  const trend = computeWeeklyTrend(records, today, 7);
  const maxDayTotal = Math.max(
    1,
    ...trend.map((pt) => pt.hadir + pt.terlambat + pt.tidakHadir)
  );

  return (
    <div className="space-y-6">
      {/* Context Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <Calendar className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
          <span className="font-medium text-slate-800">{formatIndonesianDate(today)}</span>
          <span aria-hidden="true">·</span>
          <span>
            TA{' '}
            <span className="font-mono font-medium text-slate-800">
              {settings.tahun_ajaran}
            </span>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Batas masuk{' '}
            <span className="font-mono tabular-nums font-medium text-slate-800">
              {settings.batas_jam_masuk}
            </span>
          </span>
          {assignedClass && (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-semibold text-indigo-700">
                Kelas Binaan: {assignedClass}
              </span>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {masterYearControl && (
            <select
              value={masterYearControl.selectedYear}
              onChange={(e) => masterYearControl.onChangeYear(e.target.value)}
              aria-label="Filter Tahun Ajaran Master Admin"
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="ACTIVE">TA Aktif ({settings.tahun_ajaran})</option>
              {masterYearControl.availableYears
                .filter((y) => y !== settings.tahun_ajaran)
                .map((yr) => (
                  <option key={yr} value={yr}>
                    Arsip TA {yr}
                  </option>
                ))}
              <option value="ALL">Semua Tahun Ajaran</option>
            </select>
          )}

          {canAccessScan && (
            <button
              type="button"
              onClick={() => onNavigate('scan')}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            >
              <QrCode className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Mulai Scan QR</span>
            </button>
          )}
        </div>
      </div>

      {/* Bento KPI Grid (4 columns on desktop) */}
      <section aria-label="Statistik presensi hari ini" className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div
          data-testid="kpi-total-siswa"
          className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] flex flex-col justify-between"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Total Siswa</span>
            <span className="h-8 w-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              <Users className="h-4 w-4" aria-hidden="true" />
            </span>
          </div>
          <div className="mt-3">
            <p className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 font-mono tabular-nums">
              {metrics.totalSiswa}
            </p>
            <p className="text-[11px] sm:text-xs text-slate-500 mt-1">
              {metrics.classBreakdown.length} kelas · {metrics.belumScan} belum scan
            </p>
          </div>
        </div>

        <div
          data-testid="kpi-hadir"
          className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] flex flex-col justify-between"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Tepat Waktu</span>
            <span className="h-8 w-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <UserCheck className="h-4 w-4" aria-hidden="true" />
            </span>
          </div>
          <div className="mt-3">
            <p className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 font-mono tabular-nums">
              {metrics.hadir}
            </p>
            <p className="text-[11px] sm:text-xs text-emerald-700 font-medium mt-1">
              {metrics.kehadiranPct}% tingkat kehadiran
            </p>
          </div>
        </div>

        <div
          data-testid="kpi-terlambat"
          className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] flex flex-col justify-between"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Terlambat</span>
            <span className="h-8 w-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
              <Clock className="h-4 w-4" aria-hidden="true" />
            </span>
          </div>
          <div className="mt-3">
            <p className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 font-mono tabular-nums">
              {metrics.terlambat}
            </p>
            <p className="text-[11px] sm:text-xs text-slate-500 mt-1">
              Lewat {settings.batas_jam_masuk} WIB
            </p>
          </div>
        </div>

        <div
          data-testid="kpi-tidak-hadir"
          className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] flex flex-col justify-between"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Tidak Hadir</span>
            <span className="h-8 w-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
              <UserX className="h-4 w-4" aria-hidden="true" />
            </span>
          </div>
          <div className="mt-3">
            <p className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 font-mono tabular-nums">
              {metrics.tidakHadir}
            </p>
            <p className="text-[11px] sm:text-xs text-slate-500 mt-1 tabular-nums">
              {metrics.sakit} S · {metrics.izin} I · {metrics.alpa} A
            </p>
          </div>
        </div>
      </section>

      {/* Main Bento Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left: 7-day Attendance Chart & Class Distribution */}
        <section className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/80 p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)] flex flex-col justify-between gap-6">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Tren Kehadiran 7 Hari Terakhir
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Distribusi status hadir, terlambat, dan tidak hadir harian
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-600">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" aria-hidden="true" />
                  Hadir
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-amber-400" aria-hidden="true" />
                  Terlambat
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-rose-400" aria-hidden="true" />
                  Tidak Hadir
                </span>
              </div>
            </div>

            {/* 7-Day Stacked Bar Chart */}
            <div className="mt-6 grid grid-cols-7 gap-2 sm:gap-3 items-end h-44 pt-4 border-b border-slate-100 pb-2">
              {trend.map((pt) => {
                const total = pt.hadir + pt.terlambat + pt.tidakHadir;
                const hadirH = Math.round((pt.hadir / maxDayTotal) * 100);
                const lateH = Math.round((pt.terlambat / maxDayTotal) * 100);
                const absH = Math.round((pt.tidakHadir / maxDayTotal) * 100);
                const isToday = pt.tanggal === today;

                return (
                  <div
                    key={pt.tanggal}
                    className="flex flex-col items-center gap-2 h-full justify-end group"
                    title={`${pt.label}: ${pt.hadir} Hadir, ${pt.terlambat} Terlambat, ${pt.tidakHadir} Tidak Hadir`}
                  >
                    <span className="text-[11px] font-mono tabular-nums text-slate-500 group-hover:text-slate-900 transition-colors">
                      {total}
                    </span>
                    <div className="w-full max-w-[36px] h-28 bg-slate-50 rounded-lg overflow-hidden flex flex-col-reverse border border-slate-100">
                      {pt.hadir > 0 && (
                        <div
                          style={{ height: `${Math.max(hadirH, 6)}%` }}
                          className="w-full bg-emerald-500 transition-all"
                        />
                      )}
                      {pt.terlambat > 0 && (
                        <div
                          style={{ height: `${Math.max(lateH, 6)}%` }}
                          className="w-full bg-amber-400 transition-all"
                        />
                      )}
                      {pt.tidakHadir > 0 && (
                        <div
                          style={{ height: `${Math.max(absH, 6)}%` }}
                          className="w-full bg-rose-400 transition-all"
                        />
                      )}
                    </div>
                    <span
                      className={`text-[11px] font-medium whitespace-nowrap ${
                        isToday ? 'text-indigo-600 font-semibold' : 'text-slate-500'
                      }`}
                    >
                      {isToday ? 'Hari Ini' : pt.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Class Breakdown Summary */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-900">Ringkasan Per Kelas Hari Ini</h3>
              <button
                type="button"
                onClick={() => onNavigate('rekap')}
                className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"
              >
                <span>Lihat Rekap</span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>

            {metrics.classBreakdown.length === 0 ? (
              <p className="text-sm text-slate-500 py-4">Belum ada data kelas terdaftar.</p>
            ) : (
              <div className="space-y-3">
                {metrics.classBreakdown.map((cls) => {
                  const present = cls.hadir + cls.terlambat;
                  const pct = cls.total > 0 ? Math.round((present / cls.total) * 100) : 0;
                  return (
                    <div key={cls.kelas} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-800">{cls.kelas}</span>
                        <span className="text-slate-500 font-mono tabular-nums">
                          {present}/{cls.total} hadir ({pct}%)
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden flex">
                        {cls.hadir > 0 && (
                          <div
                            style={{ width: `${(cls.hadir / cls.total) * 100}%` }}
                            className="bg-emerald-500 h-full"
                          />
                        )}
                        {cls.terlambat > 0 && (
                          <div
                            style={{ width: `${(cls.terlambat / cls.total) * 100}%` }}
                            className="bg-amber-400 h-full"
                          />
                        )}
                        {cls.tidakHadir > 0 && (
                          <div
                            style={{ width: `${(cls.tidakHadir / cls.total) * 100}%` }}
                            className="bg-rose-400 h-full"
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Right: Recent Scan Activity */}
        <section className="lg:col-span-5 bg-white rounded-2xl border border-slate-200/80 p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)] flex flex-col">
          <div className="flex items-center justify-between gap-2 pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Aktivitas Scan Terbaru
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Catatan presensi masuk hari ini
              </p>
            </div>
            {canAccessScan && (
              <button
                type="button"
                onClick={() => onNavigate('scan')}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-700 whitespace-nowrap"
              >
                Scan Baru
              </button>
            )}
          </div>

          {metrics.recentScans.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-10">
              <QrCode className="h-10 w-10 text-slate-300 mb-3" aria-hidden="true" />
              <p className="text-sm font-medium text-slate-700">Belum ada presensi hari ini</p>
              <p className="text-xs text-slate-500 mt-1 max-w-xs">
                Mulai pindai kartu QR siswa atau input NIS untuk mencatat kehadiran pertama.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 flex-1">
              {metrics.recentScans.map((rec) => (
                <li key={rec.id} className="py-3.5 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex items-center gap-3">
                    <div className="h-9 w-9 rounded-xl bg-slate-100 text-slate-700 font-semibold text-xs flex items-center justify-center shrink-0">
                      {rec.nama
                        .split(' ')
                        .slice(0, 2)
                        .map((p) => p[0])
                        .join('')
                        .toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {rec.nama}
                      </p>
                      <p className="text-xs text-slate-500 truncate">
                        <span className="font-mono tabular-nums">{rec.nis}</span>
                        <span aria-hidden="true"> · </span>
                        <span>{rec.kelas}</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <StatusBadge status={rec.status} />
                    <span className="text-[11px] font-mono tabular-nums text-slate-500">
                      {rec.jam_masuk}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
