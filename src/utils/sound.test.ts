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
import {
  MAX_TTS_TEXT_LENGTH,
  buildClientTtsEndpointUrl,
  buildGoogleTtsUrl,
  concatMp3Buffers,
  isLikelyMp3Audio,
  sanitizeTtsText,
  splitTtsChunks,
} from './ttsText';
import {
  config as netlifyTtsConfig,
  handleTtsServerlessRequest,
} from '../../netlify/functions/tts.ts';

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

describe('Unified Cross-Device Female TTS Helpers & Netlify /api/tts Endpoint', () => {
  it('sanitizes control characters and splits long Indonesian reminders cleanly on punctuation boundaries', () => {
    assert.equal(sanitizeTtsText('  Presensi\u0000\n\tBerhasil!  '), 'Presensi Berhasil!');
    assert.equal(sanitizeTtsText(null), '');

    const shortText = buildWelcomeGreetingText('SMP Negeri 2');
    assert.deepEqual(splitTtsChunks(shortText), [shortText]);

    const longText =
      'Perhatian Wali Kelas tujuh A. Masih terdapat lima siswa yang belum melakukan presensi pagi hari ini. Mohon segera lakukan konfirmasi kehadiran kepada orang tua siswa agar data rekapitulasi harian tetap akurat dan lengkap.';
    const chunks = splitTtsChunks(longText, 110);
    assert.ok(chunks.length >= 2 && chunks.length <= 4);
    for (const chunk of chunks) {
      assert.ok(chunk.length <= 110, `Chunk exceeded limit: ${chunk.length}`);
    }
    assert.ok(chunks[0].endsWith('.'), `Expected sentence boundary split, got: ${chunks[0]}`);
  });

  it('builds hardcoded Google Bahasa Indonesia TTS URL and validates MP3 framing', () => {
    const upstreamUrl = buildGoogleTtsUrl('Presensi Berhasil');
    assert.ok(upstreamUrl.startsWith('https://translate.google.com/translate_tts?'));
    assert.ok(upstreamUrl.includes('tl=id'));
    assert.ok(upstreamUrl.includes('client=tw-ob'));

    assert.equal(buildClientTtsEndpointUrl('Presensi Berhasil'), '/api/tts?text=Presensi%20Berhasil');

    const rawMp3 = new Uint8Array(256);
    rawMp3[0] = 0xff;
    rawMp3[1] = 0xf3;
    assert.equal(isLikelyMp3Audio(rawMp3), true);

    const notMp3 = new TextEncoder().encode('<html>blocked</html>');
    assert.equal(isLikelyMp3Audio(notMp3), false);

    const merged = concatMp3Buffers([rawMp3, rawMp3]);
    assert.equal(merged.byteLength, 512);
  });

  it('validates requests, serves audio/mpeg with cache headers, and caches warm responses on Netlify /api/tts', async () => {
    assert.equal(netlifyTtsConfig.path, '/api/tts');

    // Reject POST
    const postRes = await handleTtsServerlessRequest(
      new Request('https://example.netlify.app/api/tts?text=Halo', { method: 'POST' })
    );
    assert.equal(postRes.status, 405);

    // Reject empty text
    const emptyRes = await handleTtsServerlessRequest(
      new Request('https://example.netlify.app/api/tts?text=%20%20')
    );
    assert.equal(emptyRes.status, 400);

    // Reject oversized text
    const tooLong = 'a'.repeat(MAX_TTS_TEXT_LENGTH + 10);
    const longRes = await handleTtsServerlessRequest(
      new Request(`https://example.netlify.app/api/tts?text=${tooLong}`)
    );
    assert.equal(longRes.status, 400);

    // Valid audio fetch + warm cache hit
    let fetchCalls = 0;
    const fakeMp3 = new Uint8Array(512);
    fakeMp3[0] = 0xff;
    fakeMp3[1] = 0xf3;
    fakeMp3[2] = 0x84;
    fakeMp3[3] = 0xc4;

    const mockFetch: typeof fetch = async (input) => {
      fetchCalls += 1;
      assert.ok(String(input).startsWith('https://translate.google.com/translate_tts?'));
      return new Response(fakeMp3, {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      });
    };

    const okRes1 = await handleTtsServerlessRequest(
      new Request('https://example.netlify.app/api/tts?text=Uji%20Suara%20Tablet%20Unik'),
      mockFetch
    );
    assert.equal(okRes1.status, 200);
    assert.equal(okRes1.headers.get('content-type'), 'audio/mpeg');
    assert.equal(okRes1.headers.get('x-content-type-options'), 'nosniff');
    assert.ok((okRes1.headers.get('cache-control') || '').includes('max-age=86400'));
    const body1 = new Uint8Array(await okRes1.arrayBuffer());
    assert.equal(body1.byteLength, 512);
    assert.equal(fetchCalls, 1);

    // Second identical request should hit warm memory cache without re-fetching upstream
    const okRes2 = await handleTtsServerlessRequest(
      new Request('https://example.netlify.app/api/tts?text=Uji%20Suara%20Tablet%20Unik'),
      mockFetch
    );
    assert.equal(okRes2.status, 200);
    assert.equal(fetchCalls, 1);

    // Upstream failure returns 502 cleanly
    const failingFetch: typeof fetch = async () => new Response('upstream error', { status: 503 });
    const failRes = await handleTtsServerlessRequest(
      new Request('https://example.netlify.app/api/tts?text=Gagal%20Upstream%20Unik'),
      failingFetch
    );
    assert.equal(failRes.status, 502);
  });
});

