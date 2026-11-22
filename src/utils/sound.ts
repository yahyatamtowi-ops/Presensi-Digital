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
  /female|woman|wanita|perempuan|gadis|damayanti|siti|ayu|putri|melati|lina|dewi|id[-_]id[-_]x[-_]id[cef]|google bahasa indonesia/i;

const MALE_VOICE_HINT =
  /\bmale\b|\bman\b|pria|laki|ardi|andika|budi|id[-_]id[-_]x[-_]id[dg]/i;

export function isIndonesianLangTag(lang: string): boolean {
  return INDONESIAN_LANG_REGEX.test((lang || '').trim());
}

/**
 * Selects the best female Indonesian voice across Desktop, Android (Chrome/Samsung TTS),
 * and iOS/iPadOS (Safari Damayanti). Never hijacks Indonesian text with an English voice.
 */
export function pickFemaleIndonesianVoice<T extends VoiceLike>(
  voices: T[]
): { voice: T | null; isExplicitFemale: boolean } {
  if (!voices || voices.length === 0) {
    return { voice: null, isExplicitFemale: false };
  }

  const indonesianVoices = voices.filter((v) => isIndonesianLangTag(v.lang));

  // 1. Explicit Indonesian female voice (prefer localService on mobile for reliability, then any)
  const idFemaleLocal = indonesianVoices.find(
    (v) =>
      v.localService !== false &&
      FEMALE_VOICE_HINT.test(v.name) &&
      !MALE_VOICE_HINT.test(v.name)
  );
  if (idFemaleLocal) return { voice: idFemaleLocal, isExplicitFemale: true };

  const idFemaleAny = indonesianVoices.find(
    (v) => FEMALE_VOICE_HINT.test(v.name) && !MALE_VOICE_HINT.test(v.name)
  );
  if (idFemaleAny) return { voice: idFemaleAny, isExplicitFemale: true };

  // 2. Non-male Indonesian voice (Android default Indonesian voice is typically female)
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
  rate = 0.96
): SpeechSynthesisUtterance {
  const utterance = new SpeechSynthesisUtterance(text);
  const voices = refreshVoices();
  const { voice, isExplicitFemale } = pickFemaleIndonesianVoice(voices);

  utterance.lang = voice?.lang || 'id-ID';
  utterance.rate = rate;
  // Use natural female pitch when an explicit female voice (e.g. Damayanti/Gadis/idc) is active,
  // and slightly elevated female contour on generic voices so mobile engines stay clear.
  utterance.pitch = isExplicitFemale ? 1.08 : 1.22;
  utterance.volume = 1;
  if (voice) {
    utterance.voice = voice;
  }
  return utterance;
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
    onStart?: () => void;
    onError?: () => void;
  }
): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const synth = window.speechSynthesis;
  if (!synth) return;

  const rate = opts?.rate ?? 0.97;
  const fromGesture = Boolean(opts?.fromUserGesture);

  const runSpeak = () => {
    const utterance = createIndonesianFemaleUtterance(text, rate);
    retainAndSpeak(synth, utterance, {
      onStart: opts?.onStart,
      onError: opts?.onError,
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
      setTimeout(runSpeak, 60);
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

export function speakFemaleIndonesian(text: string, fromUserGesture = false): void {
  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }

    initSpeechEngine();
    const synth = window.speechSynthesis;
    if (!synth) return;

    // Inside a real user tap (tablet/HP), speak immediately without waiting for async voiceschanged
    if (fromUserGesture) {
      queueSpeakCleanly(text, { rate: 0.98, fromUserGesture: true });
      return;
    }

    const voices = refreshVoices();
    if (voices.length === 0 && 'onvoiceschanged' in synth) {
      let triggered = false;
      const handleVoices = () => {
        if (triggered) return;
        triggered = true;
        synth.removeEventListener?.('voiceschanged', handleVoices);
        queueSpeakCleanly(text, { rate: 0.98 });
      };
      synth.addEventListener?.('voiceschanged', handleVoices);
      setTimeout(() => {
        if (!triggered) {
          triggered = true;
          synth.removeEventListener?.('voiceschanged', handleVoices);
          queueSpeakCleanly(text, { rate: 0.98 });
        }
      }, 220);
      return;
    }

    queueSpeakCleanly(text, { rate: 0.98 });
  } catch {
    // Ignore speech synthesis errors
  }
}

export const CHECKOUT_FAREWELL_TEXT =
  'Presensi Pulang Berhasil. Sampai jumpa. Hati-hati di jalan, semoga selamat sampai di tujuan';

export function buildCheckoutSuccessText(): string {
  return CHECKOUT_FAREWELL_TEXT;
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
            const utterance = createIndonesianFemaleUtterance(msg, 0.96);
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
