import type { AttendanceRecord, SchoolSettings, Student } from '../types';
import { getTodayDateString, shiftDateString } from './attendanceLogic';

export const DEFAULT_APP_NAME = 'Presensi Digital';
export const DEFAULT_SCHOOL_NAME = 'SMA Negeri 1 Kabun';
export const DEFAULT_SCHOOL_LOGO = '/assets/aistudio/LOGO_SMANSA_3D_d5e941c9.png';
export const DEFAULT_ACADEMIC_YEAR = '2026/2027';

export const SEED_SETTINGS: SchoolSettings = {
  nama_sekolah: DEFAULT_SCHOOL_NAME,
  nama_kepala_sekolah: '',
  nip_kepala_sekolah: '',
  ttd_kepala_sekolah: '',
  cap_sekolah: '',
  batas_jam_masuk: '07:15',
  mode_presensi: 'masuk_saja',
  jam_pulang_standar: '15:00',
  tahun_ajaran: DEFAULT_ACADEMIC_YEAR,
  semester: 'ganjil',
  tema: 'indigo',
  script_url: '',
  logo_sekolah: DEFAULT_SCHOOL_LOGO,
};

export const SEED_STUDENTS: Student[] = [
  {
    nis: '2026001',
    nama: 'Ahmad Fauzi Pratama',
    kelas: 'X IPA 1',
    gender: 'L',
    no_wa_ortu: '081234567801',
    tahun_ajaran: DEFAULT_ACADEMIC_YEAR,
  },
  {
    nis: '2026002',
    nama: 'Aisyah Putri Lestari',
    kelas: 'X IPA 1',
    gender: 'P',
    no_wa_ortu: '081234567802',
    tahun_ajaran: DEFAULT_ACADEMIC_YEAR,
  },
  {
    nis: '2026003',
    nama: 'Bagas Saputra',
    kelas: 'X IPA 1',
    gender: 'L',
    no_wa_ortu: '081234567803',
    tahun_ajaran: DEFAULT_ACADEMIC_YEAR,
  },
  {
    nis: '2026004',
    nama: 'Citra Dewi Anggraini',
    kelas: 'X IPA 2',
    gender: 'P',
    no_wa_ortu: '081234567804',
    tahun_ajaran: DEFAULT_ACADEMIC_YEAR,
  },
  {
    nis: '2026005',
    nama: 'Dimas Ramadhan',
    kelas: 'X IPA 2',
    gender: 'L',
    no_wa_ortu: '081234567805',
    tahun_ajaran: DEFAULT_ACADEMIC_YEAR,
  },
  {
    nis: '2026006',
    nama: 'Elena Kusuma Wardani',
    kelas: 'XI IPA 1',
    gender: 'P',
    no_wa_ortu: '081234567806',
    tahun_ajaran: DEFAULT_ACADEMIC_YEAR,
  },
  {
    nis: '2026007',
    nama: 'Farhan Rizky Maulana',
    kelas: 'XI IPA 1',
    gender: 'L',
    no_wa_ortu: '081234567807',
    tahun_ajaran: DEFAULT_ACADEMIC_YEAR,
  },
  {
    nis: '2026008',
    nama: 'Gita Cahyani',
    kelas: 'XI IPA 1',
    gender: 'P',
    no_wa_ortu: '081234567808',
    tahun_ajaran: DEFAULT_ACADEMIC_YEAR,
  },
  {
    nis: '2026009',
    nama: 'Hendra Wijaya',
    kelas: 'XII IPS 1',
    gender: 'L',
    no_wa_ortu: '081234567809',
    tahun_ajaran: DEFAULT_ACADEMIC_YEAR,
  },
  {
    nis: '2026010',
    nama: 'Intan Permatasari',
    kelas: 'XII IPS 1',
    gender: 'P',
    no_wa_ortu: '081234567810',
    tahun_ajaran: DEFAULT_ACADEMIC_YEAR,
  },
  {
    nis: '2026011',
    nama: 'Kevin Ardiansyah',
    kelas: 'XII IPS 1',
    gender: 'L',
    no_wa_ortu: '081234567811',
    tahun_ajaran: DEFAULT_ACADEMIC_YEAR,
  },
  {
    nis: '2026012',
    nama: 'Nadia Safitri',
    kelas: 'X IPA 2',
    gender: 'P',
    no_wa_ortu: '081234567812',
    tahun_ajaran: DEFAULT_ACADEMIC_YEAR,
  },
];

export function generateSeedRecords(
  today: string = getTodayDateString(),
  academicYear: string = DEFAULT_ACADEMIC_YEAR
): AttendanceRecord[] {
  const records: AttendanceRecord[] = [
    {
      id: `${today}_2026001`,
      tanggal: today,
      nis: '2026001',
      nama: 'Ahmad Fauzi Pratama',
      kelas: 'X IPA 1',
      jam_masuk: '06:54:12',
      status: 'Hadir',
      keterangan: 'Tepat waktu',
      tahun_ajaran: academicYear,
    },
    {
      id: `${today}_2026002`,
      tanggal: today,
      nis: '2026002',
      nama: 'Aisyah Putri Lestari',
      kelas: 'X IPA 1',
      jam_masuk: '07:02:45',
      status: 'Hadir',
      keterangan: 'Tepat waktu',
      tahun_ajaran: academicYear,
    },
    {
      id: `${today}_2026003`,
      tanggal: today,
      nis: '2026003',
      nama: 'Bagas Saputra',
      kelas: 'X IPA 1',
      jam_masuk: '07:21:08',
      status: 'Terlambat',
      keterangan: 'Melewati batas jam masuk',
      tahun_ajaran: academicYear,
    },
    {
      id: `${today}_2026004`,
      tanggal: today,
      nis: '2026004',
      nama: 'Citra Dewi Anggraini',
      kelas: 'X IPA 2',
      jam_masuk: '06:58:30',
      status: 'Hadir',
      keterangan: 'Tepat waktu',
      tahun_ajaran: academicYear,
    },
    {
      id: `${today}_2026006`,
      tanggal: today,
      nis: '2026006',
      nama: 'Elena Kusuma Wardani',
      kelas: 'XI IPA 1',
      jam_masuk: '07:09:19',
      status: 'Hadir',
      keterangan: 'Tepat waktu',
      tahun_ajaran: academicYear,
    },
    {
      id: `${today}_2026007`,
      tanggal: today,
      nis: '2026007',
      nama: 'Farhan Rizky Maulana',
      kelas: 'XI IPA 1',
      jam_masuk: '-',
      status: 'Sakit',
      keterangan: 'Surat keterangan dokter',
      tahun_ajaran: academicYear,
    },
    {
      id: `${today}_2026009`,
      tanggal: today,
      nis: '2026009',
      nama: 'Hendra Wijaya',
      kelas: 'XII IPS 1',
      jam_masuk: '07:28:51',
      status: 'Terlambat',
      keterangan: 'Melewati batas jam masuk',
      tahun_ajaran: academicYear,
    },
    {
      id: `${today}_2026010`,
      tanggal: today,
      nis: '2026010',
      nama: 'Intan Permatasari',
      kelas: 'XII IPS 1',
      jam_masuk: '-',
      status: 'Izin',
      keterangan: 'Izin lomba olimpiade',
      tahun_ajaran: academicYear,
    },
  ];

  const patterns: Array<{ hadir: number; terlambat: number; sakit: number }> = [
    { hadir: 10, terlambat: 1, sakit: 1 },
    { hadir: 9, terlambat: 2, sakit: 1 },
    { hadir: 11, terlambat: 1, sakit: 0 },
    { hadir: 8, terlambat: 2, sakit: 2 },
    { hadir: 10, terlambat: 2, sakit: 0 },
    { hadir: 9, terlambat: 1, sakit: 2 },
  ];

  for (let dayOffset = 1; dayOffset <= 6; dayOffset++) {
    const dt = shiftDateString(today, -dayOffset);
    const pat = patterns[dayOffset - 1];
    SEED_STUDENTS.forEach((student, idx) => {
      let status: AttendanceRecord['status'] = 'Hadir';
      let jam_masuk = `07:0${idx % 9}:15`;
      if (idx >= pat.hadir && idx < pat.hadir + pat.terlambat) {
        status = 'Terlambat';
        jam_masuk = `07:2${idx % 5}:40`;
      } else if (idx >= pat.hadir + pat.terlambat) {
        status = idx % 2 === 0 ? 'Sakit' : 'Alpa';
        jam_masuk = '-';
      }
      records.push({
        id: `${dt}_${student.nis}`,
        tanggal: dt,
        nis: student.nis,
        nama: student.nama,
        kelas: student.kelas,
        jam_masuk,
        status,
        tahun_ajaran: academicYear,
      });
    });
  }

  return records;
}
