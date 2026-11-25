/**
 * Netlify Serverless Function (Functions v2) for unified Indonesian Female Voice (/api/tts).
 *
 * Ensures HP (Android/iOS), Tablet (Android Tab/iPad), and Laptop all play the exact same
 * Google Bahasa Indonesia female voice MP3 without relying on inconsistent or missing OS TTS engines.
 */

import {
  MAX_TTS_TEXT_LENGTH,
  buildGoogleTtsUrl,
  concatMp3Buffers,
  isLikelyMp3Audio,
  sanitizeTtsText,
  splitTtsChunks,
} from '../../src/utils/ttsText.ts';

const MAX_CACHE_ENTRIES = 64;
const ttsMemoryCache = new Map<string, Uint8Array>();

function getCachedAudio(key: string): Uint8Array | null {
  const hit = ttsMemoryCache.get(key);
  if (!hit) return null;
  // Refresh LRU recency
  ttsMemoryCache.delete(key);
  ttsMemoryCache.set(key, hit);
  return hit;
}

function setCachedAudio(key: string, data: Uint8Array): void {
  if (ttsMemoryCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = ttsMemoryCache.keys().next().value;
    if (oldestKey !== undefined) {
      ttsMemoryCache.delete(oldestKey);
    }
  }
  ttsMemoryCache.set(key, data);
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function fetchUpstreamMp3Chunk(
  chunk: string,
  fetchImpl: typeof fetch
): Promise<Uint8Array | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetchImpl(buildGoogleTtsUrl(chunk), {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'audio/mpeg, audio/*;q=0.9, */*;q=0.5',
        Referer: 'https://translate.google.com/',
      },
      signal: controller.signal,
    });

    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    if (bytes.length < 128 || !isLikelyMp3Audio(bytes)) {
      return null;
    }
    return bytes;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function handleTtsServerlessRequest(
  request: Request,
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonError(405, 'Metode HTTP tidak diizinkan untuk endpoint suara.');
  }

  let rawText = '';
  try {
    const url = new URL(request.url);
    rawText = url.searchParams.get('text') || '';
  } catch {
    return jsonError(400, 'URL permintaan suara tidak valid.');
  }

  const trimmedRaw = rawText.trim();
  if (!trimmedRaw) {
    return jsonError(400, 'Parameter teks suara tidak boleh kosong.');
  }
  if (trimmedRaw.length > MAX_TTS_TEXT_LENGTH) {
    return jsonError(
      400,
      `Teks suara terlalu panjang (maksimal ${MAX_TTS_TEXT_LENGTH} karakter).`
    );
  }

  const sanitized = sanitizeTtsText(trimmedRaw, MAX_TTS_TEXT_LENGTH);
  if (!sanitized) {
    return jsonError(400, 'Parameter teks suara tidak valid.');
  }

  let audioBytes = getCachedAudio(sanitized);
  if (!audioBytes) {
    const chunks = splitTtsChunks(sanitized);
    if (chunks.length === 0) {
      return jsonError(400, 'Parameter teks suara tidak valid.');
    }

    const parts: Uint8Array[] = [];
    for (const chunk of chunks) {
      const bytes = await fetchUpstreamMp3Chunk(chunk, fetchImpl);
      if (!bytes) {
        return jsonError(502, 'Layanan suara sedang tidak tersedia sementara.');
      }
      parts.push(bytes);
    }

    audioBytes = concatMp3Buffers(parts);
    setCachedAudio(sanitized, audioBytes);
  }

  const headers = new Headers({
    'Content-Type': 'audio/mpeg',
    'Content-Length': String(audioBytes.byteLength),
    'Cache-Control': 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
  });

  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers });
  }

  const bodyBytes = new Uint8Array(audioBytes.byteLength);
  bodyBytes.set(audioBytes);
  return new Response(bodyBytes, {
    status: 200,
    headers,
  });
}

export default async function handler(request: Request): Promise<Response> {
  return handleTtsServerlessRequest(request);
}

export const config = {
  path: '/api/tts',
};
