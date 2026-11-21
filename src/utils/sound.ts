let audioCtx: AudioContext | null = null;

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

function pickFemaleIndonesianVoice(
  voices: SpeechSynthesisVoice[]
): SpeechSynthesisVoice | null {
  if (!voices || voices.length === 0) return null;

  const femaleHint =
    /female|woman|wanita|perempuan|gadis|damayanti|siti|ayu|putri|melati|natural|google bahasa indonesia|aria|jenny|zira|samantha/i;

  const idFemale = voices.find(
    (v) => v.lang.toLowerCase().startsWith('id') && femaleHint.test(v.name)
  );
  if (idFemale) return idFemale;

  const idAny = voices.find((v) => v.lang.toLowerCase().startsWith('id'));
  if (idAny) return idAny;

  const msFemale = voices.find(
    (v) => v.lang.toLowerCase().startsWith('ms') && femaleHint.test(v.name)
  );
  if (msFemale) return msFemale;

  const anyFemale = voices.find((v) => femaleHint.test(v.name));
  return anyFemale ?? null;
}

export function speakFemaleIndonesian(text: string): void {
  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }

    const synth = window.speechSynthesis;
    if (!synth) return;

    const speakNow = () => {
      try {
        synth.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'id-ID';
        utterance.rate = 0.98;
        utterance.pitch = 1.25; // Female vocal pitch contour
        utterance.volume = 1;

        const voices = synth.getVoices();
        const chosen = pickFemaleIndonesianVoice(voices);
        if (chosen) {
          utterance.voice = chosen;
        }
        synth.speak(utterance);
      } catch {
        // Ignore TTS failures in headless or unsupported browsers
      }
    };

    const currentVoices = synth.getVoices();
    if (currentVoices.length === 0 && 'onvoiceschanged' in synth) {
      let triggered = false;
      const handleVoices = () => {
        if (triggered) return;
        triggered = true;
        synth.removeEventListener('voiceschanged', handleVoices);
        speakNow();
      };
      synth.addEventListener('voiceschanged', handleVoices);
      setTimeout(() => {
        if (!triggered) {
          triggered = true;
          synth.removeEventListener('voiceschanged', handleVoices);
          speakNow();
        }
      }, 150);
      return;
    }

    speakNow();
  } catch {
    // Ignore speech synthesis errors
  }
}

export function speakSuccessNotification(text = 'Presensi Berhasil'): void {
  playSuccessBeep();
  speakFemaleIndonesian(text);
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

    const synth = window.speechSynthesis;
    if (!synth) return;

    const speakAll = () => {
      try {
        synth.cancel();
        const voices = synth.getVoices();
        const chosen = pickFemaleIndonesianVoice(voices);

        for (const msg of cleanMessages) {
          const utterance = new SpeechSynthesisUtterance(msg);
          utterance.lang = 'id-ID';
          utterance.rate = 0.96;
          utterance.pitch = 1.25; // Female vocal pitch contour
          utterance.volume = 1;
          if (chosen) {
            utterance.voice = chosen;
          }
          synth.speak(utterance);
        }
      } catch {
        // Ignore TTS failures in headless or unsupported browsers
      }
    };

    const currentVoices = synth.getVoices();
    if (currentVoices.length === 0 && 'onvoiceschanged' in synth) {
      let triggered = false;
      const handleVoices = () => {
        if (triggered) return;
        triggered = true;
        synth.removeEventListener('voiceschanged', handleVoices);
        speakAll();
      };
      synth.addEventListener('voiceschanged', handleVoices);
      setTimeout(() => {
        if (!triggered) {
          triggered = true;
          synth.removeEventListener('voiceschanged', handleVoices);
          speakAll();
        }
      }, 150);
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
  speakFemaleIndonesian(text);
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

export function speakWelcomeGreeting(namaSekolah: string): string {
  const text = buildWelcomeGreetingText(namaSekolah);
  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return text;
    }

    const synth = window.speechSynthesis;
    if (!synth) return text;

    let started = false;
    let fallbackAttached = false;

    const cleanupFallback = () => {
      if (!fallbackAttached) return;
      fallbackAttached = false;
      window.removeEventListener('pointerdown', handleFirstInteraction);
      window.removeEventListener('keydown', handleFirstInteraction);
    };

    const attemptSpeak = (fromInteraction: boolean) => {
      try {
        synth.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'id-ID';
        utterance.rate = 0.96;
        utterance.pitch = 1.25; // Female vocal pitch contour
        utterance.volume = 1;

        const voices = synth.getVoices();
        const chosen = pickFemaleIndonesianVoice(voices);
        if (chosen) {
          utterance.voice = chosen;
        }

        utterance.onstart = () => {
          started = true;
          cleanupFallback();
        };

        utterance.onerror = () => {
          if (!fromInteraction && !started) {
            attachFallback();
          }
        };

        synth.speak(utterance);

        // If browser autoplay policy silently blocks speech before user gesture,
        // arm a one-time fallback so the greeting plays on first tap/key press.
        if (!fromInteraction) {
          setTimeout(() => {
            if (!started && !synth.speaking) {
              attachFallback();
            }
          }, 450);
        }
      } catch {
        if (!fromInteraction && !started) {
          attachFallback();
        }
      }
    };

    const handleFirstInteraction = () => {
      cleanupFallback();
      if (!started) {
        attemptSpeak(true);
      }
    };

    const attachFallback = () => {
      if (fallbackAttached || started) return;
      fallbackAttached = true;
      window.addEventListener('pointerdown', handleFirstInteraction, { once: true, passive: true });
      window.addEventListener('keydown', handleFirstInteraction, { once: true, passive: true });
    };

    const currentVoices = synth.getVoices();
    if (currentVoices.length === 0 && 'onvoiceschanged' in synth) {
      let triggered = false;
      const handleVoices = () => {
        if (triggered) return;
        triggered = true;
        synth.removeEventListener('voiceschanged', handleVoices);
        attemptSpeak(false);
      };
      synth.addEventListener('voiceschanged', handleVoices);
      setTimeout(() => {
        if (!triggered) {
          triggered = true;
          synth.removeEventListener('voiceschanged', handleVoices);
          attemptSpeak(false);
        }
      }, 150);
      return text;
    }

    attemptSpeak(false);
  } catch {
    // Ignore speech synthesis errors in restricted browsers
  }

  return text;
}


