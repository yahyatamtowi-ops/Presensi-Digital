import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, LogOut, Users, X } from 'lucide-react';
import {
  COLLECTIVE_EARLY_CHECKOUT_PRESETS,
  getCurrentTimeString,
  isBeforeCheckoutTime,
  normalizeCheckoutTimeHHMMSS,
} from '../utils/attendanceLogic';

export interface CollectiveCheckoutTarget {
  nis: string;
  nama: string;
  kelas: string;
  jam_masuk: string;
}

interface CollectiveCheckoutModalProps {
  open: boolean;
  tanggal: string;
  targets: CollectiveCheckoutTarget[];
  jamPulangStandar: string;
  onCancel: () => void;
  onConfirm: (params: {
    checkoutTime: string;
    alasanPulangCepat?: string;
  }) => void;
}

export function CollectiveCheckoutModal({
  open,
  tanggal,
  targets,
  jamPulangStandar,
  onCancel,
  onConfirm,
}: CollectiveCheckoutModalProps) {
  const [checkoutTimeHHMM, setCheckoutTimeHHMM] = useState<string>(() =>
    getCurrentTimeString().slice(0, 5)
  );
  const [forceEarlyMode, setForceEarlyMode] = useState<boolean>(false);
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const [customReason, setCustomReason] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    if (!open) return;
    const nowHHMM = getCurrentTimeString().slice(0, 5);
    setCheckoutTimeHHMM(nowHHMM);
    setForceEarlyMode(false);
    setSelectedPreset('');
    setCustomReason('');
    setErrorMsg('');
  }, [open, tanggal]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  if (!open || targets.length === 0) return null;

  const normalizedFullTime = normalizeCheckoutTimeHHMMSS(checkoutTimeHHMM);
  const isBeforeStandard = isBeforeCheckoutTime(normalizedFullTime, jamPulangStandar);
  const isEarlyMode = isBeforeStandard || forceEarlyMode;

  const isOther = selectedPreset === '__OTHER__';
  const finalReason = isOther
    ? customReason.trim()
    : selectedPreset
      ? customReason.trim()
        ? `${selectedPreset} — ${customReason.trim()}`
        : selectedPreset
      : customReason.trim();

  const distinctClasses = Array.from(new Set(targets.map((t) => t.kelas))).sort();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isEarlyMode && !finalReason) {
      setErrorMsg(
        'Jam pulang lebih awal dari waktu standar. Pilih atau tulis keterangan pulang cepat kolektif terlebih dahulu.'
      );
      return;
    }
    setErrorMsg('');
    onConfirm({
      checkoutTime: normalizedFullTime,
      ...(isEarlyMode && finalReason ? { alasanPulangCepat: finalReason } : {}),
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="collective-checkout-modal-title"
      data-testid="modal-collective-checkout"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-[1px]"
    >
      <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div
          className={`px-5 py-4 border-b flex items-center justify-between gap-3 ${
            isEarlyMode
              ? 'border-amber-100 bg-amber-50/75'
              : 'border-indigo-100 bg-indigo-50/70'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${
                isEarlyMode
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-indigo-100 text-indigo-700'
              }`}
            >
              {isEarlyMode ? (
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              ) : (
                <LogOut className="h-5 w-5" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0">
              <h2
                id="collective-checkout-modal-title"
                className="text-base font-semibold text-slate-900 truncate"
              >
                {isEarlyMode
                  ? 'Konfirmasi Pulang Cepat Kolektif'
                  : 'Konfirmasi Jam Pulang Kolektif'}
              </h2>
              <p
                className={`text-xs ${
                  isEarlyMode ? 'text-amber-800' : 'text-indigo-800'
                }`}
              >
                Tanggal {tanggal} · Jam pulang standar {jamPulangStandar}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Tutup dialog konfirmasi pulang kolektif"
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-white/70 transition-colors"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
          {/* Affected Students Summary */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                <Users className="h-4 w-4 text-indigo-600" aria-hidden="true" />
                <span>
                  {targets.length} siswa siap dikonfirmasi pulang
                </span>
              </div>
              <span className="text-[11px] font-medium text-slate-600">
                {distinctClasses.length === 1
                  ? `Kelas ${distinctClasses[0]}`
                  : `${distinctClasses.length} Kelas`}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
              {targets.slice(0, 12).map((s) => (
                <span
                  key={s.nis}
                  className="inline-flex items-center px-2 py-0.5 rounded-md bg-white border border-slate-200 text-[11px] text-slate-700"
                >
                  {s.nama} ({s.kelas})
                </span>
              ))}
              {targets.length > 12 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 text-[11px] font-semibold text-indigo-700">
                  +{targets.length - 12} siswa lainnya
                </span>
              )}
            </div>
          </div>

          {/* Checkout Time Input */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
            <div>
              <label
                htmlFor="collective-checkout-time"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                Jam Pulang yang Dikonfirmasi
              </label>
              <div className="relative">
                <Clock
                  className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="collective-checkout-time"
                  data-testid="input-collective-checkout-time"
                  type="time"
                  required
                  value={checkoutTimeHHMM}
                  onChange={(e) => {
                    setCheckoutTimeHHMM(e.target.value || getCurrentTimeString().slice(0, 5));
                    setErrorMsg('');
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm font-mono tabular-nums text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                data-testid="toggle-collective-early-mode"
                checked={isEarlyMode}
                disabled={isBeforeStandard}
                onChange={(e) => {
                  setForceEarlyMode(e.target.checked);
                  setErrorMsg('');
                }}
                className="h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500 disabled:opacity-70"
              />
              <span className="text-xs font-medium text-slate-700 leading-tight">
                {isBeforeStandard
                  ? `Pulang cepat otomatis (< ${jamPulangStandar})`
                  : 'Tandai sebagai Pulang Cepat'}
              </span>
            </label>
          </div>

          {/* Status Feedback Banner */}
          {isEarlyMode ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-2.5 text-xs text-amber-900 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
              <p className="leading-relaxed">
                Jam pulang <strong className="font-mono">{checkoutTimeHHMM}</strong> tercatat{' '}
                <strong>Pulang Cepat</strong> (sebelum jam pulang standar{' '}
                <span className="font-mono">{jamPulangStandar}</span>). Isi keterangan pulang cepat
                kolektif di bawah untuk diterapkan ke seluruh {targets.length} siswa terpilih.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-3.5 py-2.5 text-xs text-emerald-900 flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
              <p className="leading-relaxed">
                Jam pulang <strong className="font-mono">{checkoutTimeHHMM}</strong> sesuai waktu
                pulang standar (<span className="font-mono">≥ {jamPulangStandar}</span>). Seluruh{' '}
                {targets.length} siswa terpilih akan dikonfirmasi pulang tepat waktu.
              </p>
            </div>
          )}

          {/* Collective Early Checkout Reason Section */}
          {isEarlyMode && (
            <div className="space-y-3 pt-1">
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-slate-700">
                  Pilih Keterangan Pulang Cepat Kolektif{' '}
                  <span className="text-rose-500">*</span>
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {COLLECTIVE_EARLY_CHECKOUT_PRESETS.map((preset) => {
                    const active = selectedPreset === preset;
                    return (
                      <button
                        key={preset}
                        type="button"
                        aria-pressed={active}
                        onClick={() => {
                          setSelectedPreset(active ? '' : preset);
                          setErrorMsg('');
                        }}
                        className={`text-left px-3 py-2 rounded-xl border text-xs font-medium transition-colors ${
                          active
                            ? 'border-amber-500 bg-amber-50 text-amber-900 font-semibold'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {preset}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    aria-pressed={isOther}
                    onClick={() => {
                      setSelectedPreset(isOther ? '' : '__OTHER__');
                      setErrorMsg('');
                    }}
                    className={`text-left px-3 py-2 rounded-xl border text-xs font-medium transition-colors ${
                      isOther
                        ? 'border-amber-500 bg-amber-50 text-amber-900 font-semibold'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Alasan Lainnya (tulis manual)
                  </button>
                </div>
              </div>

              <div>
                <label
                  htmlFor="collective-early-reason-input"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  {isOther || !selectedPreset
                    ? 'Keterangan Pulang Cepat Kolektif'
                    : 'Detail Tambahan Kegiatan (Opsional)'}
                </label>
                <textarea
                  id="collective-early-reason-input"
                  data-testid="textarea-collective-early-reason"
                  rows={2}
                  value={customReason}
                  onChange={(e) => {
                    setCustomReason(e.target.value);
                    if (errorMsg) setErrorMsg('');
                  }}
                  placeholder={
                    selectedPreset && !isOther
                      ? 'Contoh: Rapat persiapan ujian semester mulai pukul 12.00...'
                      : 'Contoh: Siswa dipulangkan lebih awal karena ada kegiatan rapat dewan guru...'
                  }
                  className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 resize-none"
                />
              </div>
            </div>
          )}

          {errorMsg && (
            <p
              role="alert"
              data-testid="collective-checkout-error"
              className="text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2"
            >
              {errorMsg}
            </p>
          )}

          <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-xl border border-slate-200 text-xs sm:text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Batal
            </button>
            <button
              type="submit"
              data-testid="btn-submit-collective-checkout"
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-white text-xs sm:text-sm font-semibold transition-colors ${
                isEarlyMode
                  ? 'bg-amber-600 hover:bg-amber-700'
                  : 'bg-indigo-600 hover:bg-indigo-700'
              }`}
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span>
                {isEarlyMode
                  ? `Konfirmasi Pulang Cepat (${targets.length})`
                  : `Konfirmasi Pulang (${targets.length})`}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
