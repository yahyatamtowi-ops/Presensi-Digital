import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCheckoutSuccessText,
  buildOfflineAttendanceSpeechText,
  buildWelcomeGreetingText,
  isIndonesianLangTag,
  pickFemaleIndonesianVoice,
  type VoiceLike,
} from './sound';

describe('Indonesian Female Voice Selection (Desktop, Tablet, Mobile & Offline)', () => {
  it('recognizes Indonesian language tags across Desktop, iOS, and legacy Android locales', () => {
    assert.equal(isIndonesianLangTag('id-ID'), true);
    assert.equal(isIndonesianLangTag('id_ID'), true);
    assert.equal(isIndonesianLangTag('in-ID'), true);
    assert.equal(isIndonesianLangTag('in_ID'), true);
    assert.equal(isIndonesianLangTag('ind'), true);
    assert.equal(isIndonesianLangTag('en-US'), false);
  });

  it('prefers iOS Damayanti and Android female Google TTS voices while excluding male voices', () => {
    const androidVoices: VoiceLike[] = [
      { name: 'English United States', lang: 'en-US', localService: true },
      { name: 'id-id-x-idd-local', lang: 'id-ID', localService: true }, // male
      { name: 'id-id-x-idc-local', lang: 'id-ID', localService: true }, // female
    ];
    const pickedAndroid = pickFemaleIndonesianVoice(androidVoices);
    assert.equal(pickedAndroid.voice?.name, 'id-id-x-idc-local');
    assert.equal(pickedAndroid.isExplicitFemale, true);

    const iosVoices: VoiceLike[] = [
      { name: 'Samantha', lang: 'en-US', localService: true },
      { name: 'Damayanti', lang: 'id-ID', localService: true },
    ];
    const pickedIos = pickFemaleIndonesianVoice(iosVoices);
    assert.equal(pickedIos.voice?.name, 'Damayanti');
    assert.equal(pickedIos.isExplicitFemale, true);

    const legacyAndroidVoices: VoiceLike[] = [
      { name: 'Samantha', lang: 'en-US', localService: true },
      { name: 'Indonesian Indonesia', lang: 'in_ID', localService: true },
    ];
    const pickedLegacy = pickFemaleIndonesianVoice(legacyAndroidVoices);
    assert.equal(pickedLegacy.voice?.name, 'Indonesian Indonesia');
  });

  it('when offline, skips cloud-only Google Bahasa Indonesia (localService: false) and picks local Indonesian female voice instead of male/English fallback', () => {
    const mixedVoices: VoiceLike[] = [
      { name: 'Microsoft David - English (United States)', lang: 'en-US', localService: true },
      { name: 'Google Bahasa Indonesia', lang: 'id-ID', localService: false }, // cloud-only, fails offline!
      { name: 'Microsoft Ardi - Indonesian (Indonesia)', lang: 'id-ID', localService: true }, // male
      { name: 'Microsoft Gadis - Indonesian (Indonesia)', lang: 'id-ID', localService: true }, // female local
    ];

    const pickedOffline = pickFemaleIndonesianVoice(mixedVoices, { isOffline: true });
    assert.equal(pickedOffline.voice?.name, 'Microsoft Gadis - Indonesian (Indonesia)');
    assert.equal(pickedOffline.isExplicitFemale, true);

    // When offline and only cloud id-ID + English voices exist, never pick cloud voice or English male voice
    const noLocalIndonesian: VoiceLike[] = [
      { name: 'Microsoft David - English (United States)', lang: 'en-US', localService: true },
      { name: 'Google Bahasa Indonesia', lang: 'id-ID', localService: false },
    ];
    const pickedOfflineNone = pickFemaleIndonesianVoice(noLocalIndonesian, { isOffline: true });
    assert.equal(pickedOfflineNone.voice, null);

    // When online with the same list, cloud Google Bahasa Indonesia is selected
    const pickedOnline = pickFemaleIndonesianVoice(noLocalIndonesian, { isOffline: false });
    assert.equal(pickedOnline.voice?.name, 'Google Bahasa Indonesia');
    assert.equal(pickedOnline.isExplicitFemale, true);
  });

  it('when offline on Android/macOS, picks local Malay female voice if local id-ID is missing before giving up', () => {
    const voicesWithLocalMalay: VoiceLike[] = [
      { name: 'Google Bahasa Indonesia', lang: 'id-ID', localService: false },
      { name: 'Microsoft Osman - Malay (Malaysia)', lang: 'ms-MY', localService: true },
      { name: 'Microsoft Yasmin - Malay (Malaysia)', lang: 'ms-MY', localService: true },
    ];
    const picked = pickFemaleIndonesianVoice(voicesWithLocalMalay, { isOffline: true });
    assert.equal(picked.voice?.name, 'Microsoft Yasmin - Malay (Malaysia)');
    assert.equal(picked.isExplicitFemale, true);
  });

  it('does not hijack Indonesian speech with an English voice when no id/ms voice is listed', () => {
    const onlyEnglish: VoiceLike[] = [
      { name: 'Samantha', lang: 'en-US', localService: true },
      { name: 'Google US English', lang: 'en-US', localService: false },
    ];
    const picked = pickFemaleIndonesianVoice(onlyEnglish);
    assert.equal(picked.voice, null);
    assert.equal(
      buildWelcomeGreetingText('SMA Negeri 1'),
      'Selamat Datang di Aplikasi Presensi Digital SMA Negeri 1'
    );
  });

  it('builds natural pure Bahasa Indonesia speech copy for offline attendance and checkout', () => {
    assert.equal(
      buildCheckoutSuccessText(),
      'Presensi Pulang Berhasil. Sampai jumpa. Hati-hati di jalan, semoga selamat sampai di tujuan'
    );
    const offlineIn = buildOfflineAttendanceSpeechText('masuk', 'Hadir');
    assert.ok(offlineIn.includes('Presensi berhasil'));
    assert.ok(!/offline/i.test(offlineIn), 'Should avoid English word "offline" for clean Indonesian pronunciation');

    const offlineLate = buildOfflineAttendanceSpeechText('masuk', 'Terlambat');
    assert.ok(offlineLate.includes('terlambat'));
    assert.ok(!/offline/i.test(offlineLate));

    const offlineOut = buildOfflineAttendanceSpeechText('pulang');
    assert.ok(offlineOut.includes('Presensi pulang berhasil'));
    assert.ok(offlineOut.includes('Hati-hati di jalan') || offlineOut.includes('hati-hati di jalan'));
  });
});
