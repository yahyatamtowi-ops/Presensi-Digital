import { useEffect, useState } from 'react';
import { Loader2, LogIn, LogOut } from 'lucide-react';
import type { SchoolSettings } from '../types';
import { DEFAULT_SCHOOL_LOGO } from '../utils/seedData';

export interface AuthTransitionState {
  mode: 'login' | 'logout';
  userName?: string;
  roleLabel?: string;
}

interface AuthLoadingOverlayProps {
  transition: AuthTransitionState | null;
  settings: SchoolSettings;
  durationMs?: number;
  onComplete: () => void;
}

export function AuthLoadingOverlay({
  transition,
  settings,
  durationMs = 5000,
  onComplete,
}: AuthLoadingOverlayProps) {
  const [secondsLeft, setSecondsLeft] = useState(Math.ceil(durationMs / 1000));

  useEffect(() => {
    if (!transition) return;

    const totalSec = Math.max(1, Math.ceil(durationMs / 1000));
    setSecondsLeft(totalSec);

    const interval = setInterval(() => {
      setSecondsLeft((prev) => (prev > 1 ? prev - 1 : 1));
    }, 1000);

    const doneTimer = setTimeout(() => {
      onComplete();
    }, durationMs);

    return () => {
      clearInterval(interval);
      clearTimeout(doneTimer);
    };
  }, [transition, durationMs, onComplete]);

  if (!transition) return null;

  const isLogin = transition.mode === 'login';

  return (
    <div
      role="status"
      aria-live="assertive"
      data-testid="auth-loading-overlay"
      className="fixed inset-0 z-[110] bg-slate-950/95 backdrop-blur-sm text-white flex flex-col items-center justify-center px-6"
    >
      <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-slate-900/90 p-8 shadow-2xl flex flex-col items-center text-center">
        <div className="relative mb-6">
          <div className="h-20 w-20 rounded-2xl bg-white/10 border border-white/15 flex items-center justify-center p-2.5 overflow-hidden">
            <img
              src={settings.logo_sekolah || DEFAULT_SCHOOL_LOGO}
              alt={`Logo ${settings.nama_sekolah}`}
              className="h-full w-full object-contain rounded-xl"
            />
          </div>
          <span className="absolute -bottom-2 -right-2 h-8 w-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-lg border border-slate-900">
            {isLogin ? (
              <LogIn className="h-4 w-4" aria-hidden="true" />
            ) : (
              <LogOut className="h-4 w-4" aria-hidden="true" />
            )}
          </span>
        </div>

        <div className="inline-flex items-center gap-2 text-indigo-300 text-xs font-semibold tracking-wider uppercase">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span>{isLogin ? 'Memuat Ruang Kerja' : 'Mengakhiri Sesi'}</span>
        </div>

        <h2 className="mt-2.5 text-lg font-bold text-white">
          {isLogin
            ? `Selamat datang, ${transition.userName || 'Pengguna'}`
            : 'Sedang Keluar dari Sistem...'}
        </h2>

        <p className="mt-1 text-xs text-slate-400">
          {isLogin
            ? `Menyiapkan akses ${transition.roleLabel || 'akun'} · TA ${settings.tahun_ajaran}`
            : 'Mengembalikan tampilan ke mode Pemindai QR Code'}
        </p>

        <div className="mt-6 w-full h-1.5 rounded-full bg-white/15 overflow-hidden">
          <div
            key={`${transition.mode}_${transition.userName || 'anon'}`}
            className="h-full w-full bg-indigo-500 animate-auth-progress"
          />
        </div>

        <p className="mt-3 text-[11px] font-mono tabular-nums text-slate-400">
          Mohon tunggu {secondsLeft} detik...
        </p>
      </div>
    </div>
  );
}
