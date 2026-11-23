import { useState } from 'react';
import { AlertTriangle, Check, Copy, ExternalLink, RefreshCw, X } from 'lucide-react';
import type { FirebaseAuthErrorDetail } from '../utils/firebaseAuthErrors';

interface FirebaseDomainHelpModalProps {
  open: boolean;
  error: FirebaseAuthErrorDetail | null;
  retrying?: boolean;
  onClose: () => void;
  onRetry: () => Promise<void> | void;
}

export function FirebaseDomainHelpModal({
  open,
  error,
  retrying = false,
  onClose,
  onRetry,
}: FirebaseDomainHelpModalProps) {
  const [copied, setCopied] = useState(false);

  if (!open || !error || !error.isUnauthorizedDomain) return null;

  const handleCopyHostname = async () => {
    try {
      await navigator.clipboard.writeText(error.hostname);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may be restricted in some embedded contexts
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="firebase-domain-modal-title"
      data-testid="modal-firebase-domain-help"
    >
      <div className="w-full max-w-lg rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h3
                id="firebase-domain-modal-title"
                className="text-sm font-bold text-slate-900 truncate"
              >
                Domain Belum Diizinkan di Firebase Auth
              </h3>
              <p className="text-[11px] font-mono text-amber-700">
                {error.code}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup panduan domain Firebase"
            className="h-8 w-8 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center shrink-0 transition-colors"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs text-slate-600 leading-relaxed">
            Login Google Firebase menolak domain saat ini karena belum terdaftar pada daftar{' '}
            <strong className="text-slate-900">Authorized domains</strong> di proyek Firebase Anda.
            Aplikasi tetap dapat digunakan dalam <strong>Mode Lokal / Offline</strong> tanpa gangguan.
          </p>

          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-1.5">
            <p className="text-[11px] font-semibold text-slate-600">
              Domain aplikasi saat ini yang perlu ditambahkan:
            </p>
            <div className="flex items-center gap-2">
              <code
                data-testid="firebase-unauthorized-hostname"
                className="flex-1 min-w-0 truncate px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs font-mono font-semibold text-slate-900"
              >
                {error.hostname}
              </code>
              <button
                type="button"
                onClick={() => void handleCopyHostname()}
                data-testid="btn-copy-firebase-hostname"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors shrink-0"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Tersalin</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Salin</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <ol className="text-xs text-slate-700 space-y-1.5 list-decimal pl-4 leading-relaxed">
            <li>
              Klik tombol <strong>Buka Firebase Console</strong> di bawah (menu{' '}
              <span className="font-mono text-[11px]">Authentication → Settings → Authorized domains</span>).
            </li>
            <li>
              Klik <strong>Add domain</strong>, tempel domain{' '}
              <span className="font-mono font-semibold text-slate-900">{error.hostname}</span>, lalu klik{' '}
              <strong>Add</strong>.
            </li>
            <li>
              Kembali ke aplikasi ini lalu klik <strong>Coba Hubungkan Lagi</strong>.
            </li>
          </ol>

          <div className="pt-1 flex flex-wrap items-center justify-between gap-2.5 border-t border-slate-100">
            <a
              href={error.consoleAuthorizedDomainsUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="link-firebase-authorized-domains"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-indigo-200 bg-indigo-50 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Buka Firebase Console</span>
            </a>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Tutup
              </button>
              <button
                type="button"
                disabled={retrying}
                onClick={() => void onRetry()}
                data-testid="btn-retry-firebase-connect"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${retrying ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>{retrying ? 'Menghubungkan...' : 'Coba Hubungkan Lagi'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
