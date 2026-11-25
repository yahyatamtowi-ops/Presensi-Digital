import {
  buildClientTtsEndpointUrl,
  isLikelyMp3Audio,
  sanitizeTtsText,
  splitTtsChunks,
} from './ttsText';

const TTS_CACHE_NAME = 'presensi-tts-v1';
const MAX_MEMORY_CLIPS = 48;

// Minimal valid 44-byte silent PCM WAV (1 sample at 8kHz) used to unlock HTMLAudioElement
// inside a real user gesture on iPadOS Safari & Android Tablet browsers.
const SILENT_WAV_DATA_URI =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

let audioCtx: AudioContext | null = null;
let sharedHtmlAudio: HTMLAudioElement | null = null;
let htmlAudioUnlocked = false;
let audioContextUnlocked = false;
let cachedVoices: SpeechSynthesisVoice[] = [];
let speechEngineInitialized = false;
let speechUnlocked = false;
let pendingWelcomeText: string | null = null;
let playbackGeneration = 0;
let activeBufferSource: AudioBufferSourceNode | null = null;
let activeBlobUrl: string | null = null;
let preloadedSchoolKey: string | null = null;

const memoryAudioCache = new Map<string, ArrayBuffer>();
const inflightAudioFetches = new Map<string, Promise<ArrayBuffer | null>>();
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

export interface UnlockSpeechOptions {
  /** Skip queueing a silent SpeechSynthesisUtterance when real speech is about to start immediately. */
  skipSpeechPrimer?: boolean;
  /** Whether to immediately speak any deferred welcome greeting during this unlock call. Defaults to true. */
  consumePendingWelcome?: boolean;
}

/**
 * Selects the best female Indonesian fallback voice for browser SpeechSynthesis
 * (used only when offline AND the unified MP3 voice clip is not yet cached).
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

  // 1. Explicit Indonesian female local voice
  const idFemaleLocal = localIndonesianVoices.find(
    (v) => FEMALE_VOICE_HINT.test(v.name) && !MALE_VOICE_HINT.test(v.name)
  );
  if (idFemaleLocal) return { voice: idFemaleLocal, isExplicitFemale: true };

  if (isOffline) {
    // 2 (Offline). Non-male local Indonesian voice
    const idNonMaleLocal = localIndonesianVoices.find((v) => !MALE_VOICE_HINT.test(v.name));
    if (idNonMaleLocal) return { voice: idNonMaleLocal, isExplicitFemale: false };

    // 3 (Offline). Local Malay female/non-male voice
    const localMalayVoices = voices.filter(
      (v) => v.localService !== false && MALAY_LANG_REGEX.test((v.lang || '').trim())
    );
    const msFemaleLocal = localMalayVoices.find(
      (v) => FEMALE_VOICE_HINT.test(v.name) && !MALE_VOICE_HINT.test(v.name)
    );
    if (msFemaleLocal) return { voice: msFemaleLocal, isExplicitFemale: true };

    const msNonMaleLocal = localMalayVoices.find((v) => !MALE_VOICE_HINT.test(v.name));
    if (msNonMaleLocal) return { voice: msNonMaleLocal, isExplicitFemale: false };

    // 4 (Offline). Any local Indonesian voice (pitch-adjusted upward)
    if (localIndonesianVoices.length > 0) {
      return { voice: localIndonesianVoices[0], isExplicitFemale: false };
    }

    // 5 (Offline). Never choose a cloud-only or English voice when offline
    return { voice: null, isExplicitFemale: false };
  }

  // Online priority: explicit Indonesian female voice (including Google Bahasa Indonesia)
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
    (v) => MALAY_LANG_REGEX.test((v.lang || '').trim()) && !MALE_VOICE_HINT.test(v.name)
  );
  if (msFemale) return { voice: msFemale, isExplicitFemale: FEMALE_VOICE_HINT.test(msFemale.name) };

  // 5. Leave voice null so OS native TTS uses utterance.lang = 'id-ID'
  return { voice: null, isExplicitFemale: false };
}

function getAudioContext(resumeIfSuspended = true): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) {
    try {
      audioCtx = new Ctx();
    } catch {
      return null;
    }
  }
  if (resumeIfSuspended && audioCtx.state === 'suspended') {
    void audioCtx.resume().then(() => {
      if (audioCtx && audioCtx.state === 'running') {
        audioContextUnlocked = true;
      }
    }).catch(() => {});
  } else if (audioCtx.state === 'running') {
    audioContextUnlocked = true;
  }
  return audioCtx;
}

function getSharedHtmlAudio(): HTMLAudioElement | null {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return null;
  if (!sharedHtmlAudio) {
    const el = new Audio();
    el.preload = 'auto';
    // Required for iOS/iPadOS Safari inline audio playback without fullscreen takeover
    el.setAttribute('playsinline', 'true');
    el.setAttribute('webkit-playsinline', 'true');
    sharedHtmlAudio = el;
  }
  return sharedHtmlAudio;
}

function revokeActiveBlobUrl(): void {
  if (activeBlobUrl) {
    try {
      URL.revokeObjectURL(activeBlobUrl);
    } catch {
      // Ignore revoke errors
    }
    activeBlobUrl = null;
  }
}

/**
 * Unlocks Web Audio API (AudioContext) AND reusable HTMLAudioElement synchronously
 * inside a real user gesture (click / touchend / keydown) so iPadOS Safari,
 * Android Chrome Tablets, Samsung Internet, and HP browsers reliably play audio.
 */
function unlockAudioHardware(): void {
  try {
    const ctx = getAudioContext(true);
    if (ctx) {
      const needsSilentUnlock = !audioContextUnlocked || ctx.state !== 'running';
      if (ctx.state === 'suspended') {
        void ctx.resume().then(() => {
          if (audioCtx && audioCtx.state === 'running') {
            audioContextUnlocked = true;
          }
        }).catch(() => {});
      }
      if (needsSilentUnlock) {
        // Play a 1-sample silent AudioBuffer synchronously inside the user gesture
        // to permanently unlock Web Audio playback on iOS/iPadOS Safari & Android Tablets.
        const silentBuffer = ctx.createBuffer(1, 1, 22050);
        const source = ctx.createBufferSource();
        source.buffer = silentBuffer;
        source.connect(ctx.destination);
        source.start(0);
        if (ctx.state === 'running') {
          audioContextUnlocked = true;
        }
      }
    }
  } catch {
    // Ignore AudioContext unlock errors
  }

  try {
    const el = getSharedHtmlAudio();
    if (el && !htmlAudioUnlocked) {
      el.muted = true;
      el.src = SILENT_WAV_DATA_URI;
      const playPromise = el.play();
      if (playPromise && typeof playPromise.then === 'function') {
        void playPromise
          .then(() => {
            htmlAudioUnlocked = true;
            try {
              el.pause();
              el.currentTime = 0;
              el.muted = false;
            } catch {
              // Ignore reset quirks
            }
          })
          .catch(() => {
            el.muted = false;
          });
      } else {
        htmlAudioUnlocked = true;
        el.muted = false;
      }
    }
  } catch {
    // Ignore HTMLAudioElement unlock errors
  }
}

function setMemoryCachedClip(key: string, buffer: ArrayBuffer): void {
  if (memoryAudioCache.size >= MAX_MEMORY_CLIPS) {
    const oldest = memoryAudioCache.keys().next().value;
    if (oldest !== undefined) {
      memoryAudioCache.delete(oldest);
    }
  }
  memoryAudioCache.set(key, buffer);
}

async function readFromBrowserCache(url: string): Promise<ArrayBuffer | null> {
  if (typeof window === 'undefined' || !('caches' in window)) return null;
  try {
    const cache = await window.caches.open(TTS_CACHE_NAME);
    const matched = await cache.match(url);
    if (!matched || !matched.ok) return null;
    const buf = await matched.arrayBuffer();
    const bytes = new Uint8Array(buf);
    if (bytes.length < 128 || !isLikelyMp3Audio(bytes)) return null;
    return buf;
  } catch {
    return null;
  }
}

async function writeToBrowserCache(url: string, buffer: ArrayBuffer): Promise<void> {
  if (typeof window === 'undefined' || !('caches' in window)) return;
  try {
    const cache = await window.caches.open(TTS_CACHE_NAME);
    const response = new Response(buffer.slice(0), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    });
    await cache.put(url, response);
  } catch {
    // Ignore Cache Storage quota / private browsing errors
  }
}

/**
 * Fetches (or reads from memory/Cache Storage) the unified Google Bahasa Indonesia
 * female MP3 audio clip for a sanitized text chunk via same-origin /api/tts.
 */
async function loadUnifiedVoiceClip(
  chunk: string,
  options?: { cacheOnly?: boolean }
): Promise<ArrayBuffer | null> {
  const clean = sanitizeTtsText(chunk, 200);
  if (!clean) return null;

  const memHit = memoryAudioCache.get(clean);
  if (memHit) return memHit;

  const endpointUrl = buildClientTtsEndpointUrl(clean);
  const cacheHit = await readFromBrowserCache(endpointUrl);
  if (cacheHit) {
    setMemoryCachedClip(clean, cacheHit);
    return cacheHit;
  }

  if (options?.cacheOnly || isVoiceOfflineContext() || typeof fetch !== 'function') {
    return null;
  }

  const existingInflight = inflightAudioFetches.get(clean);
  if (existingInflight) {
    return existingInflight;
  }

  const fetchTask = (async (): Promise<ArrayBuffer | null> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(endpointUrl, {
        method: 'GET',
        cache: 'force-cache',
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (contentType && !contentType.includes('audio') && !contentType.includes('octet-stream')) {
        return null;
      }
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      if (bytes.length < 128 || !isLikelyMp3Audio(bytes)) {
        return null;
      }
      setMemoryCachedClip(clean, buffer);
      void writeToBrowserCache(endpointUrl, buffer);
      return buffer;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
      inflightAudioFetches.delete(clean);
    }
  })();

  inflightAudioFetches.set(clean, fetchTask);
  return fetchTask;
}

/**
 * Stops any currently playing MP3 voice clip or browser SpeechSynthesis utterance.
 */
export function stopAllVoicePlayback(): void {
  playbackGeneration += 1;

  if (activeBufferSource) {
    try {
      activeBufferSource.onended = null;
      activeBufferSource.stop();
      activeBufferSource.disconnect();
    } catch {
      // Ignore already-stopped source errors
    }
    activeBufferSource = null;
  }

  if (sharedHtmlAudio) {
    try {
      sharedHtmlAudio.onended = null;
      sharedHtmlAudio.onerror = null;
      sharedHtmlAudio.pause();
      sharedHtmlAudio.currentTime = 0;
    } catch {
      // Ignore HTMLAudioElement stop errors
    }
  }
  revokeActiveBlobUrl();

  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
        window.speechSynthesis.cancel();
      }
    } catch {
      // Ignore speechSynthesis cancel errors
    }
  }
}

type ClipPlaybackResult = 'played' | 'cancelled' | 'blocked' | 'failed';

async function playSingleBufferViaWebAudio(
  buffer: ArrayBuffer,
  generation: number,
  onStart?: () => void
): Promise<ClipPlaybackResult> {
  const ctx = getAudioContext(true);
  if (!ctx) return 'failed';

  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      return 'blocked';
    }
  }

  if (generation !== playbackGeneration) return 'cancelled';
  if (ctx.state !== 'running') return 'blocked';

  audioContextUnlocked = true;

  let decoded: AudioBuffer;
  try {
    // Always pass a copy (.slice(0)) because decodeAudioData detaches the ArrayBuffer in Safari/Chrome
    decoded = await ctx.decodeAudioData(buffer.slice(0));
  } catch {
    return 'failed';
  }

  if (generation !== playbackGeneration) return 'cancelled';

  return new Promise<ClipPlaybackResult>((resolve) => {
    try {
      const source = ctx.createBufferSource();
      source.buffer = decoded;
      source.connect(ctx.destination);
      activeBufferSource = source;

      source.onended = () => {
        if (activeBufferSource === source) {
          activeBufferSource = null;
        }
        resolve(generation === playbackGeneration ? 'played' : 'cancelled');
      };

      onStart?.();
      source.start(0);
    } catch {
      activeBufferSource = null;
      resolve('failed');
    }
  });
}

async function playSingleBufferViaHtmlAudio(
  buffer: ArrayBuffer,
  generation: number,
  onStart?: () => void
): Promise<ClipPlaybackResult> {
  const el = getSharedHtmlAudio();
  if (!el || typeof URL === 'undefined' || typeof Blob === 'undefined') {
    return 'failed';
  }

  revokeActiveBlobUrl();
  const blob = new Blob([buffer.slice(0)], { type: 'audio/mpeg' });
  const blobUrl = URL.createObjectURL(blob);
  activeBlobUrl = blobUrl;

  return new Promise<ClipPlaybackResult>((resolve) => {
    let settled = false;
    const finish = (result: ClipPlaybackResult) => {
      if (settled) return;
      settled = true;
      el.onended = null;
      el.onerror = null;
      el.onplaying = null;
      if (activeBlobUrl === blobUrl) {
        revokeActiveBlobUrl();
      }
      resolve(result);
    };

    el.muted = false;
    el.volume = 1;
    el.onplaying = () => {
      htmlAudioUnlocked = true;
      onStart?.();
    };
    el.onended = () => finish(generation === playbackGeneration ? 'played' : 'cancelled');
    el.onerror = () => finish('failed');
    el.src = blobUrl;

    try {
      const playPromise = el.play();
      if (playPromise && typeof playPromise.then === 'function') {
        void playPromise
          .then(() => {
            htmlAudioUnlocked = true;
            onStart?.();
          })
          .catch((err: unknown) => {
            const name = err instanceof Error ? err.name : '';
            if (name === 'NotAllowedError') {
              finish('blocked');
            } else {
              finish('failed');
            }
          });
      } else {
        htmlAudioUnlocked = true;
        onStart?.();
      }
    } catch {
      finish('failed');
    }
  });
}

/**
 * Plays one or more Indonesian text chunks using the unified /api/tts female MP3 voice.
 * Uses Web Audio API (AudioContext) first and automatically falls back to HTMLAudioElement.
 */
async function playUnifiedIndonesianMp3Chunks(
  chunks: string[],
  options?: {
    fromUserGesture?: boolean;
    cacheOnly?: boolean;
    onStart?: () => void;
  }
): Promise<ClipPlaybackResult> {
  if (chunks.length === 0) return 'failed';

  stopAllVoicePlayback();
  const generation = playbackGeneration;

  if (options?.fromUserGesture) {
    unlockAudioHardware();
  }

  // Prefetch all chunks concurrently so multi-sentence reminders have zero awkward gaps
  const buffers = await Promise.all(
    chunks.map((chunk) => loadUnifiedVoiceClip(chunk, { cacheOnly: options?.cacheOnly }))
  );

  if (generation !== playbackGeneration) return 'cancelled';
  if (buffers.some((b) => !b)) {
    return 'failed';
  }

  let notifiedStart = false;
  const triggerStartOnce = () => {
    if (!notifiedStart) {
      notifiedStart = true;
      speechUnlocked = true;
      options?.onStart?.();
    }
  };

  for (const buf of buffers) {
    if (!buf) return 'failed';
    if (generation !== playbackGeneration) return 'cancelled';

    // Try Web Audio API first (best reliability on iPadOS Safari, Android Tablets, HP, and Desktop)
    const webAudioResult = await playSingleBufferViaWebAudio(buf, generation, triggerStartOnce);
    if (webAudioResult === 'played' || webAudioResult === 'cancelled') {
      continue;
    }

    // Fallback to unlocked HTMLAudioElement (helps on browsers with AudioContext codec quirks)
    const htmlAudioResult = await playSingleBufferViaHtmlAudio(buf, generation, triggerStartOnce);
    if (htmlAudioResult === 'played' || htmlAudioResult === 'cancelled') {
      continue;
    }

    if (webAudioResult === 'blocked' || htmlAudioResult === 'blocked') {
      return 'blocked';
    }
    return 'failed';
  }

  return 'played';
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
  utterance.rate = useOfflineMode ? Math.min(rate, 0.95) : rate;
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

/**
 * Browser SpeechSynthesis fallback (used ONLY when offline & uncached, or if /api/tts is unreachable).
 * Always waits 80ms after synth.cancel() so Android Chrome Tablets and iPadOS Safari never drop the new utterance.
 */
function queueSpeechSynthesisFallback(
  text: string,
  opts?: {
    rate?: number;
    forceOfflineLocal?: boolean;
    onStart?: () => void;
    onError?: () => void;
  }
): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const synth = window.speechSynthesis;
  if (!synth) return;

  const rate = opts?.rate ?? 0.97;
  const forceOfflineLocal = opts?.forceOfflineLocal;

  const runSpeak = (retryWithLocal = false) => {
    const { utterance, isLocalVoice } = createIndonesianFemaleUtterance(text, rate, {
      forceOfflineLocal: retryWithLocal ? true : forceOfflineLocal,
    });
    retainAndSpeak(synth, utterance, {
      onStart: opts?.onStart,
      onError: () => {
        if (!retryWithLocal && !isLocalVoice) {
          runSpeak(true);
          return;
        }
        opts?.onError?.();
      },
    });
  };

  if (synth.speaking || synth.pending) {
    try {
      synth.cancel();
    } catch {
      // Ignore cancel errors
    }
    setTimeout(() => runSpeak(), 80);
    return;
  }

  runSpeak();
}

function queueMultipleSpeechSynthesisFallback(messages: string[]): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const synth = window.speechSynthesis;
  if (!synth) return;

  const speakQueue = () => {
    for (const msg of messages) {
      const { utterance } = createIndonesianFemaleUtterance(msg, 0.96);
      retainAndSpeak(synth, utterance);
    }
  };

  if (synth.speaking || synth.pending) {
    try {
      synth.cancel();
    } catch {
      // Ignore cancel errors
    }
    setTimeout(speakQueue, 80);
    return;
  }

  speakQueue();
}

/**
 * Unlocks Web Audio, HTMLAudioElement, and SpeechSynthesis inside a real mobile/tablet user gesture
 * (click / touchend / keydown). When `skipSpeechPrimer` is true (e.g. tapping the Speaker icon or
 * OpeningSplash), avoids queueing a silent SpeechSynthesis utterance that could race with real playback.
 */
export function unlockSpeechForMobile(options?: UnlockSpeechOptions): void {
  unlockAudioHardware();

  const shouldConsumePending = options?.consumePendingWelcome !== false;
  if (shouldConsumePending && pendingWelcomeText) {
    const textToSpeak = pendingWelcomeText;
    pendingWelcomeText = null;
    speakFemaleIndonesian(textToSpeak, true);
    return;
  }

  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const synth = window.speechSynthesis;
  if (!synth) return;

  refreshVoices();

  if (!options?.skipSpeechPrimer && !speechUnlocked) {
    speechUnlocked = true;
    try {
      if (synth.paused) {
        synth.resume();
      }
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
 * Eagerly preloads browser fallback voices and registers mobile/tablet gesture unlock hooks
 * (`touchend`, `click`, `keydown` — intentionally omitting `pointerdown` so iPadOS Safari
 * never consumes the gesture before `touchend` unlocks AudioContext).
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
    unlockSpeechForMobile({ skipSpeechPrimer: true });
    // Keep gesture listeners attached until AudioContext is genuinely running AND no welcome is pending
    if (audioContextUnlocked && !pendingWelcomeText) {
      window.removeEventListener('touchend', handleMobileGesture, true);
      window.removeEventListener('click', handleMobileGesture, true);
      window.removeEventListener('keydown', handleMobileGesture, true);
    }
  };

  window.addEventListener('touchend', handleMobileGesture, { capture: true, passive: true });
  window.addEventListener('click', handleMobileGesture, { capture: true, passive: true });
  window.addEventListener('keydown', handleMobileGesture, { capture: true, passive: true });
}

/**
 * Quietly preloads core school female voice clips into memory & Cache Storage
 * so HP, Tablet, and Laptop speak instantaneously (even if Wi-Fi later drops).
 */
export function preloadSchoolVoiceClips(namaSekolah: string): void {
  if (typeof window === 'undefined' || isVoiceOfflineContext()) return;
  const schoolKey = (namaSekolah || '').trim() || 'Sekolah';
  if (preloadedSchoolKey === schoolKey) return;
  preloadedSchoolKey = schoolKey;

  const corePhrases = [
    buildWelcomeGreetingText(schoolKey),
    'Presensi Berhasil',
    buildCheckoutSuccessText(),
    'Presensi Ganda, Data Ditolak',
    buildOfflineAttendanceSpeechText('masuk', 'Hadir'),
    buildOfflineAttendanceSpeechText('masuk', 'Terlambat'),
    buildOfflineAttendanceSpeechText('pulang'),
  ];

  void (async () => {
    for (const phrase of corePhrases) {
      if (isVoiceOfflineContext()) break;
      const chunks = splitTtsChunks(phrase);
      for (const chunk of chunks) {
        if (isVoiceOfflineContext()) break;
        await loadUnifiedVoiceClip(chunk).catch(() => null);
      }
    }
  })();
}

export function playSuccessBeep(): void {
  try {
    const ctx = getAudioContext(true);
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
  const cleanText = sanitizeTtsText(text);
  if (!cleanText || typeof window === 'undefined') return;

  try {
    initSpeechEngine();
    if (fromUserGesture) {
      unlockAudioHardware();
    }

    const chunks = splitTtsChunks(cleanText);
    const cacheOnly = Boolean(options?.forceOfflineLocal) || isVoiceOfflineContext();

    void playUnifiedIndonesianMp3Chunks(chunks, {
      fromUserGesture,
      cacheOnly,
    })
      .then((result) => {
        if (result === 'played' || result === 'cancelled') {
          return;
        }
        // Fallback to local Indonesian SpeechSynthesis only if MP3 voice failed or is uncached offline
        queueSpeechSynthesisFallback(cleanText, {
          rate: options?.forceOfflineLocal ? 0.95 : 0.98,
          forceOfflineLocal: options?.forceOfflineLocal,
        });
      })
      .catch(() => {
        queueSpeechSynthesisFallback(cleanText, {
          rate: options?.forceOfflineLocal ? 0.95 : 0.98,
          forceOfflineLocal: options?.forceOfflineLocal,
        });
      });
  } catch {
    // Ignore speech errors in restricted environments
  }
}

export const CHECKOUT_FAREWELL_TEXT =
  'Presensi Pulang Berhasil. Sampai jumpa. Hati-hati di jalan, semoga selamat sampai di tujuan';

export function buildCheckoutSuccessText(): string {
  return CHECKOUT_FAREWELL_TEXT;
}

/**
 * Pure Bahasa Indonesia speech copy for offline attendance so voice playback
 * articulates every word clearly without English loanword glitches.
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
    const ctx = getAudioContext(true);
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
  const cleanMessages = messages.map((m) => sanitizeTtsText(m)).filter(Boolean);
  if (cleanMessages.length === 0 || typeof window === 'undefined') return;

  try {
    initSpeechEngine();
    const allChunks = cleanMessages.flatMap((msg) => splitTtsChunks(msg));
    const cacheOnly = isVoiceOfflineContext();

    void playUnifiedIndonesianMp3Chunks(allChunks, {
      fromUserGesture: false,
      cacheOnly,
    })
      .then((result) => {
        if (result === 'played' || result === 'cancelled') {
          return;
        }
        queueMultipleSpeechSynthesisFallback(cleanMessages);
      })
      .catch(() => {
        queueMultipleSpeechSynthesisFallback(cleanMessages);
      });
  } catch {
    // Ignore speech errors
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
  if (typeof window === 'undefined') return text;

  try {
    initSpeechEngine();
    const chunks = splitTtsChunks(text);

    // Direct user tap (e.g., tapping the top-right Speaker button or OpeningSplash on Tablet/HP):
    // unlock hardware synchronously and play the exact same Google Bahasa Indonesia female MP3.
    if (fromUserGesture) {
      pendingWelcomeText = null;
      unlockAudioHardware();
      void playUnifiedIndonesianMp3Chunks(chunks, {
        fromUserGesture: true,
        cacheOnly: isVoiceOfflineContext(),
      })
        .then((result) => {
          if (result === 'played' || result === 'cancelled') return;
          queueSpeechSynthesisFallback(text, { rate: 0.96 });
        })
        .catch(() => {
          queueSpeechSynthesisFallback(text, { rate: 0.96 });
        });
      return text;
    }

    // Automatic greeting after splash fade-out:
    // attempt unified MP3 playback; if mobile/tablet autoplay policy blocks it,
    // arm a one-time touchend/click/keydown unlock so the very first tap speaks immediately.
    let started = false;
    let fallbackAttached = false;

    const cleanupFallback = () => {
      if (!fallbackAttached) return;
      fallbackAttached = false;
      window.removeEventListener('touchend', handleFirstInteraction, true);
      window.removeEventListener('click', handleFirstInteraction, true);
      window.removeEventListener('keydown', handleFirstInteraction, true);
    };

    const handleFirstInteraction = () => {
      cleanupFallback();
      if (!started && pendingWelcomeText) {
        const queuedText = pendingWelcomeText;
        pendingWelcomeText = null;
        started = true;
        unlockAudioHardware();
        speakFemaleIndonesian(queuedText, true);
      }
    };

    const attachFallback = () => {
      if (fallbackAttached || started) return;
      fallbackAttached = true;
      pendingWelcomeText = text;
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
      window.addEventListener('keydown', handleFirstInteraction, {
        capture: true,
        once: true,
        passive: true,
      });
    };

    void playUnifiedIndonesianMp3Chunks(chunks, {
      fromUserGesture: false,
      cacheOnly: isVoiceOfflineContext(),
      onStart: () => {
        started = true;
        pendingWelcomeText = null;
        cleanupFallback();
      },
    })
      .then((result) => {
        if (result === 'played' || result === 'cancelled') {
          started = true;
          pendingWelcomeText = null;
          cleanupFallback();
          return;
        }
        if (result === 'blocked') {
          attachFallback();
          return;
        }
        // Only if offline/uncached or /api/tts failed, try SpeechSynthesis fallback
        queueSpeechSynthesisFallback(text, {
          rate: 0.96,
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
        setTimeout(() => {
          const synthSpeaking =
            typeof window !== 'undefined' &&
            'speechSynthesis' in window &&
            window.speechSynthesis.speaking;
          if (!started && !synthSpeaking) {
            attachFallback();
          }
        }, 550);
      })
      .catch(() => {
        if (!started) {
          attachFallback();
        }
      });
  } catch {
    // Ignore errors in restricted browsers
  }

  return text;
}
