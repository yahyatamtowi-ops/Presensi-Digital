import {
  CheckCircle2,
  Clock,
  FileText,
  HeartPulse,
  MinusCircle,
  XCircle,
} from 'lucide-react';
import type { AttendanceStatus } from '../types';

interface StatusBadgeProps {
  status: AttendanceStatus | 'Belum Presensi' | 'Belum Absen';
  size?: 'sm' | 'md';
}

const STATUS_STYLES: Record<
  AttendanceStatus | 'Belum Presensi',
  { bg: string; text: string; border: string; Icon: typeof CheckCircle2 }
> = {
  Hadir: {
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
    Icon: CheckCircle2,
  },
  Terlambat: {
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-200',
    Icon: Clock,
  },
  Sakit: {
    bg: 'bg-sky-50',
    text: 'text-sky-700',
    border: 'border-sky-200',
    Icon: HeartPulse,
  },
  Izin: {
    bg: 'bg-sky-50',
    text: 'text-sky-700',
    border: 'border-sky-200',
    Icon: FileText,
  },
  Alpa: {
    bg: 'bg-rose-50',
    text: 'text-rose-700',
    border: 'border-rose-200',
    Icon: XCircle,
  },
  'Belum Presensi': {
    bg: 'bg-slate-100',
    text: 'text-slate-600',
    border: 'border-slate-200',
    Icon: MinusCircle,
  },
};

export function StatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  const normalizedStatus: AttendanceStatus | 'Belum Presensi' =
    status === 'Belum Absen' ? 'Belum Presensi' : status;
  const cfg = STATUS_STYLES[normalizedStatus] ?? STATUS_STYLES['Belum Presensi'];
  const { Icon } = cfg;
  const padding = size === 'sm' ? 'px-2.5 py-0.5 text-xs' : 'px-3 py-1 text-sm';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border font-medium whitespace-nowrap ${cfg.bg} ${cfg.text} ${cfg.border} ${padding}`}
    >
      <Icon className={size === 'sm' ? 'h-3.5 w-3.5 shrink-0' : 'h-4 w-4 shrink-0'} aria-hidden="true" />
      <span>{normalizedStatus}</span>
    </span>
  );
}
