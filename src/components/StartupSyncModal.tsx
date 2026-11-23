import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Database,
  Lock,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  DEFAULT_FIREBASE_SYNC_EMAIL,
  DEFAULT_GAS_WEBAPP_URL,
  getMaskedConfirmationEmail,
  normalizeGasUrlForConfirmation,
  type StartupSyncStep,
} from '../utils/startupSyncPrompt';

interface StartupSyncModalProps {
  open: boolean;
  step: StartupSyncStep;
  firebaseConnected: boolean;
  firebaseSyncing: boolean;
  sheetsSyncing: boolean;
  initialSheetsUrl: string;
  errorMessage?: string | null;
  onConfirmFirebase: (loginHintEmail: string) => Promise<boolean>;
  onConfirmSheets: (scriptUrl: string) => Promise<boolean>;
  onDismiss: () => void;
}

export function StartupSyncModal({
  open,
  step,
  firebaseConnected,
  firebaseSyncing,
  sheetsSyncing,
  initialSheetsUrl,
  errorMessage,
  onConfirmFirebase,
  onConfirmSheets,
  onDismiss,
}: StartupSyncModalProps) {
  const [sheetsUrl, setSheetsUrl] = useState<string>(() =>
    normalizeGasUrlForConfirmation(initialSheetsUrl)
  );
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (step === 'sheets') {
      setSheetsUrl(normalizeGasUrlForConfirmation(initialSheetsUrl));
      setLocalError(null);
    }
  }, [step, initialSheetsUrl]);

  if (!open || step === 'done') return null;

  const maskedEmail = getMaskedConfirmationEmail(DEFAULT_FIREBASE_SYNC_EMAIL);
  const displayError = localError || errorMessage || null;

  const handleFirebaseClick = async () => {
    setLocalError(null);
    await onConfirmFirebase(DEFAULT_FIREBASE_SYNC_EMAIL);
  };

  const handleSheetsClick = async () => {
    const trimmed = sheetsUrl.trim();
    if (!trimmed) {
      setLocalError('URL Deployment Web App Google Apps Script tidak boleh kosong.');
      return;
    }
    setLocalError(null);
    const ok = await onConfirmSheets(trimmed);
    if (!ok) {
      setLocalError(
        'Gagal menyinkronkan dengan Google Apps Script. Periksa koneksi internet atau URL deployment lalu coba lagi.'
      );
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/55 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="startup-sync-modal-title"
      data-testid="modal-startup-sync"
    >
      <div className="w-full max-w-lg rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
                step === 'firebase'
                  ? 'bg-indigo-50 text-indigo-600'
                  : 'bg-emerald-50 text-emerald-600'
              }`}
            >
              {step === 'firebase' ? (
                <Cloud className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Database className="h-5 w-5" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-600">
                Permintaan Sinkronisasi Awal · Langkah {step === 'firebase' ? '1' : '2'} dari 2
              </p>
              <h2
                id="startup-sync-modal-title"
                className="text-sm sm:text-base font-bold text-slate-900 truncate"
              >
                {step === 'firebase'
                  ? 'Sinkronisasi Cloud Lintas Perangkat (Firebase)'
                  : 'Backend Google Apps Script (Web App & Spreadsheet)'}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Tutup permintaan sinkronisasi awal"
            data-testid="btn-close-startup-sync"
            className="h-8 w-8 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center shrink-0 transition-colors"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Step Indicator */}
        <div className="px-5 pt-4">
          <div className="grid grid-cols-2 gap-2">
            <div
              className={`rounded-xl border px-3 py-2 flex items-center gap-2 text-xs font-semibold ${
                firebaseConnected
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : step === 'firebase'
                    ? 'bg-indigo-50 border-indigo-200 text-indigo-800'
                    : 'bg-slate-50 border-slate-200 text-slate-500'
              }`}
            >
              {firebaseConnected ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" aria-hidden="true" />
              ) : (
                <span className="h-5 w-5 rounded-full bg-indigo-600 text-white text-[11px] flex items-center justify-center shrink-0">
                  1
                </span>
              )}
              <span className="truncate">Cloud Firebase</span>
            </div>
            <div
              className={`rounded-xl border px-3 py-2 flex items-center gap-2 text-xs font-semibold ${
                step === 'sheets'
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                  : 'bg-slate-50 border-slate-200 text-slate-400'
              }`}
            >
              <span
                className={`h-5 w-5 rounded-full text-[11px] flex items-center justify-center shrink-0 ${
                  step === 'sheets'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-200 text-slate-500'
                }`}
              >
                2
              </span>
              <span className="truncate">Google Sheets</span>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {step === 'firebase' ? (
            <>
              <p className="text-xs text-slate-600 leading-relaxed">
                Aplikasi belum terhubung ke{' '}
                <strong className="text-slate-900">
                  Sinkronisasi Cloud Lintas Perangkat (Firebase)
                </strong>{' '}
                dan{' '}
                <strong className="text-slate-900">
                  Koneksi Database Google Sheets (Sinkronisasi Penuh)
                </strong>
                . Silakan konfirmasi akun Cloud Firebase terlebih dahulu agar seluruh data tersinkronisasi otomatis antar perangkat.
              </p>

              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 space-y-2">
                <label
                  htmlFor="startup-firebase-masked-email"
                  className="flex items-center justify-between text-xs font-semibold text-slate-700"
                >
                  <span>Bilah Konfirmasi Email Akun Firebase</span>
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    Terlindungi
                  </span>
                </label>
                <div className="relative">
                  <Lock
                    className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                    aria-hidden="true"
                  />
                  <input
                    id="startup-firebase-masked-email"
                    data-testid="startup-firebase-email-input"
                    type="text"
                    readOnly
                    value={maskedEmail}
                    aria-label="Email akun Firebase tersembunyi untuk konfirmasi"
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white border border-slate-300 text-sm font-mono font-bold tracking-widest text-slate-800 select-none focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                  />
                </div>
                <p className="text-[11px] text-slate-500">
                  Alamat email akun sinkronisasi disembunyikan demi privasi. Anda cukup menekan tombol konfirmasi di bawah untuk verifikasi akun Google.
                </p>
              </div>

              {displayError && (
                <div
                  data-testid="startup-sync-error"
                  className="rounded-xl bg-amber-50 border border-amber-200 p-3 flex items-start gap-2 text-xs text-amber-900"
                >
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{displayError}</span>
                </div>
              )}

              <div className="pt-1 flex flex-wrap items-center justify-end gap-2.5 border-t border-slate-100">
                <button
                  type="button"
                  onClick={onDismiss}
                  data-testid="btn-startup-dismiss"
                  className="px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Nanti Saja
                </button>
                <button
                  type="button"
                  disabled={firebaseSyncing}
                  onClick={() => void handleFirebaseClick()}
                  data-testid="btn-startup-confirm-firebase"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  {firebaseSyncing ? (
                    <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Cloud className="h-4 w-4" aria-hidden="true" />
                  )}
                  <span>
                    {firebaseSyncing
                      ? 'Memverifikasi Firebase...'
                      : 'Konfirmasi & Hubungkan Firebase'}
                  </span>
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 flex items-center gap-2 text-xs text-emerald-800 font-medium">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" aria-hidden="true" />
                <span>
                  Sinkronisasi Cloud Lintas Perangkat (Firebase) berhasil terverifikasi. Lanjutkan konfirmasi koneksi Google Sheets.
                </span>
              </div>

              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 space-y-2">
                <label
                  htmlFor="startup-gas-url-input"
                  className="block text-xs font-semibold text-slate-700"
                >
                  URL Deployment Web App Google Apps Script
                </label>
                <textarea
                  id="startup-gas-url-input"
                  data-testid="startup-gas-url-input"
                  rows={3}
                  value={sheetsUrl}
                  onChange={(e) => setSheetsUrl(e.target.value)}
                  placeholder={DEFAULT_GAS_WEBAPP_URL}
                  className="w-full px-3 py-2 rounded-xl bg-white border border-slate-300 text-xs font-mono text-slate-800 break-all focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                />
                <p className="text-[11px] text-slate-500">
                  URL Deployment Web App Google Apps Script sudah terisi otomatis. Klik tombol konfirmasi untuk mengaktifkan{' '}
                  <strong>Koneksi Database Google Sheets (Sinkronisasi Penuh)</strong>.
                </p>
              </div>

              {displayError && (
                <div
                  data-testid="startup-sync-error"
                  className="rounded-xl bg-amber-50 border border-amber-200 p-3 flex items-start gap-2 text-xs text-amber-900"
                >
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{displayError}</span>
                </div>
              )}

              <div className="pt-1 flex flex-wrap items-center justify-end gap-2.5 border-t border-slate-100">
                <button
                  type="button"
                  onClick={onDismiss}
                  data-testid="btn-startup-dismiss-sheets"
                  className="px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Lewati
                </button>
                <button
                  type="button"
                  disabled={sheetsSyncing}
                  onClick={() => void handleSheetsClick()}
                  data-testid="btn-startup-confirm-sheets"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                >
                  {sheetsSyncing ? (
                    <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Database className="h-4 w-4" aria-hidden="true" />
                  )}
                  <span>
                    {sheetsSyncing
                      ? 'Menyinkronkan Google Sheets...'
                      : 'Konfirmasi & Sinkronkan Google Sheets'}
                  </span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
