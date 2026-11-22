import { useMemo, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Calendar,
  CalendarDays,
  Clock,
  GraduationCap,
} from 'lucide-react';
import type {
  AuthSession,
  DayOfWeek,
  SchoolSettings,
  SubjectAssignment,
  TeacherSchedule,
  TimetableConfig,
} from '../types';
import {
  formatIndonesianDate,
  getCurrentTimeString,
  getTodayDateString,
} from '../utils/attendanceLogic';
import { formatSemesterLabel, normalizeSemester } from '../utils/subjectAttendance';
import {
  collectPersonalTeacherLessons,
  filterPersonalLessonsByDay,
  getAvailablePersonalScheduleDays,
  getLessonTimeState,
  resolveDayForDate,
  type PersonalLessonItem,
  type PersonalScheduleDayFilter,
} from '../utils/teacherScheduleFilter';

interface TeacherLessonListViewProps {
  session: AuthSession;
  settings: SchoolSettings;
  schedules: TeacherSchedule[];
  assignments: SubjectAssignment[];
  activeTimetableConfig?: TimetableConfig;
  onOpenSubjectAttendance?: () => void;
}

export function TeacherLessonListView({
  session,
  settings,
  schedules,
  assignments,
  activeTimetableConfig,
  onOpenSubjectAttendance,
}: TeacherLessonListViewProps) {
  const todayStr = getTodayDateString();
  const todayDay = resolveDayForDate(todayStr);
  const currentTimeHHMM = getCurrentTimeString().slice(0, 5);
  const activeSemester = normalizeSemester(settings.semester, 'ganjil');

  // Default adjusts automatically to the day/date when the menu is accessed
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [filterMode, setFilterMode] = useState<'date' | 'day'>('date');
  const [selectedDayTab, setSelectedDayTab] = useState<PersonalScheduleDayFilter>(todayDay);

  const personalLessons = useMemo(
    () =>
      collectPersonalTeacherLessons({
        schedules,
        assignments,
        session,
        tahunAjaran: settings.tahun_ajaran,
        semester: activeSemester,
        activeTimetableConfig,
      }),
    [
      schedules,
      assignments,
      session,
      settings.tahun_ajaran,
      activeSemester,
      activeTimetableConfig,
    ]
  );

  const availableDays = useMemo(
    () => getAvailablePersonalScheduleDays(personalLessons, activeTimetableConfig),
    [personalLessons, activeTimetableConfig]
  );

  const activeDayFilter: PersonalScheduleDayFilter =
    filterMode === 'date' ? resolveDayForDate(selectedDate) : selectedDayTab;

  const filteredLessons = useMemo(
    () => filterPersonalLessonsByDay(personalLessons, activeDayFilter),
    [personalLessons, activeDayFilter]
  );

  const countByDay = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of personalLessons) {
      map[item.hari] = (map[item.hari] ?? 0) + 1;
    }
    return map;
  }, [personalLessons]);

  const uniqueSubjectsCount = useMemo(
    () =>
      new Set(personalLessons.map((item) => item.mata_pelajaran.trim().toLowerCase())).size,
    [personalLessons]
  );

  const uniqueClassesCount = useMemo(
    () => new Set(personalLessons.map((item) => item.kelas.trim().toLowerCase())).size,
    [personalLessons]
  );

  const groupedByDay = useMemo(() => {
    if (activeDayFilter !== 'ALL') return [];
    const groups: Array<{ day: DayOfWeek; items: PersonalLessonItem[] }> = [];
    const seen = new Map<DayOfWeek, PersonalLessonItem[]>();
    for (const item of filteredLessons) {
      const existing = seen.get(item.hari);
      if (existing) {
        existing.push(item);
      } else {
        const list = [item];
        seen.set(item.hari, list);
        groups.push({ day: item.hari, items: list });
      }
    }
    return groups;
  }, [activeDayFilter, filteredLessons]);

  const isViewingToday =
    (filterMode === 'date' && selectedDate === todayStr) ||
    (filterMode === 'day' && selectedDayTab === todayDay);

  function handleDateChange(nextDate: string) {
    if (!nextDate) return;
    setSelectedDate(nextDate);
    setFilterMode('date');
    setSelectedDayTab(resolveDayForDate(nextDate));
  }

  function handleSelectDayTab(day: PersonalScheduleDayFilter) {
    setFilterMode('day');
    setSelectedDayTab(day);
  }

  function handleResetToday() {
    setSelectedDate(todayStr);
    setFilterMode('date');
    setSelectedDayTab(todayDay);
  }

  function renderLessonRow(lesson: PersonalLessonItem, showTimeState: boolean) {
    const timeState = showTimeState
      ? getLessonTimeState(lesson, currentTimeHHMM)
      : null;

    return (
      <tr
        key={lesson.id}
        data-testid={`personal-lesson-row-${lesson.id}`}
        className="hover:bg-slate-50/80 transition-colors"
      >
        <td className="py-3.5 px-4 sm:px-5 align-top whitespace-nowrap">
          <div className="flex items-center gap-1.5 text-sm font-mono tabular-nums font-semibold text-slate-900">
            <Clock className="h-3.5 w-3.5 text-indigo-600 shrink-0" aria-hidden="true" />
            <span>
              {lesson.jam_mulai} – {lesson.jam_selesai}
            </span>
          </div>
          {lesson.jamKeLabel && (
            <p className="text-xs text-indigo-700 font-medium mt-0.5 pl-5">
              {lesson.jamKeLabel}
            </p>
          )}
        </td>
        <td className="py-3.5 px-4 align-top">
          <p className="text-sm font-semibold text-slate-900">
            {lesson.mata_pelajaran}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            {lesson.hari}
            {timeState === 'ongoing'
              ? ' · Sedang berlangsung'
              : timeState === 'upcoming'
                ? ' · Akan datang'
                : timeState === 'done'
                  ? ' · Selesai'
                  : ''}
          </p>
        </td>
        <td className="py-3.5 px-4 align-top whitespace-nowrap">
          <span className="text-sm font-semibold text-slate-800">
            {lesson.kelas}
          </span>
        </td>
        {onOpenSubjectAttendance && (
          <td className="py-3.5 px-4 sm:px-5 align-top text-right whitespace-nowrap">
            <button
              type="button"
              onClick={onOpenSubjectAttendance}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50/70 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors"
            >
              <span>Presensi Mapel</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </td>
        )}
      </tr>
    );
  }

  function renderMobileLessonCard(lesson: PersonalLessonItem, showTimeState: boolean) {
    const timeState = showTimeState
      ? getLessonTimeState(lesson, currentTimeHHMM)
      : null;

    return (
      <div
        key={`mobile-${lesson.id}`}
        className="p-4 space-y-2.5 bg-white"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 leading-snug">
              {lesson.mata_pelajaran}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              Kelas <strong className="text-slate-800">{lesson.kelas}</strong>
              {timeState === 'ongoing'
                ? ' · Sedang berlangsung'
                : timeState === 'upcoming'
                  ? ' · Akan datang'
                  : timeState === 'done'
                    ? ' · Selesai'
                    : ''}
            </p>
          </div>
          <div className="text-right shrink-0">
            <div className="inline-flex items-center gap-1 text-xs font-mono tabular-nums font-semibold text-slate-900">
              <Clock className="h-3 w-3 text-indigo-600 shrink-0" aria-hidden="true" />
              <span>
                {lesson.jam_mulai}–{lesson.jam_selesai}
              </span>
            </div>
            {lesson.jamKeLabel && (
              <p className="text-[11px] text-indigo-700 font-medium mt-0.5">
                {lesson.jamKeLabel}
              </p>
            )}
          </div>
        </div>

        {onOpenSubjectAttendance && (
          <button
            type="button"
            onClick={onOpenSubjectAttendance}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-indigo-200 bg-indigo-50/70 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors"
          >
            <span>Buka Presensi Mapel</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="teacher-lesson-list-view">
      {/* Header & Personal Schedule Summary */}
      <section className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="h-10 w-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                <BookOpen className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base sm:text-lg font-semibold text-slate-900 truncate">
                  Jadwal Mengajar — {session.nama}
                </h2>
                <p className="text-xs text-slate-500">
                  TA <span className="font-mono">{settings.tahun_ajaran}</span> · Semester{' '}
                  <strong className="text-slate-700">
                    {formatSemesterLabel(activeSemester)}
                  </strong>{' '}
                  ·{' '}
                  <span className="font-mono tabular-nums font-medium text-slate-700">
                    {personalLessons.length}
                  </span>{' '}
                  sesi/minggu ·{' '}
                  <span className="font-mono tabular-nums font-medium text-slate-700">
                    {uniqueSubjectsCount}
                  </span>{' '}
                  mapel ·{' '}
                  <span className="font-mono tabular-nums font-medium text-slate-700">
                    {uniqueClassesCount}
                  </span>{' '}
                  kelas
                </p>
              </div>
            </div>
          </div>

          {/* Date Selector (auto-matches accessed date) */}
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <div className="flex items-center gap-2">
              <label
                htmlFor="daftar-pelajaran-date"
                className="text-xs font-medium text-slate-600 whitespace-nowrap"
              >
                Tanggal:
              </label>
              <div className="relative">
                <Calendar
                  className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="daftar-pelajaran-date"
                  data-testid="daftar-pelajaran-date"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => handleDateChange(e.target.value)}
                  className="rounded-xl border border-slate-200 bg-white pl-8 pr-3 py-1.5 text-xs font-mono text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
            </div>

            <button
              type="button"
              data-testid="btn-lesson-today"
              onClick={handleResetToday}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors whitespace-nowrap ${
                filterMode === 'date' && selectedDate === todayStr
                  ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              Hari Ini ({todayDay})
            </button>
          </div>
        </div>

        {/* Interactive Day Filter Bar */}
        <div className="pt-1 border-t border-slate-100">
          <div
            role="tablist"
            aria-label="Filter hari daftar pelajaran"
            data-testid="daftar-pelajaran-day-tabs"
            className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-2"
          >
            <button
              type="button"
              role="tab"
              data-testid="day-filter-ALL"
              aria-selected={activeDayFilter === 'ALL'}
              onClick={() => handleSelectDayTab('ALL')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                activeDayFilter === 'ALL'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
              }`}
            >
              <span>Semua Hari</span>
              <span className="font-mono tabular-nums opacity-80">
                ({personalLessons.length})
              </span>
            </button>

            {availableDays.map((day) => {
              const isSelected = activeDayFilter === day;
              const isTodayTab = day === todayDay;
              const dayCount = countByDay[day] ?? 0;
              return (
                <button
                  key={day}
                  type="button"
                  role="tab"
                  data-testid={`day-filter-${day}`}
                  aria-selected={isSelected}
                  onClick={() => handleSelectDayTab(day)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    isSelected
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
                  }`}
                >
                  <span>{day}</span>
                  {isTodayTab && (
                    <span className="text-[10px] opacity-80">· Hari Ini</span>
                  )}
                  <span className="font-mono tabular-nums opacity-80">
                    ({dayCount})
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Active Schedule List */}
      <section className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="min-w-0">
            <h3
              data-testid="daftar-pelajaran-active-heading"
              className="text-sm sm:text-base font-semibold text-slate-900"
            >
              {activeDayFilter === 'ALL'
                ? 'Seluruh Jadwal Pelajaran Anda (Mingguan)'
                : filterMode === 'date'
                  ? `Jadwal Hari ${activeDayFilter} — ${formatIndonesianDate(selectedDate)}`
                  : `Jadwal Hari ${activeDayFilter}`}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Hanya menampilkan mata pelajaran yang Anda ampu ({session.nama}).
            </p>
          </div>
          <span className="text-xs font-mono tabular-nums font-medium text-slate-600 shrink-0">
            {filteredLessons.length} mata pelajaran
          </span>
        </div>

        {personalLessons.length === 0 ? (
          <div className="p-8 sm:p-10 text-center space-y-3">
            <div className="h-12 w-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
              <GraduationCap className="h-6 w-6" aria-hidden="true" />
            </div>
            <div className="space-y-1 max-w-md mx-auto">
              <p className="text-sm font-semibold text-slate-900">
                Belum Ada Jadwal Mengajar Terdaftar
              </p>
              <p className="text-xs text-slate-500 leading-relaxed">
                Jadwal pelajaran Anda pada Tahun Ajaran {settings.tahun_ajaran} Semester{' '}
                {formatSemesterLabel(activeSemester)} belum diisi. Anda dapat menambahkan kelas
                &amp; mata pelajaran di menu <strong>Presensi Mapel</strong> atau meminta Master
                Admin mengaturnya di <strong>Pengaturan Jadwal</strong>.
              </p>
            </div>
            {onOpenSubjectAttendance && (
              <button
                type="button"
                onClick={onOpenSubjectAttendance}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors"
              >
                <span>Buka Menu Presensi Mapel</span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        ) : filteredLessons.length === 0 ? (
          <div className="p-8 sm:p-10 text-center space-y-3">
            <div className="h-12 w-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
              <CalendarDays className="h-6 w-6" aria-hidden="true" />
            </div>
            <div className="space-y-1 max-w-md mx-auto">
              <p className="text-sm font-semibold text-slate-900">
                Tidak Ada Jadwal Mengajar pada Hari {activeDayFilter}
              </p>
              <p className="text-xs text-slate-500">
                Anda memiliki {personalLessons.length} sesi mengajar di hari lain minggu ini.
                Pilih hari lain pada filter di atas atau tampilkan semua hari.
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleSelectDayTab('ALL')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors"
            >
              <span>Lihat Jadwal Semua Hari</span>
            </button>
          </div>
        ) : activeDayFilter === 'ALL' ? (
          <div className="divide-y divide-slate-200/80">
            {groupedByDay.map(({ day, items }) => (
              <div key={day}>
                <div className="px-5 py-2.5 bg-slate-50/90 border-b border-slate-100 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-800">
                    {day}
                    {day === todayDay ? ' · Hari Ini' : ''}
                  </span>
                  <span className="text-xs font-mono tabular-nums text-slate-500">
                    {items.length} sesi
                  </span>
                </div>
                <div className="sm:hidden divide-y divide-slate-100">
                  {items.map((lesson) => renderMobileLessonCard(lesson, day === todayDay))}
                </div>
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-100 text-[11px] font-semibold text-slate-500">
                        <th className="py-2.5 px-4 sm:px-5">Waktu &amp; Jam ke</th>
                        <th className="py-2.5 px-4">Mata Pelajaran</th>
                        <th className="py-2.5 px-4">Kelas</th>
                        {onOpenSubjectAttendance && (
                          <th className="py-2.5 px-4 sm:px-5 text-right">Aksi</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {items.map((lesson) => renderLessonRow(lesson, day === todayDay))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="sm:hidden divide-y divide-slate-100">
              {filteredLessons.map((lesson) =>
                renderMobileLessonCard(lesson, isViewingToday)
              )}
            </div>
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                    <th className="py-3 px-4 sm:px-5">Waktu &amp; Jam ke</th>
                    <th className="py-3 px-4">Mata Pelajaran</th>
                    <th className="py-3 px-4">Kelas</th>
                    {onOpenSubjectAttendance && (
                      <th className="py-3 px-4 sm:px-5 text-right">Aksi</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredLessons.map((lesson) => renderLessonRow(lesson, isViewingToday))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
