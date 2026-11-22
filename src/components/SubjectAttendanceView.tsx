import { useEffect, useMemo, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  BookOpen,
  Calendar,
  CalendarDays,
  Camera,
  CameraOff,
  CheckCheck,
  CheckCircle2,
  Clock,
  Download,
  FileSpreadsheet,
  Filter,
  Keyboard,
  Plus,
  QrCode,
  Search,
  SwitchCamera,
  Trash2,
  UserCheck,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import type {
  AttendanceStatus,
  AuthSession,
  DayOfWeek,
  MasterSubject,
  SchoolSettings,
  Student,
  SubjectAssignment,
  SubjectAttendanceRecord,
  TeacherSchedule,
  UserAccount,
} from '../types';
import { extractNisFromQrPayload, getTodayDateString } from '../utils/attendanceLogic';
import {
  computeSubjectSessionSummary,
  formatIndonesianDateWithDay,
  formatSemesterLabel,
  getDateForDayInSameWeek,
  getIndonesianDayOfWeek,
  getRecordsForAssignmentOnDate,
  resolveAssignmentsForDate,
  SCHOOL_DAYS,
  SUBJECT_SUGGESTIONS,
  type SubjectScanOutcome,
} from '../utils/subjectAttendance';
import {
  generateSubjectAttendancePdf,
  resolveTeacherNip,
} from '../utils/subjectAttendancePdf';

interface SubjectAttendanceViewProps {
  session: AuthSession;
  accounts: UserAccount[];
  students: Student[];
  settings: SchoolSettings;
  assignments: SubjectAssignment[];
  schedules: TeacherSchedule[];
  masterSubjects: MasterSubject[];
  records: SubjectAttendanceRecord[];
  onAddAssignment: (input: {
    kelas: string;
    mata_pelajaran: string;
    hari: DayOfWeek;
    jam_mulai?: string;
    jam_selesai?: string;
  }) => { ok: boolean; assignment?: SubjectAssignment; error?: string };
  onDeleteAssignment: (assignmentId: string) => void;
  onScanSubject: (
    assignment: SubjectAssignment,
    nis: string,
    tanggal: string
  ) => SubjectScanOutcome;
  onUpdateStudentStatus: (
    assignment: SubjectAssignment,
    student: Student,
    tanggal: string,
    status: AttendanceStatus
  ) => void;
  onMarkAllPresent: (
    assignment: SubjectAssignment,
    classStudents: Student[],
    tanggal: string
  ) => void;
  onNavigateToSchedule?: () => void;
}

const MAPEL_SCANNER_ID = 'presensiqr-mapel-camera-reader';

const STATUS_BADGE_STYLES: Record<AttendanceStatus, string> = {
  Hadir: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Terlambat: 'bg-amber-50 text-amber-700 border-amber-200',
  Sakit: 'bg-sky-50 text-sky-700 border-sky-200',
  Izin: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  Alpa: 'bg-rose-50 text-rose-700 border-rose-200',
};

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SubjectAttendanceView({
  session,
  accounts,
  students,
  settings,
  assignments,
  schedules,
  masterSubjects,
  records,
  onAddAssignment,
  onDeleteAssignment,
  onScanSubject,
  onUpdateStudentStatus,
  onMarkAllPresent,
  onNavigateToSchedule,
}: SubjectAttendanceViewProps) {
  const isMasterAdmin = session.role === 'master_admin';
  const [selectedDate, setSelectedDate] = useState(getTodayDateString);

  // Shared PDF downloading indicator (assignment id)
  const [downloadingPdfId, setDownloadingPdfId] = useState<string | null>(null);

  // === Master Admin Filter State ===
  const [adminFilterClass, setAdminFilterClass] = useState<string>('ALL');
  const [adminFilterSubjectId, setAdminFilterSubjectId] = useState<string>('ALL');

  // === Teacher / Wali Kelas State ===
  const [activeAssignmentId, setActiveAssignmentId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [inputMode, setInputMode] = useState<'nis' | 'nama'>('nis');
  const [manualNis, setManualNis] = useState('');
  const [nameSearchQuery, setNameSearchQuery] = useState('');
  const [selectedStudentNis, setSelectedStudentNis] = useState('');
  const [lastOutcome, setLastOutcome] = useState<SubjectScanOutcome | null>(null);

  // Add Class & Subject modal state (Guru / Wali Kelas)
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newKelas, setNewKelas] = useState('');
  const [newMapel, setNewMapel] = useState('');
  const [newHari, setNewHari] = useState<DayOfWeek>(() =>
    getIndonesianDayOfWeek(getTodayDateString())
  );
  const [newJamMulai, setNewJamMulai] = useState('');
  const [newJamSelesai, setNewJamSelesai] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Collapsible Camera QR Scanner state
  const [showCameraPanel, setShowCameraPanel] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastScanRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const activeAssignmentRef = useRef<SubjectAssignment | null>(null);
  const selectedDateRef = useRef<string>(selectedDate);
  const onScanSubjectRef = useRef(onScanSubject);

  selectedDateRef.current = selectedDate;
  onScanSubjectRef.current = onScanSubject;

  const selectedDayName = useMemo(
    () => getIndonesianDayOfWeek(selectedDate),
    [selectedDate]
  );
  const formattedSelectedDate = useMemo(
    () => formatIndonesianDateWithDay(selectedDate),
    [selectedDate]
  );

  // All available classes from active year's student roster
  const availableClasses = useMemo(() => {
    const set = new Set<string>();
    for (const s of students) {
      if (s.kelas.trim()) set.add(s.kelas.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [students]);

  const subjectSuggestionNames = useMemo(() => {
    const set = new Set<string>(masterSubjects.map((m) => m.nama));
    for (const s of SUBJECT_SUGGESTIONS) set.add(s);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [masterSubjects]);

  // Date-resolved assignments (ONLY subjects scheduled or recorded for `selectedDate`)
  const dateAssignments = useMemo(
    () =>
      resolveAssignmentsForDate({
        selectedDate,
        academicYear: settings.tahun_ajaran,
        semester: settings.semester,
        schedules,
        manualAssignments: assignments,
        records,
        role: session.role,
        teacherUserId: session.userId,
      }),
    [
      selectedDate,
      settings.tahun_ajaran,
      settings.semester,
      schedules,
      assignments,
      records,
      session.role,
      session.userId,
    ]
  );

  // Teacher's weekly schedule overview across all school days (so schedules added by Master Admin are always immediately visible and 1-click reachable)
  const teacherWeeklyScheduleByDay = useMemo(() => {
    if (isMasterAdmin) return [] as Array<{ day: DayOfWeek; items: SubjectAssignment[] }>;
    return SCHOOL_DAYS.map((day) => {
      const dateForDay = getDateForDayInSameWeek(selectedDate, day);
      const items = resolveAssignmentsForDate({
        selectedDate: dateForDay,
        academicYear: settings.tahun_ajaran,
        semester: settings.semester,
        schedules,
        manualAssignments: assignments,
        records,
        role: session.role,
        teacherUserId: session.userId,
      });
      return { day, items };
    }).filter((entry) => entry.items.length > 0);
  }, [
    isMasterAdmin,
    selectedDate,
    settings.tahun_ajaran,
    settings.semester,
    schedules,
    assignments,
    records,
    session.role,
    session.userId,
  ]);

  // =========================================================================
  // MASTER ADMIN DERIVED DATA
  // =========================================================================
  const adminAvailableClasses = useMemo(() => {
    const set = new Set<string>();
    for (const a of dateAssignments) {
      if (a.kelas.trim()) set.add(a.kelas.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [dateAssignments]);

  // Reset class filter if selected class does not exist on the newly picked date
  useEffect(() => {
    if (!isMasterAdmin) return;
    if (
      adminFilterClass !== 'ALL' &&
      !adminAvailableClasses.some(
        (c) => c.toLowerCase() === adminFilterClass.toLowerCase()
      )
    ) {
      setAdminFilterClass('ALL');
    }
  }, [isMasterAdmin, adminFilterClass, adminAvailableClasses]);

  const adminSubjectsForClass = useMemo(() => {
    if (adminFilterClass === 'ALL') return dateAssignments;
    const norm = adminFilterClass.trim().toLowerCase();
    return dateAssignments.filter((a) => a.kelas.trim().toLowerCase() === norm);
  }, [dateAssignments, adminFilterClass]);

  // Reset subject filter if selected subject does not exist on the newly picked date/class
  useEffect(() => {
    if (!isMasterAdmin) return;
    if (
      adminFilterSubjectId !== 'ALL' &&
      !adminSubjectsForClass.some((a) => a.id === adminFilterSubjectId)
    ) {
      setAdminFilterSubjectId('ALL');
    }
  }, [isMasterAdmin, adminFilterSubjectId, adminSubjectsForClass]);

  const adminFilteredAssignments = useMemo(() => {
    if (adminFilterSubjectId === 'ALL') return adminSubjectsForClass;
    return adminSubjectsForClass.filter((a) => a.id === adminFilterSubjectId);
  }, [adminSubjectsForClass, adminFilterSubjectId]);

  const adminRecapCards = useMemo(() => {
    return adminFilteredAssignments.map((asg) => {
      const normKelas = asg.kelas.trim().toLowerCase();
      const clsStudents = students
        .filter((s) => s.kelas.trim().toLowerCase() === normKelas)
        .sort((a, b) => a.nama.localeCompare(b.nama));
      const sesRecs = getRecordsForAssignmentOnDate(records, asg, selectedDate);
      const recMap = new Map<string, SubjectAttendanceRecord>();
      for (const r of sesRecs) recMap.set(r.nis.trim().toLowerCase(), r);
      const summary = computeSubjectSessionSummary(clsStudents, sesRecs);
      return {
        assignment: asg,
        classStudents: clsStudents,
        sessionRecords: sesRecs,
        recordByNis: recMap,
        summary,
      };
    });
  }, [adminFilteredAssignments, students, records, selectedDate]);

  const adminAggregateSummary = useMemo(() => {
    let totalStudents = 0;
    let hadir = 0;
    let terlambat = 0;
    let sakit = 0;
    let izin = 0;
    let alpa = 0;
    let belumPresensi = 0;
    for (const card of adminRecapCards) {
      totalStudents += card.summary.totalStudents;
      hadir += card.summary.hadir;
      terlambat += card.summary.terlambat;
      sakit += card.summary.sakit;
      izin += card.summary.izin;
      alpa += card.summary.alpa;
      belumPresensi += card.summary.belumPresensi;
    }
    const persentaseHadir =
      totalStudents > 0 ? Math.round(((hadir + terlambat) / totalStudents) * 100) : 0;
    return {
      totalStudents,
      hadir,
      terlambat,
      sakit,
      izin,
      alpa,
      belumPresensi,
      persentaseHadir,
    };
  }, [adminRecapCards]);

  // =========================================================================
  // TEACHER / WALI KELAS DERIVED DATA
  // =========================================================================
  useEffect(() => {
    if (isMasterAdmin) return;
    if (dateAssignments.length === 0) {
      setActiveAssignmentId('');
      return;
    }
    if (!dateAssignments.some((a) => a.id === activeAssignmentId)) {
      setActiveAssignmentId(dateAssignments[0].id);
    }
  }, [isMasterAdmin, dateAssignments, activeAssignmentId]);

  const activeAssignment = useMemo(
    () => dateAssignments.find((a) => a.id === activeAssignmentId) || null,
    [dateAssignments, activeAssignmentId]
  );
  activeAssignmentRef.current = activeAssignment;

  // Students belonging to activeAssignment.kelas
  const classStudents = useMemo(() => {
    if (!activeAssignment) return [];
    const norm = activeAssignment.kelas.trim().toLowerCase();
    return students
      .filter((s) => s.kelas.trim().toLowerCase() === norm)
      .sort((a, b) => a.nama.localeCompare(b.nama));
  }, [students, activeAssignment]);

  // Records for activeAssignment on selectedDate
  const sessionRecords = useMemo(() => {
    if (!activeAssignment) return [];
    return getRecordsForAssignmentOnDate(records, activeAssignment, selectedDate);
  }, [records, activeAssignment, selectedDate]);

  const recordByNis = useMemo(() => {
    const map = new Map<string, SubjectAttendanceRecord>();
    for (const r of sessionRecords) {
      map.set(r.nis.trim().toLowerCase(), r);
    }
    return map;
  }, [sessionRecords]);

  const summary = useMemo(
    () => computeSubjectSessionSummary(classStudents, sessionRecords),
    [classStudents, sessionRecords]
  );

  // Per-assignment attendance counter for left Sub Menu Kelas badges
  const assignmentCounts = useMemo(() => {
    const map = new Map<string, { present: number; total: number }>();
    for (const asg of dateAssignments) {
      const normClass = asg.kelas.trim().toLowerCase();
      const clsStudents = students.filter(
        (s) => s.kelas.trim().toLowerCase() === normClass
      );
      const sesRecs = getRecordsForAssignmentOnDate(records, asg, selectedDate);
      const present = sesRecs.filter(
        (r) => r.status === 'Hadir' || r.status === 'Terlambat'
      ).length;
      map.set(asg.id, { present, total: clsStudents.length });
    }
    return map;
  }, [dateAssignments, students, records, selectedDate]);

  const visibleStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return classStudents;
    return classStudents.filter(
      (s) =>
        s.nama.toLowerCase().includes(q) || s.nis.toLowerCase().includes(q)
    );
  }, [classStudents, searchQuery]);

  // Filtered students for Input Nama mode
  const namePickerStudents = useMemo(() => {
    const q = nameSearchQuery.trim().toLowerCase();
    if (!q) return classStudents;
    return classStudents.filter(
      (s) =>
        s.nama.toLowerCase().includes(q) || s.nis.toLowerCase().includes(q)
    );
  }, [classStudents, nameSearchQuery]);

  useEffect(() => {
    if (namePickerStudents.length === 0) {
      setSelectedStudentNis('');
      return;
    }
    if (!namePickerStudents.some((s) => s.nis === selectedStudentNis)) {
      // Prefer first student not yet recorded
      const firstUnrecorded = namePickerStudents.find(
        (s) => !recordByNis.has(s.nis.trim().toLowerCase())
      );
      setSelectedStudentNis((firstUnrecorded || namePickerStudents[0]).nis);
    }
  }, [namePickerStudents, selectedStudentNis, recordByNis]);

  // =========================================================================
  // SHARED EXPORT HANDLERS (PDF & EXCEL)
  // =========================================================================
  async function handleDownloadPdf(
    assignment: SubjectAssignment,
    targetStudents: Student[],
    targetRecords: SubjectAttendanceRecord[]
  ) {
    setDownloadingPdfId(assignment.id);
    try {
      const teacherNip = resolveTeacherNip(
        accounts,
        assignment.teacher_user_id,
        assignment.teacher_name,
        session.userId === assignment.teacher_user_id ? session.nip : undefined
      );
      const { blob, filename } = await generateSubjectAttendancePdf({
        assignment,
        tanggal: selectedDate,
        classStudents: targetStudents,
        sessionRecords: targetRecords,
        settings,
        teacherNip,
      });
      triggerBlobDownload(blob, filename);
    } finally {
      setDownloadingPdfId(null);
    }
  }

  function handleExportExcel(
    assignment: SubjectAssignment,
    targetStudents: Student[],
    targetRecordMap: Map<string, SubjectAttendanceRecord>
  ) {
    const rows = targetStudents.map((s, idx) => {
      const rec = targetRecordMap.get(s.nis.trim().toLowerCase());
      return {
        No: idx + 1,
        Tanggal: selectedDate,
        Hari: selectedDayName,
        Kelas: assignment.kelas,
        'Mata Pelajaran': assignment.mata_pelajaran,
        Guru: assignment.teacher_name,
        NIS: s.nis,
        'Nama Siswa': s.nama,
        'Jam Masuk': rec?.jam_masuk || '-',
        Status: rec?.status || 'Belum Presensi',
        Keterangan: rec?.keterangan || '-',
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Presensi_Mapel');
    const safeMapel = assignment.mata_pelajaran.replace(/[^a-zA-Z0-9]+/g, '_');
    const safeKelas = assignment.kelas.replace(/[^a-zA-Z0-9]+/g, '_');
    XLSX.writeFile(wb, `Presensi_Mapel_${safeMapel}_${safeKelas}_${selectedDate}.xlsx`);
  }

  // =========================================================================
  // CAMERA SCANNER LIFECYCLE (GURU / WALI KELAS)
  // =========================================================================
  async function stopCamera() {
    const instance = scannerRef.current;
    if (instance) {
      try {
        if (instance.isScanning) {
          await instance.stop();
        }
      } catch {
        // Ignore stop race
      }
      try {
        instance.clear();
      } catch {
        // Ignore clear errors
      }
      scannerRef.current = null;
    }
    setCameraActive(false);
    setCameraStarting(false);
  }

  async function startCamera(targetFacing: 'environment' | 'user' = facingMode) {
    setCameraError(null);
    setCameraStarting(true);
    try {
      await stopCamera();
      const html5Qr = new Html5Qrcode(MAPEL_SCANNER_ID, { verbose: false });
      scannerRef.current = html5Qr;
      await html5Qr.start(
        { facingMode: targetFacing },
        {
          fps: 10,
          qrbox: { width: 220, height: 220 },
          aspectRatio: 1.333,
        },
        (decodedText) => {
          const currentAsg = activeAssignmentRef.current;
          if (!currentAsg) return;
          const nis = extractNisFromQrPayload(decodedText);
          if (!nis) return;
          const now = Date.now();
          if (
            lastScanRef.current.code === nis &&
            now - lastScanRef.current.at < 2500
          ) {
            return;
          }
          lastScanRef.current = { code: nis, at: now };
          const outcome = onScanSubjectRef.current(
            currentAsg,
            nis,
            selectedDateRef.current
          );
          setLastOutcome(outcome);
        },
        () => {
          // Ignore per-frame decode misses
        }
      );
      setCameraActive(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal membuka kamera.';
      if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('denied')) {
        setCameraError(
          'Akses kamera ditolak. Berikan izin kamera pada browser atau gunakan input NIS / Nama di bawah.'
        );
      } else {
        setCameraError(
          'Perangkat kamera tidak ditemukan atau sedang digunakan. Gunakan input NIS, input Nama, atau tombol Catat Masuk.'
        );
      }
      setCameraActive(false);
    } finally {
      setCameraStarting(false);
    }
  }

  async function handleSwitchCamera() {
    const nextMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextMode);
    if (cameraActive) {
      await startCamera(nextMode);
    }
  }

  useEffect(() => {
    return () => {
      const instance = scannerRef.current;
      if (instance && instance.isScanning) {
        instance.stop().catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    setLastOutcome(null);
    setManualNis('');
    setNameSearchQuery('');
    setSearchQuery('');
  }, [activeAssignmentId, selectedDate]);

  // =========================================================================
  // TEACHER / WALI KELAS HANDLERS
  // =========================================================================
  function openAddModal() {
    setNewKelas(
      session.role === 'wali_kelas' && session.kelas_binaan
        ? session.kelas_binaan
        : availableClasses[0] || ''
    );
    setNewMapel(masterSubjects[0]?.nama || '');
    setNewHari(selectedDayName === 'Minggu' ? 'Senin' : selectedDayName);
    setNewJamMulai('07:30');
    setNewJamSelesai('09:00');
    setAddError(null);
    setAddModalOpen(true);
  }

  function handleSubmitAddAssignment(e: React.FormEvent) {
    e.preventDefault();
    const res = onAddAssignment({
      kelas: newKelas,
      mata_pelajaran: newMapel,
      hari: newHari,
      jam_mulai: newJamMulai || undefined,
      jam_selesai: newJamSelesai || undefined,
    });
    if (!res.ok) {
      setAddError(res.error || 'Gagal menambahkan kelas & mata pelajaran.');
      return;
    }
    if (res.assignment) {
      if (newHari !== selectedDayName) {
        setSelectedDate(getDateForDayInSameWeek(selectedDate, newHari));
      }
      setActiveAssignmentId(res.assignment.id);
    }
    setAddModalOpen(false);
    setNewKelas('');
    setNewMapel('');
    setNewJamMulai('');
    setNewJamSelesai('');
    setAddError(null);
  }

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeAssignment) return;
    const trimmed = manualNis.trim();
    if (!trimmed) return;
    const outcome = onScanSubject(activeAssignment, trimmed, selectedDate);
    setLastOutcome(outcome);
    if (outcome.ok) {
      setManualNis('');
    }
  }

  function handleNameCheckInSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeAssignment || !selectedStudentNis) return;
    const outcome = onScanSubject(activeAssignment, selectedStudentNis, selectedDate);
    setLastOutcome(outcome);
  }

  function handleQuickCheckIn(student: Student) {
    if (!activeAssignment) return;
    const outcome = onScanSubject(activeAssignment, student.nis, selectedDate);
    setLastOutcome(outcome);
  }

  // =========================================================================
  // RENDER 1: MASTER ADMIN DEDICATED RECAP VIEW
  // =========================================================================
  if (isMasterAdmin) {
    return (
      <div className="space-y-6" data-testid="admin-mapel-view">
        {/* Master Admin Filter Card: Tanggal, Kelas, Mata Pelajaran (date-scoped) */}
        <section className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                <Filter className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm sm:text-base font-semibold text-slate-900">
                  Rekap Presensi Mata Pelajaran (Master Admin)
                </h2>
                <p className="text-xs text-slate-500">
                  Menampilkan rekap kehadiran siswa sesuai jadwal &amp; data pada{' '}
                  <strong className="text-slate-700">{formattedSelectedDate}</strong> · TA{' '}
                  <span className="font-mono font-semibold text-indigo-700">
                    {settings.tahun_ajaran}
                  </span>{' '}
                  · Semester {formatSemesterLabel(settings.semester)}
                </p>
              </div>
            </div>

            {onNavigateToSchedule && (
              <button
                type="button"
                onClick={onNavigateToSchedule}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-indigo-200 bg-indigo-50 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors whitespace-nowrap"
              >
                <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Kelola Mapel &amp; Jadwal</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-slate-100">
            {/* Filter Tanggal */}
            <div>
              <label
                htmlFor="mapel-date-picker"
                className="flex items-center gap-1.5 text-xs font-medium text-slate-700 mb-1.5"
              >
                <Calendar className="h-3.5 w-3.5 text-indigo-600" aria-hidden="true" />
                <span>Tanggal ({selectedDayName})</span>
              </label>
              <input
                id="mapel-date-picker"
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value || getTodayDateString())}
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs sm:text-sm font-mono text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            {/* Filter Kelas */}
            <div>
              <label
                htmlFor="admin-mapel-filter-kelas"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Filter Kelas
              </label>
              <select
                id="admin-mapel-filter-kelas"
                value={adminFilterClass}
                disabled={adminAvailableClasses.length === 0}
                onChange={(e) => {
                  setAdminFilterClass(e.target.value);
                  setAdminFilterSubjectId('ALL');
                }}
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 disabled:bg-slate-50 disabled:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                {adminAvailableClasses.length === 0 ? (
                  <option value="ALL">Tidak ada kelas terjadwal</option>
                ) : (
                  <>
                    <option value="ALL">
                      Semua Kelas ({adminAvailableClasses.length} kelas)
                    </option>
                    {adminAvailableClasses.map((cls) => (
                      <option key={cls} value={cls}>
                        Kelas {cls}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </div>

            {/* Filter Mata Pelajaran (STRICTLY scoped to selectedDate) */}
            <div>
              <label
                htmlFor="admin-mapel-filter-subject"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Filter Mata Pelajaran (Tersedia pada {selectedDayName})
              </label>
              <select
                id="admin-mapel-filter-subject"
                value={adminFilterSubjectId}
                disabled={adminSubjectsForClass.length === 0}
                onChange={(e) => setAdminFilterSubjectId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 disabled:bg-slate-50 disabled:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                {adminSubjectsForClass.length === 0 ? (
                  <option value="ALL">Tidak ada mapel pada tanggal ini</option>
                ) : (
                  <>
                    <option value="ALL">
                      Semua Mapel ({adminSubjectsForClass.length} sesi)
                    </option>
                    {adminSubjectsForClass.map((asg) => (
                      <option key={asg.id} value={asg.id}>
                        {asg.mata_pelajaran} — {asg.kelas} ({asg.teacher_name})
                      </option>
                    ))}
                  </>
                )}
              </select>
            </div>
          </div>
        </section>

        {/* Empty State when NO subjects exist on selectedDate */}
        {adminRecapCards.length === 0 ? (
          <section
            data-testid="admin-mapel-empty"
            className="bg-white rounded-2xl border border-slate-200/80 p-10 text-center space-y-3 shadow-[0_1px_3px_rgba(15,23,42,0.04)]"
          >
            <div className="h-12 w-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
              <BookOpen className="h-6 w-6" aria-hidden="true" />
            </div>
            <div className="space-y-1 max-w-md mx-auto">
              <h3 className="text-sm sm:text-base font-semibold text-slate-900">
                Tidak Ada Mata Pelajaran pada {formattedSelectedDate}
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Tidak ditemukan jadwal pelajaran maupun catatan presensi mata pelajaran pada hari{' '}
                <strong>{selectedDayName}</strong> ({selectedDate}). Pilih tanggal lain atau tambahkan jadwal mengajar guru pada menu{' '}
                <strong>Mapel &amp; Jadwal</strong>.
              </p>
            </div>
            {onNavigateToSchedule && (
              <button
                type="button"
                onClick={onNavigateToSchedule}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors"
              >
                <CalendarDays className="h-4 w-4" aria-hidden="true" />
                <span>Buka Menu Mapel &amp; Jadwal</span>
              </button>
            )}
          </section>
        ) : (
          <>
            {/* Aggregate KPI Summary */}
            <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-3.5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                <p className="text-[11px] font-medium text-slate-500">Sesi Mapel</p>
                <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                  {adminRecapCards.length}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-3.5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                <p className="text-[11px] font-medium text-slate-500">Total Siswa</p>
                <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                  {adminAggregateSummary.totalStudents}
                </p>
              </div>
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 px-4 py-3.5">
                <p className="text-[11px] font-medium text-emerald-700">Hadir</p>
                <p className="text-2xl font-bold font-mono tabular-nums text-emerald-800 mt-0.5">
                  {adminAggregateSummary.hadir}
                </p>
              </div>
              <div className="rounded-2xl border border-amber-200 bg-amber-50/60 px-4 py-3.5">
                <p className="text-[11px] font-medium text-amber-700">Terlambat</p>
                <p className="text-2xl font-bold font-mono tabular-nums text-amber-800 mt-0.5">
                  {adminAggregateSummary.terlambat}
                </p>
              </div>
              <div className="rounded-2xl border border-rose-200 bg-rose-50/60 px-4 py-3.5">
                <p className="text-[11px] font-medium text-rose-700">Sakit / Izin / Alpa</p>
                <p className="text-2xl font-bold font-mono tabular-nums text-rose-800 mt-0.5">
                  {adminAggregateSummary.sakit +
                    adminAggregateSummary.izin +
                    adminAggregateSummary.alpa}
                </p>
              </div>
              <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 px-4 py-3.5">
                <p className="text-[11px] font-medium text-indigo-700">Kehadiran</p>
                <p className="text-2xl font-bold font-mono tabular-nums text-indigo-800 mt-0.5">
                  {adminAggregateSummary.persentaseHadir}%
                </p>
              </div>
            </section>

            {/* Rekap Kehadiran Siswa per Mapel */}
            <div className="space-y-5">
              {adminRecapCards.map(
                ({
                  assignment,
                  classStudents: cardStudents,
                  sessionRecords: cardRecords,
                  recordByNis: cardRecMap,
                  summary: cardSummary,
                }) => (
                  <section
                    key={assignment.id}
                    data-testid="admin-mapel-recap-card"
                    className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden"
                  >
                    <div className="p-5 sm:p-6 border-b border-slate-100 flex flex-wrap items-start justify-between gap-4">
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span className="font-semibold text-indigo-700">
                            Kelas {assignment.kelas}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{assignment.teacher_name}</span>
                          {assignment.jam_mulai && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono">
                                {assignment.jam_mulai}
                                {assignment.jam_selesai ? ` – ${assignment.jam_selesai}` : ''}
                              </span>
                            </>
                          )}
                        </div>
                        <h3 className="text-base sm:text-lg font-bold text-slate-900">
                          Rekap Kehadiran — {assignment.mata_pelajaran}
                        </h3>
                        <p className="text-xs font-mono tabular-nums text-slate-500">
                          Total {cardSummary.totalStudents} siswa · Hadir {cardSummary.hadir} ·
                          Terlambat {cardSummary.terlambat} · S/I/A{' '}
                          {cardSummary.sakit + cardSummary.izin + cardSummary.alpa} · Belum{' '}
                          {cardSummary.belumPresensi} ({cardSummary.persentaseHadir}%)
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          data-testid="btn-download-mapel-pdf"
                          disabled={downloadingPdfId === assignment.id}
                          onClick={() =>
                            handleDownloadPdf(assignment, cardStudents, cardRecords)
                          }
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-60 transition-colors whitespace-nowrap"
                        >
                          <Download className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>
                            {downloadingPdfId === assignment.id
                              ? 'Menyiapkan PDF...'
                              : 'Unduh PDF'}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleExportExcel(assignment, cardStudents, cardRecMap)
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
                        >
                          <FileSpreadsheet
                            className="h-3.5 w-3.5 text-emerald-600"
                            aria-hidden="true"
                          />
                          <span>Excel</span>
                        </button>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-sm">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200/80 text-xs font-semibold text-slate-500">
                            <th className="py-3 px-4 w-12 text-center">No</th>
                            <th className="py-3 px-4">NIS</th>
                            <th className="py-3 px-4">Nama Siswa</th>
                            <th className="py-3 px-4">Jam Masuk</th>
                            <th className="py-3 px-4">Status</th>
                            <th className="py-3 px-4">Keterangan</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {cardStudents.length === 0 ? (
                            <tr>
                              <td
                                colSpan={6}
                                className="py-8 px-6 text-center text-xs text-slate-500"
                              >
                                Belum ada data siswa terdaftar di kelas {assignment.kelas}.
                              </td>
                            </tr>
                          ) : (
                            cardStudents.map((student, idx) => {
                              const rec = cardRecMap.get(student.nis.trim().toLowerCase());
                              return (
                                <tr
                                  key={student.nis}
                                  className="hover:bg-slate-50/70 transition-colors"
                                >
                                  <td className="py-3 px-4 text-center text-xs font-mono text-slate-500">
                                    {idx + 1}
                                  </td>
                                  <td className="py-3 px-4 font-mono tabular-nums text-xs font-medium text-slate-700 whitespace-nowrap">
                                    {student.nis}
                                  </td>
                                  <td className="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">
                                    {student.nama}
                                  </td>
                                  <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                                    {rec?.jam_masuk || '-'}
                                  </td>
                                  <td className="py-3 px-4 whitespace-nowrap">
                                    {rec ? (
                                      <span
                                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg border text-xs font-semibold ${STATUS_BADGE_STYLES[rec.status]}`}
                                      >
                                        {rec.status === 'Hadir' && (
                                          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                                        )}
                                        {rec.status === 'Terlambat' && (
                                          <Clock className="h-3 w-3" aria-hidden="true" />
                                        )}
                                        {rec.status}
                                      </span>
                                    ) : (
                                      <span className="text-xs text-slate-400">
                                        Belum Presensi
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-3 px-4 text-xs text-slate-500">
                                    {rec?.keterangan || (rec ? '-' : 'Belum tercatat hadir')}
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  // =========================================================================
  // RENDER 2: GURU MATA PELAJARAN & WALI KELAS WORKSPACE
  // =========================================================================
  return (
    <div className="space-y-6" data-testid="teacher-mapel-view">
      {/* Shared Datalists */}
      <datalist id="mapel-class-suggestions">
        {availableClasses.map((cls) => (
          <option key={cls} value={cls} />
        ))}
      </datalist>
      <datalist id="mapel-subject-suggestions">
        {subjectSuggestionNames.map((sub) => (
          <option key={sub} value={sub} />
        ))}
      </datalist>

      {/* Top Action & Context Bar */}
      <div className="bg-white rounded-2xl border border-slate-200/80 px-5 py-4 shadow-[0_1px_3px_rgba(15,23,42,0.04)] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
            <BookOpen className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-semibold text-slate-900 truncate">
              Presensi Kehadiran Mata Pelajaran
            </h2>
            <p className="text-xs text-slate-500 truncate">
              {session.nama} · {session.jabatan} · TA {settings.tahun_ajaran} · Semester{' '}
              {formatSemesterLabel(settings.semester)} ·{' '}
              <strong className="text-slate-700">{formattedSelectedDate}</strong>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5">
            <Calendar className="h-3.5 w-3.5 text-indigo-600 shrink-0" aria-hidden="true" />
            <span className="text-xs font-semibold text-indigo-700">{selectedDayName}</span>
            <input
              id="mapel-date-picker"
              type="date"
              aria-label="Tanggal presensi mata pelajaran"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value || getTodayDateString())}
              className="bg-transparent text-xs font-mono text-slate-800 focus:outline-none"
            />
          </div>

          <button
            type="button"
            onClick={openAddModal}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs sm:text-sm font-semibold hover:bg-indigo-700 transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>Tambah Kelas &amp; Mapel</span>
          </button>
        </div>
      </div>

      {/* Teacher Weekly Schedule Quick Day Switcher (shows all days assigned by Master Admin or self-added) */}
      {teacherWeeklyScheduleByDay.length > 0 && (
        <div
          data-testid="teacher-weekly-schedule-strip"
          className="bg-white rounded-2xl border border-slate-200/80 px-4 py-3 shadow-[0_1px_3px_rgba(15,23,42,0.04)] flex flex-wrap items-center gap-2"
        >
          <span className="text-xs font-semibold text-slate-600 mr-1">
            Jadwal Mengajar Anda:
          </span>
          {teacherWeeklyScheduleByDay.map(({ day, items }) => {
            const isSelectedDay = day === selectedDayName;
            return (
              <button
                key={day}
                type="button"
                data-testid={`teacher-day-jump-${day}`}
                onClick={() => setSelectedDate(getDateForDayInSameWeek(selectedDate, day))}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
                  isSelectedDay
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-indigo-50 hover:text-indigo-700'
                }`}
              >
                <span>{day}</span>
                <span className={`font-mono tabular-nums text-[11px] ${isSelectedDay ? 'text-indigo-100' : 'text-slate-500'}`}>
                  ({items.length})
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Main Split Layout: Left Sub-Menu Kelas + Right Presensi Workspace */}
      {dateAssignments.length === 0 ? (
        <section
          data-testid="teacher-mapel-empty-date"
          className="bg-white rounded-2xl border border-slate-200/80 p-10 text-center space-y-4 shadow-[0_1px_3px_rgba(15,23,42,0.04)]"
        >
          <div className="h-14 w-14 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto">
            <BookOpen className="h-7 w-7" aria-hidden="true" />
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <h3 className="text-base font-semibold text-slate-900">
              Tidak Ada Jadwal Mata Pelajaran pada {formattedSelectedDate}
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Mata pelajaran yang tampil mengikuti <strong>Jadwal Pelajaran Guru</strong> pada hari{' '}
              <strong>{selectedDayName}</strong>. Pilih tanggal lain yang memiliki jadwal mengajar Anda, atau tambahkan kelas &amp; mapel tambahan untuk hari {selectedDayName}.
            </p>
          </div>
          <button
            type="button"
            onClick={openAddModal}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>Tambah Kelas &amp; Mapel ({selectedDayName})</span>
          </button>
        </section>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Sticky Sub-Menu Kelas Rail */}
          <aside className="lg:col-span-3 lg:sticky lg:top-20">
            <div
              role="tablist"
              aria-label="Sub menu kelas mata pelajaran"
              className="bg-white rounded-2xl border border-slate-200/80 p-2.5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] flex lg:flex-col gap-1.5 overflow-x-auto"
            >
              <div className="hidden lg:flex items-center justify-between px-3 pt-1 pb-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Sub Menu {selectedDayName} ({dateAssignments.length})
                </span>
                <button
                  type="button"
                  onClick={openAddModal}
                  aria-label="Tambah kelas dan mata pelajaran"
                  className="p-1 rounded-lg text-indigo-600 hover:bg-indigo-50 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>

              {dateAssignments.map((asg) => {
                const isActive = activeAssignment?.id === asg.id;
                const counts = assignmentCounts.get(asg.id) || { present: 0, total: 0 };
                return (
                  <div
                    key={asg.id}
                    className={`flex items-center gap-1.5 rounded-xl border transition-colors shrink-0 lg:shrink lg:w-full ${
                      isActive
                        ? 'bg-indigo-50 border-indigo-200/80 text-indigo-700'
                        : 'border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => setActiveAssignmentId(asg.id)}
                      className="flex-1 flex items-center gap-2.5 px-3 py-2.5 text-left min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-xl"
                    >
                      <div
                        className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
                          isActive
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        <BookOpen className="h-4 w-4" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold truncate">
                          {asg.kelas} — {asg.mata_pelajaran}
                        </p>
                        <p className="text-[11px] text-slate-500 font-mono tabular-nums truncate">
                          {counts.present}/{counts.total} hadir
                          {asg.jam_mulai ? ` · ${asg.jam_mulai}` : ''}
                        </p>
                      </div>
                    </button>
                    {asg.source === 'manual' && (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(asg.id)}
                        aria-label={`Hapus ${asg.kelas} ${asg.mata_pelajaran}`}
                        title="Hapus kelas & mapel tambahan"
                        className="p-1.5 mr-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </aside>

          {/* Right Workspace for Active Class & Subject */}
          {activeAssignment && (
            <div className="lg:col-span-9 space-y-5 min-w-0">
              {/* Session Header + KPI Strip */}
              <section className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-semibold text-indigo-700">
                        Kelas {activeAssignment.kelas}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{activeAssignment.teacher_name}</span>
                      {activeAssignment.jam_mulai && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono">
                            {activeAssignment.jam_mulai}
                            {activeAssignment.jam_selesai
                              ? ` – ${activeAssignment.jam_selesai}`
                              : ''}
                          </span>
                        </>
                      )}
                      {activeAssignment.source === 'schedule' && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-emerald-700 font-semibold">
                            Sesuai Jadwal Sekolah
                          </span>
                        </>
                      )}
                    </div>
                    <h3 className="text-lg font-bold text-slate-900 mt-0.5">
                      {activeAssignment.mata_pelajaran}
                    </h3>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      data-testid="btn-download-mapel-pdf"
                      disabled={downloadingPdfId === activeAssignment.id}
                      onClick={() =>
                        handleDownloadPdf(
                          activeAssignment,
                          classStudents,
                          sessionRecords
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-60 transition-colors whitespace-nowrap"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>
                        {downloadingPdfId === activeAssignment.id
                          ? 'Menyiapkan PDF...'
                          : 'Unduh PDF'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        handleExportExcel(activeAssignment, classStudents, recordByNis)
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
                    >
                      <FileSpreadsheet
                        className="h-3.5 w-3.5 text-emerald-600"
                        aria-hidden="true"
                      />
                      <span>Export Excel</span>
                    </button>
                  </div>
                </div>

                {/* KPI Summary Row */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-3.5 py-3">
                    <p className="text-[11px] font-medium text-slate-500">Total Siswa</p>
                    <p className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                      {summary.totalStudents}
                    </p>
                  </div>
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3.5 py-3">
                    <p className="text-[11px] font-medium text-emerald-700">Hadir</p>
                    <p className="text-xl font-bold font-mono tabular-nums text-emerald-800 mt-0.5">
                      {summary.hadir}
                    </p>
                  </div>
                  <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3.5 py-3">
                    <p className="text-[11px] font-medium text-amber-700">Terlambat</p>
                    <p className="text-xl font-bold font-mono tabular-nums text-amber-800 mt-0.5">
                      {summary.terlambat}
                    </p>
                  </div>
                  <div className="rounded-xl border border-rose-200 bg-rose-50/60 px-3.5 py-3">
                    <p className="text-[11px] font-medium text-rose-700">S / I / A</p>
                    <p className="text-xl font-bold font-mono tabular-nums text-rose-800 mt-0.5">
                      {summary.sakit + summary.izin + summary.alpa}
                    </p>
                  </div>
                  <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 px-3.5 py-3 col-span-2 sm:col-span-1">
                    <p className="text-[11px] font-medium text-indigo-700">Kehadiran</p>
                    <p className="text-xl font-bold font-mono tabular-nums text-indigo-800 mt-0.5">
                      {summary.persentaseHadir}%
                    </p>
                  </div>
                </div>
              </section>

              {/* Presensi Masuk Siswa Card (QR Camera + Input NIS / Input Nama Mode Switcher) */}
              <section className="bg-white rounded-2xl border border-slate-200/80 p-5 sm:p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="h-9 w-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                      <QrCode className="h-4.5 w-4.5" aria-hidden="true" />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-slate-900">
                        Presensi Masuk Siswa — {activeAssignment.mata_pelajaran} ({activeAssignment.kelas})
                      </h4>
                      <p className="text-xs text-slate-500">
                        Pilih input NIS/barcode, input nama siswa, scan QR kamera, atau klik Catat Masuk di tabel.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (showCameraPanel) {
                        void stopCamera();
                        setShowCameraPanel(false);
                      } else {
                        setShowCameraPanel(true);
                      }
                    }}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-semibold transition-colors ${
                      showCameraPanel
                        ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                        : 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                    }`}
                  >
                    {showCameraPanel ? (
                      <>
                        <CameraOff className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Tutup Kamera QR</span>
                      </>
                    ) : (
                      <>
                        <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Scan QR Kamera</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Collapsible Camera Reader */}
                {showCameraPanel && (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-slate-700">
                        Pemindai QR Mata Pelajaran ({activeAssignment.kelas})
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleSwitchCamera}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <SwitchCamera className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>{facingMode === 'environment' ? 'Belakang' : 'Depan'}</span>
                        </button>
                        {cameraActive ? (
                          <button
                            type="button"
                            onClick={() => void stopCamera()}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700"
                          >
                            <CameraOff className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Hentikan</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={cameraStarting}
                            onClick={() => void startCamera(facingMode)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-60"
                          >
                            <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>{cameraStarting ? 'Membuka...' : 'Mulai Kamera'}</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {cameraError && (
                      <div
                        role="alert"
                        className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-800"
                      >
                        {cameraError}
                      </div>
                    )}

                    <div className="relative rounded-xl overflow-hidden bg-slate-900 min-h-[220px] flex items-center justify-center">
                      <div id={MAPEL_SCANNER_ID} className="w-full" />
                      {!cameraActive && !cameraStarting && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-4 text-slate-300">
                          <QrCode className="h-10 w-10 text-slate-500 mb-2" aria-hidden="true" />
                          <p className="text-xs font-medium text-white">
                            Klik &ldquo;Mulai Kamera&rdquo; untuk scan kartu siswa {activeAssignment.kelas}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Input Mode Selector: NIS / Barcode vs Input Nama Siswa */}
                <div className="space-y-3">
                  <div
                    role="tablist"
                    aria-label="Pilih metode input presensi mapel"
                    className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1 gap-1"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={inputMode === 'nis'}
                      data-testid="mapel-input-mode-nis"
                      onClick={() => setInputMode('nis')}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                        inputMode === 'nis'
                          ? 'bg-white text-indigo-700 shadow-sm border border-slate-200/80'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Keyboard className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Input NIS / Scan Barcode</span>
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={inputMode === 'nama'}
                      data-testid="mapel-input-mode-nama"
                      onClick={() => setInputMode('nama')}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                        inputMode === 'nama'
                          ? 'bg-white text-indigo-700 shadow-sm border border-slate-200/80'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Users className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Input Nama Siswa</span>
                    </button>
                  </div>

                  {/* Mode 1: Manual NIS / Barcode Input */}
                  {inputMode === 'nis' ? (
                    <form onSubmit={handleManualSubmit} className="flex flex-col sm:flex-row gap-2.5">
                      <div className="flex-1">
                        <label
                          htmlFor="mapel-manual-nis"
                          className="flex items-center gap-1.5 text-xs font-medium text-slate-700 mb-1.5"
                        >
                          <Keyboard className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                          <span>Input NIS / Scan Barcode Kartu Siswa ({activeAssignment.kelas})</span>
                        </label>
                        <input
                          id="mapel-manual-nis"
                          type="text"
                          value={manualNis}
                          onChange={(e) => setManualNis(e.target.value)}
                          placeholder="Masukkan NIS siswa lalu tekan Enter..."
                          className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-mono text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={!manualNis.trim()}
                        className="sm:self-end px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                      >
                        Catat Masuk Mapel
                      </button>
                    </form>
                  ) : (
                    /* Mode 2: Input Nama Siswa */
                    <form
                      onSubmit={handleNameCheckInSubmit}
                      className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end"
                    >
                      <div className="sm:col-span-4">
                        <label
                          htmlFor="mapel-name-search"
                          className="block text-xs font-medium text-slate-700 mb-1.5"
                        >
                          Cari Nama Siswa ({activeAssignment.kelas})
                        </label>
                        <div className="relative">
                          <Search
                            className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                            aria-hidden="true"
                          />
                          <input
                            id="mapel-name-search"
                            type="text"
                            value={nameSearchQuery}
                            onChange={(e) => setNameSearchQuery(e.target.value)}
                            placeholder="Ketik nama siswa..."
                            className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                          />
                        </div>
                      </div>

                      <div className="sm:col-span-5">
                        <label
                          htmlFor="mapel-name-select"
                          className="block text-xs font-medium text-slate-700 mb-1.5"
                        >
                          Pilih Nama Siswa
                        </label>
                        <select
                          id="mapel-name-select"
                          value={selectedStudentNis}
                          disabled={namePickerStudents.length === 0}
                          onChange={(e) => setSelectedStudentNis(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 disabled:bg-slate-50 disabled:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                        >
                          {namePickerStudents.length === 0 ? (
                            <option value="">Tidak ada siswa ditemukan</option>
                          ) : (
                            namePickerStudents.map((s) => {
                              const rec = recordByNis.get(s.nis.trim().toLowerCase());
                              return (
                                <option key={s.nis} value={s.nis}>
                                  {s.nama} ({s.nis}){rec ? ` — ${rec.status}` : ''}
                                </option>
                              );
                            })
                          )}
                        </select>
                      </div>

                      <div className="sm:col-span-3">
                        <button
                          type="submit"
                          disabled={!selectedStudentNis}
                          className="w-full px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                        >
                          Catat Masuk Mapel
                        </button>
                      </div>
                    </form>
                  )}
                </div>

                {/* Live Scan / Check-in Feedback Card */}
                {lastOutcome && (
                  <div
                    role="status"
                    data-testid="mapel-scan-outcome"
                    className={`rounded-xl border p-3.5 flex items-start gap-3 ${
                      lastOutcome.ok
                        ? lastOutcome.record.status === 'Hadir'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                          : 'border-amber-200 bg-amber-50 text-amber-900'
                        : lastOutcome.reason === 'duplicate'
                          ? 'border-amber-200 bg-amber-50 text-amber-900'
                          : 'border-rose-200 bg-rose-50 text-rose-900'
                    }`}
                  >
                    {lastOutcome.ok ? (
                      lastOutcome.record.status === 'Hadir' ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
                      ) : (
                        <Clock className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
                      )
                    ) : lastOutcome.reason === 'duplicate' ? (
                      <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
                    ) : (
                      <XCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
                    )}
                    <div className="text-xs min-w-0">
                      {lastOutcome.ok ? (
                        <>
                          <p className="font-bold text-sm">
                            {lastOutcome.student.nama} — {lastOutcome.record.status}
                          </p>
                          <p className="mt-0.5 font-mono">
                            NIS {lastOutcome.student.nis} · {lastOutcome.record.mata_pelajaran} · Masuk{' '}
                            {lastOutcome.record.jam_masuk}
                          </p>
                        </>
                      ) : lastOutcome.reason === 'duplicate' ? (
                        <>
                          <p className="font-bold text-sm">Presensi Ganda Ditolak</p>
                          <p className="mt-0.5">
                            {lastOutcome.student?.nama} sudah tercatat{' '}
                            <strong>{lastOutcome.existingRecord?.status}</strong> pada mapel{' '}
                            {activeAssignment.mata_pelajaran} tanggal {selectedDate}.
                          </p>
                        </>
                      ) : lastOutcome.reason === 'wrong_class' ? (
                        <>
                          <p className="font-bold text-sm">
                            Bukan Siswa Kelas {activeAssignment.kelas}
                          </p>
                          <p className="mt-0.5">
                            {lastOutcome.student?.nama} (NIS {lastOutcome.nis}) terdaftar di kelas{' '}
                            <strong>{lastOutcome.student?.kelas}</strong>, bukan {activeAssignment.kelas}.
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="font-bold text-sm">NIS Tidak Terdaftar</p>
                          <p className="mt-0.5">
                            Data siswa dengan NIS &ldquo;{lastOutcome.nis}&rdquo; tidak ditemukan pada tahun ajaran aktif.
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </section>

              {/* Student Roll-Call Table */}
              <section className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden">
                <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-900">
                      Daftar Kehadiran Siswa Kelas {activeAssignment.kelas}
                    </h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {formattedSelectedDate} · Belum presensi:{' '}
                      <strong className="font-mono text-slate-700">{summary.belumPresensi}</strong> siswa
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative">
                      <Search
                        className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                        aria-hidden="true"
                      />
                      <input
                        type="search"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Cari nama / NIS..."
                        aria-label="Cari siswa dalam kelas"
                        className="w-44 rounded-xl border border-slate-200 bg-white pl-9 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                      />
                    </div>

                    {summary.belumPresensi > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          onMarkAllPresent(activeAssignment, classStudents, selectedDate)
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-emerald-200 bg-emerald-50 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors whitespace-nowrap"
                      >
                        <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Tandai Semua Hadir ({summary.belumPresensi})</span>
                      </button>
                    )}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200/80 text-xs font-semibold text-slate-500">
                        <th className="py-3 px-4">NIS</th>
                        <th className="py-3 px-4">Nama Siswa</th>
                        <th className="py-3 px-4">Jam Masuk</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4 text-right">Presensi / Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {visibleStudents.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-10 px-6 text-center text-xs text-slate-500">
                            {classStudents.length === 0
                              ? `Belum ada data siswa terdaftar di kelas ${activeAssignment.kelas} pada Tahun Ajaran ${settings.tahun_ajaran}.`
                              : 'Tidak ada siswa yang sesuai pencarian.'}
                          </td>
                        </tr>
                      ) : (
                        visibleStudents.map((student) => {
                          const rec = recordByNis.get(student.nis.trim().toLowerCase());
                          return (
                            <tr
                              key={student.nis}
                              className="hover:bg-slate-50/70 transition-colors"
                            >
                              <td className="py-3 px-4 font-mono tabular-nums text-xs font-medium text-slate-700 whitespace-nowrap">
                                {student.nis}
                              </td>
                              <td className="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">
                                {student.nama}
                              </td>
                              <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                                {rec?.jam_masuk || '-'}
                              </td>
                              <td className="py-3 px-4 whitespace-nowrap">
                                {rec ? (
                                  <span
                                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg border text-xs font-semibold ${STATUS_BADGE_STYLES[rec.status]}`}
                                  >
                                    {rec.status === 'Hadir' && (
                                      <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                                    )}
                                    {rec.status === 'Terlambat' && (
                                      <Clock className="h-3 w-3" aria-hidden="true" />
                                    )}
                                    {rec.status}
                                  </span>
                                ) : (
                                  <span className="text-xs text-slate-400">Belum Presensi</span>
                                )}
                              </td>
                              <td className="py-3 px-4 text-right whitespace-nowrap">
                                <div className="inline-flex items-center gap-2">
                                  {!rec && (
                                    <button
                                      type="button"
                                      onClick={() => handleQuickCheckIn(student)}
                                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors"
                                    >
                                      <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                                      <span>Catat Masuk</span>
                                    </button>
                                  )}
                                  <select
                                    aria-label={`Ubah status ${student.nama}`}
                                    value={rec?.status || ''}
                                    onChange={(e) => {
                                      const val = e.target.value as AttendanceStatus;
                                      if (val) {
                                        onUpdateStudentStatus(
                                          activeAssignment,
                                          student,
                                          selectedDate,
                                          val
                                        );
                                      }
                                    }}
                                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-indigo-500 focus:outline-none"
                                  >
                                    <option value="" disabled>
                                      -- Status --
                                    </option>
                                    <option value="Hadir">Hadir</option>
                                    <option value="Terlambat">Terlambat</option>
                                    <option value="Sakit">Sakit</option>
                                    <option value="Izin">Izin</option>
                                    <option value="Alpa">Alpa</option>
                                  </select>
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
            </div>
          )}
        </div>
      )}

      {/* Modal: Tambah Kelas & Mata Pelajaran */}
      {addModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-mapel-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/55 backdrop-blur-[1px]"
        >
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-md shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 id="add-mapel-title" className="text-base font-semibold text-slate-900">
                Tambah Kelas &amp; Mata Pelajaran
              </h3>
              <button
                type="button"
                onClick={() => setAddModalOpen(false)}
                aria-label="Tutup modal tambah kelas dan mapel"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleSubmitAddAssignment} className="p-6 space-y-4">
              {addError && (
                <div
                  role="alert"
                  className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-xs font-medium text-rose-700"
                >
                  {addError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="mapel-input-hari"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Hari <span className="text-rose-600">*</span>
                  </label>
                  <select
                    id="mapel-input-hari"
                    value={newHari}
                    onChange={(e) => setNewHari(e.target.value as DayOfWeek)}
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
                    htmlFor="mapel-input-kelas"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Kelas yang Diajar <span className="text-rose-600">*</span>
                  </label>
                  <input
                    id="mapel-input-kelas"
                    type="text"
                    required
                    list="mapel-class-suggestions"
                    value={newKelas}
                    onChange={(e) => setNewKelas(e.target.value)}
                    placeholder="Contoh: X IPA 1"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="mapel-input-subject"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Mata Pelajaran yang Diampu <span className="text-rose-600">*</span>
                </label>
                <input
                  id="mapel-input-subject"
                  type="text"
                  required
                  list="mapel-subject-suggestions"
                  value={newMapel}
                  onChange={(e) => setNewMapel(e.target.value)}
                  placeholder="Contoh: Matematika, Fisika, Bahasa Indonesia"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="mapel-input-time"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Jam Mulai Pelajaran
                  </label>
                  <input
                    id="mapel-input-time"
                    type="time"
                    value={newJamMulai}
                    onChange={(e) => setNewJamMulai(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-mono text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
                <div>
                  <label
                    htmlFor="mapel-input-end-time"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Jam Selesai Pelajaran
                  </label>
                  <input
                    id="mapel-input-end-time"
                    type="time"
                    value={newJamSelesai}
                    onChange={(e) => setNewJamSelesai(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-mono text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              </div>
              <p className="text-[11px] text-slate-500 -mt-2">
                Kelas &amp; mapel yang ditambahkan otomatis tersinkron ke <strong>Jadwal Pelajaran Guru</strong> Master Admin. Jika jam mulai diisi, siswa yang masuk melewatinya otomatis tercatat Terlambat.
              </p>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setAddModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
                >
                  Simpan Kelas &amp; Mapel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Konfirmasi Hapus Kelas & Mapel Tambahan */}
      {confirmDeleteId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-mapel-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[1px]"
        >
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-sm shadow-xl p-6 space-y-4">
            <h3 id="delete-mapel-title" className="text-base font-semibold text-slate-900">
              Hapus Kelas &amp; Mapel Tambahan?
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Kelas dan mata pelajaran ini akan dihapus dari sub menu Anda. Riwayat presensi yang sudah tercatat tetap aman.
            </p>
            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteAssignment(confirmDeleteId);
                  setConfirmDeleteId(null);
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
