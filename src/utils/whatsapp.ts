import { formatIndonesianDate } from './attendanceLogic';

export function normalizeIndonesianPhone(rawPhone: string): string {
  const digits = rawPhone.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) {
    return `62${digits.slice(1)}`;
  }
  if (digits.startsWith('62')) {
    return digits;
  }
  if (digits.startsWith('8')) {
    return `62${digits}`;
  }
  return digits;
}

export function buildParentAttendanceMessage(params: {
  namaSekolah: string;
  tanggal: string;
  namaSiswa: string;
  nis: string;
  kelas: string;
  jamMasuk: string;
  jamPulang?: string;
  status: string;
  keterangan?: string;
  catatanTambahan?: string;
}): string {
  const formattedDate = formatIndonesianDate(params.tanggal);
  const lines = [
    `*Laporan Kehadiran Siswa — ${params.namaSekolah}*`,
    '',
    'Yth. Bapak/Ibu Orang Tua/Wali dari:',
    `• Nama: *${params.namaSiswa}*`,
    `• NIS: ${params.nis}`,
    `• Kelas: ${params.kelas}`,
    `• Tanggal: ${formattedDate}`,
    `• Status: *${params.status}*`,
    `• Jam Masuk: ${params.jamMasuk && params.jamMasuk !== '-' ? `${params.jamMasuk} WIB` : '-'}`,
  ];

  if (params.jamPulang && params.jamPulang !== '-') {
    lines.push(`• Jam Pulang: ${params.jamPulang} WIB`);
  }

  if (params.keterangan && params.keterangan.trim()) {
    lines.push(`• Keterangan: ${params.keterangan.trim()}`);
  }
  if (params.catatanTambahan && params.catatanTambahan.trim()) {
    lines.push('', `Catatan Guru/Wali Kelas: ${params.catatanTambahan.trim()}`);
  }

  lines.push('', 'Terima kasih atas perhatian Bapak/Ibu.');
  return lines.join('\n');
}

export function buildWhatsAppUrl(rawPhone: string, message: string): string | null {
  const normalized = normalizeIndonesianPhone(rawPhone);
  if (!normalized || normalized.length < 9) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}
