import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Download,
  Search,
  Calendar,
  ClipboardList,
  MessageCircle,
  Send,
  Copy,
  Check,
  X,
  UserX,
  FileDown,
  RotateCcw,
  Clock,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import type {
  AttendanceRecord,
  AttendanceStatus,
  AuthSession,
  LateCorrectionRequest,
  RecapPeriodType,
  SchoolSettings,
  SemesterKind,
  Student,
  UserAccount,
} from '../types';
import {
  buildDailyRecapRows,
  buildPeriodSummaryRows,
  getCurrentTimeString,
  getPeriodDateRange,
  getTodayDateString,
  isBeforeCheckoutTime,
  isSameClassName,
  type DailyRecapRow,
} from '../utils/attendanceLogic';
import { generateRecapPdf } from '../utils/recapPdf';
import { buildLetterheadExcelSheet } from '../utils/excelLetterhead';
import { formatSemesterLabel } from '../utils/subjectAttendance';
import {
  buildLateCorrectionWhatsAppMessage,
  buildParentAttendanceMessage,
  buildWhatsAppUrl,
} from '../utils/whatsapp';
import { StatusBadge } from './StatusBadge';
import { EarlyCheckoutModal } from './EarlyCheckoutModal';

interface RecapViewProps {
  students: Student[];
  records: AttendanceRecord[];
  settings: SchoolSettings;
  accounts?: UserAccount[];
  currentSession?: AuthSession | null;
  assignedClass?: string;
  isGuruMode?: boolean;
  canExport?: boolean;
  canSendParentWa?: boolean;
  canModifyStatus?: boolean;
  masterYearControl?: {
    selectedYear: string;
    availableYears: string[];
    onChangeYear: (year: string) => void;
  };
  onUpdateStatus: (params: {
    tanggal: string;
    student: { nis: string; nama: string; kelas: string };
    status: AttendanceStatus;
  }) => void;
  onConfirmCheckout?: (params: {
    tanggal: string;
    student: { nis: string; nama: string; kelas: string };
    alasanPulangCepat?: string;
  }) => void;
  onResetStatus?: (params: {
    tanggal: string;
    students: Array<{ nis: string; nama: string; kelas: string }>;
  }) => void;
  lateCorrectionRequests?: LateCorrectionRequest[];
  onSubmitLateCorrection?: (input: {
    tanggal: string;
    nis: string;
    nama: string;
    kelas: string;
    jam_masuk_asal: string;
    alasan: string;
    adminWaPhone?: string;
  }) => { ok: boolean; error?: string; request?: LateCorrectionRequest };
  onSaveAdminWaPhone?: (phone: string) => void;
}

const STATUS_OPTIONS: AttendanceStatus[] = ['Hadir', 'Terlambat', 'Sakit', 'Izin', 'Alpa'];

type StatusFilterValue = 'ALL' | 'TIDAK_HADIR' | AttendanceStatus | 'Belum Presensi';

const LATE_REASON_PRESETS: string[] = [
  'Kendala kendaraan / ban bocor di perjalanan (sudah izin ke Wali Kelas)',
  'Hujan deras / banjir di jalur keberangkatan (sudah izin ke Wali Kelas)',
  'Kemacetan / gangguan lalu lintas di perjalanan (sudah izin ke Wali Kelas)',
];

const PERIOD_TABS: Array<{ id: RecapPeriodType; label: string }> = [
  { id: 'harian', label: 'Harian' },
  { id: 'mingguan', label: 'Mingguan' },
  { id: 'bulanan', label: 'Bulanan' },
  { id: 'semester', label: 'Semester' },
];

export function RecapView({
  students,
  records,
  settings,
  accounts = [],
  currentSession = null,
  assignedClass,
  isGuruMode = false,
  canExport = true,
  canSendParentWa = true,
  canModifyStatus = true,
  masterYearControl,
  onUpdateStatus,
  onConfirmCheckout,
  onResetStatus,
  lateCorrectionRequests = [],
  onSubmitLateCorrection,
  onSaveAdminWaPhone,
}: RecapViewProps) {
  const today = getTodayDateString();
  const isMasterAdmin = currentSession?.role === 'master_admin';
  const isWaliKelas = currentSession?.role === 'wali_kelas';
  const canResetToBelumPresensi = isMasterAdmin && canModifyStatus && Boolean(onResetStatus);
  const [period, setPeriod] = useState<RecapPeriodType>('harian');
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedMonth, setSelectedMonth] = useState(today.slice(0, 7));
  const [selectedSemester, setSelectedSemester] = useState<SemesterKind>(
    Number(today.slice(5, 7)) >= 7 ? 'ganjil' : 'genap'
  );
  const [selectedSemesterYear, setSelectedSemesterYear] = useState<number>(
    Number(today.slice(0, 4)) || new Date().getFullYear()
  );

  const [classFilter, setClassFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>(
    isGuruMode ? 'TIDAK_HADIR' : 'ALL'
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [exportingPdf, setExportingPdf] = useState(false);

  // Single Parent WhatsApp Modal
  const [waModalRow, setWaModalRow] = useState<DailyRecapRow | null>(null);
  const [waPhoneInput, setWaPhoneInput] = useState('');
  const [waCustomNote, setWaCustomNote] = useState('');
  const [copiedSingleMsg, setCopiedSingleMsg] = useState(false);

  // Batch Parent Notification Modal
  const [batchWaOpen, setBatchWaOpen] = useState(false);
  const [batchWaFilter, setBatchWaFilter] = useState<'issues' | 'all'>('issues');
  const [sentNisSet, setSentNisSet] = useState<Set<string>>(new Set());

  // Early Checkout Confirmation Modal
  const [earlyCheckoutRow, setEarlyCheckoutRow] = useState<DailyRecapRow | null>(null);

  // Master Admin collective reset selection & confirmation modal
  const [selectedResetNis, setSelectedResetNis] = useState<string[]>([]);
  const [confirmResetModalOpen, setConfirmResetModalOpen] = useState(false);

  // Wali Kelas late-to-on-time correction request bar
  const lateRequestSectionRef = useRef<HTMLElement | null>(null);
  const [lateRequestNis, setLateRequestNis] = useState('');
  const [lateRequestReason, setLateRequestReason] = useState('');
  const [adminWaInput, setAdminWaInput] = useState(settings.no_wa_admin || '');
  const [lateRequestError, setLateRequestError] = useState<string | null>(null);
  const [lastSubmittedLateReq, setLastSubmittedLateReq] =
    useState<LateCorrectionRequest | null>(null);
  const [copiedLateWaMsg, setCopiedLateWaMsg] = useState(false);

  useEffect(() => {
    setAdminWaInput(settings.no_wa_admin || '');
  }, [settings.no_wa_admin]);

  useEffect(() => {
    setSelectedResetNis([]);
  }, [selectedDate, period, classFilter, statusFilter]);

  const periodRange = useMemo(
    () =>
      getPeriodDateRange({
        period,
        date: selectedDate,
        month: selectedMonth,
        semester: selectedSemester,
        semesterYear: selectedSemesterYear,
      }),
    [period, selectedDate, selectedMonth, selectedSemester, selectedSemesterYear]
  );

  const studentPhoneMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of students) {
      map.set(s.nis.trim().toLowerCase(), s.no_wa_ortu || '');
    }
    return map;
  }, [students]);

  const allDailyRows = useMemo(
    () => buildDailyRecapRows(students, records, selectedDate),
    [students, records, selectedDate]
  );

  const allPeriodRows = useMemo(
    () =>
      buildPeriodSummaryRows(
        students,
        records,
        periodRange.startDate,
        periodRange.endDate
      ),
    [students, records, periodRange.startDate, periodRange.endDate]
  );

  const uniqueClasses = useMemo(() => {
    const set = new Set([
      ...allDailyRows.map((r) => r.kelas),
      ...allPeriodRows.map((r) => r.kelas),
    ]);
    return Array.from(set).sort();
  }, [allDailyRows, allPeriodRows]);

  const effectiveClassFilter = assignedClass ? 'ALL' : classFilter;

  const filteredDailyRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allDailyRows.filter((row) => {
      const matchesClass =
        effectiveClassFilter === 'ALL' ||
        isSameClassName(row.kelas, effectiveClassFilter);
      const matchesStatus =
        statusFilter === 'ALL'
          ? true
          : statusFilter === 'TIDAK_HADIR'
            ? row.status === 'Sakit' ||
              row.status === 'Izin' ||
              row.status === 'Alpa' ||
              row.status === 'Belum Presensi'
            : row.status === statusFilter;
      const matchesQuery =
        !q || row.nama.toLowerCase().includes(q) || row.nis.toLowerCase().includes(q);
      return matchesClass && matchesStatus && matchesQuery;
    });
  }, [allDailyRows, effectiveClassFilter, statusFilter, searchQuery]);

  const filteredPeriodRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allPeriodRows.filter((row) => {
      const matchesClass =
        effectiveClassFilter === 'ALL' ||
        isSameClassName(row.kelas, effectiveClassFilter);
      const matchesQuery =
        !q || row.nama.toLowerCase().includes(q) || row.nis.toLowerCase().includes(q);
      if (!matchesClass || !matchesQuery) return false;

      if (statusFilter === 'TIDAK_HADIR') {
        return row.sakit + row.izin + row.alpa > 0;
      }
      if (statusFilter === 'Hadir') return row.hadir > 0;
      if (statusFilter === 'Terlambat') return row.terlambat > 0;
      if (statusFilter === 'Sakit') return row.sakit > 0;
      if (statusFilter === 'Izin') return row.izin > 0;
      if (statusFilter === 'Alpa') return row.alpa > 0;
      return true;
    });
  }, [allPeriodRows, effectiveClassFilter, statusFilter, searchQuery]);

  const activeRowCount =
    period === 'harian' ? filteredDailyRows.length : filteredPeriodRows.length;

  const showCheckoutColumn =
    settings.mode_presensi === 'masuk_pulang' ||
    allDailyRows.some((r) => r.jam_pulang && r.jam_pulang !== '-');

  const summary = useMemo(() => {
    const counts = {
      Hadir: 0,
      Terlambat: 0,
      Sakit: 0,
      Izin: 0,
      Alpa: 0,
      'Belum Presensi': 0,
    };
    if (period === 'harian') {
      for (const r of filteredDailyRows) {
        counts[r.status]++;
      }
    } else {
      for (const r of filteredPeriodRows) {
        counts.Hadir += r.hadir;
        counts.Terlambat += r.terlambat;
        counts.Sakit += r.sakit;
        counts.Izin += r.izin;
        counts.Alpa += r.alpa;
      }
    }
    return counts;
  }, [period, filteredDailyRows, filteredPeriodRows]);

  const recordedDailyRows = useMemo(
    () => filteredDailyRows.filter((r) => r.status !== 'Belum Presensi'),
    [filteredDailyRows]
  );

  const selectedResetSet = useMemo(() => new Set(selectedResetNis), [selectedResetNis]);

  const collectiveResetTargets = useMemo(() => {
    if (selectedResetNis.length > 0) {
      return recordedDailyRows.filter((r) => selectedResetSet.has(r.nis));
    }
    return recordedDailyRows;
  }, [recordedDailyRows, selectedResetNis.length, selectedResetSet]);

  const allRecordedSelected =
    recordedDailyRows.length > 0 &&
    recordedDailyRows.every((r) => selectedResetSet.has(r.nis));

  // Late students on selectedDate eligible for Wali Kelas late-to-on-time correction request
  const lateRowsForDate = useMemo(
    () => allDailyRows.filter((r) => r.status === 'Terlambat'),
    [allDailyRows]
  );

  const myLateRequests = useMemo(() => {
    if (!isWaliKelas || !currentSession) return [];
    const targetCls = (assignedClass || currentSession.kelas_binaan || '').trim();
    return lateCorrectionRequests.filter(
      (req) =>
        req.requested_by_user_id === currentSession.userId ||
        (targetCls && isSameClassName(req.kelas, targetCls))
    );
  }, [isWaliKelas, currentSession, assignedClass, lateCorrectionRequests]);

  const pendingLateNisSet = useMemo(() => {
    const set = new Set<string>();
    for (const req of lateCorrectionRequests) {
      if (req.status === 'pending' && req.tanggal === selectedDate) {
        set.add(req.nis.trim().toLowerCase());
      }
    }
    return set;
  }, [lateCorrectionRequests, selectedDate]);

  useEffect(() => {
    if (!isWaliKelas) return;
    if (lateRowsForDate.length === 0) {
      setLateRequestNis('');
      return;
    }
    if (!lateRowsForDate.some((r) => r.nis === lateRequestNis)) {
      const firstEligible =
        lateRowsForDate.find((r) => !pendingLateNisSet.has(r.nis.trim().toLowerCase())) ||
        lateRowsForDate[0];
      setLateRequestNis(firstEligible.nis);
    }
  }, [isWaliKelas, lateRowsForDate, lateRequestNis, pendingLateNisSet]);

  const lastSubmittedWaMessage = useMemo(() => {
    if (!lastSubmittedLateReq) return '';
    return buildLateCorrectionWhatsAppMessage({
      namaSekolah: settings.nama_sekolah,
      tanggal: lastSubmittedLateReq.tanggal,
      namaSiswa: lastSubmittedLateReq.nama,
      nis: lastSubmittedLateReq.nis,
      kelas: lastSubmittedLateReq.kelas,
      jamMasukAsal: lastSubmittedLateReq.jam_masuk_asal,
      alasan: lastSubmittedLateReq.alasan,
      namaWaliKelas: lastSubmittedLateReq.requested_by_name,
    });
  }, [lastSubmittedLateReq, settings.nama_sekolah]);

  const lastSubmittedWaHref = useMemo(
    () => buildWhatsAppUrl(adminWaInput, lastSubmittedWaMessage),
    [adminWaInput, lastSubmittedWaMessage]
  );

  function handleToggleSelectAllReset() {
    if (allRecordedSelected) {
      setSelectedResetNis([]);
    } else {
      setSelectedResetNis(recordedDailyRows.map((r) => r.nis));
    }
  }

  function handleToggleRowReset(nis: string) {
    setSelectedResetNis((prev) =>
      prev.includes(nis) ? prev.filter((item) => item !== nis) : [...prev, nis]
    );
  }

  function handleConfirmCollectiveReset() {
    if (!onResetStatus || collectiveResetTargets.length === 0) {
      setConfirmResetModalOpen(false);
      return;
    }
    onResetStatus({
      tanggal: selectedDate,
      students: collectiveResetTargets.map((r) => ({
        nis: r.nis,
        nama: r.nama,
        kelas: r.kelas,
      })),
    });
    setSelectedResetNis([]);
    setConfirmResetModalOpen(false);
  }

  function handleJumpToLateRequest(nis: string) {
    setLateRequestNis(nis);
    setLateRequestError(null);
    lateRequestSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function handleSubmitLateRequestForm(e: React.FormEvent) {
    e.preventDefault();
    if (!onSubmitLateCorrection || !isWaliKelas) return;
    setLateRequestError(null);

    const targetRow = lateRowsForDate.find((r) => r.nis === lateRequestNis);
    if (!targetRow) {
      setLateRequestError('Pilih siswa yang berstatus Terlambat pada tanggal ini.');
      return;
    }
    const trimmedReason = lateRequestReason.trim();
    if (trimmedReason.length < 5) {
      setLateRequestError('Tuliskan alasan kendala perjalanan minimal 5 karakter.');
      return;
    }

    const trimmedAdminWa = adminWaInput.trim();
    if (trimmedAdminWa && trimmedAdminWa !== (settings.no_wa_admin || '').trim()) {
      onSaveAdminWaPhone?.(trimmedAdminWa);
    }

    const result = onSubmitLateCorrection({
      tanggal: targetRow.tanggal,
      nis: targetRow.nis,
      nama: targetRow.nama,
      kelas: targetRow.kelas,
      jam_masuk_asal: targetRow.jam_masuk,
      alasan: trimmedReason,
      adminWaPhone: trimmedAdminWa,
    });

    if (!result.ok) {
      setLateRequestError(result.error || 'Gagal mengajukan permohonan.');
      return;
    }

    if (result.request) {
      setLastSubmittedLateReq(result.request);
      setCopiedLateWaMsg(false);
    }
    setLateRequestReason('');
  }

  async function handleCopyLateWaMessage() {
    if (!lastSubmittedWaMessage) return;
    try {
      await navigator.clipboard.writeText(lastSubmittedWaMessage);
      setCopiedLateWaMsg(true);
      setTimeout(() => setCopiedLateWaMsg(false), 2000);
    } catch {
      // Ignore clipboard failure
    }
  }

  const batchWaRows = useMemo(() => {
    return filteredDailyRows.filter((row) => {
      if (batchWaFilter === 'issues') {
        return row.status !== 'Hadir';
      }
      return true;
    });
  }, [filteredDailyRows, batchWaFilter]);

  function openSingleWaModal(row: DailyRecapRow) {
    const phone = studentPhoneMap.get(row.nis.trim().toLowerCase()) || '';
    setWaPhoneInput(phone);
    setWaCustomNote('');
    setCopiedSingleMsg(false);
    setWaModalRow(row);
  }

  const singleWaMessage = useMemo(() => {
    if (!waModalRow) return '';
    return buildParentAttendanceMessage({
      namaSekolah: settings.nama_sekolah,
      tanggal: waModalRow.tanggal,
      namaSiswa: waModalRow.nama,
      nis: waModalRow.nis,
      kelas: waModalRow.kelas,
      jamMasuk: waModalRow.jam_masuk,
      jamPulang: waModalRow.jam_pulang,
      status: waModalRow.status,
      keterangan: waModalRow.keterangan,
      catatanTambahan: waCustomNote,
    });
  }, [waModalRow, settings.nama_sekolah, waCustomNote]);

  const singleWaHref = useMemo(
    () => buildWhatsAppUrl(waPhoneInput, singleWaMessage),
    [waPhoneInput, singleWaMessage]
  );

  async function handleCopySingleMessage() {
    if (!singleWaMessage) return;
    try {
      await navigator.clipboard.writeText(singleWaMessage);
      setCopiedSingleMsg(true);
      setTimeout(() => setCopiedSingleMsg(false), 2000);
    } catch {
      // Ignore clipboard failures
    }
  }

  const resolvedClassLabel = assignedClass
    ? assignedClass
    : classFilter === 'ALL'
      ? 'Semua Kelas'
      : classFilter;

  const resolvedAcademicYearLabel = masterYearControl
    ? masterYearControl.selectedYear === 'ACTIVE'
      ? settings.tahun_ajaran
      : masterYearControl.selectedYear === 'ALL'
        ? 'Semua Tahun Ajaran'
        : masterYearControl.selectedYear
    : settings.tahun_ajaran;

  function handleExportExcel() {
    const isDaily = period === 'harian';
    const headers = isDaily
      ? showCheckoutColumn
        ? [
            'No',
            'Tanggal',
            'NISN',
            'Nama Siswa',
            'Kelas',
            'Jam Masuk',
            'Jam Pulang',
            'Alasan Pulang Cepat',
            'Status',
            'Keterangan',
          ]
        : ['No', 'Tanggal', 'NISN', 'Nama Siswa', 'Kelas', 'Jam Masuk', 'Status', 'Keterangan']
      : [
          'No',
          'NISN',
          'Nama Siswa',
          'Kelas',
          'Hadir',
          'Terlambat',
          'Sakit',
          'Izin',
          'Alpa',
          'Total Tercatat',
          'Skor Kehadiran',
        ];

    const dataRows: Array<Array<string | number>> = isDaily
      ? filteredDailyRows.map((r, index) =>
          showCheckoutColumn
            ? [
                index + 1,
                r.tanggal,
                r.nis,
                r.nama,
                r.kelas,
                r.jam_masuk,
                r.jam_pulang,
                r.alasan_pulang_cepat || '-',
                r.status,
                r.keterangan || '-',
              ]
            : [
                index + 1,
                r.tanggal,
                r.nis,
                r.nama,
                r.kelas,
                r.jam_masuk,
                r.status,
                r.keterangan || '-',
              ]
        )
      : filteredPeriodRows.map((r, index) => [
          index + 1,
          r.nis,
          r.nama,
          r.kelas,
          r.hadir,
          r.terlambat,
          r.sakit,
          r.izin,
          r.alpa,
          r.totalTercatat,
          `${r.skorKehadiranPct ?? r.kehadiranPct}%`,
        ]);

    const { sheet } = buildLetterheadExcelSheet({
      settings,
      documentTitle: `REKAPITULASI PRESENSI SISWA (${period.toUpperCase()})`,
      subtitleLines: [
        `Periode: ${periodRange.subtitle} · Kelas: ${resolvedClassLabel}`,
        `Tahun Ajaran: ${resolvedAcademicYearLabel} · Semester: ${formatSemesterLabel(settings.semester)}`,
      ],
      headers,
      rows: dataRows,
      includeSignature: true,
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Rekap Presensi');
    const safeSchool = settings.nama_sekolah.replace(/[^a-zA-Z0-9]+/g, '_');
    const kelasTag = resolvedClassLabel.replace(/\s+/g, '_');
    XLSX.writeFile(
      wb,
      `Presensi_${period.toUpperCase()}_${safeSchool}_${periodRange.startDate}_${kelasTag}.xlsx`
    );
  }

  const resolvedWaliKelas = useMemo(() => {
    const targetClass = (assignedClass || (classFilter !== 'ALL' ? classFilter : '')).trim();
    if (currentSession?.role === 'wali_kelas') {
      const matchedAccount = accounts.find((a) => a.id === currentSession.userId);
      return {
        nama: matchedAccount?.nama || currentSession.nama,
        nip: matchedAccount?.nip || currentSession.nip || '',
        kelasLabel: matchedAccount?.kelas_binaan || currentSession.kelas_binaan || targetClass,
      };
    }
    if (targetClass) {
      const matched = accounts.find(
        (a) =>
          a.role === 'wali_kelas' &&
          isSameClassName(a.kelas_binaan, targetClass)
      );
      if (matched) {
        return {
          nama: matched.nama,
          nip: matched.nip || '',
          kelasLabel: matched.kelas_binaan || targetClass,
        };
      }
      return { nama: '', nip: '', kelasLabel: targetClass };
    }
    return { nama: '', nip: '', kelasLabel: '' };
  }, [accounts, assignedClass, classFilter, currentSession]);

  async function handleExportPdf() {
    if (activeRowCount === 0) return;
    setExportingPdf(true);
    try {
      const { blob, filename } = await generateRecapPdf({
        period,
        periodTitle: periodRange.title,
        periodSubtitle: periodRange.subtitle,
        academicYearLabel: resolvedAcademicYearLabel,
        classLabel: resolvedClassLabel,
        settings,
        dailyRows: filteredDailyRows,
        periodRows: filteredPeriodRows,
        showCheckoutColumn,
        waliKelasNama: resolvedWaliKelas.nama,
        waliKelasNip: resolvedWaliKelas.nip,
        waliKelasLabel: resolvedWaliKelas.kelasLabel,
      });

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } finally {
      setExportingPdf(false);
    }
  }

  const hasAnyData = students.length > 0 || records.length > 0;

  return (
    <div className="space-y-6">
      {/* Filter & Export Toolbar */}
      <section className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-4">
        {/* Top row: Periode Rekap Selector + Master Admin Year Switcher */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-600 mr-1">
              Periode Rekap:
            </span>
            <div
              role="group"
              aria-label="Pilih periode rekap presensi"
              className="inline-flex items-center p-1 rounded-xl bg-slate-100 border border-slate-200/70"
            >
              {PERIOD_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setPeriod(tab.id)}
                  aria-pressed={period === tab.id}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    period === tab.id
                      ? 'bg-white text-indigo-700 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-medium text-slate-700">{periodRange.subtitle}</span>
            {masterYearControl && (
              <select
                value={masterYearControl.selectedYear}
                onChange={(e) => masterYearControl.onChangeYear(e.target.value)}
                aria-label="Filter Tahun Ajaran di Rekap"
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-indigo-500 focus:outline-none"
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
          </div>
        </div>

        {/* Filter Inputs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {(period === 'harian' || period === 'mingguan') && (
            <div className="relative">
              <Calendar
                className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value || getTodayDateString())}
                aria-label={period === 'mingguan' ? 'Pilih tanggal dalam minggu' : 'Pilih tanggal rekap'}
                className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm font-mono text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
          )}

          {period === 'bulanan' && (
            <div className="relative">
              <Calendar
                className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value || today.slice(0, 7))}
                aria-label="Pilih bulan rekap"
                className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm font-mono text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
          )}

          {period === 'semester' && (
            <div className="flex gap-2">
              <select
                value={selectedSemester}
                onChange={(e) => setSelectedSemester(e.target.value as SemesterKind)}
                aria-label="Pilih semester"
                className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="ganjil">Sem. Ganjil (Jul-Des)</option>
                <option value="genap">Sem. Genap (Jan-Jun)</option>
              </select>
              <input
                type="number"
                min={2020}
                max={2035}
                value={selectedSemesterYear}
                onChange={(e) =>
                  setSelectedSemesterYear(Number(e.target.value) || new Date().getFullYear())
                }
                aria-label="Tahun semester"
                className="w-24 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-sm font-mono text-slate-800 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          )}

          {assignedClass ? (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-2 text-sm font-semibold text-indigo-700 whitespace-nowrap flex items-center">
              Kelas {assignedClass}
            </div>
          ) : (
            <select
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              aria-label="Filter kelas rekap"
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="ALL">Semua Kelas</option>
              {uniqueClasses.map((cls) => (
                <option key={cls} value={cls}>
                  {cls}
                </option>
              ))}
            </select>
          )}

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilterValue)}
            aria-label="Filter status kehadiran"
            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          >
            <option value="ALL">Semua Status</option>
            <option value="TIDAK_HADIR">Tidak Hadir (Sakit/Izin/Alpa/Belum)</option>
            {STATUS_OPTIONS.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
            {period === 'harian' && (
              <option value="Belum Presensi">Belum Presensi</option>
            )}
          </select>

          <div className="relative">
            <Search
              className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Cari nama atau NISN di rekap"
              placeholder="Cari nama / NISN..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 pl-9 pr-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>
        </div>

        {/* Summary Strip & Primary Actions */}
        <div className="pt-3 border-t border-slate-100 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600">
            {isGuruMode && (
              <>
                <span className="font-semibold text-indigo-700">
                  Mode Pantau Guru (Semua Kelas)
                </span>
                <span aria-hidden="true" className="text-slate-300">·</span>
              </>
            )}
            <span>
              Ditampilkan:{' '}
              <strong className="font-mono tabular-nums text-slate-900">
                {activeRowCount}
              </strong>{' '}
              siswa
            </span>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <span>
              Hadir:{' '}
              <strong className="font-mono tabular-nums text-emerald-700">
                {summary.Hadir}
              </strong>
            </span>
            <span>
              Terlambat:{' '}
              <strong className="font-mono tabular-nums text-amber-700">
                {summary.Terlambat}
              </strong>
            </span>
            <span>
              Sakit/Izin:{' '}
              <strong className="font-mono tabular-nums text-sky-700">
                {summary.Sakit + summary.Izin}
              </strong>
            </span>
            <span>
              Alpa:{' '}
              <strong className="font-mono tabular-nums text-rose-700">
                {summary.Alpa}
              </strong>
            </span>
            {period === 'harian' && (
              <span>
                Belum Presensi:{' '}
                <strong className="font-mono tabular-nums text-slate-700">
                  {summary['Belum Presensi']}
                </strong>
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {canResetToBelumPresensi && period === 'harian' && (
              <button
                type="button"
                data-testid="btn-collective-reset-presensi"
                onClick={() => setConfirmResetModalOpen(true)}
                disabled={recordedDailyRows.length === 0}
                title="Ubah status presensi siswa kembali ke Belum Presensi secara kolektif"
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-xs font-semibold hover:bg-rose-100 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                <RotateCcw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>
                  {selectedResetNis.length > 0
                    ? `Reset Belum Presensi (${selectedResetNis.length})`
                    : `Reset Kolektif (${recordedDailyRows.length})`}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() =>
                setStatusFilter((prev) => (prev === 'TIDAK_HADIR' ? 'ALL' : 'TIDAK_HADIR'))
              }
              className={`inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-semibold transition-colors whitespace-nowrap ${
                statusFilter === 'TIDAK_HADIR'
                  ? 'border-rose-300 bg-rose-50 text-rose-700'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <UserX className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Cek Tidak Hadir</span>
            </button>

            {canSendParentWa && period === 'harian' && (
              <button
                type="button"
                onClick={() => setBatchWaOpen(true)}
                disabled={filteredDailyRows.length === 0}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-semibold hover:bg-emerald-100 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                <MessageCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>Kirim Rekap Ortu</span>
              </button>
            )}

            {canExport && (
              <button
                type="button"
                onClick={handleExportPdf}
                disabled={activeRowCount === 0 || exportingPdf}
                title="Unduh rekap PDF format kertas F4 potret (215 × 330 mm)"
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-700 text-xs font-semibold hover:bg-indigo-100 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                <FileDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>
                  {exportingPdf
                    ? 'Membuat PDF F4...'
                    : `Unduh PDF F4 (${PERIOD_TABS.find((p) => p.id === period)?.label})`}
                </span>
              </button>
            )}

            {canExport && (
              <button
                type="button"
                onClick={handleExportExcel}
                disabled={activeRowCount === 0}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>Export Excel (.xlsx)</span>
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Wali Kelas Exclusive Bar: Permohonan Ubah Kehadiran Terlambat -> Tepat Waktu */}
      {isWaliKelas && onSubmitLateCorrection && (
        <section
          ref={lateRequestSectionRef}
          aria-label="Permohonan ubah kehadiran menjadi tepat waktu"
          data-testid="wali-late-request-bar"
          className="bg-white rounded-2xl border border-amber-200/90 p-4 sm:p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] space-y-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
            <div className="flex items-start gap-3 min-w-0">
              <div className="h-9 w-9 rounded-xl bg-amber-50 border border-amber-200/80 text-amber-700 flex items-center justify-center shrink-0">
                <Clock className="h-4.5 w-4.5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-slate-900">
                  Permohonan Ubah Kehadiran Menjadi Tepat Waktu
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Khusus Wali Kelas untuk siswa yang terlambat karena kendala di perjalanan dan sudah izin. Permohonan dikirim ke Master Admin melalui WhatsApp sekaligus muncul di bilah notifikasi Master Admin.
                </p>
              </div>
            </div>
            <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 text-[11px] font-mono tabular-nums text-slate-600 whitespace-nowrap shrink-0">
              Tanggal: {selectedDate} · {lateRowsForDate.length} Terlambat
            </span>
          </div>

          {lateRowsForDate.length === 0 ? (
            <div className="rounded-xl bg-slate-50 border border-slate-200/70 px-4 py-3 text-xs text-slate-600">
              Tidak ada siswa berstatus <strong className="text-slate-800">Terlambat</strong> pada tanggal{' '}
              <span className="font-mono tabular-nums font-semibold">{selectedDate}</span>. Pilih tanggal lain di filter harian jika ingin mengajukan permohonan untuk hari sebelumnya.
            </div>
          ) : (
            <form onSubmit={handleSubmitLateRequestForm} className="space-y-3.5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                <div>
                  <label
                    htmlFor="late-request-student"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    Siswa Terlambat ({selectedDate})
                  </label>
                  <select
                    id="late-request-student"
                    data-testid="late-request-student-select"
                    value={lateRequestNis}
                    onChange={(e) => {
                      setLateRequestNis(e.target.value);
                      setLateRequestError(null);
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    {lateRowsForDate.map((row) => {
                      const alreadyPending = pendingLateNisSet.has(
                        row.nis.trim().toLowerCase()
                      );
                      return (
                        <option key={row.nis} value={row.nis}>
                          {row.nama} ({row.nis}) · Masuk {row.jam_masuk}
                          {alreadyPending ? ' — Menunggu Konfirmasi' : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="late-request-admin-wa"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    Nomor WhatsApp Master Admin
                  </label>
                  <input
                    id="late-request-admin-wa"
                    data-testid="late-request-admin-wa-input"
                    type="tel"
                    value={adminWaInput}
                    onChange={(e) => setAdminWaInput(e.target.value)}
                    placeholder="Contoh: 081234567890 atau 6281234567890"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-mono text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="late-request-reason"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  Alasan Kendala di Perjalanan
                </label>
                <textarea
                  id="late-request-reason"
                  data-testid="late-request-reason-input"
                  rows={2}
                  value={lateRequestReason}
                  onChange={(e) => {
                    setLateRequestReason(e.target.value);
                    setLateRequestError(null);
                  }}
                  placeholder="Contoh: Ban motor bocor di jalan dan orang tua sudah menghubungi Wali Kelas."
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-slate-500 mr-1">Alasan cepat:</span>
                  {LATE_REASON_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        setLateRequestReason(preset);
                        setLateRequestError(null);
                      }}
                      className="px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-700 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700 transition-colors text-left"
                    >
                      {preset.split(' (')[0]}
                    </button>
                  ))}
                </div>
              </div>

              {lateRequestError && (
                <div
                  role="alert"
                  className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-700 flex items-center gap-2"
                >
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{lateRequestError}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <p className="text-[11px] text-slate-500">
                  Status siswa akan berubah menjadi <strong>Hadir (Tepat Waktu)</strong> setelah disetujui oleh Master Admin.
                </p>
                <button
                  type="submit"
                  data-testid="btn-submit-late-request"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors whitespace-nowrap"
                >
                  <Send className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>Ajukan &amp; Siapkan WA Master Admin</span>
                </button>
              </div>
            </form>
          )}

          {/* Ready-to-Send WhatsApp Confirmation Box after submitting */}
          {lastSubmittedLateReq && (
            <div
              data-testid="late-request-wa-ready"
              className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <CheckCircle2
                    className="h-4.5 w-4.5 text-emerald-600 shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-emerald-900">
                      Permohonan Tercatat di Bilah Notifikasi Master Admin
                    </p>
                    <p className="text-[11px] text-emerald-800 mt-0.5">
                      Permohonan untuk <strong>{lastSubmittedLateReq.nama}</strong> ({lastSubmittedLateReq.tanggal}) siap dikirim ke WhatsApp Master Admin untuk konfirmasi segera.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setLastSubmittedLateReq(null)}
                  aria-label="Tutup panel kirim WhatsApp"
                  className="p-1 rounded-lg text-emerald-700/70 hover:text-emerald-900 hover:bg-emerald-100 transition-colors"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {lastSubmittedWaHref ? (
                  <a
                    href={lastSubmittedWaHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="link-send-wa-admin"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors whitespace-nowrap"
                  >
                    <MessageCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>Kirim via WhatsApp ke Master Admin</span>
                  </a>
                ) : (
                  <span className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg">
                    Isi Nomor WhatsApp Master Admin di atas agar tombol kirim WhatsApp aktif.
                  </span>
                )}

                <button
                  type="button"
                  data-testid="btn-copy-late-request-msg"
                  onClick={() => void handleCopyLateWaMessage()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-emerald-300 bg-white text-emerald-800 text-xs font-semibold hover:bg-emerald-50 transition-colors whitespace-nowrap"
                >
                  {copiedLateWaMsg ? (
                    <>
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Pesan Tersalin</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Salin Pesan WA</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Compact History of Wali Kelas Submitted Requests */}
          {myLateRequests.length > 0 && (
            <div className="pt-2 border-t border-slate-100 space-y-2">
              <p className="text-xs font-semibold text-slate-700">
                Riwayat Permohonan Anda ({myLateRequests.length})
              </p>
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200/80 bg-slate-50/50">
                {myLateRequests.slice(0, 5).map((req) => {
                  const statusBadge =
                    req.status === 'approved'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : req.status === 'rejected'
                        ? 'bg-rose-50 text-rose-700 border-rose-200'
                        : 'bg-amber-50 text-amber-800 border-amber-200';
                  const statusText =
                    req.status === 'approved'
                      ? 'Disetujui (Hadir)'
                      : req.status === 'rejected'
                        ? 'Ditolak'
                        : 'Menunggu Konfirmasi';
                  return (
                    <div
                      key={req.id}
                      className="px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900 truncate">
                          {req.nama}{' '}
                          <span className="font-mono font-normal text-slate-500">
                            · {req.tanggal} · {req.jam_masuk_asal}
                          </span>
                        </p>
                        <p className="text-[11px] text-slate-600 truncate mt-0.5">
                          {req.alasan}
                        </p>
                      </div>
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap shrink-0 self-start sm:self-center ${statusBadge}`}
                      >
                        {statusText}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Recap Table */}
      <section className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden">
        {activeRowCount === 0 ? (
          <div className="py-14 px-6 text-center">
            <ClipboardList className="h-10 w-10 text-slate-300 mx-auto mb-3" aria-hidden="true" />
            <p className="text-sm font-semibold text-slate-800">
              {!hasAnyData
                ? 'Belum ada data rekap presensi'
                : 'Tidak ada data rekap untuk filter ini'}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {!hasAnyData
                ? 'Tambahkan siswa di Data Siswa dan lakukan scan QR untuk melihat rekap kehadiran.'
                : 'Ubah periode, tanggal, filter kelas, atau status kehadiran untuk melihat daftar siswa.'}
            </p>
          </div>
        ) : period === 'harian' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-500">
                  {canResetToBelumPresensi && (
                    <th className="py-3 pl-4 pr-2 w-10">
                      <input
                        type="checkbox"
                        checked={allRecordedSelected}
                        disabled={recordedDailyRows.length === 0}
                        onChange={handleToggleSelectAllReset}
                        aria-label="Pilih semua siswa yang sudah presensi untuk reset kolektif"
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-40"
                      />
                    </th>
                  )}
                  <th className="py-3 px-5">NISN</th>
                  <th className="py-3 px-4">Nama Siswa</th>
                  <th className="py-3 px-4">Kelas</th>
                  <th className="py-3 px-4">Jam Masuk</th>
                  {showCheckoutColumn && <th className="py-3 px-4">Jam Pulang</th>}
                  <th className="py-3 px-4">Status</th>
                  {canModifyStatus && <th className="py-3 px-4">Ubah Status Manual</th>}
                  {canSendParentWa && <th className="py-3 px-5 text-right">Notifikasi Ortu</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredDailyRows.map((row) => {
                  const hasWa = Boolean(studentPhoneMap.get(row.nis.trim().toLowerCase()));
                  const isRowRecorded = row.status !== 'Belum Presensi';
                  const isRowChecked = selectedResetSet.has(row.nis);
                  const hasPendingLateReq = pendingLateNisSet.has(row.nis.trim().toLowerCase());
                  return (
                    <tr key={`${row.tanggal}_${row.nis}`} className="hover:bg-slate-50/70 transition-colors">
                      {canResetToBelumPresensi && (
                        <td className="py-3 pl-4 pr-2">
                          <input
                            type="checkbox"
                            checked={isRowChecked}
                            disabled={!isRowRecorded}
                            onChange={() => handleToggleRowReset(row.nis)}
                            aria-label={`Pilih ${row.nama} untuk reset ke Belum Presensi`}
                            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-30"
                          />
                        </td>
                      )}
                      <td className="py-3 px-5 font-mono tabular-nums text-xs font-semibold text-slate-800 whitespace-nowrap">
                        {row.nis}
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-900">
                        {row.nama}
                      </td>
                      <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                        {row.kelas}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                        {row.jam_masuk}
                      </td>
                      {showCheckoutColumn && (
                        <td className="py-3 px-4 text-xs text-slate-600">
                          {row.jam_pulang && row.jam_pulang !== '-' ? (
                            <div className="space-y-0.5">
                              <span className="font-mono tabular-nums font-semibold text-indigo-700 whitespace-nowrap block">
                                {row.jam_pulang}
                              </span>
                              {row.alasan_pulang_cepat && (
                                <span
                                  className="block text-[11px] font-medium text-amber-700 max-w-[200px] truncate"
                                  title={`Pulang cepat: ${row.alasan_pulang_cepat}`}
                                >
                                  Pulang cepat: {row.alasan_pulang_cepat}
                                </span>
                              )}
                            </div>
                          ) : canModifyStatus &&
                            onConfirmCheckout &&
                            (row.status === 'Hadir' || row.status === 'Terlambat') &&
                            row.jam_masuk !== '-' ? (
                            <button
                              type="button"
                              onClick={() => {
                                const isEarly =
                                  row.tanggal === today &&
                                  isBeforeCheckoutTime(
                                    getCurrentTimeString(),
                                    settings.jam_pulang_standar
                                  );
                                if (isEarly) {
                                  setEarlyCheckoutRow(row);
                                  return;
                                }
                                onConfirmCheckout({
                                  tanggal: row.tanggal,
                                  student: {
                                    nis: row.nis,
                                    nama: row.nama,
                                    kelas: row.kelas,
                                  },
                                });
                              }}
                              className="inline-flex items-center px-2 py-1 rounded-md border border-indigo-200 bg-indigo-50 text-[11px] font-sans font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors whitespace-nowrap"
                            >
                              Catat Pulang
                            </button>
                          ) : (
                            <span className="font-mono tabular-nums">-</span>
                          )}
                        </td>
                      )}
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge status={row.status} />
                          {isWaliKelas &&
                            onSubmitLateCorrection &&
                            row.status === 'Terlambat' && (
                              <button
                                type="button"
                                onClick={() => handleJumpToLateRequest(row.nis)}
                                disabled={hasPendingLateReq}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-amber-200 bg-amber-50 text-[11px] font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-60 transition-colors whitespace-nowrap"
                              >
                                <Clock className="h-3 w-3" aria-hidden="true" />
                                <span>
                                  {hasPendingLateReq
                                    ? 'Diajukan'
                                    : 'Ajukan Tepat Waktu'}
                                </span>
                              </button>
                            )}
                        </div>
                      </td>
                      {canModifyStatus && (
                        <td className="py-3 px-4">
                          <select
                            aria-label={`Ubah status ${row.nama}`}
                            data-testid={`select-manual-status-${row.nis}`}
                            value={row.status === 'Belum Presensi' ? '' : row.status}
                            onChange={(e) => {
                              const rawVal = e.target.value;
                              if (!rawVal) return;
                              if (rawVal === '__RESET__') {
                                onResetStatus?.({
                                  tanggal: row.tanggal,
                                  students: [
                                    { nis: row.nis, nama: row.nama, kelas: row.kelas },
                                  ],
                                });
                                return;
                              }
                              onUpdateStatus({
                                tanggal: row.tanggal,
                                student: { nis: row.nis, nama: row.nama, kelas: row.kelas },
                                status: rawVal as AttendanceStatus,
                              });
                            }}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-300 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                          >
                            {row.status === 'Belum Presensi' && (
                              <option value="">Pilih status...</option>
                            )}
                            {STATUS_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                            {canResetToBelumPresensi && isRowRecorded && (
                              <option value="__RESET__">Belum Presensi (Reset)</option>
                            )}
                          </select>
                        </td>
                      )}
                      {canSendParentWa && (
                        <td className="py-3 px-5 text-right">
                          <button
                            type="button"
                            onClick={() => openSingleWaModal(row)}
                            aria-label={`Kirim rekap ke orang tua ${row.nama}`}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap ${
                              hasWa
                                ? 'border-emerald-200 bg-emerald-50/70 text-emerald-700 hover:bg-emerald-100'
                                : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            <Send className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Kirim WA</span>
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-500">
                  <th className="py-3 px-5">NISN</th>
                  <th className="py-3 px-4">Nama Siswa</th>
                  <th className="py-3 px-4">Kelas</th>
                  <th className="py-3 px-4 text-center">Hadir</th>
                  <th className="py-3 px-4 text-center">Terlambat</th>
                  <th className="py-3 px-4 text-center">Sakit</th>
                  <th className="py-3 px-4 text-center">Izin</th>
                  <th className="py-3 px-4 text-center">Alpa</th>
                  <th className="py-3 px-4 text-center">Total</th>
                  <th className="py-3 px-5 text-right">% Kehadiran</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredPeriodRows.map((row) => (
                  <tr key={row.nis} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-5 font-mono tabular-nums text-xs font-semibold text-slate-800 whitespace-nowrap">
                      {row.nis}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-900">
                      {row.nama}
                    </td>
                    <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                      {row.kelas}
                    </td>
                    <td className="py-3 px-4 text-center font-mono tabular-nums font-semibold text-emerald-700">
                      {row.hadir}
                    </td>
                    <td className="py-3 px-4 text-center font-mono tabular-nums font-semibold text-amber-700">
                      {row.terlambat}
                    </td>
                    <td className="py-3 px-4 text-center font-mono tabular-nums text-sky-700">
                      {row.sakit}
                    </td>
                    <td className="py-3 px-4 text-center font-mono tabular-nums text-sky-700">
                      {row.izin}
                    </td>
                    <td className="py-3 px-4 text-center font-mono tabular-nums font-semibold text-rose-700">
                      {row.alpa}
                    </td>
                    <td className="py-3 px-4 text-center font-mono tabular-nums text-slate-700">
                      {row.totalTercatat}
                    </td>
                    <td className="py-3 px-5 text-right font-mono tabular-nums font-bold text-slate-900">
                      {row.kehadiranPct}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Single Parent WhatsApp Notification Modal */}
      {canSendParentWa && waModalRow && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="wa-single-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/55 backdrop-blur-[1px]"
        >
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 id="wa-single-title" className="text-base font-semibold text-slate-900">
                  Kirim Rekap Kehadiran ke Orang Tua
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {waModalRow.nama} · {waModalRow.kelas}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setWaModalRow(null)}
                aria-label="Tutup modal kirim WhatsApp"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label htmlFor="wa-phone-input" className="block text-xs font-medium text-slate-700 mb-1">
                  Nomor WhatsApp Orang Tua
                </label>
                <input
                  id="wa-phone-input"
                  type="tel"
                  value={waPhoneInput}
                  onChange={(e) => setWaPhoneInput(e.target.value)}
                  placeholder="081234567890"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-mono text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div>
                <label htmlFor="wa-note-input" className="block text-xs font-medium text-slate-700 mb-1">
                  Catatan Tambahan Guru / Wali Kelas (Opsional)
                </label>
                <input
                  id="wa-note-input"
                  type="text"
                  value={waCustomNote}
                  onChange={(e) => setWaCustomNote(e.target.value)}
                  placeholder="Contoh: Mohon konfirmasi kehadiran ananda hari ini."
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div>
                <p className="text-xs font-medium text-slate-700 mb-1">Pratinjau Pesan:</p>
                <pre className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-800 whitespace-pre-wrap font-sans max-h-48 overflow-y-auto">
                  {singleWaMessage}
                </pre>
              </div>

              <div className="pt-1 flex flex-wrap items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={handleCopySingleMessage}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {copiedSingleMsg ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                      <span>Tersalin</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Salin Pesan</span>
                    </>
                  )}
                </button>

                {singleWaHref ? (
                  <a
                    href={singleWaHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      setSentNisSet((prev) => new Set(prev).add(waModalRow.nis));
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
                  >
                    <MessageCircle className="h-4 w-4" aria-hidden="true" />
                    <span>Kirim via WhatsApp</span>
                  </a>
                ) : (
                  <span className="text-xs font-medium text-rose-600">
                    Masukkan nomor WA valid untuk mengirim
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Batch Parent WhatsApp Queue Modal */}
      {canSendParentWa && batchWaOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="wa-batch-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/55 backdrop-blur-[1px]"
        >
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-2xl shadow-xl overflow-hidden flex flex-col max-h-[88vh]">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-4">
              <div>
                <h2 id="wa-batch-title" className="text-base font-semibold text-slate-900">
                  Kirim Rekap Kehadiran ke Orang Tua ({selectedDate})
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Kirim laporan harian langsung ke WhatsApp orang tua/wali siswa
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBatchWaOpen(false)}
                aria-label="Tutup modal kirim rekap massal"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="px-6 py-3 border-b border-slate-100 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
                <button
                  type="button"
                  onClick={() => setBatchWaFilter('issues')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    batchWaFilter === 'issues'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Terlambat / Tidak Hadir
                </button>
                <button
                  type="button"
                  onClick={() => setBatchWaFilter('all')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    batchWaFilter === 'all'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Semua Siswa ({filteredDailyRows.length})
                </button>
              </div>

              <span className="text-xs text-slate-500 font-mono tabular-nums">
                {batchWaRows.length} siswa ditampilkan
              </span>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-100 px-6">
              {batchWaRows.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-500">
                  Tidak ada siswa dalam kategori ini.
                </p>
              ) : (
                batchWaRows.map((row) => {
                  const phone = studentPhoneMap.get(row.nis.trim().toLowerCase()) || '';
                  const msg = buildParentAttendanceMessage({
                    namaSekolah: settings.nama_sekolah,
                    tanggal: row.tanggal,
                    namaSiswa: row.nama,
                    nis: row.nis,
                    kelas: row.kelas,
                    jamMasuk: row.jam_masuk,
                    jamPulang: row.jam_pulang,
                    status: row.status,
                    keterangan: row.keterangan,
                  });
                  const href = buildWhatsAppUrl(phone, msg);
                  const sent = sentNisSet.has(row.nis);

                  return (
                    <div key={row.nis} className="py-3.5 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-slate-900 truncate">
                            {row.nama}
                          </p>
                          <StatusBadge status={row.status} />
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
                          {row.kelas} · WA Ortu: {phone || 'Belum diisi'}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {href ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => {
                              setSentNisSet((prev) => new Set(prev).add(row.nis));
                            }}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                              sent
                                ? 'bg-slate-100 text-slate-700 border border-slate-200'
                                : 'bg-emerald-600 text-white hover:bg-emerald-700'
                            }`}
                          >
                            {sent ? (
                              <>
                                <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                                <span>Terkirim</span>
                              </>
                            ) : (
                              <>
                                <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>Kirim WA</span>
                              </>
                            )}
                          </a>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setBatchWaOpen(false);
                              openSingleWaModal(row);
                            }}
                            className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
                          >
                            Isi No. WA
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
      {/* Collective Reset Confirmation Modal (Master Admin Only) */}
      {canResetToBelumPresensi && confirmResetModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-collective-reset-title"
          data-testid="modal-confirm-collective-reset"
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
                  <RotateCcw className="h-4.5 w-4.5" aria-hidden="true" />
                </div>
                <h3
                  id="modal-collective-reset-title"
                  className="text-sm font-semibold text-slate-900"
                >
                  Konfirmasi Reset ke Belum Presensi
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setConfirmResetModalOpen(false)}
                aria-label="Tutup dialog konfirmasi"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-sm text-slate-600">
              <p>
                Anda akan mengubah status presensi{' '}
                <strong className="font-mono tabular-nums text-slate-900">
                  {collectiveResetTargets.length} siswa
                </strong>{' '}
                pada tanggal{' '}
                <strong className="font-mono tabular-nums text-slate-900">
                  {selectedDate}
                </strong>{' '}
                kembali menjadi <strong className="text-slate-900">Belum Presensi</strong>.
              </p>
              <p className="text-xs text-slate-500">
                Catatan presensi pada tanggal tersebut untuk siswa yang dipilih akan dihapus agar siswa dapat melakukan presensi ulang atau diatur ulang statusnya.
              </p>
            </div>
            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmResetModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
              >
                Batal
              </button>
              <button
                type="button"
                data-testid="btn-confirm-collective-reset"
                onClick={handleConfirmCollectiveReset}
                className="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 transition-colors"
              >
                Ya, Ubah ke Belum Presensi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Early Checkout Confirmation Modal */}
      {canModifyStatus && onConfirmCheckout && (
        <EarlyCheckoutModal
          open={Boolean(earlyCheckoutRow)}
          student={
            earlyCheckoutRow
              ? {
                  nis: earlyCheckoutRow.nis,
                  nama: earlyCheckoutRow.nama,
                  kelas: earlyCheckoutRow.kelas,
                  jamMasuk: earlyCheckoutRow.jam_masuk,
                }
              : null
          }
          jamPulangStandar={settings.jam_pulang_standar}
          onCancel={() => setEarlyCheckoutRow(null)}
          onConfirm={(alasan) => {
            if (!earlyCheckoutRow) return;
            onConfirmCheckout({
              tanggal: earlyCheckoutRow.tanggal,
              student: {
                nis: earlyCheckoutRow.nis,
                nama: earlyCheckoutRow.nama,
                kelas: earlyCheckoutRow.kelas,
              },
              alasanPulangCepat: alasan,
            });
            setEarlyCheckoutRow(null);
          }}
        />
      )}
    </div>
  );
}
