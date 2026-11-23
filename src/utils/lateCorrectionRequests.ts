import type { AttendanceRecord, LateCorrectionRequest, LateCorrectionRequestStatus } from '../types';
import { normalizeTimeHHMM } from './attendanceLogic';

export const LATE_CORRECTION_STORAGE_KEY = 'presensiqr_late_requests_v1';

const VALID_STATUSES: ReadonlySet<LateCorrectionRequestStatus> = new Set([
  'pending',
  'approved',
  'rejected',
]);

export function sanitizeLateCorrectionRequests(
  raw: unknown
): LateCorrectionRequest[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: LateCorrectionRequest[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const id = String(obj.id ?? '').trim();
    const tanggal = String(obj.tanggal ?? '').trim();
    const nis = String(obj.nis ?? '').trim();
    const nama = String(obj.nama ?? '').trim();
    const kelas = String(obj.kelas ?? '').trim();
    const alasan = String(obj.alasan ?? '').trim();
    if (!id || !tanggal || !nis || !nama || !alasan || seen.has(id)) continue;
    seen.add(id);

    const rawStatus = String(obj.status ?? 'pending').trim() as LateCorrectionRequestStatus;
    const status: LateCorrectionRequestStatus = VALID_STATUSES.has(rawStatus)
      ? rawStatus
      : 'pending';

    out.push({
      id,
      tanggal,
      nis,
      nama,
      kelas,
      jam_masuk_asal: String(obj.jam_masuk_asal ?? '-').trim() || '-',
      alasan,
      requested_by_user_id: String(obj.requested_by_user_id ?? '').trim(),
      requested_by_name: String(obj.requested_by_name ?? 'Wali Kelas').trim() || 'Wali Kelas',
      requested_at: String(obj.requested_at ?? new Date().toISOString()).trim(),
      status,
      resolved_by_name: obj.resolved_by_name ? String(obj.resolved_by_name).trim() : undefined,
      resolved_at: obj.resolved_at ? String(obj.resolved_at).trim() : undefined,
      catatan_admin: obj.catatan_admin ? String(obj.catatan_admin).trim() : undefined,
      tahun_ajaran: String(obj.tahun_ajaran ?? '').trim(),
    });
  }
  return out.sort((a, b) => b.requested_at.localeCompare(a.requested_at));
}

export function loadLocalLateCorrectionRequests(): LateCorrectionRequest[] {
  try {
    const raw = localStorage.getItem(LATE_CORRECTION_STORAGE_KEY);
    if (!raw) return [];
    return sanitizeLateCorrectionRequests(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function saveLocalLateCorrectionRequests(
  requests: LateCorrectionRequest[]
): void {
  try {
    localStorage.setItem(LATE_CORRECTION_STORAGE_KEY, JSON.stringify(requests));
  } catch {
    // Ignore storage quota errors
  }
}

export function createLateCorrectionRequest(
  existing: LateCorrectionRequest[],
  input: {
    tanggal: string;
    nis: string;
    nama: string;
    kelas: string;
    jam_masuk_asal: string;
    alasan: string;
    requested_by_user_id: string;
    requested_by_name: string;
    tahun_ajaran: string;
    nowIso?: string;
  }
): {
  ok: boolean;
  error?: string;
  request?: LateCorrectionRequest;
  nextRequests: LateCorrectionRequest[];
} {
  const tanggal = input.tanggal.trim();
  const nis = input.nis.trim();
  const nama = input.nama.trim();
  const kelas = input.kelas.trim();
  const alasan = input.alasan.trim();

  if (!tanggal || !nis || !nama) {
    return {
      ok: false,
      error: 'Pilih siswa yang berstatus Terlambat terlebih dahulu.',
      nextRequests: existing,
    };
  }
  if (alasan.length < 5) {
    return {
      ok: false,
      error: 'Tuliskan alasan kendala perjalanan minimal 5 karakter.',
      nextRequests: existing,
    };
  }

  const nisNorm = nis.toLowerCase();
  const hasPendingDuplicate = existing.some(
    (req) =>
      req.status === 'pending' &&
      req.tanggal === tanggal &&
      req.nis.trim().toLowerCase() === nisNorm
  );
  if (hasPendingDuplicate) {
    return {
      ok: false,
      error: `Permohonan untuk ${nama} pada tanggal ${tanggal} masih menunggu konfirmasi Master Admin.`,
      nextRequests: existing,
    };
  }

  const nowIso = input.nowIso || new Date().toISOString();
  const safeNis = nis.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 32);
  const stamp = nowIso.replace(/[^0-9]+/g, '').slice(0, 14);
  const request: LateCorrectionRequest = {
    id: `lcr_${tanggal}_${safeNis}_${stamp}`,
    tanggal,
    nis,
    nama,
    kelas,
    jam_masuk_asal: input.jam_masuk_asal?.trim() || '-',
    alasan,
    requested_by_user_id: input.requested_by_user_id.trim(),
    requested_by_name: input.requested_by_name.trim() || 'Wali Kelas',
    requested_at: nowIso,
    status: 'pending',
    tahun_ajaran: input.tahun_ajaran.trim(),
  };

  return {
    ok: true,
    request,
    nextRequests: [request, ...existing],
  };
}

export function approveLateCorrectionRequest(params: {
  requests: LateCorrectionRequest[];
  records: AttendanceRecord[];
  requestId: string;
  adminName: string;
  batasJamMasuk: string;
  catatanAdmin?: string;
  nowIso?: string;
}): {
  ok: boolean;
  error?: string;
  updatedRequest?: LateCorrectionRequest;
  updatedRecord?: AttendanceRecord;
  nextRequests: LateCorrectionRequest[];
  nextRecords: AttendanceRecord[];
} {
  const { requests, records, requestId, adminName, batasJamMasuk, catatanAdmin } = params;
  const target = requests.find((r) => r.id === requestId);
  if (!target) {
    return {
      ok: false,
      error: 'Permohonan tidak ditemukan.',
      nextRequests: requests,
      nextRecords: records,
    };
  }
  if (target.status !== 'pending') {
    return {
      ok: false,
      error: 'Permohonan ini sudah diproses sebelumnya.',
      nextRequests: requests,
      nextRecords: records,
    };
  }

  const nowIso = params.nowIso || new Date().toISOString();
  const updatedRequest: LateCorrectionRequest = {
    ...target,
    status: 'approved',
    resolved_by_name: adminName.trim() || 'Master Admin',
    resolved_at: nowIso,
    catatan_admin: catatanAdmin?.trim() || 'Disetujui menjadi Hadir tepat waktu',
  };

  const nextRequests = requests.map((r) =>
    r.id === requestId ? updatedRequest : r
  );

  const nisNorm = target.nis.trim().toLowerCase();
  const normalizedCutoff = normalizeTimeHHMM(batasJamMasuk, '07:15');
  const adjustedOnTime = `${normalizedCutoff}:00`;
  const existingRecord = records.find(
    (rec) =>
      rec.tanggal === target.tanggal &&
      rec.nis.trim().toLowerCase() === nisNorm
  );

  const auditNote = `Disetujui tepat waktu oleh ${updatedRequest.resolved_by_name} (Izin Wali Kelas ${target.requested_by_name}: ${target.alasan})`;
  const updatedRecord: AttendanceRecord = existingRecord
    ? {
        ...existingRecord,
        status: 'Hadir',
        jam_masuk: adjustedOnTime,
        keterangan: auditNote,
      }
    : {
        id: `${target.tanggal}_${target.nis}`,
        tanggal: target.tanggal,
        nis: target.nis,
        nama: target.nama,
        kelas: target.kelas,
        jam_masuk: adjustedOnTime,
        jam_pulang: '-',
        status: 'Hadir',
        keterangan: auditNote,
        tahun_ajaran: target.tahun_ajaran,
      };

  const nextRecords = existingRecord
    ? records.map((rec) =>
        rec.tanggal === target.tanggal &&
        rec.nis.trim().toLowerCase() === nisNorm
          ? updatedRecord
          : rec
      )
    : [updatedRecord, ...records];

  return {
    ok: true,
    updatedRequest,
    updatedRecord,
    nextRequests,
    nextRecords,
  };
}

export function rejectLateCorrectionRequest(params: {
  requests: LateCorrectionRequest[];
  requestId: string;
  adminName: string;
  catatanAdmin?: string;
  nowIso?: string;
}): {
  ok: boolean;
  error?: string;
  updatedRequest?: LateCorrectionRequest;
  nextRequests: LateCorrectionRequest[];
} {
  const { requests, requestId, adminName, catatanAdmin } = params;
  const target = requests.find((r) => r.id === requestId);
  if (!target) {
    return {
      ok: false,
      error: 'Permohonan tidak ditemukan.',
      nextRequests: requests,
    };
  }
  if (target.status !== 'pending') {
    return {
      ok: false,
      error: 'Permohonan ini sudah diproses sebelumnya.',
      nextRequests: requests,
    };
  }

  const nowIso = params.nowIso || new Date().toISOString();
  const updatedRequest: LateCorrectionRequest = {
    ...target,
    status: 'rejected',
    resolved_by_name: adminName.trim() || 'Master Admin',
    resolved_at: nowIso,
    catatan_admin: catatanAdmin?.trim() || 'Permohonan ditolak oleh Master Admin',
  };

  return {
    ok: true,
    updatedRequest,
    nextRequests: requests.map((r) => (r.id === requestId ? updatedRequest : r)),
  };
}

export function getPendingLateCorrectionRequests(
  requests: LateCorrectionRequest[]
): LateCorrectionRequest[] {
  return requests
    .filter((r) => r.status === 'pending')
    .sort((a, b) => b.requested_at.localeCompare(a.requested_at));
}
