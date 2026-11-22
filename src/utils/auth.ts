import type { AuthSession, TabId, UserAccount, UserRole } from '../types';

const AUTH_SESSION_KEY = 'presensiqr_auth_session_v2';
const USER_ACCOUNTS_KEY = 'presensiqr_user_accounts_v2';
const KEPSEK_SEEDED_KEY = 'presensiqr_kepsek_seeded_v1';

export const DEFAULT_USER_ACCOUNTS: UserAccount[] = [
  {
    id: 'usr_master',
    username: 'master',
    password: '123',
    nama: 'Administrator Utama',
    role: 'master_admin',
    jabatan: 'Master Admin',
  },
  {
    id: 'usr_kepsek',
    username: 'kepsek',
    password: '123',
    nama: 'Drs. H. Ahmad Hidayat, M.Pd',
    nip: '196804121995121001',
    role: 'kepala_sekolah',
    jabatan: 'Kepala Sekolah',
  },
  {
    id: 'usr_walikelas',
    username: 'walikelas',
    password: '123',
    nama: 'Budi Santoso, S.Pd',
    nip: '198705142015031002',
    role: 'wali_kelas',
    jabatan: 'Wali Kelas X IPA 1',
    kelas_binaan: 'X IPA 1',
  },
  {
    id: 'usr_guru',
    username: 'guru',
    password: '123',
    nama: 'Siti Aminah, S.Pd',
    nip: '199008212018012004',
    role: 'guru',
    jabatan: 'Guru',
  },
];

export function formatRoleLabel(role: UserRole, kelasBinaan?: string): string {
  if (role === 'master_admin') return 'Master Admin';
  if (role === 'kepala_sekolah') return 'Kepala Sekolah';
  if (role === 'wali_kelas') {
    return kelasBinaan?.trim() ? `Wali Kelas ${kelasBinaan.trim()}` : 'Wali Kelas';
  }
  return 'Guru Mata Pelajaran';
}

export function canAccessTab(role: UserRole | null, tab: TabId): boolean {
  if (role === 'kepala_sekolah') {
    return (
      tab === 'dashboard' ||
      tab === 'siswa' ||
      tab === 'rekap' ||
      tab === 'analisis'
    );
  }
  if (tab === 'scan') return true;
  if (!role) return false;
  if (role === 'master_admin') return tab !== 'daftar_pelajaran';
  if (tab === 'jadwal' || tab === 'pengaturan_jadwal' || tab === 'pengaturan') return false;
  if (role === 'wali_kelas') {
    return (
      tab === 'dashboard' ||
      tab === 'siswa' ||
      tab === 'rekap' ||
      tab === 'mapel' ||
      tab === 'daftar_pelajaran' ||
      tab === 'analisis'
    );
  }
  // Guru Mata Pelajaran: Scan QR, Daftar Pelajaran, Presensi Mapel, Rekap & Export, and Analisis
  return tab === 'daftar_pelajaran' || tab === 'mapel' || tab === 'rekap' || tab === 'analisis';
}

export function canDeleteStudents(role: UserRole | null): boolean {
  return role === 'master_admin';
}

export function canEditStudents(role: UserRole | null): boolean {
  return role === 'master_admin' || role === 'wali_kelas';
}

export function canViewStudentECard(role: UserRole | null): boolean {
  return role === 'master_admin' || role === 'wali_kelas';
}

export function canExportRecap(role: UserRole | null): boolean {
  return role === 'master_admin' || role === 'wali_kelas' || role === 'guru';
}

export function canSendParentRecap(role: UserRole | null): boolean {
  return role === 'master_admin' || role === 'wali_kelas' || role === 'guru';
}

export function canModifyRecapStatus(role: UserRole | null): boolean {
  return role === 'master_admin' || role === 'wali_kelas' || role === 'guru';
}

export function getDefaultTabForRole(role: UserRole): TabId {
  if (role === 'guru') return 'mapel';
  return 'dashboard';
}

export function authenticateUser(
  accounts: UserAccount[],
  usernameInput: string,
  passwordInput: string
): { ok: true; session: AuthSession } | { ok: false; error: string } {
  const username = usernameInput.trim().toLowerCase();
  const password = passwordInput.trim();

  if (!username || !password) {
    return { ok: false, error: 'Username dan password wajib diisi.' };
  }

  const matched = accounts.find(
    (acc) => acc.username.trim().toLowerCase() === username && acc.password === password
  );

  if (!matched) {
    return { ok: false, error: 'Username atau password tidak sesuai.' };
  }

  return {
    ok: true,
    session: {
      userId: matched.id,
      username: matched.username,
      nama: matched.nama,
      nip: matched.nip,
      role: matched.role,
      jabatan: formatRoleLabel(matched.role, matched.kelas_binaan),
      kelas_binaan: matched.kelas_binaan,
    },
  };
}

export function resetPasswordWithNip(
  accounts: UserAccount[],
  usernameInput: string,
  nipInput: string,
  newPasswordInput: string,
  confirmPasswordInput: string
):
  | { ok: true; accounts: UserAccount[]; updatedAccount: UserAccount }
  | { ok: false; error: string } {
  const username = usernameInput.trim().toLowerCase();
  const nipNormalized = nipInput.replace(/\s+/g, '').trim();
  const newPassword = newPasswordInput.trim();
  const confirmPassword = confirmPasswordInput.trim();

  if (!username) {
    return { ok: false, error: 'Username wajib diisi.' };
  }
  if (!nipNormalized) {
    return { ok: false, error: 'Konfirmasi NIP wajib diisi.' };
  }
  if (!newPassword || newPassword.length < 3) {
    return { ok: false, error: 'Password baru minimal 3 karakter.' };
  }
  if (newPassword !== confirmPassword) {
    return { ok: false, error: 'Konfirmasi password baru tidak sama.' };
  }

  const index = accounts.findIndex(
    (acc) => acc.username.trim().toLowerCase() === username
  );
  if (index === -1) {
    return { ok: false, error: `Username "${usernameInput.trim()}" tidak ditemukan.` };
  }

  const target = accounts[index];
  const storedNipNormalized = (target.nip || '').replace(/\s+/g, '').trim();
  if (!storedNipNormalized) {
    return {
      ok: false,
      error:
        'Akun ini belum memiliki NIP terdaftar. Hubungi Master Admin untuk menambahkan NIP di menu Pengaturan.',
    };
  }

  if (storedNipNormalized !== nipNormalized) {
    return {
      ok: false,
      error: 'Konfirmasi NIP tidak sesuai dengan data akun tersebut.',
    };
  }

  const updatedAccount: UserAccount = {
    ...target,
    password: newPassword,
  };
  const nextAccounts = accounts.map((acc, idx) =>
    idx === index ? updatedAccount : acc
  );

  return { ok: true, accounts: nextAccounts, updatedAccount };
}

function normalizeStoredRole(rawRole: unknown): UserRole {
  if (rawRole === 'master_admin') return 'master_admin';
  if (rawRole === 'kepala_sekolah') return 'kepala_sekolah';
  if (rawRole === 'guru') return 'guru';
  return 'wali_kelas';
}

export function loadUserAccounts(): UserAccount[] {
  try {
    const raw = localStorage.getItem(USER_ACCOUNTS_KEY);
    if (!raw) {
      localStorage.setItem(USER_ACCOUNTS_KEY, JSON.stringify(DEFAULT_USER_ACCOUNTS));
      localStorage.setItem(KEPSEK_SEEDED_KEY, '1');
      return DEFAULT_USER_ACCOUNTS;
    }
    const parsed = JSON.parse(raw) as UserAccount[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return DEFAULT_USER_ACCOUNTS;
    }
    const normalized: UserAccount[] = parsed.map((acc) => {
      const role = normalizeStoredRole(acc.role);
      const backfilledNip =
        acc.id === 'usr_walikelas' && acc.nip === undefined
          ? '198705142015031002'
          : acc.id === 'usr_guru' && acc.nip === undefined
            ? '199008212018012004'
            : acc.nip;
      return {
        ...acc,
        nip: backfilledNip,
        role,
        jabatan: formatRoleLabel(role, acc.kelas_binaan),
      };
    });

    // One-time backfill of default Kepala Sekolah account for existing installations
    if (
      !localStorage.getItem(KEPSEK_SEEDED_KEY) &&
      !normalized.some(
        (acc) => acc.role === 'kepala_sekolah' || acc.username.toLowerCase() === 'kepsek'
      )
    ) {
      const defaultKepsek = DEFAULT_USER_ACCOUNTS.find((a) => a.role === 'kepala_sekolah');
      if (defaultKepsek) {
        const masterIdx = normalized.findIndex((a) => a.role === 'master_admin');
        if (masterIdx >= 0) {
          normalized.splice(masterIdx + 1, 0, defaultKepsek);
        } else {
          normalized.unshift(defaultKepsek);
        }
        localStorage.setItem(USER_ACCOUNTS_KEY, JSON.stringify(normalized));
      }
      localStorage.setItem(KEPSEK_SEEDED_KEY, '1');
    }

    return normalized;
  } catch {
    return DEFAULT_USER_ACCOUNTS;
  }
}

export function saveUserAccounts(accounts: UserAccount[]): void {
  try {
    localStorage.setItem(USER_ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch {
    // Ignore storage errors
  }
}

export function loadAuthSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(AUTH_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSession;
    if (
      parsed &&
      parsed.username &&
      (parsed.role === 'master_admin' ||
        parsed.role === 'kepala_sekolah' ||
        parsed.role === 'wali_kelas' ||
        parsed.role === 'guru')
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveAuthSession(session: AuthSession): void {
  try {
    localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
  } catch {
    // Ignore storage errors
  }
}

export function clearAuthSession(): void {
  try {
    localStorage.removeItem(AUTH_SESSION_KEY);
  } catch {
    // Ignore storage errors
  }
}
