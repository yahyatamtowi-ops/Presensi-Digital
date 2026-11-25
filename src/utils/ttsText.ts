/**
 * Pure text sanitization, chunking, and URL builders for unified
 * Indonesian female voice playback (/api/tts) across Laptop, HP, and Tablet.
 * Shared by client (src/utils/sound.ts), Express (server.ts), and Netlify Functions (netlify/functions/tts.ts).
 */

export const MAX_TTS_TEXT_LENGTH = 600;
export const DEFAULT_TTS_CHUNK_LENGTH = 175;
export const MAX_TTS_CHUNKS = 4;

// Hardcoded official Google Translate Indonesian TTS endpoint (zero SSRF surface)
export const GOOGLE_TTS_BASE_URL = 'https://translate.google.com/translate_tts';

/**
 * Removes ASCII control characters, normalizes whitespace, and enforces a safe maximum length.
 */
export function sanitizeTtsText(raw: unknown, maxLength = MAX_TTS_TEXT_LENGTH): string {
  if (typeof raw !== 'string') return '';
  const cleaned = raw
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.slice(0, maxLength).trim();
}

/**
 * Splits Indonesian text into natural spoken chunks (<= maxChunkLen)
 * preferring sentence boundaries, then clause commas, then word spaces.
 */
export function splitTtsChunks(
  rawText: string,
  maxChunkLen = DEFAULT_TTS_CHUNK_LENGTH,
  maxChunks = MAX_TTS_CHUNKS
): string[] {
  const clean = sanitizeTtsText(rawText);
  if (!clean) return [];

  const safeMaxLen = Math.max(40, Math.min(200, Math.floor(maxChunkLen)));
  const safeMaxChunks = Math.max(1, Math.min(8, Math.floor(maxChunks)));

  if (clean.length <= safeMaxLen) {
    return [clean];
  }

  const chunks: string[] = [];
  let remaining = clean;

  while (remaining.length > 0 && chunks.length < safeMaxChunks) {
    if (remaining.length <= safeMaxLen) {
      chunks.push(remaining);
      break;
    }

    const windowText = remaining.slice(0, safeMaxLen + 1);
    let splitIdx = -1;

    // 1. Prefer sentence boundary (. ! ?)
    for (let i = safeMaxLen; i >= Math.floor(safeMaxLen * 0.45); i--) {
      const ch = windowText[i];
      if (ch === '.' || ch === '!' || ch === '?') {
        splitIdx = i + 1;
        break;
      }
    }

    // 2. Otherwise prefer clause boundary (, ; :)
    if (splitIdx === -1) {
      for (let i = safeMaxLen; i >= Math.floor(safeMaxLen * 0.45); i--) {
        const ch = windowText[i];
        if (ch === ',' || ch === ';' || ch === ':') {
          splitIdx = i + 1;
          break;
        }
      }
    }

    // 3. Otherwise split on word space
    if (splitIdx === -1) {
      const lastSpace = windowText.lastIndexOf(' ', safeMaxLen);
      if (lastSpace > Math.floor(safeMaxLen * 0.3)) {
        splitIdx = lastSpace;
      }
    }

    // 4. Hard fallback for unusually long unbroken tokens
    if (splitIdx === -1) {
      splitIdx = safeMaxLen;
    }

    const piece = remaining.slice(0, splitIdx).trim();
    if (piece) {
      chunks.push(piece);
    }
    remaining = remaining.slice(splitIdx).trim();
  }

  return chunks;
}

/**
 * Builds the hardcoded official Google Indonesian female TTS URL for one sanitized chunk.
 */
export function buildGoogleTtsUrl(chunk: string): string {
  const clean = sanitizeTtsText(chunk, 200);
  const params = new URLSearchParams({
    ie: 'UTF-8',
    tl: 'id',
    client: 'tw-ob',
    ttsspeed: '1',
    q: clean,
  });
  return `${GOOGLE_TTS_BASE_URL}?${params.toString()}`;
}

/**
 * Builds the same-origin proxy URL used by the browser on both Express and Netlify.
 */
export function buildClientTtsEndpointUrl(chunk: string): string {
  const clean = sanitizeTtsText(chunk, 200);
  return `/api/tts?text=${encodeURIComponent(clean)}`;
}

/**
 * Checks whether a byte buffer looks like valid MP3 audio (MPEG frame sync 0xFF 0xE0+ or ID3 tag).
 */
export function isLikelyMp3Audio(bytes: Uint8Array): boolean {
  if (!bytes || bytes.length < 4) return false;
  // ID3v2 header: 'I' 'D' '3'
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return true;
  }
  // Raw MPEG frame sync word: 11 consecutive 1-bits (0xFF followed by >= 0xE0)
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    return true;
  }
  return false;
}

/**
 * Strips an optional leading ID3v2 tag so concatenated MP3 chunks decode cleanly across Safari/Chrome.
 */
export function stripLeadingId3v2Tag(bytes: Uint8Array): Uint8Array {
  if (bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const tagSize =
      ((bytes[6] & 0x7f) << 21) |
      ((bytes[7] & 0x7f) << 14) |
      ((bytes[8] & 0x7f) << 7) |
      (bytes[9] & 0x7f);
    const offset = 10 + tagSize;
    if (offset < bytes.length) {
      return bytes.subarray(offset);
    }
  }
  return bytes;
}

/**
 * Concatenates multiple MP3 Uint8Arrays into one contiguous MP3 buffer.
 */
export function concatMp3Buffers(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 0) return new Uint8Array(0);
  if (parts.length === 1) return parts[0];

  const normalized = parts.map((buf, idx) => (idx === 0 ? buf : stripLeadingId3v2Tag(buf)));
  const totalLen = normalized.reduce((sum, buf) => sum + buf.length, 0);
  const merged = new Uint8Array(totalLen);
  let offset = 0;
  for (const buf of normalized) {
    merged.set(buf, offset);
    offset += buf.length;
  }
  return merged;
}
