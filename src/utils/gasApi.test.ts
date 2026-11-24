import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeStudents } from './gasApi';

test('gasApi sanitizeStudents data integrity', async (t) => {
  await t.test('drops empty-NIS rows, supports nisn alias, and deduplicates by NIS cleanly', () => {
    const cleaned = sanitizeStudents([
      null,
      { nama: 'Tanpa NISN', kelas: 'X-1' },
      { nis: '   ', nama: 'NIS Kosong', kelas: 'X-1' },
      {
        nisn: '0081234567',
        nama: 'Ahmad Fauzi',
        kelas: 'X-IPA-1',
        gender: 'L',
        no_wa_ortu: '',
      },
      {
        nis: '0081234567',
        nama: 'Ahmad Fauzi',
        kelas: 'X-IPA-1',
        gender: 'L',
        no_wa_ortu: '081234567890',
        tahun_ajaran: '2026/2027',
      },
      {
        nis: '0089999999',
        nama: 'Siti Rahma',
        kelas: 'X-IPA-2',
        jenis_kelamin: 'Perempuan',
        wa_ortu: '081355556666',
      },
    ]);

    assert.equal(cleaned.length, 2);
    assert.equal(cleaned[0].nis, '0081234567');
    assert.equal(cleaned[0].no_wa_ortu, '081234567890');
    assert.equal(cleaned[0].tahun_ajaran, '2026/2027');

    assert.equal(cleaned[1].nis, '0089999999');
    assert.equal(cleaned[1].gender, 'P');
    assert.equal(cleaned[1].no_wa_ortu, '081355556666');
  });
});
