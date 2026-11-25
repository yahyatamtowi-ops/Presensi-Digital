import { useMemo, useState } from 'react';
import {
  BookOpen,
  CalendarDays,
  CalendarRange,
  Clock,
  Download,
  FileSpreadsheet,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  UserCheck,
  X,
} from 'lucide-react';
import type {
  DayOfWeek,
  MasterSubject,
  SchoolSettings,
  SemesterKind,
  TeacherSchedule,
  TimetableConfig,
  TimetableTimeSlot,
  UserAccount,
} from '../types';
import {
  formatSemesterLabel,
  normalizeSemester,
  SCHOOL_DAYS,
} from '../utils/subjectAttendance';
import {
  createDefaultTimetableConfig,
  findSlotRangeLabelForSchedule,
  generateDailyTimeSlots,
  getSchoolDaysForCount,
} from '../utils/timetableLogic';
import {
  isSameClassName,
  normalizeClassNameKey,
  resolveCanonicalClassName,
} from '../utils/attendanceLogic';
import {
  downloadTeacherScheduleTemplate,
  parseTeacherSchedulesFile,
  type ParsedTeacherScheduleInput,
  type TeacherScheduleImportResult,
} from '../utils/scheduleImportExport';

interface ScheduleManagementViewProps {
  settings: SchoolSettings;
  accounts: UserAccount[];
  availableClasses: string[];
  masterSubjects: MasterSubject[];
  schedules: TeacherSchedule[];
  onAddMasterSubject: (input: {
    kode: string;
    nama: string;
    deskripsi?: string;
  }) => { ok: boolean; error?: string };
  onUpdateMasterSubject: (
    id: string,
    input: { kode: string; nama: string; deskripsi?: string }
  ) => { ok: boolean; error?: string };
  onDeleteMasterSubject: (id: string) => void;
  onAddSchedule: (input: {
    hari: DayOfWeek;
    teacher_user_id: string;
    teacher_name: string;
    kelas: string;
    mata_pelajaran: string;
    jam_mulai: string;
    jam_selesai: string;
    semester?: SemesterKind;
  }) => { ok: boolean; error?: string };
  onUpdateSchedule: (
    id: string,
    input: {
      hari: DayOfWeek;
      teacher_user_id: string;
      teacher_name: string;
      kelas: string;
      mata_pelajaran: string;
      jam_mulai: string;
      jam_selesai: string;
      semester?: SemesterKind;
    }
  ) => { ok: boolean; error?: string };
  onDeleteSchedule: (id: string) => void;
  onBulkImportSchedules?: (items: ParsedTeacherScheduleInput[]) => {
    addedCount: number;
    skippedCount: number;
  };
  activeTimetableConfig?: TimetableConfig;
  onNavigateToTimetable?: () => void;
}

type ScheduleSubMenuId = 'mapel' | 'jadwal';

const SUB_MENUS: Array<{
  id: ScheduleSubMenuId;
  label: string;
  desc: string;
  Icon: typeof BookOpen;
}> = [
  {
    id: 'mapel',
    label: 'Mata Pelajaran',
    desc: 'Daftar master mata pelajaran',
    Icon: BookOpen,
  },
  {
    id: 'jadwal',
    label: 'Jadwal Pelajaran Guru',
    desc: 'Atur hari, kelas & jam mengajar',
    Icon: CalendarDays,
  },
];

const DAY_SORT_ORDER: Record<DayOfWeek, number> = {
  Senin: 1,
  Selasa: 2,
  Rabu: 3,
  Kamis: 4,
  Jumat: 5,
  Sabtu: 6,
  Minggu: 7,
};

export function ScheduleManagementView({
  settings,
  accounts,
  availableClasses,
  masterSubjects,
  schedules,
  onAddMasterSubject,
  onUpdateMasterSubject,
  onDeleteMasterSubject,
  onAddSchedule,
  onUpdateSchedule,
  onDeleteSchedule,
  onBulkImportSchedules,
  activeTimetableConfig,
  onNavigateToTimetable,
}: ScheduleManagementViewProps) {
  const [activeSubMenu, setActiveSubMenu] = useState<ScheduleSubMenuId>('mapel');

  // === Sub Menu 1: Master Mata Pelajaran state ===
  const [subjectSearch, setSubjectSearch] = useState('');
  const [subjectModalOpen, setSubjectModalOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<MasterSubject | null>(null);
  const [subKode, setSubKode] = useState('');
  const [subNama, setSubNama] = useState('');
  const [subDeskripsi, setSubDeskripsi] = useState('');
  const [subjectError, setSubjectError] = useState<string | null>(null);
  const [confirmDeleteSubjectId, setConfirmDeleteSubjectId] = useState<string | null>(null);

  // === Sub Menu 2: Jadwal Pelajaran Guru state ===
  const [filterHari, setFilterHari] = useState<DayOfWeek | 'ALL'>('ALL');
  const [filterTeacherId, setFilterTeacherId] = useState<string>('ALL');
  const [filterKelas, setFilterKelas] = useState<string>('ALL');
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<TeacherSchedule | null>(null);
  const [schHari, setSchHari] = useState<DayOfWeek>('Senin');
  const [schTeacherId, setSchTeacherId] = useState('');
  const [schKelas, setSchKelas] = useState('');
  const [schMapel, setSchMapel] = useState('');
  const [schJamMulai, setSchJamMulai] = useState('07:15');
  const [schJamSelesai, setSchJamSelesai] = useState('08:45');
  const [schStartJp, setSchStartJp] = useState<string>('');
  const [schEndJp, setSchEndJp] = useState<string>('');
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [confirmDeleteScheduleId, setConfirmDeleteScheduleId] = useState<string | null>(null);
  const [importScheduleOpen, setImportScheduleOpen] = useState(false);
  const [importScheduleFileName, setImportScheduleFileName] = useState('');
  const [importScheduleParsing, setImportScheduleParsing] = useState(false);
  const [importSchedulePreview, setImportSchedulePreview] =
    useState<TeacherScheduleImportResult | null>(null);
  const [importScheduleError, setImportScheduleError] = useState<string | null>(null);

  const activeSemester = normalizeSemester(settings.semester, 'ganjil');

  // Synchronized bell schedule from Pengaturan Jadwal Mata Pelajaran
  const effectiveTimetable = useMemo<TimetableConfig>(
    () =>
      activeTimetableConfig ??
      createDefaultTimetableConfig(
        settings.tahun_ajaran,
        activeSemester,
        settings.batas_jam_masuk || '07:15'
      ),
    [activeTimetableConfig, settings.tahun_ajaran, activeSemester, settings.batas_jam_masuk]
  );

  const lessonSlots = useMemo(
    () =>
      generateDailyTimeSlots(effectiveTimetable).filter(
        (s): s is Extract<TimetableTimeSlot, { kind: 'lesson' }> => s.kind === 'lesson'
      ),
    [effectiveTimetable]
  );

  const configuredSchoolDays = useMemo(
    () => getSchoolDaysForCount(effectiveTimetable.jumlah_hari),
    [effectiveTimetable.jumlah_hari]
  );

  // Eligible teachers (Guru Mata Pelajaran & Wali Kelas)
  const teachingAccounts = useMemo(
    () =>
      accounts
        .filter((a) => a.role === 'guru' || a.role === 'wali_kelas')
        .sort((a, b) => a.nama.localeCompare(b.nama)),
    [accounts]
  );

  const activeYearSchedules = useMemo(
    () =>
      schedules.filter(
        (s) =>
          s.tahun_ajaran === settings.tahun_ajaran &&
          (!s.semester || s.semester === activeSemester)
      ),
    [schedules, settings.tahun_ajaran, activeSemester]
  );

  // Count schedules per master subject
  const scheduleCountBySubject = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of activeYearSchedules) {
      const key = s.mata_pelajaran.trim().toLowerCase();
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [activeYearSchedules]);

  const filteredSubjects = useMemo(() => {
    const q = subjectSearch.trim().toLowerCase();
    const list = q
      ? masterSubjects.filter(
          (s) =>
            s.nama.toLowerCase().includes(q) ||
            s.kode.toLowerCase().includes(q) ||
            (s.deskripsi || '').toLowerCase().includes(q)
        )
      : [...masterSubjects];
    return list.sort((a, b) => a.nama.localeCompare(b.nama));
  }, [masterSubjects, subjectSearch]);

  const scheduleClasses = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const c of availableClasses) {
      const trimmed = c.trim();
      if (!trimmed) continue;
      const key = normalizeClassNameKey(trimmed) || trimmed.toLowerCase();
      if (!byKey.has(key)) byKey.set(key, trimmed);
    }
    for (const s of activeYearSchedules) {
      const trimmed = s.kelas.trim();
      if (!trimmed) continue;
      const canonical = resolveCanonicalClassName(trimmed, availableClasses);
      const key = normalizeClassNameKey(canonical) || canonical.toLowerCase();
      if (!byKey.has(key)) byKey.set(key, canonical);
    }
    return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b));
  }, [availableClasses, activeYearSchedules]);

  const filteredSchedules = useMemo(() => {
    return activeYearSchedules
      .filter((s) => {
        if (filterHari !== 'ALL' && s.hari !== filterHari) return false;
        if (filterTeacherId !== 'ALL' && s.teacher_user_id !== filterTeacherId) return false;
        if (filterKelas !== 'ALL' && !isSameClassName(s.kelas, filterKelas)) {
          return false;
        }
        return true;
      })
      .sort(
        (a, b) =>
          (DAY_SORT_ORDER[a.hari] || 9) - (DAY_SORT_ORDER[b.hari] || 9) ||
          a.jam_mulai.localeCompare(b.jam_mulai) ||
          a.kelas.localeCompare(b.kelas)
      );
  }, [activeYearSchedules, filterHari, filterTeacherId, filterKelas]);

  // === Handlers: Master Subject ===
  function openAddSubjectModal() {
    setEditingSubject(null);
    setSubKode('');
    setSubNama('');
    setSubDeskripsi('');
    setSubjectError(null);
    setSubjectModalOpen(true);
  }

  function openEditSubjectModal(sub: MasterSubject) {
    setEditingSubject(sub);
    setSubKode(sub.kode);
    setSubNama(sub.nama);
    setSubDeskripsi(sub.deskripsi || '');
    setSubjectError(null);
    setSubjectModalOpen(true);
  }

  function handleSubmitSubject(e: React.FormEvent) {
    e.preventDefault();
    const res = editingSubject
      ? onUpdateMasterSubject(editingSubject.id, {
          kode: subKode,
          nama: subNama,
          deskripsi: subDeskripsi,
        })
      : onAddMasterSubject({
          kode: subKode,
          nama: subNama,
          deskripsi: subDeskripsi,
        });

    if (!res.ok) {
      setSubjectError(res.error || 'Gagal menyimpan mata pelajaran.');
      return;
    }
    setSubjectModalOpen(false);
    setEditingSubject(null);
    setSubjectError(null);
  }

  // === Handlers: Teacher Schedule ===
  function applySlotRange(startVal: string, endVal: string) {
    setSchStartJp(startVal);
    setSchEndJp(endVal);
    const sNum = Number(startVal);
    const eNum = Number(endVal || startVal);
    const startSlot = lessonSlots.find((s) => s.jamKe === sNum);
    const endSlot = lessonSlots.find((s) => s.jamKe === Math.max(sNum, eNum));
    if (startSlot) {
      setSchJamMulai(startSlot.jam_mulai);
      setSchJamSelesai((endSlot ?? startSlot).jam_selesai);
    }
  }

  function openAddScheduleModal() {
    setEditingSchedule(null);
    setSchHari(filterHari !== 'ALL' ? filterHari : configuredSchoolDays[0] || 'Senin');
    setSchTeacherId(
      filterTeacherId !== 'ALL'
        ? filterTeacherId
        : teachingAccounts[0]?.id || ''
    );
    setSchKelas(filterKelas !== 'ALL' ? filterKelas : scheduleClasses[0] || '');
    setSchMapel(masterSubjects[0]?.nama || '');
    const firstSlot = lessonSlots[0];
    const secondSlot = lessonSlots[1] ?? firstSlot;
    if (firstSlot) {
      setSchStartJp(String(firstSlot.jamKe));
      setSchEndJp(String(secondSlot.jamKe));
      setSchJamMulai(firstSlot.jam_mulai);
      setSchJamSelesai(secondSlot.jam_selesai);
    } else {
      setSchStartJp('');
      setSchEndJp('');
      setSchJamMulai('07:15');
      setSchJamSelesai('08:45');
    }
    setScheduleError(null);
    setScheduleModalOpen(true);
  }

  function openEditScheduleModal(sch: TeacherSchedule) {
    setEditingSchedule(sch);
    setSchHari(sch.hari);
    setSchTeacherId(sch.teacher_user_id);
    setSchKelas(sch.kelas);
    setSchMapel(sch.mata_pelajaran);
    setSchJamMulai(sch.jam_mulai);
    setSchJamSelesai(sch.jam_selesai);
    const matched = findSlotRangeLabelForSchedule(
      effectiveTimetable,
      sch.jam_mulai,
      sch.jam_selesai
    );
    setSchStartJp(matched ? String(matched.startJp) : '');
    setSchEndJp(matched ? String(matched.endJp) : '');
    setScheduleError(null);
    setScheduleModalOpen(true);
  }

  function handleSubmitSchedule(e: React.FormEvent) {
    e.preventDefault();
    const teacher = teachingAccounts.find((t) => t.id === schTeacherId);
    if (!teacher) {
      setScheduleError('Silakan pilih Guru / Wali Kelas pengampu terlebih dahulu.');
      return;
    }

    const payload = {
      hari: schHari,
      teacher_user_id: teacher.id,
      teacher_name: teacher.nama,
      kelas: schKelas,
      mata_pelajaran: schMapel,
      jam_mulai: schJamMulai,
      jam_selesai: schJamSelesai,
      semester: activeSemester,
    };

    const res = editingSchedule
      ? onUpdateSchedule(editingSchedule.id, payload)
      : onAddSchedule(payload);

    if (!res.ok) {
      setScheduleError(res.error || 'Gagal menyimpan jadwal pelajaran.');
      return;
    }
    setScheduleModalOpen(false);
    setEditingSchedule(null);
    setScheduleError(null);
  }

  return (
    <div className="space-y-6">
      <datalist id="jadwal-class-suggestions">
        {scheduleClasses.map((cls) => (
          <option key={cls} value={cls} />
        ))}
      </datalist>

      {/* Top Info Banner */}
      <div className="bg-white rounded-2xl border border-slate-200/80 px-5 py-4 shadow-[0_1px_3px_rgba(15,23,42,0.04)] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
            <CalendarDays className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-semibold text-slate-900 truncate">
              Manajemen Mata Pelajaran &amp; Jadwal Guru
            </h2>
            <p className="text-xs text-slate-500">
              TA <span className="font-mono font-semibold text-indigo-700">{settings.tahun_ajaran}</span>{' '}
              · Semester <strong className="text-slate-700">{formatSemesterLabel(activeSemester)}</strong>{' '}
              · {masterSubjects.length} mapel · {activeYearSchedules.length} jadwal aktif ·{' '}
              <span data-testid="jadwal-timetable-sync-summary" className="text-indigo-700 font-medium">
                {effectiveTimetable.jumlah_hari === 6 ? 'Senin–Sabtu' : 'Senin–Jumat'} ·{' '}
                {effectiveTimetable.durasi_jp_menit} mnt/JP · {effectiveTimetable.istirahat.length} istirahat
              </span>
            </p>
          </div>
        </div>
        {onNavigateToTimetable && (
          <button
            type="button"
            onClick={onNavigateToTimetable}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-indigo-200 bg-indigo-50 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors whitespace-nowrap"
          >
            <CalendarRange className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Buka Tabel Pengaturan Jadwal</span>
          </button>
        )}
      </div>

      {/* Main Sub-Menu Split Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Sticky Sub-Menu Rail */}
        <aside className="lg:col-span-3 lg:sticky lg:top-20">
          <div
            role="tablist"
            aria-label="Sub menu Mapel dan Jadwal"
            className="bg-white rounded-2xl border border-slate-200/80 p-2.5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] flex lg:flex-col gap-1.5 overflow-x-auto"
          >
            <div className="hidden lg:block px-3 pt-1 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Sub Menu
            </div>
            {SUB_MENUS.map(({ id, label, desc, Icon }) => {
              const isActive = activeSubMenu === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  data-testid={`jadwal-submenu-${id}`}
                  onClick={() => setActiveSubMenu(id)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors shrink-0 lg:shrink lg:w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                    isActive
                      ? 'bg-indigo-50 text-indigo-700 border border-indigo-200/80'
                      : 'text-slate-600 border border-transparent hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <div
                    className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
                      isActive
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-semibold block truncate">{label}</span>
                    <p className="text-[11px] text-slate-500 truncate hidden sm:block">
                      {desc}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Right Active Sub-Menu Content */}
        <div className="lg:col-span-9 space-y-6 min-w-0">
          {/* SUB-MENU 1: MATA PELAJARAN */}
          {activeSubMenu === 'mapel' && (
            <section className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden">
              <div className="p-5 sm:p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    Daftar Mata Pelajaran ({masterSubjects.length})
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Kelola daftar mata pelajaran resmi sekolah yang digunakan pada Jadwal Pelajaran Guru.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="relative">
                    <Search
                      className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                      aria-hidden="true"
                    />
                    <input
                      type="search"
                      value={subjectSearch}
                      onChange={(e) => setSubjectSearch(e.target.value)}
                      placeholder="Cari kode / mapel..."
                      aria-label="Cari mata pelajaran"
                      className="w-48 rounded-xl border border-slate-200 bg-white pl-9 pr-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </div>

                  <button
                    type="button"
                    data-testid="btn-add-master-subject"
                    onClick={openAddSubjectModal}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors whitespace-nowrap"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Tambah Mata Pelajaran</span>
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200/80 text-xs font-semibold text-slate-500">
                      <th className="py-3 px-4 w-12 text-center">No</th>
                      <th className="py-3 px-4 w-24">Kode</th>
                      <th className="py-3 px-4">Nama Mata Pelajaran</th>
                      <th className="py-3 px-4">Keterangan</th>
                      <th className="py-3 px-4 text-center">Jadwal Aktif</th>
                      <th className="py-3 px-4 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredSubjects.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-10 px-6 text-center text-xs text-slate-500">
                          Belum ada data mata pelajaran yang sesuai pencarian.
                        </td>
                      </tr>
                    ) : (
                      filteredSubjects.map((sub, idx) => {
                        const count =
                          scheduleCountBySubject.get(sub.nama.trim().toLowerCase()) || 0;
                        return (
                          <tr key={sub.id} className="hover:bg-slate-50/70 transition-colors">
                            <td className="py-3 px-4 text-center text-xs font-mono text-slate-500">
                              {idx + 1}
                            </td>
                            <td className="py-3 px-4 font-mono text-xs font-bold text-indigo-700">
                              {sub.kode}
                            </td>
                            <td className="py-3 px-4 font-semibold text-slate-900">
                              {sub.nama}
                            </td>
                            <td className="py-3 px-4 text-xs text-slate-600">
                              {sub.deskripsi || '-'}
                            </td>
                            <td className="py-3 px-4 text-center font-mono tabular-nums text-xs text-slate-700">
                              {count} sesi
                            </td>
                            <td className="py-3 px-4 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => openEditSubjectModal(sub)}
                                  aria-label={`Edit ${sub.nama}`}
                                  className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:text-indigo-700 hover:border-indigo-200 hover:bg-indigo-50 transition-colors"
                                >
                                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteSubjectId(sub.id)}
                                  aria-label={`Hapus ${sub.nama}`}
                                  className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:text-rose-700 hover:border-rose-200 hover:bg-rose-50 transition-colors"
                                >
                                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* SUB-MENU 2: JADWAL PELAJARAN GURU */}
          {activeSubMenu === 'jadwal' && (
            <section className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden">
              <div className="p-5 sm:p-6 border-b border-slate-100 space-y-4">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-base font-semibold text-slate-900">
                      Jadwal Pelajaran Guru ({filteredSchedules.length})
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Tersinkron otomatis 3 arah antara <strong>Pengaturan Jadwal</strong> (tabel matriks), <strong>Jadwal Pelajaran Guru</strong>, dan menu <strong>Presensi Mapel</strong> masing-masing guru.
                    </p>
                  </div>

                  <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0 self-start lg:self-auto">
                    <button
                      type="button"
                      data-testid="btn-import-teacher-schedule-excel"
                      onClick={() => {
                        setImportScheduleOpen(true);
                        setImportScheduleFileName('');
                        setImportSchedulePreview(null);
                        setImportScheduleError(null);
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-indigo-200 bg-indigo-50/70 text-indigo-700 text-xs font-semibold hover:bg-indigo-100/70 transition-colors whitespace-nowrap"
                    >
                      <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Import Excel / CSV</span>
                    </button>
                    <button
                      type="button"
                      data-testid="btn-add-teacher-schedule"
                      onClick={openAddScheduleModal}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors whitespace-nowrap"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Tambah Jadwal Guru</span>
                    </button>
                  </div>
                </div>

                {/* Filters */}
                <div className="flex flex-wrap items-center gap-2.5 pt-1">
                  <select
                    aria-label="Filter hari jadwal"
                    value={filterHari}
                    onChange={(e) => setFilterHari(e.target.value as DayOfWeek | 'ALL')}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="ALL">Semua Hari</option>
                    {SCHOOL_DAYS.map((day) => (
                      <option key={day} value={day}>
                        Hari {day}
                      </option>
                    ))}
                  </select>

                  <select
                    aria-label="Filter guru pengampu"
                    value={filterTeacherId}
                    onChange={(e) => setFilterTeacherId(e.target.value)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="ALL">Semua Guru ({teachingAccounts.length})</option>
                    {teachingAccounts.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nama} ({t.jabatan})
                      </option>
                    ))}
                  </select>

                  <select
                    aria-label="Filter kelas jadwal"
                    value={filterKelas}
                    onChange={(e) => setFilterKelas(e.target.value)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="ALL">Semua Kelas</option>
                    {scheduleClasses.map((cls) => (
                      <option key={cls} value={cls}>
                        Kelas {cls}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200/80 text-xs font-semibold text-slate-500">
                      <th className="py-3 px-4">Hari</th>
                      <th className="py-3 px-4">Jam Pelajaran</th>
                      <th className="py-3 px-4">Kelas</th>
                      <th className="py-3 px-4">Mata Pelajaran</th>
                      <th className="py-3 px-4">Guru Pengampu</th>
                      <th className="py-3 px-4 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredSchedules.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-12 px-6 text-center text-xs text-slate-500">
                          Belum ada jadwal pelajaran guru untuk filter ini. Klik{' '}
                          <strong className="text-slate-700">Tambah Jadwal Guru</strong> untuk mengatur jadwal mengajar.
                        </td>
                      </tr>
                    ) : (
                      filteredSchedules.map((sch) => {
                        const slotBadge = findSlotRangeLabelForSchedule(
                          effectiveTimetable,
                          sch.jam_mulai,
                          sch.jam_selesai
                        );
                        return (
                        <tr key={sch.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg bg-indigo-50 border border-indigo-200/80 text-xs font-semibold text-indigo-700">
                              {sch.hari}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-700 whitespace-nowrap">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="inline-flex items-center gap-1.5">
                                <Clock className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                                {sch.jam_mulai} – {sch.jam_selesai}
                              </span>
                              {slotBadge && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-slate-100 border border-slate-200/80 text-[10.5px] font-sans font-semibold text-slate-600">
                                  {slotBadge.label}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-xs font-semibold text-slate-900 whitespace-nowrap">
                            {sch.kelas}
                          </td>
                          <td className="py-3 px-4 font-semibold text-slate-900">
                            {sch.mata_pelajaran}
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-700 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5">
                              <UserCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                              {sch.teacher_name}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => openEditScheduleModal(sch)}
                                aria-label={`Edit jadwal ${sch.mata_pelajaran} ${sch.kelas}`}
                                className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:text-indigo-700 hover:border-indigo-200 hover:bg-indigo-50 transition-colors"
                              >
                                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteScheduleId(sch.id)}
                                aria-label={`Hapus jadwal ${sch.mata_pelajaran} ${sch.kelas}`}
                                className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:text-rose-700 hover:border-rose-200 hover:bg-rose-50 transition-colors"
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            </div>
                          </td>
                        </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </div>

      {/* Modal: Tambah / Edit Mata Pelajaran */}
      {subjectModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-subject-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/55 backdrop-blur-[1px]"
        >
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-md shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 id="modal-subject-title" className="text-base font-semibold text-slate-900">
                {editingSubject ? 'Edit Mata Pelajaran' : 'Tambah Mata Pelajaran'}
              </h3>
              <button
                type="button"
                onClick={() => setSubjectModalOpen(false)}
                aria-label="Tutup modal mata pelajaran"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleSubmitSubject} className="p-6 space-y-4">
              {subjectError && (
                <div
                  role="alert"
                  className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-xs font-medium text-rose-700"
                >
                  {subjectError}
                </div>
              )}

              <div>
                <label
                  htmlFor="master-subject-kode"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Kode Mata Pelajaran <span className="text-rose-600">*</span>
                </label>
                <input
                  id="master-subject-kode"
                  type="text"
                  required
                  maxLength={12}
                  value={subKode}
                  onChange={(e) => setSubKode(e.target.value.toUpperCase())}
                  placeholder="Contoh: MTK, FIS, BING"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-mono uppercase text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div>
                <label
                  htmlFor="master-subject-nama"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Nama Mata Pelajaran <span className="text-rose-600">*</span>
                </label>
                <input
                  id="master-subject-nama"
                  type="text"
                  required
                  value={subNama}
                  onChange={(e) => setSubNama(e.target.value)}
                  placeholder="Contoh: Matematika Peminatan"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div>
                <label
                  htmlFor="master-subject-desc"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Keterangan (Opsional)
                </label>
                <input
                  id="master-subject-desc"
                  type="text"
                  value={subDeskripsi}
                  onChange={(e) => setSubDeskripsi(e.target.value)}
                  placeholder="Kelompok wajib / peminatan / muatan lokal"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setSubjectModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
                >
                  Simpan Mapel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Tambah / Edit Jadwal Pelajaran Guru */}
      {scheduleModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-schedule-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/55 backdrop-blur-[1px]"
        >
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-md shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 id="modal-schedule-title" className="text-base font-semibold text-slate-900">
                {editingSchedule ? 'Edit Jadwal Pelajaran Guru' : 'Tambah Jadwal Pelajaran Guru'}
              </h3>
              <button
                type="button"
                onClick={() => setScheduleModalOpen(false)}
                aria-label="Tutup modal jadwal"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleSubmitSchedule} className="p-6 space-y-4">
              {scheduleError && (
                <div
                  role="alert"
                  className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-xs font-medium text-rose-700"
                >
                  {scheduleError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="schedule-hari"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Hari <span className="text-rose-600">*</span>
                  </label>
                  <select
                    id="schedule-hari"
                    value={schHari}
                    onChange={(e) => setSchHari(e.target.value as DayOfWeek)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
                  >
                    {SCHOOL_DAYS.map((day) => (
                      <option key={day} value={day}>
                        {day}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="schedule-kelas"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Kelas <span className="text-rose-600">*</span>
                  </label>
                  <input
                    id="schedule-kelas"
                    type="text"
                    required
                    list="jadwal-class-suggestions"
                    value={schKelas}
                    onChange={(e) => setSchKelas(e.target.value)}
                    placeholder="Contoh: X IPA 1"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="schedule-teacher"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Guru Pengampu <span className="text-rose-600">*</span>
                </label>
                <select
                  id="schedule-teacher"
                  required
                  value={schTeacherId}
                  onChange={(e) => setSchTeacherId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="">-- Pilih Guru / Wali Kelas --</option>
                  {teachingAccounts.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nama} — {t.jabatan}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="schedule-mapel"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Mata Pelajaran <span className="text-rose-600">*</span>
                </label>
                <select
                  id="schedule-mapel"
                  required
                  value={schMapel}
                  onChange={(e) => setSchMapel(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="">-- Pilih Mata Pelajaran --</option>
                  {masterSubjects.map((sub) => (
                    <option key={sub.id} value={sub.nama}>
                      [{sub.kode}] {sub.nama}
                    </option>
                  ))}
                </select>
              </div>

              {lessonSlots.length > 0 && (
                <div className="rounded-xl border border-indigo-200/70 bg-indigo-50/40 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-indigo-900">
                      Pilih Cepat Jam ke (Sinkron Pengaturan Jadwal · {effectiveTimetable.durasi_jp_menit} mnt/JP)
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label
                        htmlFor="schedule-slot-start"
                        className="block text-[11px] font-medium text-slate-600 mb-1"
                      >
                        Dari Jam ke
                      </label>
                      <select
                        id="schedule-slot-start"
                        data-testid="schedule-slot-start"
                        value={schStartJp}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (!v) {
                            setSchStartJp('');
                            setSchEndJp('');
                            return;
                          }
                          const nextEnd =
                            schEndJp && Number(schEndJp) >= Number(v) ? schEndJp : v;
                          applySlotRange(v, nextEnd);
                        }}
                        className="w-full rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
                      >
                        <option value="">Manual</option>
                        {lessonSlots.map((slot) => (
                          <option key={slot.jamKe} value={String(slot.jamKe)}>
                            Jam ke-{slot.jamKe} ({slot.jam_mulai})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label
                        htmlFor="schedule-slot-end"
                        className="block text-[11px] font-medium text-slate-600 mb-1"
                      >
                        Sampai Jam ke
                      </label>
                      <select
                        id="schedule-slot-end"
                        data-testid="schedule-slot-end"
                        value={schEndJp}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (!v) {
                            setSchEndJp('');
                            return;
                          }
                          const nextStart =
                            schStartJp && Number(schStartJp) <= Number(v)
                              ? schStartJp
                              : v;
                          applySlotRange(nextStart, v);
                        }}
                        className="w-full rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none"
                      >
                        <option value="">Manual</option>
                        {lessonSlots.map((slot) => (
                          <option
                            key={slot.jamKe}
                            value={String(slot.jamKe)}
                            disabled={Boolean(schStartJp && slot.jamKe < Number(schStartJp))}
                          >
                            Jam ke-{slot.jamKe} (s.d. {slot.jam_selesai})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="schedule-jam-mulai"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Jam Mulai <span className="text-rose-600">*</span>
                  </label>
                  <input
                    id="schedule-jam-mulai"
                    type="time"
                    required
                    value={schJamMulai}
                    onChange={(e) => {
                      setSchJamMulai(e.target.value);
                      const matched = findSlotRangeLabelForSchedule(
                        effectiveTimetable,
                        e.target.value,
                        schJamSelesai
                      );
                      setSchStartJp(matched ? String(matched.startJp) : '');
                      setSchEndJp(matched ? String(matched.endJp) : '');
                    }}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-mono text-slate-900 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="schedule-jam-selesai"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Jam Selesai <span className="text-rose-600">*</span>
                  </label>
                  <input
                    id="schedule-jam-selesai"
                    type="time"
                    required
                    value={schJamSelesai}
                    onChange={(e) => {
                      setSchJamSelesai(e.target.value);
                      const matched = findSlotRangeLabelForSchedule(
                        effectiveTimetable,
                        schJamMulai,
                        e.target.value
                      );
                      setSchStartJp(matched ? String(matched.startJp) : '');
                      setSchEndJp(matched ? String(matched.endJp) : '');
                    }}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-mono text-slate-900 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              <p className="text-[11px] text-slate-500">
                Otomatis tersimpan &amp; tersinkron ke <strong>Pengaturan Jadwal</strong> (tabel matriks) dan <strong>Menu Mapel Guru</strong> untuk TA <strong className="font-mono">{settings.tahun_ajaran}</strong> · Semester <strong>{formatSemesterLabel(activeSemester)}</strong>.
              </p>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setScheduleModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
                >
                  Simpan Jadwal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Konfirmasi Hapus Master Subject */}
      {confirmDeleteSubjectId && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[1px]"
        >
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-sm shadow-xl p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-900">Hapus Mata Pelajaran?</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Mata pelajaran akan dihapus dari daftar master. Data presensi yang sudah tercatat tetap aman.
            </p>
            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmDeleteSubjectId(null)}
                className="px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteMasterSubject(confirmDeleteSubjectId);
                  setConfirmDeleteSubjectId(null);
                }}
                className="px-3.5 py-2 rounded-xl bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700"
              >
                Ya, Hapus
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Import Jadwal Pelajaran Guru dari Excel / CSV */}
      {importScheduleOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-teacher-schedule-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[1px]"
        >
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="h-9 w-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                  <FileSpreadsheet className="h-4.5 w-4.5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h3
                    id="import-teacher-schedule-title"
                    className="text-base font-semibold text-slate-900 truncate"
                  >
                    Import Jadwal Pelajaran Guru (Excel / CSV)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Otomatis sinkron ke Pengaturan Jadwal &amp; menu Daftar Pelajaran masing-masing guru
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setImportScheduleOpen(false)}
                aria-label="Tutup modal import jadwal guru"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="text-xs text-slate-600 leading-relaxed">
                  <p className="font-semibold text-slate-800">Template Excel siap isi</p>
                  <p className="mt-0.5">
                    Kolom: Hari, Jam Mulai, Jam Selesai (atau Waktu / Jam ke), Kelas, Mata Pelajaran, Guru.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    downloadTeacherScheduleTemplate(
                      scheduleClasses,
                      teachingAccounts,
                      masterSubjects,
                      normalizeSemester(settings.semester, 'ganjil')
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  <Download className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                  <span>Unduh Template .xlsx</span>
                </button>
              </div>

              <div>
                <label
                  htmlFor="teacher-schedule-excel-input"
                  className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 hover:border-indigo-400 bg-slate-50/50 hover:bg-indigo-50/30 px-4 py-6 cursor-pointer transition-colors text-center"
                >
                  <Upload className="h-6 w-6 text-indigo-500" aria-hidden="true" />
                  <span className="text-xs font-semibold text-slate-800">
                    {importScheduleFileName || 'Pilih file Excel (.xlsx / .xls) atau CSV (.csv)'}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Nama/Username Guru akan dicocokkan otomatis dengan daftar akun Guru &amp; Wali Kelas
                  </span>
                  <input
                    id="teacher-schedule-excel-input"
                    data-testid="input-import-teacher-schedule-file"
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="sr-only"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      setImportScheduleFileName(file.name);
                      setImportScheduleError(null);
                      setImportScheduleParsing(true);
                      try {
                        const parsed = await parseTeacherSchedulesFile(file, {
                          teachingAccounts,
                          existingSchedules: schedules,
                          tahunAjaran: settings.tahun_ajaran,
                          defaultSemester: normalizeSemester(settings.semester, 'ganjil'),
                          activeTimetableConfig: effectiveTimetable,
                        });
                        setImportSchedulePreview(parsed);
                        if (parsed.totalRows === 0) {
                          setImportScheduleError(
                            'File tidak memiliki baris data jadwal pelajaran guru.'
                          );
                        }
                      } catch {
                        setImportSchedulePreview(null);
                        setImportScheduleError(
                          'Gagal membaca file. Pastikan file berformat Excel (.xlsx/.xls) atau CSV yang valid.'
                        );
                      } finally {
                        setImportScheduleParsing(false);
                      }
                    }}
                  />
                </label>
              </div>

              {importScheduleParsing && (
                <p className="text-xs text-indigo-600 font-medium text-center">
                  Memvalidasi baris jadwal guru...
                </p>
              )}

              {importScheduleError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700">
                  {importScheduleError}
                </div>
              )}

              {importSchedulePreview && importSchedulePreview.totalRows > 0 && (
                <div
                  data-testid="teacher-schedule-import-preview"
                  className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2.5 text-xs"
                >
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-emerald-50 border border-emerald-200/80 py-2 px-2">
                      <p className="text-base font-bold font-mono tabular-nums text-emerald-700">
                        {importSchedulePreview.validItems.length}
                      </p>
                      <p className="text-[11px] text-emerald-800">Siap diimpor</p>
                    </div>
                    <div className="rounded-lg bg-amber-50 border border-amber-200/80 py-2 px-2">
                      <p className="text-base font-bold font-mono tabular-nums text-amber-700">
                        {importSchedulePreview.duplicateCount}
                      </p>
                      <p className="text-[11px] text-amber-800">Duplikat</p>
                    </div>
                    <div className="rounded-lg bg-rose-50 border border-rose-200/80 py-2 px-2">
                      <p className="text-base font-bold font-mono tabular-nums text-rose-700">
                        {importSchedulePreview.invalidRows.length}
                      </p>
                      <p className="text-[11px] text-rose-800">Tidak valid</p>
                    </div>
                  </div>

                  {importSchedulePreview.invalidRows.length > 0 && (
                    <div className="rounded-lg border border-rose-200/80 bg-rose-50/70 p-2.5 space-y-1 max-h-28 overflow-y-auto">
                      <p className="text-[11px] font-semibold text-rose-800">
                        Rincian baris yang dilewati:
                      </p>
                      {importSchedulePreview.invalidRows.slice(0, 6).map((err) => (
                        <p key={`${err.rowNumber}-${err.reason}`} className="text-[11px] text-rose-700">
                          Baris {err.rowNumber}: {err.reason}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setImportScheduleOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="button"
                  data-testid="btn-confirm-import-teacher-schedule"
                  disabled={
                    !importSchedulePreview || importSchedulePreview.validItems.length === 0
                  }
                  onClick={() => {
                    if (!importSchedulePreview || importSchedulePreview.validItems.length === 0) {
                      return;
                    }
                    if (onBulkImportSchedules) {
                      onBulkImportSchedules(importSchedulePreview.validItems);
                    } else {
                      importSchedulePreview.validItems.forEach((item) => {
                        onAddSchedule(item);
                      });
                    }
                    setImportScheduleOpen(false);
                    setImportSchedulePreview(null);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    Import {importSchedulePreview?.validItems.length || 0} Jadwal
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Konfirmasi Hapus Jadwal */}
      {confirmDeleteScheduleId && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[1px]"
        >
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-sm shadow-xl p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-900">Hapus Jadwal Guru?</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Jadwal ini akan dihapus dari daftar mengajar guru. Riwayat presensi yang sudah tersimpan tidak akan ikut terhapus.
            </p>
            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmDeleteScheduleId(null)}
                className="px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteSchedule(confirmDeleteScheduleId);
                  setConfirmDeleteScheduleId(null);
                }}
                className="px-3.5 py-2 rounded-xl bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700"
              >
                Ya, Hapus
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
