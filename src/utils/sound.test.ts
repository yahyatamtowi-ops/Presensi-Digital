import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCheckoutSuccessText,
  buildWelcomeGreetingText,
  isIndonesianLangTag,
  pickFemaleIndonesianVoice,
  type VoiceLike,
} from './sound';

describe('Indonesian Female Voice Selection (Desktop, Tablet & Mobile)', () => {
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

  it('builds checkout farewell speech text with the exact requested phrase', () => {
    assert.equal(
      buildCheckoutSuccessText(),
      'Presensi Pulang Berhasil. Sampai jumpa. Hati-hati di jalan, semoga selamat sampai di tujuan'
    );
  });
});
