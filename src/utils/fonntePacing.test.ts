import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FONNTE_CONFIG,
  FONNTE_PACING_BOUNDS,
  buildFonnteDedupeKey,
  buildFonnteScheduleRunKey,
  buildPendingFonnteRecipients,
  clampFonntePacing,
  classifyCheckoutCategory,
  computeNextStaggeredDelaySec,
  estimateStaggeredDurationSec,
  evaluateScheduledFonnteRun,
  formatDurationId,
  maskFonnteTarget,
  maskFonnteToken,
  normalizeFonnteTarget,
  renderFonnteMessage,
  validateFonnteTokenInput,
} from './fonntePacing';

test('fonntePacing (Anti-Ban Staggered WhatsApp Engine)', async (t) => {
  await t.test('normalizes Indonesian WA phone numbers and rejects invalid values', () => {
    assert.equal(normalizeFonnteTarget('0812-3456-7890'), '6281234567890');
    assert.equal(normalizeFonnteTarget('+62 812 3456 7890'), '6281234567890');
    assert.equal(normalizeFonnteTarget('6285211223344'), '6285211223344');
    assert.equal(normalizeFonnteTarget('81234567890'), '6281234567890');
    assert.equal(normalizeFonnteTarget('12345'), '');
    assert.equal(normalizeFonnteTarget(''), '');
    assert.equal(maskFonnteTarget('081234567890'), '62812****7890');
  });

  await t.test('clamps pacing policy to safe anti-ban floors and ceilings', () => {
    const tooAggressive = clampFonntePacing({
      minDelaySec: 1,
      maxDelaySec: 2,
      batchSize: 99,
      batchPauseSec: 5,
    });
    assert.equal(tooAggressive.minDelaySec, FONNTE_PACING_BOUNDS.MIN_DELAY_SEC);
    assert.equal(tooAggressive.maxDelaySec, FONNTE_PACING_BOUNDS.MIN_DELAY_SEC);
    assert.equal(tooAggressive.batchSize, FONNTE_PACING_BOUNDS.MAX_BATCH_SIZE);
    assert.equal(tooAggressive.batchPauseSec, FONNTE_PACING_BOUNDS.MIN_BATCH_PAUSE_SEC);
  });

  await t.test('computes randomized per-message jitter and batch cool-down pauses', () => {
    const policy = clampFonntePacing({
      minDelaySec: 20,
      maxDelaySec: 40,
      batchSize: 5,
      batchPauseSec: 180,
    });

    const low = computeNextStaggeredDelaySec(2, policy, 0);
    assert.equal(low.isBatchPause, false);
    assert.equal(low.delaySec, 20);

    const high = computeNextStaggeredDelaySec(2, policy, 1);
    assert.equal(high.isBatchPause, false);
    assert.equal(high.delaySec, 40);

    const batchPause = computeNextStaggeredDelaySec(5, policy, 0.5);
    assert.equal(batchPause.isBatchPause, true);
    assert.equal(batchPause.delaySec, 180);
  });

  await t.test('estimates total staggered duration including batch pauses accurately', () => {
    const policy = clampFonntePacing({
      minDelaySec: 20,
      maxDelaySec: 40,
      batchSize: 5,
      batchPauseSec: 180,
    });
    // 6 messages => 5 gaps total: 1 batch pause (180s) + 4 regular gaps (avg 30s = 120s) = 300s (5 menit)
    const durationSec = estimateStaggeredDurationSec(6, policy);
    assert.equal(durationSec, 300);
    assert.equal(formatDurationId(durationSec), '5 menit');
    assert.equal(estimateStaggeredDurationSec(1, policy), 0);
  });

  await t.test('renders customized templates with natural greeting variation', () => {
    const msg0 = renderFonnteMessage(
      '{salam} Siswa {nama} ({nisn}, {kelas}) {status} jam {jam_masuk} di {sekolah}',
      {
        nama: 'Budi Santoso',
        nisn: '0081234567',
        kelas: 'X-IPA-1',
        tanggal: '2026-11-24',
        jam_masuk: '07:32:10',
        batas_jam: '07:15',
        status: 'Terlambat',
        sekolah: 'SMA Negeri 1 Kabun',
      },
      0
    );
    const msg1 = renderFonnteMessage(
      '{salam} Siswa {nama} ({nisn}, {kelas}) {status} jam {jam_masuk} di {sekolah}',
      {
        nama: 'Siti Aminah',
        nisn: '0087654321',
        kelas: 'X-IPA-1',
        tanggal: '2026-11-24',
        jam_masuk: '07:40:00',
        batas_jam: '07:15',
        status: 'Terlambat',
        sekolah: 'SMA Negeri 1 Kabun',
      },
      1
    );
    assert.ok(msg0.includes('Budi Santoso'));
    assert.ok(msg0.includes('0081234567'));
    assert.ok(msg0.includes('SMA Negeri 1 Kabun'));
    assert.notEqual(msg0.slice(0, 20), msg1.slice(0, 20));
  });

  await t.test('builds today recipient list for Terlambat, Alpa, and Belum Presensi with deduplication', () => {
    const sent = new Set<string>([
      buildFonnteDedupeKey('2026-11-24', '001', 'Terlambat'),
    ]);
    const list = buildPendingFonnteRecipients({
      students: [
        { nis: '001', nama: 'Andi', kelas: 'X-1', no_wa_ortu: '081234567890' },
        { nis: '002', nama: 'Budi', kelas: 'X-1', no_wa_ortu: '081298765432' },
        { nis: '003', nama: 'Citra', kelas: 'X-1', no_wa_ortu: '' },
        { nis: '004', nama: 'Dewi', kelas: 'X-1', no_wa_ortu: '081355556666' },
      ],
      todayRecords: [
        { nis: '001', status: 'Terlambat', jam_masuk: '07:25:00' },
        { nis: '002', status: 'Alpa', jam_masuk: '-' },
        { nis: '004', status: 'Hadir', jam_masuk: '07:05:00' },
      ],
      tanggal: '2026-11-24',
      sekolah: 'SMA Negeri 1 Kabun',
      batasJamMasuk: '07:15',
      config: DEFAULT_FONNTE_CONFIG,
      sentDedupeKeys: sent,
    });

    // Dewi (Hadir) is excluded; Andi (Terlambat, alreadyNotified), Budi (Alpa, ready), Citra (Belum Presensi, no phone)
    assert.equal(list.length, 3);
    assert.equal(list[0].nis, '001');
    assert.equal(list[0].alreadyNotified, true);
    assert.equal(list[1].nis, '002');
    assert.equal(list[1].status, 'Alpa');
    assert.equal(list[1].hasValidPhone, true);
    assert.equal(list[1].alreadyNotified, false);
    assert.equal(list[2].nis, '003');
    assert.equal(list[2].status, 'Belum Presensi');
    assert.equal(list[2].hasValidPhone, false);
  });

  await t.test('evaluates scheduled auto-send at 16:17 and re-arms when schedule time is updated on the same day', () => {
    const configAt1617 = {
      enabled: true,
      autoAbsentScheduleEnabled: true,
      autoAbsentScheduleTime: '16:17',
    };

    // 1. Disabled when master switch is off
    const disabledEval = evaluateScheduledFonnteRun({
      now: new Date(2026, 10, 24, 16, 17, 0),
      config: { ...configAt1617, enabled: false },
      lastRunKey: '',
    });
    assert.equal(disabledEval.status, 'disabled');
    assert.equal(disabledEval.shouldRun, false);

    // 2. Waiting 15 seconds before 16:17 (even if default 08:30 already ran earlier today!)
    const earlierRunKey = buildFonnteScheduleRunKey('2026-11-24', '08:30');
    const waitingEval = evaluateScheduledFonnteRun({
      now: new Date(2026, 10, 24, 16, 16, 45),
      config: configAt1617,
      lastRunKey: earlierRunKey,
    });
    assert.equal(waitingEval.status, 'waiting');
    assert.equal(waitingEval.shouldRun, false);
    assert.equal(waitingEval.secondsUntil, 15);
    assert.equal(waitingEval.runKey, '2026-11-24|16:17');

    // 3. Fires immediately when clock reaches 16:17:00
    const dueEval = evaluateScheduledFonnteRun({
      now: new Date(2026, 10, 24, 16, 17, 0),
      config: configAt1617,
      lastRunKey: earlierRunKey,
    });
    assert.equal(dueEval.status, 'due');
    assert.equal(dueEval.shouldRun, true);
    assert.equal(dueEval.secondsUntil, 0);

    // 4. Marks completed once 2026-11-24|16:17 has run (prevents double-send)
    const completedEval = evaluateScheduledFonnteRun({
      now: new Date(2026, 10, 24, 16, 17, 30),
      config: configAt1617,
      lastRunKey: dueEval.runKey,
    });
    assert.equal(completedEval.status, 'completed');
    assert.equal(completedEval.shouldRun, false);

    // 5. Re-arms again if user changes schedule to 16:20 on the same day
    const rearmedEval = evaluateScheduledFonnteRun({
      now: new Date(2026, 10, 24, 16, 20, 2),
      config: { ...configAt1617, autoAbsentScheduleTime: '16:20' },
      lastRunKey: dueEval.runKey,
    });
    assert.equal(rearmedEval.status, 'due');
    assert.equal(rearmedEval.shouldRun, true);
    assert.equal(rearmedEval.runKey, '2026-11-24|16:20');
  });

  await t.test('supports Hadir Tepat Waktu recipients, dedupe keys, and on-time template rendering when enabled', () => {
    const onTimeKey = buildFonnteDedupeKey('2026-11-24', '004', 'Hadir Tepat Waktu');
    assert.equal(onTimeKey, '2026-11-24|004|HADIR_TEPAT_WAKTU');
    assert.notEqual(onTimeKey, buildFonnteDedupeKey('2026-11-24', '004', 'Terlambat'));

    const list = buildPendingFonnteRecipients({
      students: [
        { nis: '004', nama: 'Dewi', kelas: 'X-1', no_wa_ortu: '081355556666' },
        { nis: '005', nama: 'Eko', kelas: 'X-1', no_wa_ortu: '081377778888' },
      ],
      todayRecords: [
        { nis: '004', status: 'Hadir', jam_masuk: '07:03:10' },
        { nis: '005', status: 'Hadir', jam_masuk: '07:08:45' },
      ],
      tanggal: '2026-11-24',
      sekolah: 'SMA Negeri 1 Kabun',
      batasJamMasuk: '07:15',
      config: { ...DEFAULT_FONNTE_CONFIG, autoSendOnTime: true },
      sentDedupeKeys: new Set([onTimeKey]),
      includeOnTime: true,
      includeLate: false,
      includeAbsent: false,
    });

    assert.equal(list.length, 2);
    assert.equal(list[0].nis, '004');
    assert.equal(list[0].status, 'Hadir Tepat Waktu');
    assert.equal(list[0].alreadyNotified, true);
    assert.equal(list[1].nis, '005');
    assert.equal(list[1].status, 'Hadir Tepat Waktu');
    assert.equal(list[1].alreadyNotified, false);
    assert.ok(list[1].message.includes('PRESENSI TEPAT WAKTU'));
    assert.ok(list[1].message.includes('07:08:45'));
  });

  await t.test('validates Fonnte token inputs and rejects header injection or malformed strings', () => {
    const valid = validateFonnteTokenInput('  AbCdEf1234567890_XyZ  ');
    assert.equal(valid.valid, true);
    assert.equal(valid.sanitized, 'AbCdEf1234567890_XyZ');

    assert.equal(validateFonnteTokenInput('').valid, false);
    assert.equal(validateFonnteTokenInput('short').valid, false);
    assert.equal(validateFonnteTokenInput('token with spaces 12345').valid, false);
    assert.equal(validateFonnteTokenInput('abc12345\r\nX-Injected: evil').valid, false);
    assert.equal(validateFonnteTokenInput('abc12345\nnextline').valid, false);
    assert.equal(validateFonnteTokenInput('a'.repeat(300)).valid, false);
  });

  await t.test('masks Fonnte tokens without revealing middle characters', () => {
    assert.equal(maskFonnteToken('AbCdEf1234567890XyZ9'), 'AbCd••••XyZ9');
    assert.equal(maskFonnteToken('12345678'), '12••••');
    assert.equal(maskFonnteToken(''), '');
  });

  await t.test('classifies student checkout into Pulang Tepat Waktu, Pulang Cepat, or null', () => {
    assert.equal(classifyCheckoutCategory(undefined, '15:00'), null);
    assert.equal(classifyCheckoutCategory({ jam_pulang: '' }, '15:00'), null);
    assert.equal(classifyCheckoutCategory({ jam_pulang: '-' }, '15:00'), null);
    assert.equal(
      classifyCheckoutCategory({ jam_pulang: '15:00:00' }, '15:00'),
      'Pulang Tepat Waktu'
    );
    assert.equal(
      classifyCheckoutCategory({ jam_pulang: '15:12:30' }, '15:00'),
      'Pulang Tepat Waktu'
    );
    // Earlier than standard dismissal clock => Pulang Cepat
    assert.equal(
      classifyCheckoutCategory({ jam_pulang: '14:45:00' }, '15:00'),
      'Pulang Cepat'
    );
    // Explicit early checkout reason => Pulang Cepat even if clock >= standard time
    assert.equal(
      classifyCheckoutCategory({ jam_pulang: '15:05:00', alasan_pulang_cepat: 'Sakit demam' }, '15:00'),
      'Pulang Cepat'
    );
  });

  await t.test('keeps arrival and departure dedupe keys distinct and renders checkout template variables', () => {
    const arrivalKey = buildFonnteDedupeKey('2026-11-25', '001', 'Hadir Tepat Waktu');
    const checkoutOnTimeKey = buildFonnteDedupeKey('2026-11-25', '001', 'Pulang Tepat Waktu');
    const checkoutEarlyKey = buildFonnteDedupeKey('2026-11-25', '001', 'Pulang Cepat');

    assert.equal(checkoutOnTimeKey, '2026-11-25|001|PULANG_TEPAT_WAKTU');
    assert.equal(checkoutEarlyKey, '2026-11-25|001|PULANG_CEPAT');
    assert.notEqual(arrivalKey, checkoutOnTimeKey);
    assert.notEqual(checkoutOnTimeKey, checkoutEarlyKey);

    const onTimeMsg = renderFonnteMessage(
      DEFAULT_FONNTE_CONFIG.checkoutOnTimeTemplate,
      {
        nama: 'Budi Santoso',
        nisn: '0081234567',
        kelas: 'X-IPA-1',
        tanggal: '2026-11-25',
        jam_masuk: '07:05:00',
        jam_pulang: '15:04:12',
        batas_jam: '07:15',
        batas_pulang: '15:00',
        status: 'Pulang Tepat Waktu',
        sekolah: 'SMA Negeri 1 Kabun',
      },
      0
    );
    assert.ok(onTimeMsg.includes('PULANG SESUAI WAKTU'));
    assert.ok(onTimeMsg.includes('15:04:12'));
    assert.ok(onTimeMsg.includes('15:00'));

    const earlyMsg = renderFonnteMessage(
      DEFAULT_FONNTE_CONFIG.checkoutEarlyTemplate,
      {
        nama: 'Siti Aminah',
        nisn: '0087654321',
        kelas: 'X-IPA-1',
        tanggal: '2026-11-25',
        jam_masuk: '07:02:00',
        jam_pulang: '11:25:00',
        batas_jam: '07:15',
        batas_pulang: '15:00',
        alasan_pulang: 'Izin keperluan keluarga',
        status: 'Pulang Cepat',
        sekolah: 'SMA Negeri 1 Kabun',
      },
      1
    );
    assert.ok(earlyMsg.includes('PULANG CEPAT'));
    assert.ok(earlyMsg.includes('11:25:00'));
    assert.ok(earlyMsg.includes('Izin keperluan keluarga'));
  });

  await t.test('builds departure recipients alongside arrival recipients without duplicating sent keys', () => {
    const sent = new Set<string>([
      buildFonnteDedupeKey('2026-11-25', '001', 'Hadir Tepat Waktu'),
      buildFonnteDedupeKey('2026-11-25', '002', 'Pulang Cepat'),
    ]);

    const list = buildPendingFonnteRecipients({
      students: [
        { nis: '001', nama: 'Andi', kelas: 'X-1', no_wa_ortu: '081234567890' },
        { nis: '002', nama: 'Budi', kelas: 'X-1', no_wa_ortu: '081298765432' },
        { nis: '003', nama: 'Citra', kelas: 'X-1', no_wa_ortu: '081355556666' },
      ],
      todayRecords: [
        { nis: '001', status: 'Hadir', jam_masuk: '07:05:00', jam_pulang: '15:06:00' },
        { nis: '002', status: 'Terlambat', jam_masuk: '07:28:00', jam_pulang: '12:15:00', alasan_pulang_cepat: 'Sakit' },
        { nis: '003', status: 'Hadir', jam_masuk: '07:09:00', jam_pulang: '-' },
      ],
      tanggal: '2026-11-25',
      sekolah: 'SMA Negeri 1 Kabun',
      batasJamMasuk: '07:15',
      jamPulangStandar: '15:00',
      config: DEFAULT_FONNTE_CONFIG,
      sentDedupeKeys: sent,
      includeOnTime: true,
      includeLate: true,
      includeAbsent: false,
      includeCheckoutOnTime: true,
      includeCheckoutEarly: true,
    });

    // Andi: arrival (alreadyNotified) + Pulang Tepat Waktu (ready)
    // Budi: Terlambat (ready) + Pulang Cepat (alreadyNotified)
    // Citra: arrival (ready), no checkout yet
    const andiArrival = list.find((r) => r.nis === '001' && r.status === 'Hadir Tepat Waktu');
    const andiCheckout = list.find((r) => r.nis === '001' && r.status === 'Pulang Tepat Waktu');
    const budiLate = list.find((r) => r.nis === '002' && r.status === 'Terlambat');
    const budiEarly = list.find((r) => r.nis === '002' && r.status === 'Pulang Cepat');
    const citraCheckout = list.find((r) => r.nis === '003' && (r.status === 'Pulang Tepat Waktu' || r.status === 'Pulang Cepat'));

    assert.ok(andiArrival);
    assert.equal(andiArrival.alreadyNotified, true);
    assert.ok(andiCheckout);
    assert.equal(andiCheckout.alreadyNotified, false);
    assert.equal(andiCheckout.jam_pulang, '15:06:00');
    assert.ok(andiCheckout.message.includes('15:06:00'));

    assert.ok(budiLate);
    assert.equal(budiLate.alreadyNotified, false);
    assert.ok(budiEarly);
    assert.equal(budiEarly.alreadyNotified, true);
    assert.equal(budiEarly.alasan_pulang_cepat, 'Sakit');
    assert.ok(budiEarly.message.includes('Sakit'));

    assert.equal(citraCheckout, undefined);
  });
});


