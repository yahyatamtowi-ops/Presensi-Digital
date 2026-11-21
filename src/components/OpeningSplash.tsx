import { useEffect, useState } from 'react';
import { QrCode } from 'lucide-react';
import type { SchoolSettings } from '../types';

interface OpeningSplashProps {
  settings: SchoolSettings;
  onFinish: () => void;
}

export function OpeningSplash({ settings, onFinish }: OpeningSplashProps) {
  const [fadingOut, setFadingOut] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFadingOut(true), 1750);
    const doneTimer = setTimeout(() => onFinish(), 2150);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(doneTimer);
    };
  }, [onFinish]);

  return (
    <div
      role="status"
      aria-label={`Memuat Presensi Digital Siswa ${settings.nama_sekolah}`}
      className={`fixed inset-0 z-[100] bg-slate-950 text-white flex flex-col items-center justify-center px-6 transition-opacity duration-400 ${
        fadingOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      <div className="animate-splash-rise flex flex-col items-center text-center max-w-xl">
        <div className="h-20 w-20 rounded-2xl bg-white/10 border border-white/15 flex items-center justify-center p-2.5 mb-6 shadow-2xl overflow-hidden">
          {settings.logo_sekolah ? (
            <img
              src={settings.logo_sekolah}
              alt={`Logo ${settings.nama_sekolah}`}
              className="h-full w-full object-contain rounded-xl"
            />
          ) : (
            <QrCode className="h-10 w-10 text-indigo-400" aria-hidden="true" />
          )}
        </div>

        <p className="text-xs sm:text-sm font-semibold tracking-[0.22em] text-indigo-300 uppercase">
          PRESENSI DIGITAL SISWA
        </p>
        <h1 className="mt-2.5 text-2xl sm:text-4xl font-bold tracking-tight text-white uppercase [text-wrap:balance]">
          {settings.nama_sekolah}
        </h1>

        <div className="mt-8 w-56 h-1 rounded-full bg-white/15 overflow-hidden">
          <div className="h-full w-full bg-indigo-500 animate-splash-progress" />
        </div>

        <button
          type="button"
          onClick={onFinish}
          className="mt-6 text-xs font-medium text-slate-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg"
        >
          Lewati animasi
        </button>
      </div>
    </div>
  );
}
