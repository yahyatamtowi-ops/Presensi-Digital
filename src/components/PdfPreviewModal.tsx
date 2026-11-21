import { useMemo, useState } from 'react';
import { Download, Eye, FileText, Printer, QrCode, X } from 'lucide-react';
import type { SchoolSettings, Student } from '../types';

interface PdfPreviewModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  blobUrl: string | null;
  filename: string;
  students: Student[];
  settings: SchoolSettings;
  qrMap: Record<string, string>;
  onClose: () => void;
}

type PreviewMode = 'sheets' | 'native';

export function PdfPreviewModal({
  open,
  title,
  subtitle,
  blobUrl,
  filename,
  students,
  settings,
  qrMap,
  onClose,
}: PdfPreviewModalProps) {
  const [mode, setMode] = useState<PreviewMode>('sheets');

  const pages = useMemo(() => {
    const chunks: Student[][] = [];
    for (let i = 0; i < students.length; i += 8) {
      chunks.push(students.slice(i, i + 8));
    }
    return chunks;
  }, [students]);

  if (!open || !blobUrl) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pdf-preview-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/65 backdrop-blur-[1px]"
    >
      <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 id="pdf-preview-title" className="text-base font-semibold text-slate-900 truncate">
              {title}
            </h2>
            {subtitle && (
              <p className="text-xs text-slate-500 mt-0.5 truncate">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup pratinjau PDF"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 shrink-0"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Mode Bar */}
        <div className="px-5 sm:px-6 py-2.5 border-b border-slate-100 bg-slate-50/70 flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center rounded-xl border border-slate-200 bg-white p-0.5">
            <button
              type="button"
              onClick={() => setMode('sheets')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                mode === 'sheets'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Pratinjau Halaman A4 ({pages.length} hal)</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('native')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                mode === 'native'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileText className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Viewer PDF Bawaan</span>
            </button>
          </div>

          <span className="text-[11px] font-mono tabular-nums text-slate-500">
            Format A4 · Maks. 8 kartu/halaman
          </span>
        </div>

        {/* Preview Content */}
        <div className="p-4 sm:p-5 bg-slate-100 flex-1 overflow-y-auto min-h-[360px]">
          {mode === 'sheets' ? (
            <div className="ecard-batch-print-area space-y-5">
              {pages.map((pageStudents, pageIdx) => (
                <div
                  key={pageIdx}
                  className="ecard-print-page bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-6 max-w-[760px] mx-auto"
                >
                  <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100 text-[11px] text-slate-400">
                    <span className="font-medium text-slate-500 truncate">
                      {settings.nama_sekolah} — Kartu Tanda Siswa Elektronik
                    </span>
                    <span className="font-mono tabular-nums shrink-0">
                      Halaman {pageIdx + 1} / {pages.length}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    {pageStudents.map((student) => (
                      <article
                        key={student.nis}
                        className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04)] flex flex-col"
                      >
                        {/* Indigo Card Header */}
                        <div className="bg-indigo-600 px-3.5 py-2.5 text-white flex items-center gap-2.5">
                          {settings.logo_sekolah && (
                            <div className="h-8 w-8 rounded-md bg-white p-0.5 shrink-0 flex items-center justify-center">
                              <img
                                src={settings.logo_sekolah}
                                alt={`Logo ${settings.nama_sekolah}`}
                                className="h-full w-full object-contain"
                              />
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="text-[9px] font-medium tracking-wide uppercase text-indigo-100">
                              Kartu Tanda Siswa Elektronik
                            </p>
                            <p className="text-xs font-bold leading-tight truncate">
                              {settings.nama_sekolah}
                            </p>
                          </div>
                        </div>

                        {/* Card Body */}
                        <div className="p-3.5 flex items-start justify-between gap-3 flex-1">
                          <div className="min-w-0 flex-1 flex flex-col justify-between space-y-2 pt-0.5">
                            <div className="space-y-0.5">
                              <p className="text-sm font-bold text-slate-900 leading-snug line-clamp-2">
                                {student.nama}
                              </p>
                              <p className="text-xs text-slate-500">
                                NIS{' '}
                                <span className="font-mono tabular-nums font-bold text-slate-900">
                                  {student.nis}
                                </span>
                              </p>
                              <p className="text-xs text-slate-500">
                                Kelas{' '}
                                <span className="font-semibold text-slate-900">
                                  {student.kelas}
                                </span>
                              </p>
                              <p className="text-[11px] text-slate-400">
                                {student.gender === 'L' ? 'Siswa Putra' : 'Siswa Putri'}
                              </p>
                            </div>

                            {(settings.nama_kepala_sekolah?.trim() ||
                              settings.nip_kepala_sekolah?.trim() ||
                              settings.ttd_kepala_sekolah ||
                              settings.cap_sekolah) && (
                              <div
                                data-testid="ecard-principal-block"
                                className="pt-1.5 border-t border-slate-100 text-left flex flex-col items-start"
                              >
                                <p className="text-[8px] font-medium text-slate-500 leading-none">
                                  Kepala Sekolah
                                </p>
                                {(settings.cap_sekolah || settings.ttd_kepala_sekolah) && (
                                  <div className="relative h-9 w-28 flex items-center justify-start my-0.5">
                                    {settings.cap_sekolah && (
                                      <img
                                        src={settings.cap_sekolah}
                                        alt="Cap Sekolah"
                                        className={`h-9 w-9 object-contain pointer-events-none select-none ${
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
                                        className={`relative z-10 max-h-8 max-w-[92px] object-contain pointer-events-none select-none ${
                                          settings.cap_sekolah ? 'ml-3.5' : ''
                                        }`}
                                      />
                                    )}
                                  </div>
                                )}
                                {settings.nama_kepala_sekolah?.trim() && (
                                  <p className="text-[8.5px] font-bold text-slate-900 leading-tight underline decoration-slate-400 underline-offset-2 line-clamp-1 max-w-full">
                                    {settings.nama_kepala_sekolah.trim()}
                                  </p>
                                )}
                                {settings.nip_kepala_sekolah?.trim() && (
                                  <p className="text-[7.5px] font-mono tabular-nums text-slate-500 leading-tight mt-0.5">
                                    NIP. {settings.nip_kepala_sekolah.trim()}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="shrink-0 flex flex-col items-center pt-0.5">
                            <div className="h-28 w-28 rounded-lg border border-slate-200 bg-white p-1.5 flex items-center justify-center">
                              {qrMap[student.nis] ? (
                                <img
                                  src={qrMap[student.nis]}
                                  alt={`QR ${student.nis}`}
                                  className="h-full w-full object-contain"
                                />
                              ) : (
                                <QrCode className="h-9 w-9 text-slate-300" aria-hidden="true" />
                              )}
                            </div>
                            <p className="text-[9px] font-mono tabular-nums text-slate-400 mt-1">
                              NIS: {student.nis}
                            </p>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <iframe
              src={blobUrl}
              title={title}
              className="w-full h-[60vh] rounded-xl border border-slate-200 bg-white"
            />
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 sm:px-6 py-4 border-t border-slate-100 bg-white flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            File PDF ukuran A4 siap dicetak langsung atau diunduh ke perangkat.
          </p>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Printer className="h-4 w-4" aria-hidden="true" />
              <span>Cetak Sekarang</span>
            </button>
            <a
              href={blobUrl}
              download={filename}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              <span>Unduh PDF</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
