import { useEffect, useState } from 'react';
import { AlertTriangle, Clock, LogOut, X } from 'lucide-react';
import {
  EARLY_CHECKOUT_PRESET_REASONS,
  getCurrentTimeString,
} from '../utils/attendanceLogic';

export interface EarlyCheckoutStudentInfo {
  nis: string;
  nama: string;
  kelas: string;
  jamMasuk?: string;
}

interface EarlyCheckoutModalProps {
  open: boolean;
  student: EarlyCheckoutStudentInfo | null;
  jamPulangStandar: string;
  onCancel: () => void;
  onConfirm: (alasan: string) => void;
}

export function EarlyCheckoutModal({
  open,
  student,
  jamPulangStandar,
  onCancel,
  onConfirm,
}: EarlyCheckoutModalProps) {
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const [customReason, setCustomReason] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [currentTime, setCurrentTime] = useState<string>(() => getCurrentTimeString());

  useEffect(() => {
    if (!open) return;
    setSelectedPreset('');
    setCustomReason('');
    setErrorMsg('');
    setCurrentTime(getCurrentTimeString());
  }, [open, student?.nis]);

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

  if (!open || !student) return null;

  const isOther = selectedPreset === '__OTHER__';
  const finalReason = isOther
    ? customReason.trim()
    : selectedPreset
      ? customReason.trim()
        ? `${selectedPreset} — ${customReason.trim()}`
        : selectedPreset
      : customReason.trim();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!finalReason) {
      setErrorMsg('Pilih atau tulis alasan pulang cepat terlebih dahulu sebelum konfirmasi.');
      return;
    }
    setErrorMsg('');
    onConfirm(finalReason);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="early-checkout-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-[1px]"
    >
      <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-md shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-amber-100 bg-amber-50/70 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2
                id="early-checkout-modal-title"
                className="text-base font-semibold text-slate-900 truncate"
              >
                Konfirmasi Pulang Cepat
              </h2>
              <p className="text-xs text-amber-800">
                Presensi pulang dilakukan sebelum jam pulang ({jamPulangStandar})
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Tutup konfirmasi pulang cepat"
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-amber-100/70 transition-colors"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Student Summary Box */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-slate-900 truncate">{student.nama}</p>
              <span className="text-xs font-medium text-slate-600 whitespace-nowrap">
                {student.kelas}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-mono tabular-nums text-slate-600">
              <span>NISN {student.nis}</span>
              {student.jamMasuk && student.jamMasuk !== '-' && (
                <span>· Masuk {student.jamMasuk}</span>
              )}
              <span className="inline-flex items-center gap-1 text-amber-700 font-semibold">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Sekarang {currentTime.slice(0, 5)} &lt; {jamPulangStandar}</span>
              </span>
            </div>
          </div>

          {/* Preset Reasons */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-700">
              Pilih Alasan Pulang Cepat <span className="text-rose-500">*</span>
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {EARLY_CHECKOUT_PRESET_REASONS.map((preset) => {
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
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold'
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
                className={`sm:col-span-2 text-left px-3 py-2 rounded-xl border text-xs font-medium transition-colors ${
                  isOther
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                Alasan Lainnya (tulis manual di bawah)
              </button>
            </div>
          </div>

          {/* Detail / Custom Reason Input */}
          <div>
            <label
              htmlFor="early-checkout-reason-input"
              className="block text-xs font-semibold text-slate-700 mb-1.5"
            >
              {isOther || !selectedPreset
                ? 'Keterangan Alasan Pulang Cepat'
                : 'Detail Tambahan (Opsional)'}
            </label>
            <textarea
              id="early-checkout-reason-input"
              rows={2}
              value={customReason}
              onChange={(e) => {
                setCustomReason(e.target.value);
                if (errorMsg) setErrorMsg('');
              }}
              placeholder={
                selectedPreset && !isOther
                  ? 'Contoh: Sudah dijemput ibu di gerbang sekolah...'
                  : 'Tulis alasan siswa pulang sebelum jam pulang...'
              }
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 resize-none"
            />
          </div>

          {errorMsg && (
            <p
              role="alert"
              className="text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2"
            >
              {errorMsg}
            </p>
          )}

          <div className="pt-1 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Batal
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 transition-colors"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span>Konfirmasi Pulang Cepat</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
