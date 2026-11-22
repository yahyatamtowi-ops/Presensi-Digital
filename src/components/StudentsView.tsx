import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  Plus,
  Search,
  QrCode,
  Pencil,
  Trash2,
  Printer,
  Download,
  X,
  Users,
  FileSpreadsheet,
  Upload,
  CheckSquare,
  Square,
  Layers,
} from 'lucide-react';
import type { Gender, SchoolSettings, Student } from '../types';
import {
  downloadStudentImportTemplate,
  parseStudentsFile,
  type ParsedStudentImportResult,
} from '../utils/importExport';
import { generateECardsPdf } from '../utils/ecardPdf';
import { DEFAULT_SCHOOL_LOGO } from '../utils/seedData';
import { PdfPreviewModal } from './PdfPreviewModal';

interface StudentsViewProps {
  students: Student[];
  settings: SchoolSettings;
  assignedClass?: string;
  canEdit?: boolean;
  canViewECard?: boolean;
  canDelete?: boolean;
  masterYearControl?: {
    selectedYear: string;
    availableYears: string[];
    onChangeYear: (year: string) => void;
  };
  onAddStudent: (student: Student) => { ok: boolean; error?: string };
  onBulkImportStudents: (newStudents: Student[]) => void;
  onUpdateStudent: (originalNis: string, updated: Student) => { ok: boolean; error?: string };
  onDeleteStudent: (nis: string) => void;
  onBulkDeleteStudents: (nisList: string[]) => void;
}

const EMPTY_FORM: Student = {
  nis: '',
  nama: '',
  kelas: '',
  gender: 'L',
  no_wa_ortu: '',
};

type BatchPrintScope = 'class' | 'selected' | 'all';

export function StudentsView({
  students,
  settings,
  assignedClass,
  canEdit = true,
  canViewECard = true,
  canDelete = true,
  masterYearControl,
  onAddStudent,
  onBulkImportStudents,
  onUpdateStudent,
  onDeleteStudent,
  onBulkDeleteStudents,
}: StudentsViewProps) {
  const showSelectionTools = canViewECard || canDelete;
  const showActionColumn = canViewECard || canEdit || canDelete;
  const [searchQuery, setSearchQuery] = useState('');
  const [classFilter, setClassFilter] = useState('ALL');

  // Selection ("Bilah Tandai Data")
  const [selectedNis, setSelectedNis] = useState<string[]>([]);

  // CRUD Modal
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingOriginalNis, setEditingOriginalNis] = useState<string | null>(null);
  const [formData, setFormData] = useState<Student>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  // Delete Modals
  const [deleteTarget, setDeleteTarget] = useState<Student | null>(null);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);

  // Single E-Card Preview Modal
  const [ecardStudent, setEcardStudent] = useState<Student | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  // Excel/CSV Import Modal
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importResult, setImportResult] = useState<ParsedStudentImportResult | null>(null);
  const [importFileName, setImportFileName] = useState<string>('');
  const [importError, setImportError] = useState<string | null>(null);

  // Batch Print Modal + PDF Preview Modal
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchScope, setBatchScope] = useState<BatchPrintScope>('class');
  const [batchClass, setBatchClass] = useState<string>('');
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [pdfPreview, setPdfPreview] = useState<{
    open: boolean;
    title: string;
    subtitle: string;
    blobUrl: string | null;
    filename: string;
    students: Student[];
    qrMap: Record<string, string>;
  }>({
    open: false,
    title: '',
    subtitle: '',
    blobUrl: null,
    filename: 'ECard_Siswa.pdf',
    students: [],
    qrMap: {},
  });

  const uniqueClasses = useMemo(() => {
    const set = new Set(students.map((s) => s.kelas));
    return Array.from(set).sort();
  }, [students]);

  useEffect(() => {
    if (!batchClass && uniqueClasses.length > 0) {
      setBatchClass(uniqueClasses[0]);
    }
  }, [batchClass, uniqueClasses]);

  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return students
      .filter((s) => {
        const matchesClass = classFilter === 'ALL' || s.kelas === classFilter;
        const matchesSearch =
          !q ||
          s.nis.toLowerCase().includes(q) ||
          s.nama.toLowerCase().includes(q) ||
          s.kelas.toLowerCase().includes(q);
        return matchesClass && matchesSearch;
      })
      .sort((a, b) => a.kelas.localeCompare(b.kelas) || a.nama.localeCompare(b.nama));
  }, [students, searchQuery, classFilter]);

  const selectedSet = useMemo(() => new Set(selectedNis), [selectedNis]);
  const allFilteredSelected =
    filteredStudents.length > 0 &&
    filteredStudents.every((s) => selectedSet.has(s.nis));

  useEffect(() => {
    // Drop stale NIS selections if students were deleted
    const existingSet = new Set(students.map((s) => s.nis));
    setSelectedNis((prev) => prev.filter((nis) => existingSet.has(nis)));
  }, [students]);

  useEffect(() => {
    let cancelled = false;
    if (!ecardStudent) {
      setQrDataUrl('');
      return;
    }
    QRCode.toDataURL(ecardStudent.nis, {
      width: 320,
      margin: 2,
      color: { dark: '#0F172A', light: '#FFFFFF' },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [ecardStudent]);

  useEffect(() => {
    return () => {
      if (pdfPreview.blobUrl) {
        URL.revokeObjectURL(pdfPreview.blobUrl);
      }
    };
  }, [pdfPreview.blobUrl]);

  function toggleSelectOne(nis: string) {
    setSelectedNis((prev) =>
      prev.includes(nis) ? prev.filter((item) => item !== nis) : [...prev, nis]
    );
  }

  function toggleSelectAllFiltered() {
    if (allFilteredSelected) {
      const filteredSet = new Set(filteredStudents.map((s) => s.nis));
      setSelectedNis((prev) => prev.filter((nis) => !filteredSet.has(nis)));
    } else {
      const merged = new Set(selectedNis);
      for (const s of filteredStudents) merged.add(s.nis);
      setSelectedNis(Array.from(merged));
    }
  }

  function openAddModal() {
    setEditingOriginalNis(null);
    setFormData({ ...EMPTY_FORM, kelas: assignedClass || '' });
    setFormError(null);
    setFormModalOpen(true);
  }

  function openEditModal(student: Student) {
    setEditingOriginalNis(student.nis);
    setFormData({ ...student, kelas: assignedClass || student.kelas });
    setFormError(null);
    setFormModalOpen(true);
  }

  function handleSubmitForm(e: React.FormEvent) {
    e.preventDefault();
    const cleaned: Student = {
      nis: formData.nis.trim(),
      nama: formData.nama.trim(),
      kelas: (assignedClass || formData.kelas).trim(),
      gender: formData.gender,
      no_wa_ortu: formData.no_wa_ortu.trim(),
    };

    if (!cleaned.nis || !cleaned.nama || !cleaned.kelas) {
      setFormError('NISN, Nama Lengkap, dan Kelas wajib diisi.');
      return;
    }

    const res = editingOriginalNis
      ? onUpdateStudent(editingOriginalNis, cleaned)
      : onAddStudent(cleaned);

    if (!res.ok) {
      setFormError(res.error || 'Gagal menyimpan data siswa.');
      return;
    }

    setFormModalOpen(false);
  }

  async function handleImportFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportError(null);
    setImportFileName(file.name);
    try {
      const parsed = await parseStudentsFile(file, students);
      setImportResult(parsed);
    } catch (err) {
      setImportResult(null);
      setImportError(
        err instanceof Error
          ? `Gagal membaca file: ${err.message}`
          : 'File Excel/CSV tidak valid.'
      );
    }
  }

  function handleConfirmImport() {
    if (!importResult || importResult.valid.length === 0) return;
    const normalized = assignedClass
      ? importResult.valid.map((s) => ({ ...s, kelas: assignedClass }))
      : importResult.valid;
    onBulkImportStudents(normalized);
    setImportModalOpen(false);
    setImportResult(null);
    setImportFileName('');
  }

  async function openPdfPreviewForStudents(
    targets: Student[],
    title: string,
    filename: string
  ) {
    if (targets.length === 0) return;
    setGeneratingPdf(true);
    try {
      if (pdfPreview.blobUrl) {
        URL.revokeObjectURL(pdfPreview.blobUrl);
      }
      const { blobUrl, qrMap } = await generateECardsPdf(targets, settings);
      setBatchModalOpen(false);
      setPdfPreview({
        open: true,
        title,
        subtitle: `${targets.length} Kartu Tanda Siswa · ${settings.nama_sekolah}`,
        blobUrl,
        filename,
        students: targets,
        qrMap,
      });
    } finally {
      setGeneratingPdf(false);
    }
  }

  function handleBatchPrintSubmit() {
    let targets: Student[] = [];
    let label = 'Semua_Siswa';
    let title = 'Pratinjau PDF E-Card — Semua Siswa';

    if (batchScope === 'class') {
      targets = students.filter((s) => s.kelas === batchClass);
      label = `Kelas_${batchClass.replace(/\s+/g, '_')}`;
      title = `Pratinjau PDF E-Card — Kelas ${batchClass}`;
    } else if (batchScope === 'selected') {
      targets = students.filter((s) => selectedSet.has(s.nis));
      label = 'Siswa_Terpilih';
      title = `Pratinjau PDF E-Card — ${targets.length} Siswa Terpilih`;
    } else {
      targets = [...students].sort(
        (a, b) => a.kelas.localeCompare(b.kelas) || a.nama.localeCompare(b.nama)
      );
    }

    const safeSchool = settings.nama_sekolah.replace(/[^a-zA-Z0-9]+/g, '_');
    void openPdfPreviewForStudents(
      targets,
      title,
      `ECard_${safeSchool}_${label}.pdf`
    );
  }

  function handleDownloadQr() {
    if (!ecardStudent || !qrDataUrl) return;
    const link = document.createElement('a');
    link.href = qrDataUrl;
    link.download = `QR_${ecardStudent.nis}_${ecardStudent.nama.replace(/\s+/g, '_')}.png`;
    link.click();
  }

  const batchPreviewCount =
    batchScope === 'class'
      ? students.filter((s) => s.kelas === batchClass).length
      : batchScope === 'selected'
        ? selectedNis.length
        : students.length;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <section className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search
              className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Cari siswa berdasarkan NISN atau nama"
              placeholder="Cari NISN atau nama siswa..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 pl-10 pr-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          {assignedClass ? (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-2 text-xs sm:text-sm font-semibold text-indigo-700 whitespace-nowrap">
              Kelas {assignedClass} ({students.length})
            </div>
          ) : (
            <select
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              aria-label="Filter berdasarkan kelas"
              className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="ALL">Semua Kelas ({students.length})</option>
              {uniqueClasses.map((cls) => (
                <option key={cls} value={cls}>
                  {cls}
                </option>
              ))}
            </select>
          )}

          {masterYearControl && (
            <select
              value={masterYearControl.selectedYear}
              onChange={(e) => masterYearControl.onChangeYear(e.target.value)}
              aria-label="Filter Tahun Ajaran di Data Siswa"
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
        </div>

        {(canEdit || canViewECard) && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {canEdit && (
              <button
                type="button"
                onClick={() => {
                  setImportResult(null);
                  setImportFileName('');
                  setImportError(null);
                  setImportModalOpen(true);
                }}
                className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs sm:text-sm font-semibold hover:bg-slate-50 transition-colors whitespace-nowrap"
              >
                <FileSpreadsheet className="h-4 w-4 text-emerald-600 shrink-0" aria-hidden="true" />
                <span>Import Excel/CSV</span>
              </button>
            )}

            {canViewECard && (
              <button
                type="button"
                onClick={() => {
                  setBatchScope(selectedNis.length > 0 ? 'selected' : 'class');
                  setBatchModalOpen(true);
                }}
                disabled={students.length === 0}
                className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-700 text-xs sm:text-sm font-semibold hover:bg-indigo-100 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                <Layers className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Cetak E-Card Massal</span>
              </button>
            )}

            {canEdit && (
              <button
                type="button"
                onClick={openAddModal}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-xs sm:text-sm font-semibold hover:bg-indigo-700 transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Tambah Siswa</span>
              </button>
            )}
          </div>
        )}
      </section>

      {/* Bilah Tandai Data (Selection Bar) */}
      {showSelectionTools && (
        <section
          aria-label="Bilah tandai data siswa"
          className="bg-white rounded-2xl border border-slate-200/80 px-4 py-3 shadow-[0_1px_3px_rgba(15,23,42,0.04)] flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={toggleSelectAllFiltered}
              disabled={filteredStudents.length === 0}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-700 disabled:opacity-50 transition-colors"
            >
              {allFilteredSelected ? (
                <CheckSquare className="h-4 w-4 text-indigo-600" aria-hidden="true" />
              ) : (
                <Square className="h-4 w-4 text-slate-400" aria-hidden="true" />
              )}
              <span>{allFilteredSelected ? 'Batal Tandai Semua' : 'Tandai Semua'}</span>
            </button>

            <span className="text-xs text-slate-600 font-mono tabular-nums">
              <strong className="text-slate-900">{selectedNis.length}</strong> data ditandai
            </span>
          </div>

          {selectedNis.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {canViewECard && (
                <button
                  type="button"
                  disabled={generatingPdf}
                  onClick={() => {
                    const targets = students.filter((s) => selectedSet.has(s.nis));
                    void openPdfPreviewForStudents(
                      targets,
                      `Pratinjau PDF E-Card — ${targets.length} Siswa Terpilih`,
                      `ECard_Terpilih_${targets.length}_Siswa.pdf`
                    );
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-60 transition-colors"
                >
                  <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Cetak Terpilih (PDF)</span>
                </button>
              )}

              {canDelete && (
                <button
                  type="button"
                  onClick={() => setBulkDeleteConfirmOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Hapus Terpilih ({selectedNis.length})</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setSelectedNis([])}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Reset
              </button>
            </div>
          )}
        </section>
      )}

      {/* Student Table */}
      <section className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden">
        {filteredStudents.length === 0 ? (
          <div className="py-14 px-6 text-center">
            <Users className="h-10 w-10 text-slate-300 mx-auto mb-3" aria-hidden="true" />
            <p className="text-sm font-semibold text-slate-800">
              {students.length === 0
                ? 'Belum ada data siswa'
                : 'Tidak ada siswa yang sesuai pencarian'}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {students.length === 0
                ? canEdit
                  ? 'Tambahkan siswa baru atau import dari Excel/CSV untuk membuat QR Code kartu.'
                  : 'Belum ada data siswa yang terdaftar pada Tahun Ajaran aktif.'
                : 'Coba ubah kata kunci pencarian atau pilih filter semua kelas.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-500">
                  {showSelectionTools && (
                    <th className="py-3 pl-5 pr-2 w-10">
                      <input
                        type="checkbox"
                        checked={allFilteredSelected}
                        onChange={toggleSelectAllFiltered}
                        aria-label="Tandai semua siswa"
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                    </th>
                  )}
                  <th className={`py-3 ${showSelectionTools ? 'px-4' : 'pl-5 pr-4'}`}>NISN</th>
                  <th className="py-3 px-4">Nama Siswa</th>
                  <th className="py-3 px-4">Kelas</th>
                  <th className="py-3 px-4">L/P</th>
                  <th className="py-3 px-4">No. WA Ortu</th>
                  {showActionColumn && <th className="py-3 px-5 text-right">Aksi</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredStudents.map((student) => {
                  const isChecked = showSelectionTools && selectedSet.has(student.nis);
                  return (
                    <tr
                      key={student.nis}
                      className={`transition-colors ${
                        isChecked ? 'bg-indigo-50/40' : 'hover:bg-slate-50/70'
                      }`}
                    >
                      {showSelectionTools && (
                        <td className="py-3 pl-5 pr-2">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleSelectOne(student.nis)}
                            aria-label={`Tandai siswa ${student.nama}`}
                            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                        </td>
                      )}
                      <td className={`py-3 ${showSelectionTools ? 'px-4' : 'pl-5 pr-4'} font-mono tabular-nums text-xs font-semibold text-slate-800 whitespace-nowrap`}>
                        {student.nis}
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-900">
                        {student.nama}
                      </td>
                      <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                        {student.kelas}
                      </td>
                      <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                        {student.gender === 'L' ? 'Laki-laki' : 'Perempuan'}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                        {student.no_wa_ortu || '-'}
                      </td>
                      {showActionColumn && (
                        <td className="py-3 px-5">
                          <div className="flex items-center justify-end gap-1.5">
                            {canViewECard && (
                              <button
                                type="button"
                                onClick={() => setEcardStudent(student)}
                                aria-label={`Lihat kartu E-Card ${student.nama}`}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50/70 text-indigo-700 text-xs font-medium hover:bg-indigo-100 transition-colors whitespace-nowrap"
                              >
                                <QrCode className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>E-Card</span>
                              </button>
                            )}
                            {canViewECard && (
                              <button
                                type="button"
                                disabled={generatingPdf}
                                onClick={() =>
                                  void openPdfPreviewForStudents(
                                    [student],
                                    `Pratinjau PDF E-Card — ${student.nama}`,
                                    `ECard_${student.nis}_${student.nama.replace(/\s+/g, '_')}.pdf`
                                  )
                                }
                                aria-label={`Cetak PDF E-Card ${student.nama}`}
                                title="Cetak Kartu ke Pratinjau PDF"
                                className="p-2 rounded-lg text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 disabled:opacity-50 transition-colors"
                              >
                                <Printer className="h-4 w-4" aria-hidden="true" />
                              </button>
                            )}
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() => openEditModal(student)}
                                aria-label={`Edit siswa ${student.nama}`}
                                className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                              >
                                <Pencil className="h-4 w-4" aria-hidden="true" />
                              </button>
                            )}
                            {canDelete && (
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(student)}
                                aria-label={`Hapus siswa ${student.nama}`}
                                className="p-2 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                              >
                                <Trash2 className="h-4 w-4" aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Add/Edit Student Modal */}
      {canEdit && formModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="student-form-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[1px]"
        >
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-md shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 id="student-form-title" className="text-base font-semibold text-slate-900">
                {editingOriginalNis ? 'Edit Data Siswa' : 'Tambah Siswa Baru'}
              </h2>
              <button
                type="button"
                onClick={() => setFormModalOpen(false)}
                aria-label="Tutup modal"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleSubmitForm} className="p-6 space-y-4">
              {formError && (
                <div
                  role="alert"
                  className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-xs font-medium text-rose-700"
                >
                  {formError}
                </div>
              )}

              <div>
                <label htmlFor="field-nis" className="block text-xs font-medium text-slate-700 mb-1">
                  NISN <span className="text-rose-600">*</span>
                </label>
                <input
                  id="field-nis"
                  type="text"
                  required
                  value={formData.nis}
                  onChange={(e) => setFormData({ ...formData, nis: e.target.value })}
                  placeholder="Contoh: 2026015"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-mono text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div>
                <label htmlFor="field-nama" className="block text-xs font-medium text-slate-700 mb-1">
                  Nama Lengkap <span className="text-rose-600">*</span>
                </label>
                <input
                  id="field-nama"
                  type="text"
                  required
                  value={formData.nama}
                  onChange={(e) => setFormData({ ...formData, nama: e.target.value })}
                  placeholder="Nama lengkap siswa"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="field-kelas" className="block text-xs font-medium text-slate-700 mb-1">
                    Kelas <span className="text-rose-600">*</span>
                  </label>
                  <input
                    id="field-kelas"
                    type="text"
                    required
                    readOnly={Boolean(assignedClass)}
                    value={assignedClass || formData.kelas}
                    onChange={(e) => setFormData({ ...formData, kelas: e.target.value })}
                    placeholder="Contoh: X IPA 1"
                    className={`w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 ${
                      assignedClass ? 'bg-slate-100 text-slate-600 cursor-not-allowed' : ''
                    }`}
                  />
                </div>

                <div>
                  <label htmlFor="field-gender" className="block text-xs font-medium text-slate-700 mb-1">
                    Gender
                  </label>
                  <select
                    id="field-gender"
                    value={formData.gender}
                    onChange={(e) =>
                      setFormData({ ...formData, gender: e.target.value as Gender })
                    }
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    <option value="L">Laki-laki (L)</option>
                    <option value="P">Perempuan (P)</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="field-wa" className="block text-xs font-medium text-slate-700 mb-1">
                  No. WhatsApp Orang Tua
                </label>
                <input
                  id="field-wa"
                  type="tel"
                  value={formData.no_wa_ortu}
                  onChange={(e) => setFormData({ ...formData, no_wa_ortu: e.target.value })}
                  placeholder="081234567890"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-mono text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setFormModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
                >
                  {editingOriginalNis ? 'Simpan Perubahan' : 'Simpan Siswa'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Excel / CSV Import Modal */}
      {importModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/55 backdrop-blur-[1px]"
        >
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 id="import-modal-title" className="text-base font-semibold text-slate-900">
                Import Data Siswa (Excel / CSV)
              </h2>
              <button
                type="button"
                onClick={() => setImportModalOpen(false)}
                aria-label="Tutup modal import"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
                <div className="text-xs text-slate-600">
                  <p className="font-semibold text-slate-800">Format Kolom yang Didukung</p>
                  <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                    NISN, Nama, Kelas, Gender (L/P), No WA Ortu
                  </p>
                </div>
                <button
                  type="button"
                  onClick={downloadStudentImportTemplate}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-indigo-700 hover:bg-indigo-50 shrink-0"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Template .xlsx</span>
                </button>
              </div>

              <label className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/50 hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors p-6 cursor-pointer text-center">
                <Upload className="h-7 w-7 text-indigo-600" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    {importFileName || 'Pilih file Excel (.xlsx, .xls) atau CSV'}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Klik untuk memilih file dari perangkat Anda
                  </p>
                </div>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleImportFileChange}
                  className="sr-only"
                />
              </label>

              {importError && (
                <div role="alert" className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-xs font-medium text-rose-700">
                  {importError}
                </div>
              )}

              {importResult && (
                <div className="rounded-xl border border-slate-200 p-4 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Siap diimpor:</span>
                    <span className="font-mono tabular-nums font-bold text-emerald-700">
                      {importResult.valid.length} siswa
                    </span>
                  </div>
                  {importResult.duplicates.length > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600">NISN duplikat dilewati:</span>
                      <span className="font-mono tabular-nums font-semibold text-amber-700">
                        {importResult.duplicates.length} ({importResult.duplicates.slice(0, 3).join(', ')})
                      </span>
                    </div>
                  )}
                  {importResult.invalidRows.length > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600">Baris tidak lengkap:</span>
                      <span className="font-mono tabular-nums font-semibold text-rose-700">
                        {importResult.invalidRows.length} baris
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setImportModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={!importResult || importResult.valid.length === 0}
                  onClick={handleConfirmImport}
                  className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
                >
                  Import {importResult ? `${importResult.valid.length} Siswa` : ''}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Batch E-Card Print Modal */}
      {batchModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="batch-ecard-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/55 backdrop-blur-[1px]"
        >
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-md shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 id="batch-ecard-title" className="text-base font-semibold text-slate-900">
                Cetak E-Card Banyak Sekaligus
              </h2>
              <button
                type="button"
                onClick={() => setBatchModalOpen(false)}
                aria-label="Tutup modal cetak massal"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="space-y-2.5">
                <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50">
                  <input
                    type="radio"
                    name="batchScope"
                    checked={batchScope === 'class'}
                    onChange={() => setBatchScope('class')}
                    className="mt-1 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div className="flex-1 min-w-0 space-y-2">
                    <p className="text-sm font-semibold text-slate-900">Cetak Per Kelas</p>
                    <select
                      value={batchClass}
                      onChange={(e) => {
                        setBatchScope('class');
                        setBatchClass(e.target.value);
                      }}
                      aria-label="Pilih kelas untuk cetak E-Card"
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none"
                    >
                      {uniqueClasses.map((cls) => (
                        <option key={cls} value={cls}>
                          {cls} ({students.filter((s) => s.kelas === cls).length} siswa)
                        </option>
                      ))}
                    </select>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50">
                  <input
                    type="radio"
                    name="batchScope"
                    checked={batchScope === 'selected'}
                    disabled={selectedNis.length === 0}
                    onChange={() => setBatchScope('selected')}
                    className="mt-1 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      Siswa Ditandai ({selectedNis.length} siswa)
                    </p>
                    <p className="text-xs text-slate-500">
                      Gunakan kotak centang pada tabel untuk memilih beberapa siswa
                    </p>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50">
                  <input
                    type="radio"
                    name="batchScope"
                    checked={batchScope === 'all'}
                    onChange={() => setBatchScope('all')}
                    className="mt-1 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      Semua Siswa ({students.length} siswa)
                    </p>
                    <p className="text-xs text-slate-500">
                      Susun seluruh kartu siswa ke dalam halaman PDF ukuran A4 (8 kartu/halaman)
                    </p>
                  </div>
                </label>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setBatchModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={batchPreviewCount === 0 || generatingPdf}
                  onClick={handleBatchPrintSubmit}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
                >
                  <Printer className="h-4 w-4" aria-hidden="true" />
                  <span>
                    {generatingPdf
                      ? 'Menyiapkan PDF...'
                      : `Pratinjau PDF (${batchPreviewCount})`}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Single Delete Confirmation Modal (Master Admin only) */}
      {canDelete && deleteTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[1px]"
        >
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-sm p-6 shadow-xl space-y-4">
            <h2 id="delete-modal-title" className="text-base font-semibold text-slate-900">
              Hapus Data Siswa?
            </h2>
            <p className="text-sm text-slate-600">
              Siswa <span className="font-semibold text-slate-900">{deleteTarget.nama}</span> (NISN{' '}
              <span className="font-mono tabular-nums">{deleteTarget.nis}</span>) akan dihapus dari daftar siswa.
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteStudent(deleteTarget.nis);
                  setDeleteTarget(null);
                }}
                className="px-4 py-2 rounded-xl bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700"
              >
                Ya, Hapus
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Confirmation Modal (Master Admin only) */}
      {canDelete && bulkDeleteConfirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="bulk-delete-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[1px]"
        >
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-sm p-6 shadow-xl space-y-4">
            <h2 id="bulk-delete-title" className="text-base font-semibold text-slate-900">
              Hapus {selectedNis.length} Siswa Terpilih?
            </h2>
            <p className="text-sm text-slate-600">
              Seluruh <span className="font-semibold text-slate-900">{selectedNis.length}</span> data siswa yang ditandai akan dihapus permanen dari daftar siswa.
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setBulkDeleteConfirmOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => {
                  onBulkDeleteStudents(selectedNis);
                  setSelectedNis([]);
                  setBulkDeleteConfirmOpen(false);
                }}
                className="px-4 py-2 rounded-xl bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700"
              >
                Ya, Hapus Semua
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Single E-Card Preview Modal */}
      {ecardStudent && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ecard-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-[1px]"
        >
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 id="ecard-modal-title" className="text-base font-semibold text-slate-900">
                Kartu Tanda Siswa (E-Card)
              </h2>
              <button
                type="button"
                onClick={() => setEcardStudent(null)}
                aria-label="Tutup preview E-Card"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="p-6 flex flex-col items-center gap-5 bg-slate-50/60">
              <div className="ecard-print-area w-full max-w-[440px] rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-md">
                <div className="bg-indigo-600 px-5 py-3.5 text-white flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-white p-1 shrink-0 flex items-center justify-center">
                    <img
                      src={settings.logo_sekolah || DEFAULT_SCHOOL_LOGO}
                      alt={`Logo ${settings.nama_sekolah}`}
                      className="h-full w-full object-contain"
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-indigo-100">
                      Kartu Tanda Siswa Elektronik
                    </p>
                    <p className="text-sm font-bold tracking-tight mt-0.5 truncate">
                      {settings.nama_sekolah}
                    </p>
                  </div>
                </div>

                <div className="p-4 sm:p-5 flex items-start justify-between gap-4">
                  {/* Left Column: Student Info + Principal TTD/Cap/Name/NIP below Siswa Putra/Putri */}
                  <div className="flex-1 min-w-0 text-left space-y-1">
                    <p className="text-base font-bold text-slate-900 leading-snug">
                      {ecardStudent.nama}
                    </p>
                    <div className="space-y-0.5 text-xs text-slate-500">
                      <p>
                        NISN{' '}
                        <span className="font-mono tabular-nums font-semibold text-slate-800 ml-1.5">
                          {ecardStudent.nis}
                        </span>
                      </p>
                      <p>
                        Kelas{' '}
                        <span className="font-semibold text-slate-800 ml-1">
                          {ecardStudent.kelas}
                        </span>
                      </p>
                      <p className="text-[11px] text-slate-500 pt-0.5">
                        {ecardStudent.gender === 'L' ? 'Siswa Putra' : 'Siswa Putri'}
                      </p>
                    </div>

                    {(settings.nama_kepala_sekolah?.trim() ||
                      settings.nip_kepala_sekolah?.trim() ||
                      settings.ttd_kepala_sekolah ||
                      settings.cap_sekolah) && (
                      <div
                        data-testid="single-ecard-principal-block"
                        className="pt-2.5 mt-2 border-t border-slate-100 text-left"
                      >
                        <p className="text-[10px] font-medium text-slate-500">
                          Kepala Sekolah
                        </p>
                        <div className="relative h-12 w-40 flex items-center my-0.5">
                          {settings.cap_sekolah && (
                            <img
                              src={settings.cap_sekolah}
                              alt="Cap Sekolah"
                              className={`h-12 w-12 object-contain pointer-events-none select-none ${
                                settings.ttd_kepala_sekolah
                                  ? 'absolute left-0 opacity-90'
                                  : ''
                              }`}
                            />
                          )}
                          {settings.ttd_kepala_sekolah && (
                            <img
                              src={settings.ttd_kepala_sekolah}
                              alt="TTD Kepala Sekolah"
                              className={`relative z-10 max-h-11 max-w-[120px] object-contain pointer-events-none select-none ${
                                settings.cap_sekolah ? 'ml-5' : ''
                              }`}
                            />
                          )}
                        </div>
                        {settings.nama_kepala_sekolah?.trim() && (
                          <p className="text-[11px] font-bold text-slate-900 leading-tight underline decoration-slate-400 underline-offset-2 truncate">
                            {settings.nama_kepala_sekolah.trim()}
                          </p>
                        )}
                        {settings.nip_kepala_sekolah?.trim() && (
                          <p className="text-[10px] font-mono text-slate-600 leading-tight mt-0.5 truncate">
                            NIP. {settings.nip_kepala_sekolah.trim()}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Right Column: Full-size QR Code (never shrunk) */}
                  <div className="flex flex-col items-center shrink-0">
                    <div className="p-2 rounded-xl border border-slate-200 bg-white">
                      {qrDataUrl ? (
                        <img
                          src={qrDataUrl}
                          alt={`QR Code NISN ${ecardStudent.nis}`}
                          className="h-32 w-32 object-contain"
                        />
                      ) : (
                        <div className="h-32 w-32 flex items-center justify-center text-xs text-slate-400">
                          Membuat QR...
                        </div>
                      )}
                    </div>
                    <p className="text-[10px] font-mono font-semibold text-slate-600 mt-1.5">
                      NISN: {ecardStudent.nis}
                    </p>
                  </div>
                </div>
              </div>

              <div className="w-full flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleDownloadQr}
                  disabled={!qrDataUrl}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  <span>Unduh QR</span>
                </button>
                <button
                  type="button"
                  disabled={generatingPdf}
                  onClick={() => {
                    const target = ecardStudent;
                    setEcardStudent(null);
                    void openPdfPreviewForStudents(
                      [target],
                      `Pratinjau PDF E-Card — ${target.nama}`,
                      `ECard_${target.nis}_${target.nama.replace(/\s+/g, '_')}.pdf`
                    );
                  }}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60"
                >
                  <Printer className="h-4 w-4" aria-hidden="true" />
                  <span>{generatingPdf ? 'Menyiapkan...' : 'Cetak Kartu (PDF)'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Immediate PDF Preview Modal */}
      <PdfPreviewModal
        open={pdfPreview.open}
        title={pdfPreview.title}
        subtitle={pdfPreview.subtitle}
        blobUrl={pdfPreview.blobUrl}
        filename={pdfPreview.filename}
        students={pdfPreview.students}
        settings={settings}
        qrMap={pdfPreview.qrMap}
        onClose={() => setPdfPreview((prev) => ({ ...prev, open: false }))}
      />
    </div>
  );
}
