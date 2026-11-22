export type Gender = 'L' | 'P';

export type AttendanceStatus = 'Hadir' | 'Terlambat' | 'Sakit' | 'Izin' | 'Alpa';

export type AttendanceScheduleMode = 'masuk_saja' | 'masuk_pulang';

export type ScanActionMode = 'auto' | 'masuk' | 'pulang';

export type AppThemeId =
  | 'indigo'
  | 'emerald'
  | 'sky'
  | 'teal'
  | 'violet'
  | 'rose'
  | 'amber'
  | 'slate'
  | 'dark'
  | 'dark-indigo'
  | 'dark-emerald'
  | 'dark-violet'
  | 'dark-rose'
  | 'dark-amber';

export type RecapPeriodType = 'harian' | 'mingguan' | 'bulanan' | 'semester';

export type AnalyticsPeriodType = 'harian' | 'mingguan' | 'bulanan' | 'semester' | 'tahunan';

export type SemesterKind = 'ganjil' | 'genap';

export type DayOfWeek =
  | 'Senin'
  | 'Selasa'
  | 'Rabu'
  | 'Kamis'
  | 'Jumat'
  | 'Sabtu'
  | 'Minggu';

export interface Student {
  nis: string;
  nama: string;
  kelas: string;
  gender: Gender;
  no_wa_ortu: string;
  tahun_ajaran?: string;
}

export interface AttendanceRecord {
  id: string;
  tanggal: string; // YYYY-MM-DD
  nis: string;
  nama: string;
  kelas: string;
  jam_masuk: string; // HH:MM:SS or '-'
  jam_pulang?: string; // HH:MM:SS or '-'
  alasan_pulang_cepat?: string;
  status: AttendanceStatus;
  keterangan?: string;
  tahun_ajaran?: string;
}

export interface SchoolSettings {
  nama_sekolah: string;
  nama_kepala_sekolah?: string;
  nip_kepala_sekolah?: string;
  ttd_kepala_sekolah?: string; // Transparent PNG Data URL
  cap_sekolah?: string; // Transparent PNG Data URL
  batas_jam_masuk: string; // HH:MM
  mode_presensi: AttendanceScheduleMode;
  jam_pulang_standar: string; // HH:MM
  tahun_ajaran: string; // e.g. '2026/2027'
  semester?: SemesterKind; // 'ganjil' | 'genap'
  tema: AppThemeId;
  script_url: string;
  logo_sekolah?: string; // Data URL (PNG/JPG/SVG)
}

export interface MasterSubject {
  id: string;
  kode: string;
  nama: string;
  deskripsi?: string;
}

export interface TeacherSchedule {
  id: string;
  hari: DayOfWeek;
  teacher_user_id: string;
  teacher_name: string;
  kelas: string;
  mata_pelajaran: string;
  jam_mulai: string; // HH:MM
  jam_selesai: string; // HH:MM
  tahun_ajaran: string;
  semester?: SemesterKind;
}

export interface SubjectAssignment {
  id: string;
  teacher_user_id: string;
  teacher_name: string;
  kelas: string;
  mata_pelajaran: string;
  hari?: DayOfWeek;
  jam_mulai?: string; // Optional HH:MM
  jam_selesai?: string; // Optional HH:MM
  tahun_ajaran: string;
  semester?: SemesterKind;
  source?: 'schedule' | 'manual' | 'record';
}

export interface SubjectAttendanceRecord {
  id: string;
  assignment_id: string;
  tanggal: string; // YYYY-MM-DD
  kelas: string;
  mata_pelajaran: string;
  teacher_user_id: string;
  teacher_name: string;
  nis: string;
  nama: string;
  jam_masuk: string; // HH:MM:SS or '-'
  status: AttendanceStatus;
  keterangan?: string;
  tahun_ajaran: string;
}

export type SchoolDayCount = 5 | 6;

export interface TimetableBreak {
  id: string;
  label: string; // e.g. 'Istirahat 1', 'Istirahat 2'
  jam_mulai: string; // HH:MM
  jam_selesai: string; // HH:MM
}

export interface TimetableCellValue {
  mata_pelajaran: string;
  teacher_user_id?: string;
  teacher_name?: string;
}

export interface TimetableConfig {
  tahun_ajaran: string;
  semester: SemesterKind;
  jumlah_hari: SchoolDayCount; // 5 (Senin-Jumat) | 6 (Senin-Sabtu)
  jam_mulai_sekolah: string; // HH:MM e.g. '07:15'
  durasi_jp_menit: number; // e.g. 45
  jumlah_jp: number; // e.g. 8
  istirahat: TimetableBreak[];
  custom_classes?: string[];
  /** Key format: `${hari}|${jamKe}|${kelas}` */
  cells: Record<string, TimetableCellValue>;
  updated_at?: string;
}

export type TimetableTimeSlot =
  | {
      kind: 'lesson';
      jamKe: number;
      jam_mulai: string;
      jam_selesai: string;
    }
  | {
      kind: 'break';
      breakId: string;
      label: string;
      jam_mulai: string;
      jam_selesai: string;
    };

export type ConnectionStatus = 'connected' | 'offline' | 'syncing' | 'error';

export type TabId =
  | 'dashboard'
  | 'scan'
  | 'siswa'
  | 'rekap'
  | 'mapel'
  | 'daftar_pelajaran'
  | 'jadwal'
  | 'pengaturan_jadwal'
  | 'analisis'
  | 'pengaturan';

export type UserRole = 'master_admin' | 'kepala_sekolah' | 'wali_kelas' | 'guru';

export interface DefaultSchoolIdentity {
  nama_sekolah: string;
  logo_sekolah?: string;
}

export interface UserAccount {
  id: string;
  username: string;
  password: string;
  nama: string;
  nip?: string;
  role: UserRole;
  jabatan: string;
  kelas_binaan?: string;
}

export interface AuthSession {
  userId: string;
  username: string;
  nama: string;
  nip?: string;
  role: UserRole;
  jabatan: string;
  kelas_binaan?: string;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'warning' | 'error' | 'info';
  title: string;
  description?: string;
}
