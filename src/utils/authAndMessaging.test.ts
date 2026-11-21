import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authenticateUser,
  canAccessTab,
  canDeleteStudents,
  canEditStudents,
  canExportRecap,
  canModifyRecapStatus,
  canSendParentRecap,
  canViewStudentECard,
  DEFAULT_USER_ACCOUNTS,
  getDefaultTabForRole,
  resetPasswordWithNip,
} from './auth';
import {
  normalizeSheetDateString,
  sanitizeRecords,
  sanitizeStudents,
  validateGasScriptUrl,
} from './gasApi';
import { parseStudentSheetRows } from './importExport';
import {
  buildParentAttendanceMessage,
  buildWhatsAppUrl,
  normalizeIndonesianPhone,
} from './whatsapp';
import {
  buildBackupFilename,
  createAppBackupPayload,
  parseAndValidateBackupJson,
} from './backupStorage';
import { SEED_SETTINGS } from './seedData';
import { RECAP_PDF_F4_CONFIG, getRecapPdfColumns } from './recapPdf';
import { getECardLayoutMetrics } from './ecardPdf';
import { THEME_PRESETS, isDarkTheme, normalizeThemeId } from './themes';
import { buildWelcomeGreetingText } from './sound';
import type { Student } from '../types';

test('RBAC separates guest, guru (Mapel/Rekap/Analisis), wali_kelas (operational + Mapel), and master_admin', () => {
  assert.equal(canAccessTab(null, 'scan'), true);
  assert.equal(canAccessTab(null, 'dashboard'), false);
  assert.equal(canAccessTab(null, 'siswa'), false);
  assert.equal(canAccessTab(null, 'rekap'), false);
  assert.equal(canAccessTab(null, 'mapel'), false);
  assert.equal(canAccessTab(null, 'analisis'), false);
  assert.equal(canAccessTab(null, 'jadwal'), false);
  assert.equal(canAccessTab(null, 'pengaturan'), false);

  // Guru Mata Pelajaran: Scan QR, Presensi Mapel, Rekap & Export, and Analisis
  assert.equal(canAccessTab('guru', 'scan'), true);
  assert.equal(canAccessTab('guru', 'mapel'), true);
  assert.equal(canAccessTab('guru', 'rekap'), true);
  assert.equal(canAccessTab('guru', 'analisis'), true);
  assert.equal(canAccessTab('guru', 'dashboard'), false);
  assert.equal(canAccessTab('guru', 'siswa'), false);
  assert.equal(canAccessTab('guru', 'jadwal'), false);
  assert.equal(canAccessTab('guru', 'pengaturan'), false);
  assert.equal(getDefaultTabForRole('guru'), 'mapel');

  // Wali Kelas: Scan QR, Dashboard, Siswa, Rekap, Presensi Mapel, Analisis (no Jadwal / Pengaturan)
  assert.equal(canAccessTab('wali_kelas', 'scan'), true);
  assert.equal(canAccessTab('wali_kelas', 'dashboard'), true);
  assert.equal(canAccessTab('wali_kelas', 'siswa'), true);
  assert.equal(canAccessTab('wali_kelas', 'rekap'), true);
  assert.equal(canAccessTab('wali_kelas', 'mapel'), true);
  assert.equal(canAccessTab('wali_kelas', 'analisis'), true);
  assert.equal(canAccessTab('wali_kelas', 'jadwal'), false);
  assert.equal(canAccessTab('wali_kelas', 'pengaturan'), false);
  assert.equal(getDefaultTabForRole('wali_kelas'), 'dashboard');

  // Master Admin: everywhere including Mapel & Jadwal
  assert.equal(canAccessTab('master_admin', 'mapel'), true);
  assert.equal(canAccessTab('master_admin', 'jadwal'), true);
  assert.equal(canAccessTab('master_admin', 'analisis'), true);
  assert.equal(canAccessTab('master_admin', 'pengaturan'), true);
  assert.equal(getDefaultTabForRole('master_admin'), 'dashboard');

  // Kepala Sekolah: ONLY Dashboard, Data Siswa (read-only, no E-Card), Rekap (read-only, no Export/Unduh/WA), Analisis
  assert.equal(canAccessTab('kepala_sekolah', 'dashboard'), true);
  assert.equal(canAccessTab('kepala_sekolah', 'siswa'), true);
  assert.equal(canAccessTab('kepala_sekolah', 'rekap'), true);
  assert.equal(canAccessTab('kepala_sekolah', 'analisis'), true);
  assert.equal(canAccessTab('kepala_sekolah', 'scan'), false);
  assert.equal(canAccessTab('kepala_sekolah', 'mapel'), false);
  assert.equal(canAccessTab('kepala_sekolah', 'jadwal'), false);
  assert.equal(canAccessTab('kepala_sekolah', 'pengaturan'), false);
  assert.equal(getDefaultTabForRole('kepala_sekolah'), 'dashboard');

  // Student delete authority: only Master Admin; edit authority: Master Admin & Wali Kelas
  assert.equal(canDeleteStudents('master_admin'), true);
  assert.equal(canDeleteStudents('wali_kelas'), false);
  assert.equal(canDeleteStudents('guru'), false);
  assert.equal(canDeleteStudents('kepala_sekolah'), false);
  assert.equal(canDeleteStudents(null), false);

  assert.equal(canEditStudents('master_admin'), true);
  assert.equal(canEditStudents('wali_kelas'), true);
  assert.equal(canEditStudents('guru'), false);
  assert.equal(canEditStudents('kepala_sekolah'), false);
  assert.equal(canEditStudents(null), false);

  // Kepala Sekolah cannot view/print E-Card, export/download Recap, send parent WA, or modify Recap status
  assert.equal(canViewStudentECard('master_admin'), true);
  assert.equal(canViewStudentECard('wali_kelas'), true);
  assert.equal(canViewStudentECard('kepala_sekolah'), false);
  assert.equal(canViewStudentECard(null), false);

  assert.equal(canExportRecap('master_admin'), true);
  assert.equal(canExportRecap('wali_kelas'), true);
  assert.equal(canExportRecap('guru'), true);
  assert.equal(canExportRecap('kepala_sekolah'), false);

  assert.equal(canSendParentRecap('master_admin'), true);
  assert.equal(canSendParentRecap('wali_kelas'), true);
  assert.equal(canSendParentRecap('kepala_sekolah'), false);

  assert.equal(canModifyRecapStatus('master_admin'), true);
  assert.equal(canModifyRecapStatus('wali_kelas'), true);
  assert.equal(canModifyRecapStatus('kepala_sekolah'), false);
});

test('authenticateUser validates Master Admin, Kepala Sekolah, Wali Kelas (with NIP), and Guru credentials properly', () => {
  const masterRes = authenticateUser(DEFAULT_USER_ACCOUNTS, 'master', '123');
  assert.equal(masterRes.ok, true);
  if (masterRes.ok) {
    assert.equal(masterRes.session.role, 'master_admin');
  }

  const kepsekRes = authenticateUser(DEFAULT_USER_ACCOUNTS, 'kepsek', '123');
  assert.equal(kepsekRes.ok, true);
  if (kepsekRes.ok) {
    assert.equal(kepsekRes.session.role, 'kepala_sekolah');
    assert.equal(kepsekRes.session.jabatan, 'Kepala Sekolah');
    assert.equal(kepsekRes.session.nip, '196804121995121001');
  }

  const waliRes = authenticateUser(DEFAULT_USER_ACCOUNTS, 'walikelas', '123');
  assert.equal(waliRes.ok, true);
  if (waliRes.ok) {
    assert.equal(waliRes.session.role, 'wali_kelas');
    assert.equal(waliRes.session.kelas_binaan, 'X IPA 1');
    assert.equal(waliRes.session.nip, '198705142015031002');
  }

  const guruRes = authenticateUser(DEFAULT_USER_ACCOUNTS, 'guru', '123');
  assert.equal(guruRes.ok, true);
  if (guruRes.ok) {
    assert.equal(guruRes.session.role, 'guru');
  }

  const badRes = authenticateUser(DEFAULT_USER_ACCOUNTS, 'master', 'salah');
  assert.equal(badRes.ok, false);
});

test('resetPasswordWithNip verifies NIP confirmation and updates password safely', () => {
  const wrongNip = resetPasswordWithNip(
    DEFAULT_USER_ACCOUNTS,
    'walikelas',
    '999999',
    'baru123',
    'baru123'
  );
  assert.equal(wrongNip.ok, false);

  const mismatchConfirm = resetPasswordWithNip(
    DEFAULT_USER_ACCOUNTS,
    'walikelas',
    '198705142015031002',
    'baru123',
    'beda123'
  );
  assert.equal(mismatchConfirm.ok, false);

  const noNipAccount = resetPasswordWithNip(
    DEFAULT_USER_ACCOUNTS,
    'guru',
    '198705142015031002',
    'baru123',
    'baru123'
  );
  assert.equal(noNipAccount.ok, false);

  const okRes = resetPasswordWithNip(
    DEFAULT_USER_ACCOUNTS,
    'walikelas',
    '19870514 201503 1 002',
    'rahasia789',
    'rahasia789'
  );
  assert.equal(okRes.ok, true);
  if (okRes.ok) {
    const authNew = authenticateUser(okRes.accounts, 'walikelas', 'rahasia789');
    assert.equal(authNew.ok, true);
  }
});

test('sanitizeRecords and sanitizeStudents drop undefined/malformed rows and normalize Sheet headers/dates', () => {
  assert.equal(normalizeSheetDateString('20/11/2026'), '2026-11-20');
  assert.equal(normalizeSheetDateString('2026/11/5'), '2026-11-05');

  const records = sanitizeRecords([
    undefined,
    null,
    {},
    { Tanggal: '20/11/2026', NIS: '2026001', 'Nama Siswa': 'Ahmad', Kelas: 'X IPA 1', 'Jam Masuk': '07:10', Status: 'Hadir' },
    { tanggal: '', nis: '2026002' },
  ]);
  assert.equal(records.length, 1);
  assert.equal(records[0].tanggal, '2026-11-20');
  assert.equal(records[0].nis, '2026001');
  assert.equal(records[0].nama, 'Ahmad');

  const students = sanitizeStudents([
    undefined,
    null,
    { NIS: '2026001', Nama: 'Ahmad', Kelas: 'X IPA 1', Gender: 'L' },
    { nis: '', nama: '' },
  ]);
  assert.equal(students.length, 1);
  assert.equal(students[0].nis, '2026001');
});

test('validateGasScriptUrl rejects empty, non-http, and /edit URLs while accepting /exec URLs', () => {
  assert.throws(() => validateGasScriptUrl('   '));
  assert.throws(() => validateGasScriptUrl('ftp://example.com'));
  assert.throws(() =>
    validateGasScriptUrl('https://script.google.com/macros/d/abc123/edit')
  );
  assert.equal(
    validateGasScriptUrl('  https://script.google.com/macros/s/abc123/exec  '),
    'https://script.google.com/macros/s/abc123/exec'
  );
});

test('parseStudentSheetRows imports valid rows, normalizes gender, and skips duplicates/invalid rows', () => {
  const existing: Student[] = [
    { nis: '2026001', nama: 'Ahmad', kelas: 'X IPA 1', gender: 'L', no_wa_ortu: '0812' },
  ];

  const raw = [
    { NIS: '2026001', 'Nama Siswa': 'Duplikat Eksisting', Kelas: 'X IPA 1', Gender: 'L' },
    { NIS: '2026200', 'Nama Siswa': 'Dewi Sari', Kelas: 'XI IPA 2', Gender: 'Perempuan', 'No WA Ortu': '08123456789' },
    { NIS: '2026200', 'Nama Siswa': 'Duplikat Batch', Kelas: 'XI IPA 2', Gender: 'P' },
    { NIS: '', 'Nama Siswa': 'Tanpa NIS', Kelas: 'X IPA 1' },
  ];

  const res = parseStudentSheetRows(raw, existing);
  assert.equal(res.valid.length, 1);
  assert.equal(res.valid[0].nis, '2026200');
  assert.equal(res.valid[0].gender, 'P');
  assert.deepEqual(res.duplicates, ['2026001', '2026200']);
  assert.deepEqual(res.invalidRows, [5]);
});

test('normalizeIndonesianPhone and buildWhatsAppUrl format parent WhatsApp links accurately', () => {
  assert.equal(normalizeIndonesianPhone('0812-3456-7890'), '6281234567890');
  assert.equal(normalizeIndonesianPhone('+62 813 1111 2222'), '6281311112222');
  assert.equal(normalizeIndonesianPhone('812999888'), '62812999888');

  const msg = buildParentAttendanceMessage({
    namaSekolah: 'SMA Negeri 1 Nusantara',
    tanggal: '2026-11-20',
    namaSiswa: 'Ahmad Fauzi',
    nis: '2026001',
    kelas: 'X IPA 1',
    jamMasuk: '07:05:00',
    status: 'Hadir',
  });
  assert.ok(msg.includes('Ahmad Fauzi'));
  assert.ok(msg.includes('SMA Negeri 1 Nusantara'));

  const url = buildWhatsAppUrl('081234567890', msg);
  assert.ok(url?.startsWith('https://wa.me/6281234567890?text='));
  assert.equal(buildWhatsAppUrl('', msg), null);
});

test('backupStorage creates valid JSON backups, filenames, and validates/sanitizes restores safely', () => {
  const filenameJson = buildBackupFilename(
    'SMA Negeri 1 Nusantara',
    'json',
    new Date(2026, 10, 20, 9, 5, 0)
  );
  assert.equal(
    filenameJson,
    'Backup_PresensiQR_SMA_Negeri_1_Nusantara_2026-11-20_09-05.json'
  );

  const filenameXlsx = buildBackupFilename(
    'SMA Negeri 1',
    'xlsx',
    new Date(2026, 10, 20, 14, 30, 0)
  );
  assert.equal(
    filenameXlsx,
    'Arsip_PresensiQR_SMA_Negeri_1_2026-11-20_14-30.xlsx'
  );

  const payload = createAppBackupPayload({
    students: [
      { nis: '2026101', nama: 'Raka Pratama', kelas: 'X IPA 1', gender: 'L', no_wa_ortu: '0812' },
    ],
    records: [
      {
        id: '2026-11-20_2026101',
        tanggal: '2026-11-20',
        nis: '2026101',
        nama: 'Raka Pratama',
        kelas: 'X IPA 1',
        jam_masuk: '07:05:00',
        status: 'Hadir',
      },
    ],
    settings: {
      ...SEED_SETTINGS,
      mode_presensi: 'masuk_pulang',
      nama_kepala_sekolah: 'Drs. H. Ahmad Hidayat, M.Pd',
      nip_kepala_sekolah: '196804121995121001',
      ttd_kepala_sekolah: 'data:image/png;base64,iVBORw0KGgo=',
      cap_sekolah: 'data:image/png;base64,iVBORw0KGgo=',
    },
    accounts: DEFAULT_USER_ACCOUNTS,
    defaultIdentity: { nama_sekolah: SEED_SETTINGS.nama_sekolah, logo_sekolah: '' },
    subjectAssignments: [
      {
        id: 'asg_1',
        teacher_user_id: 'usr_guru',
        teacher_name: 'Siti Aminah, S.Pd',
        kelas: 'X IPA 1',
        mata_pelajaran: 'Matematika',
        tahun_ajaran: '2026/2027',
      },
    ],
    subjectRecords: [],
    exportedBy: 'Master Admin',
  });

  const roundTrip = parseAndValidateBackupJson(
    JSON.stringify(payload),
    DEFAULT_USER_ACCOUNTS
  );
  assert.equal(roundTrip.ok, true);
  if (roundTrip.ok) {
    assert.equal(roundTrip.backup.data.students.length, 1);
    assert.equal(roundTrip.backup.data.records.length, 1);
    assert.equal(roundTrip.backup.data.settings.mode_presensi, 'masuk_pulang');
    assert.equal(
      roundTrip.backup.data.settings.nama_kepala_sekolah,
      'Drs. H. Ahmad Hidayat, M.Pd'
    );
    assert.equal(
      roundTrip.backup.data.settings.nip_kepala_sekolah,
      '196804121995121001'
    );
    assert.equal(
      roundTrip.backup.data.settings.ttd_kepala_sekolah,
      'data:image/png;base64,iVBORw0KGgo='
    );
    assert.equal(
      roundTrip.backup.data.settings.cap_sekolah,
      'data:image/png;base64,iVBORw0KGgo='
    );
    assert.equal(roundTrip.backup.data.subjectAssignments?.length, 1);
    assert.ok(
      roundTrip.backup.data.accounts.some((a) => a.role === 'master_admin')
    );
    assert.ok(
      roundTrip.backup.data.accounts.some((a) => a.role === 'kepala_sekolah')
    );
  }

  // Invalid JSON should fail cleanly
  const badJson = parseAndValidateBackupJson('{not valid json', DEFAULT_USER_ACCOUNTS);
  assert.equal(badJson.ok, false);

  // JSON without students/records arrays should fail cleanly
  const emptyObj = parseAndValidateBackupJson('{"foo":"bar"}', DEFAULT_USER_ACCOUNTS);
  assert.equal(emptyObj.ok, false);

  // Backup missing master_admin account should preserve fallback master admin accounts
  const noMasterBackup = JSON.stringify({
    students: [{ nis: '2026101', nama: 'Raka', kelas: 'X IPA 1', gender: 'L' }],
    records: [],
    accounts: [{ id: 'g1', username: 'guru', password: '123', nama: 'Guru', role: 'guru' }],
  });
  const preservedMaster = parseAndValidateBackupJson(noMasterBackup, DEFAULT_USER_ACCOUNTS);
  assert.equal(preservedMaster.ok, true);
  if (preservedMaster.ok) {
    assert.ok(
      preservedMaster.backup.data.accounts.some((a) => a.role === 'master_admin')
    );
  }
});

test('RECAP_PDF_F4_CONFIG and getRecapPdfColumns enforce F4 portrait 215x330mm proportional columns', () => {
  assert.equal(RECAP_PDF_F4_CONFIG.orientation, 'portrait');
  assert.equal(RECAP_PDF_F4_CONFIG.widthMm, 215);
  assert.equal(RECAP_PDF_F4_CONFIG.heightMm, 330);
  assert.equal(RECAP_PDF_F4_CONFIG.contentWidth, 187);

  const sum = (cols: Array<{ width: number }>) =>
    cols.reduce((acc, c) => acc + c.width, 0);

  const dailyWithCheckout = getRecapPdfColumns('harian', true);
  assert.equal(sum(dailyWithCheckout), RECAP_PDF_F4_CONFIG.contentWidth);
  assert.ok(dailyWithCheckout.some((c) => c.header === 'Pulang'));
  assert.equal(dailyWithCheckout.some((c) => c.header === 'Keterangan'), false);

  const dailyWithoutCheckout = getRecapPdfColumns('harian', false);
  assert.equal(sum(dailyWithoutCheckout), RECAP_PDF_F4_CONFIG.contentWidth);
  assert.ok(!dailyWithoutCheckout.some((c) => c.header === 'Pulang'));
  assert.equal(dailyWithoutCheckout.some((c) => c.header === 'Keterangan'), false);

  const monthlyCols = getRecapPdfColumns('bulanan', true);
  assert.equal(sum(monthlyCols), RECAP_PDF_F4_CONFIG.contentWidth);
  assert.ok(monthlyCols.some((c) => c.header === '% Hadir'));
});

test('getECardLayoutMetrics keeps compact 56mm height without footer, full-size 29mm QR on right, and principal at bottom-left', () => {
  const metrics = getECardLayoutMetrics();
  assert.equal(metrics.cardH, 56);
  assert.equal(metrics.qrSize, 29);
  assert.equal(metrics.principalBlockPosition, 'bottom-left');
});

test('THEME_PRESETS offers expanded light and dark variations with safe normalization', () => {
  assert.ok(THEME_PRESETS.length >= 14);
  const lightCount = THEME_PRESETS.filter((t) => t.mode === 'light').length;
  const darkCount = THEME_PRESETS.filter((t) => t.mode === 'dark').length;
  assert.ok(lightCount >= 8);
  assert.ok(darkCount >= 6);

  assert.equal(isDarkTheme('dark'), true);
  assert.equal(isDarkTheme('dark-emerald'), true);
  assert.equal(isDarkTheme('indigo'), false);
  assert.equal(isDarkTheme('amber'), false);

  assert.equal(normalizeThemeId('dark-violet'), 'dark-violet');
  assert.equal(normalizeThemeId('unknown-theme'), 'indigo');
});

test('buildWelcomeGreetingText produces exact Indonesian welcome phrase with school name', () => {
  assert.equal(
    buildWelcomeGreetingText('SMA Negeri 1 Nusantara'),
    'Selamat Datang di Aplikasi Presensi Digital SMA Negeri 1 Nusantara'
  );
  assert.equal(
    buildWelcomeGreetingText('  SMK Harapan Bangsa  '),
    'Selamat Datang di Aplikasi Presensi Digital SMK Harapan Bangsa'
  );
});



