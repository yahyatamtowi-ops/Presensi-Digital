import { useRef, useState } from 'react';
import { Camera, CheckCircle2, Trash2, Upload, User } from 'lucide-react';
import type { AuthSession } from '../types';

interface ProfilePhotoSettingsViewProps {
  session: AuthSession;
  onUpdateProfilePhoto: (photoDataUrl: string | undefined) => Promise<void> | void;
}

const MAX_RAW_FILE_BYTES = 10 * 1024 * 1024; // 10 MB before client-side resize
const TARGET_AVATAR_PX = 256;

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function resizeImageToSquareDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
    reader.onload = () => {
      const rawUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!rawUrl) {
        reject(new Error('Data gambar tidak valid.'));
        return;
      }

      const img = new Image();
      img.onerror = () => reject(new Error('File bukan gambar yang dapat diproses.'));
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = TARGET_AVATAR_PX;
          canvas.height = TARGET_AVATAR_PX;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Browser tidak mendukung pemrosesan gambar.'));
            return;
          }

          // Center-crop to square
          const srcW = img.naturalWidth || img.width;
          const srcH = img.naturalHeight || img.height;
          const side = Math.min(srcW, srcH);
          const sx = Math.max(0, (srcW - side) / 2);
          const sy = Math.max(0, (srcH - side) / 2);

          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, TARGET_AVATAR_PX, TARGET_AVATAR_PX);
          ctx.drawImage(img, sx, sy, side, side, 0, 0, TARGET_AVATAR_PX, TARGET_AVATAR_PX);

          let dataUrl = canvas.toDataURL('image/jpeg', 0.84);
          if (dataUrl.length > 120000) {
            dataUrl = canvas.toDataURL('image/jpeg', 0.68);
          }
          resolve(dataUrl);
        } catch {
          reject(new Error('Gagal mengompresi foto profil.'));
        }
      };
      img.src = rawUrl;
    };
    reader.readAsDataURL(file);
  });
}

export function ProfilePhotoSettingsView({
  session,
  onUpdateProfilePhoto,
}: ProfilePhotoSettingsViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  async function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setError(null);
    setSavedNotice(null);

    if (!file.type.startsWith('image/')) {
      setError('Format file harus berupa gambar (JPG, PNG, atau WEBP).');
      return;
    }
    if (file.size > MAX_RAW_FILE_BYTES) {
      setError('Ukuran file terlalu besar. Pilih foto dengan ukuran maksimal 10 MB.');
      return;
    }

    setBusy(true);
    try {
      const optimizedDataUrl = await resizeImageToSquareDataUrl(file);
      await onUpdateProfilePhoto(optimizedDataUrl);
      setSavedNotice('Foto profil berhasil diperbarui dan ditampilkan di panel kiri.');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Gagal mengunggah foto profil.'
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleRemovePhoto() {
    setError(null);
    setSavedNotice(null);
    setBusy(true);
    try {
      await onUpdateProfilePhoto(undefined);
      setSavedNotice('Foto profil telah dihapus.');
    } catch {
      setError('Gagal menghapus foto profil.');
    } finally {
      setBusy(false);
    }
  }

  const hasPhoto = Boolean(session.foto_profil?.trim());

  return (
    <div
      data-testid="profile-photo-settings"
      className="max-w-2xl mx-auto space-y-5"
    >
      <section className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
            <Camera className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">
              Upload Foto Profil
            </h2>
            <p className="text-xs text-slate-500">
              Foto profil akan ditampilkan di bagian kiri atas nama Anda pada menu navigasi.
            </p>
          </div>
        </div>

        <div className="p-6 space-y-6">
          <div className="flex flex-col sm:flex-row items-center gap-6">
            {/* Avatar Preview */}
            <div className="relative shrink-0">
              {hasPhoto ? (
                <img
                  src={session.foto_profil}
                  alt={`Foto profil ${session.nama}`}
                  data-testid="profile-photo-preview"
                  className="h-28 w-28 rounded-full object-cover border-4 border-indigo-100 shadow-sm bg-slate-100"
                />
              ) : (
                <div
                  data-testid="profile-photo-placeholder"
                  className="h-28 w-28 rounded-full bg-indigo-50 border-4 border-indigo-100 text-indigo-700 flex flex-col items-center justify-center shadow-sm"
                >
                  <User className="h-8 w-8 mb-0.5 opacity-75" aria-hidden="true" />
                  <span className="text-xs font-bold tracking-wide">
                    {getInitials(session.nama)}
                  </span>
                </div>
              )}
            </div>

            {/* Identity & Upload Controls */}
            <div className="flex-1 min-w-0 text-center sm:text-left space-y-3">
              <div>
                <p className="text-base font-semibold text-slate-900 truncate">
                  {session.nama}
                </p>
                <p className="text-xs font-medium text-indigo-600">
                  {session.jabatan}
                </p>
                {session.nip && (
                  <p className="text-xs text-slate-500 mt-0.5">
                    NIP: {session.nip}
                  </p>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                data-testid="profile-photo-input"
                onChange={handleFileSelected}
                className="sr-only"
                aria-label="Pilih file foto profil"
              />

              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2.5 pt-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="profile-photo-upload-btn"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors cursor-pointer"
                >
                  <Upload className="h-4 w-4" aria-hidden="true" />
                  <span>
                    {busy
                      ? 'Memproses...'
                      : hasPhoto
                        ? 'Ganti Foto Profil'
                        : 'Upload Foto Profil'}
                  </span>
                </button>

                {hasPhoto && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleRemovePhoto}
                    data-testid="profile-photo-remove-btn"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-sm font-medium hover:bg-rose-100 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    <span>Hapus Foto</span>
                  </button>
                )}
              </div>

              <p className="text-xs text-slate-500">
                Format JPG, PNG, atau WEBP. Gambar otomatis disesuaikan berbentuk persegi dan dikompresi agar cepat dimuat.
              </p>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="p-3.5 rounded-xl border border-rose-200 bg-rose-50 text-xs font-medium text-rose-700"
            >
              {error}
            </div>
          )}

          {savedNotice && (
            <div
              role="status"
              className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50 text-xs font-medium text-emerald-700 flex items-center gap-2"
            >
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{savedNotice}</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
