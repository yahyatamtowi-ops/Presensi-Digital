import { AlertTriangle, BellRing, Check, Clock, HardDrive, X } from 'lucide-react';
import type { LateCorrectionRequest } from '../types';
import type { StorageAlertItem } from '../utils/storageHealth';

interface AdminStorageAlertBannerProps {
  alerts: StorageAlertItem[];
  onOpenStorageBackup?: () => void;
}

export function AdminStorageAlertBanner({
  alerts,
  onOpenStorageBackup,
}: AdminStorageAlertBannerProps) {
  if (alerts.length === 0) return null;

  const hasCritical = alerts.some((a) => a.severity === 'critical');

  return (
    <section
      role="alert"
      aria-label="Peringatan kapasitas penyimpanan aplikasi"
      data-testid="admin-storage-alert-bar"
      className={`mb-5 bg-white rounded-2xl border shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden ${
        hasCritical ? 'border-rose-300' : 'border-amber-300'
      }`}
    >
      <div
        className={`px-4 sm:px-5 py-3.5 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
          hasCritical
            ? 'bg-rose-50/80 border-rose-200/80'
            : 'bg-amber-50/80 border-amber-200/80'
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`h-8 w-8 rounded-xl flex items-center justify-center shrink-0 ${
              hasCritical
                ? 'bg-rose-100 text-rose-700'
                : 'bg-amber-100 text-amber-700'
            }`}
          >
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 truncate">
              {hasCritical
                ? 'Peringatan Kritis: Penyimpanan Aplikasi Hampir Penuh'
                : 'Peringatan Penyimpanan Aplikasi'}
            </h2>
            <p className="text-xs text-slate-600 truncate">
              {alerts.length} peringatan storage terdeteksi — segera backup atau hapus data presensi tahun ajaran lama
            </p>
          </div>
        </div>

        {onOpenStorageBackup && (
          <button
            type="button"
            data-testid="btn-goto-storage-backup"
            onClick={onOpenStorageBackup}
            className={`inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 ${
              hasCritical
                ? 'bg-rose-600 hover:bg-rose-700'
                : 'bg-amber-600 hover:bg-amber-700'
            }`}
          >
            <HardDrive className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Buka Backup &amp; Reset</span>
          </button>
        )}
      </div>

      <ul className="divide-y divide-slate-100">
        {alerts.map((alert) => {
          const isCritical = alert.severity === 'critical';
          return (
            <li
              key={alert.id}
              data-testid={`storage-alert-item-${alert.id}`}
              className="px-4 sm:px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
            >
              <div className="min-w-0 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                      isCritical
                        ? 'bg-rose-100 text-rose-800 border border-rose-200'
                        : 'bg-amber-100 text-amber-800 border border-amber-200'
                    }`}
                  >
                    {isCritical ? 'Kritis' : 'Peringatan'}
                  </span>
                  <span className="text-xs font-semibold text-slate-900">
                    {alert.title}
                  </span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {alert.message}
                </p>
              </div>
              {typeof alert.percent === 'number' && (
                <span
                  className={`font-mono tabular-nums text-xs font-bold px-2.5 py-1 rounded-lg shrink-0 self-start sm:self-center ${
                    isCritical
                      ? 'bg-rose-50 text-rose-700 border border-rose-200'
                      : 'bg-amber-50 text-amber-800 border border-amber-200'
                  }`}
                >
                  {alert.percent}% terpakai
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface AdminNotificationBarProps {
  requests: LateCorrectionRequest[];
  expanded: boolean;
  onClose?: () => void;
  onApprove: (requestId: string) => void;
  onReject: (requestId: string) => void;
}

export function AdminNotificationBar({
  requests,
  expanded,
  onClose,
  onApprove,
  onReject,
}: AdminNotificationBarProps) {
  if (requests.length === 0 && !expanded) {
    return null;
  }

  return (
    <section
      aria-label="Notifikasi permohonan ubah kehadiran tepat waktu"
      data-testid="admin-late-request-notif-bar"
      className="mb-5 bg-white rounded-2xl border border-amber-200/90 shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden"
    >
      <div className="px-4 sm:px-5 py-3.5 bg-amber-50/60 border-b border-amber-100 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-8 w-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
            <BellRing className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 truncate">
              Notifikasi Permohonan Ubah Kehadiran Tepat Waktu
            </h2>
            <p className="text-xs text-slate-600 truncate">
              {requests.length > 0
                ? `${requests.length} permohonan dari Wali Kelas menunggu konfirmasi Master Admin`
                : 'Belum ada permohonan baru yang menunggu konfirmasi'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {requests.length > 0 && (
            <span
              data-testid="admin-notif-pending-count"
              className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold font-mono tabular-nums bg-amber-100 text-amber-800 border border-amber-200"
            >
              {requests.length} Menunggu
            </span>
          )}
          {onClose && requests.length === 0 && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup bilah notifikasi"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-amber-100/60 transition-colors"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {requests.length === 0 ? (
        <div className="px-5 py-5 text-xs text-slate-500">
          Semua permohonan dispensasi keterlambatan dari Wali Kelas telah diproses.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {requests.map((req) => (
            <li
              key={req.id}
              data-testid={`admin-notif-item-${req.nis}`}
              className="px-4 sm:px-5 py-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3 hover:bg-slate-50/60 transition-colors"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <span className="text-sm font-semibold text-slate-900">{req.nama}</span>
                  <span className="font-mono tabular-nums text-xs text-slate-500">
                    NISN {req.nis}
                  </span>
                  <span className="text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200/70 px-2 py-0.5 rounded-md">
                    {req.kelas}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs font-mono tabular-nums text-amber-700 bg-amber-50 border border-amber-200/70 px-2 py-0.5 rounded-md">
                    <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
                    {req.tanggal} · Masuk {req.jam_masuk_asal}
                  </span>
                </div>
                <p className="text-xs text-slate-700 leading-relaxed">
                  <span className="font-semibold text-slate-800">Alasan:</span> {req.alasan}
                </p>
                <p className="text-[11px] text-slate-500">
                  Diajukan oleh Wali Kelas:{' '}
                  <span className="font-medium text-slate-700">{req.requested_by_name}</span>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  data-testid="btn-approve-late-request"
                  onClick={() => onApprove(req.id)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors whitespace-nowrap"
                >
                  <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>Setujui (Ubah ke Hadir)</span>
                </button>
                <button
                  type="button"
                  data-testid="btn-reject-late-request"
                  onClick={() => onReject(req.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-rose-200 bg-white text-rose-700 text-xs font-semibold hover:bg-rose-50 transition-colors whitespace-nowrap"
                >
                  <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>Tolak</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
