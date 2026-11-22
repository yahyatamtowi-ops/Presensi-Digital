let audioCtx: AudioContext | null = null;
let cachedVoices: SpeechSynthesisVoice[] = [];
let speechEngineInitialized = false;
let speechUnlocked = false;
let pendingWelcomeText: string | null = null;
const activeUtterances = new Set<SpeechSynthesisUtterance>();

export interface VoiceLike {
  name: string;
  lang: string;
  localService?: boolean;
  default?: boolean;
}

const INDONESIAN_LANG_REGEX = /^(id|in|ind)($|[-_])/i;
const MALAY_LANG_REGEX = /^(ms|msa)($|[-_])/i;

const FEMALE_VOICE_HINT =
  /female|woman|wanita|perempuan|gadis|damayanti|siti|ayu|putri|melati|lina|dewi|nisa|intan|maya|kartini|yasmin|id[-_]id[-_]x[-_]id[cef]|id[-_]id[-_]x[-_]dfz|wavenet[-_][ad]|standard[-_][ad]|neural2[-_][ad]|google bahasa indonesia/i;

const MALE_VOICE_HINT =
  /\bmale\b|\bman\b|pria|laki|ardi|andika|budi|osman|david|mark|george|daniel|alex|fred|rishi|aaron|arthur|james|id[-_]id[-_]x[-_]id[dg]|wavenet[-_][bc]|standard[-_][bc]|neural2[-_][bc]/i;

export function isIndonesianLangTag(lang: string): boolean {
  return INDONESIAN_LANG_REGEX.test((lang || '').trim());
}

export function isVoiceOfflineContext(): boolean {
  if (typeof navigator === 'undefined') return false;
  return navigator.onLine === false;
}

export interface PickVoiceOptions {
  isOffline?: boolean;
}

/**
 * Selects the best female Indonesian voice across Desktop, Android (Chrome/Samsung TTS),
 * and iOS/iPadOS (Safari Damayanti).
 *
 * When offline (`isOffline: true`), strictly avoids cloud-only (`localService: false`)
 * voices such as "Google Bahasa Indonesia" that fail offline and cause browsers to
 * silently fall back to an English/male OS default voice (e.g. Microsoft David).
 * Never hijacks Indonesian text with an English voice.
 */
export function pickFemaleIndonesianVoice<T extends VoiceLike>(
  voices: T[],
  options?: PickVoiceOptions
): { voice: T | null; isExplicitFemale: boolean } {
  if (!voices || voices.length === 0) {
    return { voice: null, isExplicitFemale: false };
  }

  const isOffline = options?.isOffline ?? false;
  const indonesianVoices = voices.filter((v) => isIndonesianLangTag(v.lang));
  const localIndonesianVoices = indonesianVoices.filter((v) => v.localService !== false);

  // 1. Explicit Indonesian female local voice (always #1 for both online & offline reliability)
  const idFemaleLocal = localIndonesianVoices.find(
    (v) => FEMALE_VOICE_HINT.test(v.name) && !MALE_VOICE_HINT.test(v.name)
  );
  if (idFemaleLocal) return { voice: idFemaleLocal, isExplicitFemale: true };

  if (isOffline) {
    // 2 (Offline). Non-male local Indonesian voice (e.g. Android/Samsung/Windows local id-ID)
    const idNonMaleLocal = localIndonesianVoices.find((v) => !MALE_VOICE_HINT.test(v.name));
    if (idNonMaleLocal) return { voice: idNonMaleLocal, isExplicitFemale: false };

    // 3 (Offline). Local Malay female/non-male voice (pronounces Indonesian cleanly offline)
    const localMalayVoices = voices.filter(
      (v) => v.localService !== false && MALAY_LANG_REGEX.test((v.lang || '').trim())
    );
    const msFemaleLocal = localMalayVoices.find(
      (v) => FEMALE_VOICE_HINT.test(v.name) && !MALE_VOICE_HINT.test(v.name)
    );
    if (msFemaleLocal) return { voice: msFemaleLocal, isExplicitFemale: true };

    const msNonMaleLocal = localMalayVoices.find((v) => !MALE_VOICE_HINT.test(v.name));
    if (msNonMaleLocal) return { voice: msNonMaleLocal, isExplicitFemale: false };

    // 4 (Offline). Any local Indonesian voice (will be pitch-adjusted upward for female contour)
    if (localIndonesianVoices.length > 0) {
      return { voice: localIndonesianVoices[0], isExplicitFemale: false };
    }

    // 5 (Offline). Never choose a cloud-only voice or English voice when offline;
    // return null so utterance.lang = 'id-ID' lets the OS native Indonesian engine handle it.
    return { voice: null, isExplicitFemale: false };
  }

  // Online priority: explicit Indonesian female voice (including Google Bahasa Indonesia cloud)
  const idFemaleAny = indonesianVoices.find(
    (v) => FEMALE_VOICE_HINT.test(v.name) && !MALE_VOICE_HINT.test(v.name)
  );
  if (idFemaleAny) return { voice: idFemaleAny, isExplicitFemale: true };

  // 2. Non-male Indonesian voice (prefer local first, then any)
  const idNonMaleLocal = localIndonesianVoices.find((v) => !MALE_VOICE_HINT.test(v.name));
  if (idNonMaleLocal) return { voice: idNonMaleLocal, isExplicitFemale: false };

  const idNonMale = indonesianVoices.find((v) => !MALE_VOICE_HINT.test(v.name));
  if (idNonMale) return { voice: idNonMale, isExplicitFemale: false };

  // 3. Any Indonesian voice
  if (indonesianVoices.length > 0) {
    return { voice: indonesianVoices[0], isExplicitFemale: false };
  }

  // 4. Close Malay female voice as fallback if OS lacks id-ID pack
  const msFemale = voices.find(
    (v) =>
      MALAY_LANG_REGEX.test((v.lang || '').trim()) &&
      !MALE_VOICE_HINT.test(v.name)
  );
  if (msFemale) return { voice: msFemale, isExplicitFemale: FEMALE_VOICE_HINT.test(msFemale.name) };

  // 5. Leave voice null so Android/iOS native TTS uses utterance.lang = 'id-ID'
  return { voice: null, isExplicitFemale: false };
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) {
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function refreshVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  try {
    const list = window.speechSynthesis.getVoices();
    if (list && list.length > 0) {
      cachedVoices = list;
    }
    return cachedVoices;
  } catch {
    return cachedVoices;
  }
}

function createIndonesianFemaleUtterance(
  text: string,
  rate = 0.96,
  options?: { forceOfflineLocal?: boolean }
): { utterance: SpeechSynthesisUtterance; isLocalVoice: boolean } {
  const utterance = new SpeechSynthesisUtterance(text);
  const voices = refreshVoices();
  const useOfflineMode = options?.forceOfflineLocal ?? isVoiceOfflineContext();
  const { voice, isExplicitFemale } = pickFemaleIndonesianVoice(voices, {
    isOffline: useOfflineMode,
  });

  utterance.lang = voice?.lang || 'id-ID';
  // Slightly calmer rate offline so local OS Indonesian TTS articulates every syllable clearly
  utterance.rate = useOfflineMode ? Math.min(rate, 0.95) : rate;
  // Use natural female pitch when an explicit female voice (e.g. Damayanti/Gadis/idc) is active,
  // and elevated female contour on generic/local fallback voices so it stays unmistakably female.
  utterance.pitch = isExplicitFemale ? 1.1 : 1.26;
  utterance.volume = 1;
  if (voice) {
    try {
      utterance.voice = voice;
    } catch {
      // Some embedded WebViews throw when assigning voice proxies; keep lang = 'id-ID'
    }
  }
  return {
    utterance,
    isLocalVoice: !voice || voice.localService !== false,
  };
}

function retainAndSpeak(
  synth: SpeechSynthesis,
  utterance: SpeechSynthesisUtterance,
  options?: {
    onStart?: () => void;
    onEnd?: () => void;
    onError?: () => void;
  }
): void {
  activeUtterances.add(utterance);
  const cleanup = () => {
    activeUtterances.delete(utterance);
  };

  utterance.onstart = () => {
    speechUnlocked = true;
    options?.onStart?.();
  };
  utterance.onend = () => {
    cleanup();
    options?.onEnd?.();
  };
  utterance.onerror = () => {
    cleanup();
    options?.onError?.();
  };

  try {
    if (synth.paused) {
      synth.resume();
    }
    synth.speak(utterance);
  } catch {
    cleanup();
    options?.onError?.();
  }
}

function queueSpeakCleanly(
  text: string,
  opts?: {
    rate?: number;
    fromUserGesture?: boolean;
    forceOfflineLocal?: boolean;
    onStart?: () => void;
    onError?: () => void;
  }
): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const synth = window.speechSynthesis;
  if (!synth) return;

  const rate = opts?.rate ?? 0.97;
  const fromGesture = Boolean(opts?.fromUserGesture);
  const forceOfflineLocal = opts?.forceOfflineLocal;

  const runSpeak = (retryWithLocal = false) => {
    const { utterance, isLocalVoice } = createIndonesianFemaleUtterance(text, rate, {
      forceOfflineLocal: retryWithLocal ? true : forceOfflineLocal,
    });
    retainAndSpeak(synth, utterance, {
      onStart: opts?.onStart,
      onError: () => {
        // If a cloud voice failed (e.g. sudden internet drop before navigator.onLine updated),
        // automatically retry once with a strictly local Indonesian female voice.
        if (!retryWithLocal && !isLocalVoice) {
          runSpeak(true);
          return;
        }
        opts?.onError?.();
      },
    });
  };

  // On iOS Safari & Android Chrome, calling cancel() synchronously right before speak()
  // can cancel the newly queued utterance. Only cancel if actually speaking/pending,
  // and inside a user gesture call speak() synchronously to keep gesture activation valid.
  if (synth.speaking || synth.pending) {
    try {
      synth.cancel();
    } catch {
      // Ignore cancel errors
    }
    if (fromGesture) {
      runSpeak();
    } else {
      setTimeout(() => runSpeak(), 60);
    }
    return;
  }

  runSpeak();
}

/**
 * Unlocks Web Audio & SpeechSynthesis inside a real mobile/tablet user gesture
 * (click / touchend / pointerdown / keydown). If a welcome greeting was blocked
 * by mobile autoplay policies, it speaks immediately inside this gesture.
 */
export function unlockSpeechForMobile(): void {
  try {
    getAudioContext();
  } catch {
    // Ignore audio context errors
  }

  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const synth = window.speechSynthesis;
  if (!synth) return;

  refreshVoices();

  if (pendingWelcomeText) {
    const textToSpeak = pendingWelcomeText;
    pendingWelcomeText = null;
    queueSpeakCleanly(textToSpeak, { rate: 0.96, fromUserGesture: true });
    return;
  }

  if (!speechUnlocked) {
    speechUnlocked = true;
    try {
      if (synth.paused) {
        synth.resume();
      }
      // Prime iOS/Android speech engine with a silent zero-volume utterance inside gesture
      if (!synth.speaking && !synth.pending) {
        const primer = new SpeechSynthesisUtterance(' ');
        primer.lang = 'id-ID';
        primer.volume = 0;
        primer.rate = 2;
        retainAndSpeak(synth, primer);
      }
    } catch {
      // Ignore priming errors
    }
  }
}

/**
 * Eagerly preloads browser voices (Android/iOS load voices asynchronously)
 * and registers one-time mobile gesture unlock hooks (touchend + click + keydown).
 */
export function initSpeechEngine(): void {
  if (typeof window === 'undefined' || speechEngineInitialized) return;
  speechEngineInitialized = true;

  if ('speechSynthesis' in window) {
    const synth = window.speechSynthesis;
    refreshVoices();
    try {
      synth.addEventListener?.('voiceschanged', () => {
        refreshVoices();
      });
    } catch {
      // Ignore older WebKit event listener quirks
    }
  }

  const handleMobileGesture = () => {
    unlockSpeechForMobile();
    if (!pendingWelcomeText && speechUnlocked) {
      window.removeEventListener('touchend', handleMobileGesture, true);
      window.removeEventListener('click', handleMobileGesture, true);
      window.removeEventListener('keydown', handleMobileGesture, true);
    }
  };

  window.addEventListener('touchend', handleMobileGesture, { capture: true, passive: true });
  window.addEventListener('click', handleMobileGesture, { capture: true, passive: true });
  window.addEventListener('keydown', handleMobileGesture, { capture: true, passive: true });
}

export function playSuccessBeep(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, now);
    osc1.frequency.setValueAtTime(1174.66, now + 0.09);

    gain1.gain.setValueAtTime(0.001, now);
    gain1.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.25);
  } catch {
    // Ignore audio errors in restricted environments
  }
}

export function speakFemaleIndonesian(
  text: string,
  fromUserGesture = false,
  options?: { forceOfflineLocal?: boolean }
): void {
  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }

    initSpeechEngine();
    const synth = window.speechSynthesis;
    if (!synth) return;

    const forceOfflineLocal = options?.forceOfflineLocal;

    // Inside a real user tap (tablet/HP), speak immediately without waiting for async voiceschanged
    if (fromUserGesture) {
      queueSpeakCleanly(text, {
        rate: forceOfflineLocal ? 0.95 : 0.98,
        fromUserGesture: true,
        forceOfflineLocal,
      });
      return;
    }

    const voices = refreshVoices();
    if (voices.length === 0 && 'onvoiceschanged' in synth) {
      let triggered = false;
      const handleVoices = () => {
        if (triggered) return;
        triggered = true;
        synth.removeEventListener?.('voiceschanged', handleVoices);
        queueSpeakCleanly(text, {
          rate: forceOfflineLocal ? 0.95 : 0.98,
          forceOfflineLocal,
        });
      };
      synth.addEventListener?.('voiceschanged', handleVoices);
      setTimeout(() => {
        if (!triggered) {
          triggered = true;
          synth.removeEventListener?.('voiceschanged', handleVoices);
          queueSpeakCleanly(text, {
            rate: forceOfflineLocal ? 0.95 : 0.98,
            forceOfflineLocal,
          });
        }
      }, 220);
      return;
    }

    queueSpeakCleanly(text, {
      rate: forceOfflineLocal ? 0.95 : 0.98,
      forceOfflineLocal,
    });
  } catch {
    // Ignore speech synthesis errors
  }
}

export const CHECKOUT_FAREWELL_TEXT =
  'Presensi Pulang Berhasil. Sampai jumpa. Hati-hati di jalan, semoga selamat sampai di tujuan';

export function buildCheckoutSuccessText(): string {
  return CHECKOUT_FAREWELL_TEXT;
}

/**
 * Pure Bahasa Indonesia speech copy for offline attendance so local Indonesian
 * female TTS articulates every word clearly without English loanword glitches.
 */
export function buildOfflineAttendanceSpeechText(
  scanType: 'masuk' | 'pulang',
  status?: 'Hadir' | 'Terlambat'
): string {
  if (scanType === 'pulang') {
    return 'Presensi pulang berhasil, data disimpan sementara di perangkat. Sampai jumpa, hati-hati di jalan, semoga selamat sampai di tujuan';
  }
  if (status === 'Terlambat') {
    return 'Presensi masuk tercatat terlambat, data disimpan sementara di perangkat';
  }
  return 'Presensi berhasil, data disimpan sementara di perangkat';
}

export function speakSuccessNotification(text = 'Presensi Berhasil'): void {
  playSuccessBeep();
  speakFemaleIndonesian(text, true);
}

export function speakCheckoutSuccessNotification(): string {
  const text = buildCheckoutSuccessText();
  speakSuccessNotification(text);
  return text;
}

export function speakOfflineAttendanceNotification(
  scanType: 'masuk' | 'pulang',
  status?: 'Hadir' | 'Terlambat'
): string {
  const text = buildOfflineAttendanceSpeechText(scanType, status);
  playSuccessBeep();
  speakFemaleIndonesian(text, true, { forceOfflineLocal: true });
  return text;
}

export function playWarningBeep(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.setValueAtTime(240, now + 0.12);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);
  } catch {
    // Ignore audio errors in restricted environments
  }
}

export function speakFemaleIndonesianMessages(messages: string[]): void {
  const cleanMessages = messages.map((m) => m.trim()).filter(Boolean);
  if (cleanMessages.length === 0) return;

  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }

    initSpeechEngine();
    const synth = window.speechSynthesis;
    if (!synth) return;

    const speakAll = () => {
      try {
        if (synth.speaking || synth.pending) {
          synth.cancel();
        }
        const runQueue = () => {
          for (const msg of cleanMessages) {
            const { utterance } = createIndonesianFemaleUtterance(msg, 0.96);
            retainAndSpeak(synth, utterance);
          }
        };
        setTimeout(runQueue, 60);
      } catch {
        // Ignore TTS failures in headless or unsupported browsers
      }
    };

    const currentVoices = refreshVoices();
    if (currentVoices.length === 0 && 'onvoiceschanged' in synth) {
      let triggered = false;
      const handleVoices = () => {
        if (triggered) return;
        triggered = true;
        synth.removeEventListener?.('voiceschanged', handleVoices);
        speakAll();
      };
      synth.addEventListener?.('voiceschanged', handleVoices);
      setTimeout(() => {
        if (!triggered) {
          triggered = true;
          synth.removeEventListener?.('voiceschanged', handleVoices);
          speakAll();
        }
      }, 220);
      return;
    }

    speakAll();
  } catch {
    // Ignore speech synthesis errors
  }
}

export function speakDuplicateRejectedNotification(
  text = 'Presensi Ganda, Data Ditolak'
): void {
  playWarningBeep();
  speakFemaleIndonesian(text, true);
}

export function speakWaliKelasReminder(messages: string[]): void {
  if (!messages || messages.length === 0) return;
  playWarningBeep();
  speakFemaleIndonesianMessages(messages);
}

export function buildWelcomeGreetingText(namaSekolah: string): string {
  const cleanName = namaSekolah.trim() || 'Sekolah';
  return `Selamat Datang di Aplikasi Presensi Digital ${cleanName}`;
}

export function speakWelcomeGreeting(
  namaSekolah: string,
  fromUserGesture = false
): string {
  const text = buildWelcomeGreetingText(namaSekolah);
  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return text;
    }

    initSpeechEngine();
    const synth = window.speechSynthesis;
    if (!synth) return text;

    // If invoked directly from a user tap (e.g. tapping splash or speaker button on tablet/HP),
    // speak synchronously so iOS Safari and Android Chrome allow audio playback immediately.
    if (fromUserGesture) {
      pendingWelcomeText = null;
      queueSpeakCleanly(text, { rate: 0.96, fromUserGesture: true });
      return text;
    }

    let started = false;
    let fallbackAttached = false;

    const cleanupFallback = () => {
      if (!fallbackAttached) return;
      fallbackAttached = false;
      window.removeEventListener('touchend', handleFirstInteraction, true);
      window.removeEventListener('click', handleFirstInteraction, true);
      window.removeEventListener('pointerdown', handleFirstInteraction, true);
      window.removeEventListener('keydown', handleFirstInteraction, true);
    };

    const handleFirstInteraction = () => {
      cleanupFallback();
      if (!started) {
        pendingWelcomeText = null;
        started = true;
        queueSpeakCleanly(text, { rate: 0.96, fromUserGesture: true });
      }
    };

    const attachFallback = () => {
      if (fallbackAttached || started) return;
      fallbackAttached = true;
      pendingWelcomeText = text;
      // Listen on touchend & click in capture phase so iOS Safari & Android Chrome
      // accept the user gesture and play the female voice immediately on first tap.
      window.addEventListener('touchend', handleFirstInteraction, {
        capture: true,
        once: true,
        passive: true,
      });
      window.addEventListener('click', handleFirstInteraction, {
        capture: true,
        once: true,
        passive: true,
      });
      window.addEventListener('pointerdown', handleFirstInteraction, {
        capture: true,
        once: true,
        passive: true,
      });
      window.addEventListener('keydown', handleFirstInteraction, {
        capture: true,
        once: true,
        passive: true,
      });
    };

    const attemptAutoSpeak = () => {
      queueSpeakCleanly(text, {
        rate: 0.96,
        fromUserGesture: false,
        onStart: () => {
          started = true;
          pendingWelcomeText = null;
          cleanupFallback();
        },
        onError: () => {
          if (!started) {
            attachFallback();
          }
        },
      });

      // On Android & iOS, autoplay speech fails silently without firing onerror.
      // Check after 550ms and arm mobile touch/click unlock fallback.
      setTimeout(() => {
        if (!started && !synth.speaking) {
          attachFallback();
        }
      }, 550);
    };

    const currentVoices = refreshVoices();
    if (currentVoices.length === 0 && 'onvoiceschanged' in synth) {
      let triggered = false;
      const handleVoices = () => {
        if (triggered) return;
        triggered = true;
        synth.removeEventListener?.('voiceschanged', handleVoices);
        attemptAutoSpeak();
      };
      synth.addEventListener?.('voiceschanged', handleVoices);
      setTimeout(() => {
        if (!triggered) {
          triggered = true;
          synth.removeEventListener?.('voiceschanged', handleVoices);
          attemptAutoSpeak();
        }
      }, 220);
      return text;
    }

    attemptAutoSpeak();
  } catch {
    // Ignore speech synthesis errors in restricted browsers
  }

  return text;
}
