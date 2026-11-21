import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, KeyRound, Lock, LogIn, X } from 'lucide-react';

interface LoginModalProps {
  open: boolean;
  targetHint?: string;
  onClose: () => void;
  onSubmit: (username: string, password: string) => { ok: boolean; error?: string };
  onResetPassword?: (params: {
    username: string;
    nip: string;
    newPassword: string;
    confirmPassword: string;
  }) => { ok: boolean; error?: string };
}

export function LoginModal({
  open,
  targetHint,
  onClose,
  onSubmit,
  onResetPassword,
}: LoginModalProps) {
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  // Forgot password state
  const [forgotUsername, setForgotUsername] = useState('');
  const [forgotNip, setForgotNip] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [forgotError, setForgotError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setMode('login');
      setError(null);
      setSuccessNotice(null);
      setForgotError(null);
    }
  }, [open]);

  if (!open) return null;

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSuccessNotice(null);
    const res = onSubmit(username, password);
    if (!res.ok) {
      setError(res.error || 'Login gagal.');
      return;
    }
    setError(null);
    setUsername('');
    setPassword('');
    onClose();
  }

  function handleForgotSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!onResetPassword) {
      setForgotError('Fitur reset password belum tersedia.');
      return;
    }
    const res = onResetPassword({
      username: forgotUsername,
      nip: forgotNip,
      newPassword,
      confirmPassword,
    });
    if (!res.ok) {
      setForgotError(res.error || 'Gagal mereset password.');
      return;
    }
    setForgotError(null);
    setUsername(forgotUsername.trim());
    setPassword('');
    setForgotNip('');
    setNewPassword('');
    setConfirmPassword('');
    setError(null);
    setSuccessNotice('Password berhasil diperbarui. Silakan login menggunakan password baru Anda.');
    setMode('login');
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="login-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-[1px]"
    >
      <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-md shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              {mode === 'forgot' ? (
                <KeyRound className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Lock className="h-4 w-4" aria-hidden="true" />
              )}
            </div>
            <div>
              <h2 id="login-modal-title" className="text-base font-semibold text-slate-900">
                {mode === 'forgot' ? 'Lupa Password (Konfirmasi NIP)' : 'Masuk ke Sistem'}
              </h2>
              <p className="text-xs text-slate-500">
                {mode === 'forgot'
                  ? 'Masukkan username dan NIP terdaftar untuk mengatur ulang password'
                  : targetHint
                    ? `Login diperlukan untuk mengakses ${targetHint}`
                    : 'Silakan masukkan username dan password Anda'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup modal login"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {mode === 'login' ? (
          <form onSubmit={handleFormSubmit} className="p-6 space-y-4">
            {successNotice && (
              <div
                role="status"
                className="flex items-start gap-2 p-3 rounded-xl border border-emerald-200 bg-emerald-50 text-xs font-medium text-emerald-800"
              >
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" aria-hidden="true" />
                <span>{successNotice}</span>
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-xs font-medium text-rose-700"
              >
                {error}
              </div>
            )}

            <div>
              <label htmlFor="login-username" className="block text-xs font-medium text-slate-700 mb-1">
                Username
              </label>
              <input
                id="login-username"
                type="text"
                required
                autoFocus
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Masukkan username"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="login-password" className="block text-xs font-medium text-slate-700">
                  Password
                </label>
                {onResetPassword && (
                  <button
                    type="button"
                    onClick={() => {
                      setForgotUsername(username.trim());
                      setForgotError(null);
                      setSuccessNotice(null);
                      setMode('forgot');
                    }}
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 hover:underline"
                  >
                    Lupa password?
                  </button>
                )}
              </div>
              <input
                id="login-password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Masukkan password"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            <div className="pt-1 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
              >
                <LogIn className="h-4 w-4" aria-hidden="true" />
                <span>Masuk</span>
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleForgotSubmit} className="p-6 space-y-4">
            {forgotError && (
              <div
                role="alert"
                className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-xs font-medium text-rose-700"
              >
                {forgotError}
              </div>
            )}

            <div>
              <label htmlFor="forgot-username" className="block text-xs font-medium text-slate-700 mb-1">
                Username Akun
              </label>
              <input
                id="forgot-username"
                type="text"
                required
                autoFocus
                value={forgotUsername}
                onChange={(e) => setForgotUsername(e.target.value)}
                placeholder="Contoh: walikelas"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            <div>
              <label htmlFor="forgot-nip" className="block text-xs font-medium text-slate-700 mb-1">
                Konfirmasi NIP
              </label>
              <input
                id="forgot-nip"
                type="text"
                required
                value={forgotNip}
                onChange={(e) => setForgotNip(e.target.value)}
                placeholder="Masukkan NIP terdaftar (mis. 198705142015031002)"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-mono text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="forgot-new-password" className="block text-xs font-medium text-slate-700 mb-1">
                  Password Baru
                </label>
                <input
                  id="forgot-new-password"
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimal 3 karakter"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div>
                <label htmlFor="forgot-confirm-password" className="block text-xs font-medium text-slate-700 mb-1">
                  Konfirmasi Password Baru
                </label>
                <input
                  id="forgot-confirm-password"
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Ulangi password baru"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
            </div>

            <div className="pt-1 flex items-center justify-between gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setForgotError(null);
                  setMode('login');
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Kembali ke Login</span>
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
              >
                <KeyRound className="h-4 w-4" aria-hidden="true" />
                <span>Reset Password</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
