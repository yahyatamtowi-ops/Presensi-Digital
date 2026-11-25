import test from 'node:test';
import assert from 'node:assert/strict';
import {
  config as netlifyFonnteConfig,
  extractFonnteSubpath,
  handleFonnteServerlessRequest,
  resetServerlessStateForTest,
} from '../../netlify/functions/fonnte';

const BASE_URL = 'https://presensi-sman1kabun.netlify.app';

function makeHeaders(role: string, extra: Record<string, string> = {}): HeadersInit {
  return {
    'X-Requested-With': 'XMLHttpRequest',
    'X-App-Role': role,
    'Content-Type': 'application/json',
    ...extra,
  };
}

test('Netlify Serverless Function (/api/fonnte/*)', async (t) => {
  await t.test('exports Netlify Functions v2 wildcard path config for /api/fonnte/*', () => {
    assert.deepEqual(netlifyFonnteConfig.path, ['/api/fonnte', '/api/fonnte/*']);
  });

  await t.test('normalizes both /api/fonnte/* and /.netlify/functions/fonnte/* paths', () => {
    assert.equal(extractFonnteSubpath('/api/fonnte/status'), '/status');
    assert.equal(extractFonnteSubpath('/api/fonnte/status/'), '/status');
    assert.equal(extractFonnteSubpath('/.netlify/functions/fonnte/status'), '/status');
    assert.equal(extractFonnteSubpath('/.netlify/functions/fonnte/queue/clear'), '/queue/clear');
    assert.equal(extractFonnteSubpath('/.netlify/functions/fonnte'), '/');
    assert.equal(extractFonnteSubpath('/api/fonnte'), '/');
  });

  await t.test('blocks requests missing required app headers or invalid role with 403', async () => {
    resetServerlessStateForTest();
    const res1 = await handleFonnteServerlessRequest(new Request(`${BASE_URL}/api/fonnte/status`));
    assert.equal(res1.status, 403);

    const res2 = await handleFonnteServerlessRequest(
      new Request(`${BASE_URL}/api/fonnte/status`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest', 'X-App-Role': 'hacker' },
      })
    );
    assert.equal(res2.status, 403);
  });

  await t.test('handles GET status?checkDevice=1, token update/reset, enqueue, and test with mocked Fonnte API', async () => {
    resetServerlessStateForTest();
    const prevEnvToken = process.env.FONNTE_TOKEN;
    const prevFetch = globalThis.fetch;

    process.env.FONNTE_TOKEN = 'PrimaryServerToken_123456';
    const capturedCalls: Array<{ url: string; auth: string }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      const auth = headers.get('Authorization') || '';
      capturedCalls.push({ url, auth });

      if (url === 'https://api.fonnte.com/device') {
        if (auth === 'InvalidToken_999999') {
          return new Response(JSON.stringify({ status: false, reason: 'token invalid' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(
          JSON.stringify({
            status: true,
            device_status: 'connect',
            device: auth === 'NewCustomToken_888888' ? '6289900001111' : '6281200009999',
            name: 'WA Sekolah',
            quota: 950,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url === 'https://api.fonnte.com/send') {
        return new Response(JSON.stringify({ status: true, detail: 'success! message in queue' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ status: false }), { status: 404 });
    }) as typeof fetch;

    try {
      // 1. Check device via /.netlify/functions/fonnte/status?checkDevice=1 (exact Netlify redirect target)
      const statusRes = await handleFonnteServerlessRequest(
        new Request(`${BASE_URL}/.netlify/functions/fonnte/status?checkDevice=1`, {
          method: 'GET',
          headers: makeHeaders('master_admin'),
        })
      );
      assert.equal(statusRes.status, 200);
      const statusJson = (await statusRes.json()) as {
        configured: boolean;
        serverMode: string;
        tokenMeta: { maskedToken: string; activeSlot: string };
        deviceStatus: { connected: boolean; device: string };
      };
      assert.equal(statusJson.configured, true);
      assert.equal(statusJson.serverMode, 'serverless');
      assert.equal(statusJson.tokenMeta.activeSlot, 'primary');
      assert.equal(statusJson.tokenMeta.maskedToken, 'Prim••••3456');
      assert.equal(statusJson.deviceStatus.connected, true);
      assert.equal(statusJson.deviceStatus.device, '6281200009999');

      // 2. Non-Master-Admin blocked from changing token
      const rbacRes = await handleFonnteServerlessRequest(
        new Request(`${BASE_URL}/api/fonnte/token`, {
          method: 'POST',
          headers: makeHeaders('wali_kelas'),
          body: JSON.stringify({ token: 'NewCustomToken_888888' }),
        })
      );
      assert.equal(rbacRes.status, 403);

      // 3. Header injection rejected with 400
      const injRes = await handleFonnteServerlessRequest(
        new Request(`${BASE_URL}/api/fonnte/token`, {
          method: 'POST',
          headers: makeHeaders('master_admin'),
          body: JSON.stringify({ token: 'ValidPart\r\nX-Injected: 1' }),
        })
      );
      assert.equal(injRes.status, 400);

      // 4. Invalid Fonnte token rejected with 400 & preserves primary token
      const invalidTokRes = await handleFonnteServerlessRequest(
        new Request(`${BASE_URL}/api/fonnte/token`, {
          method: 'POST',
          headers: makeHeaders('master_admin'),
          body: JSON.stringify({ token: 'InvalidToken_999999' }),
        })
      );
      assert.equal(invalidTokRes.status, 400);

      // 5. Valid Master Admin token switch succeeds & updates active WA device
      const validTokRes = await handleFonnteServerlessRequest(
        new Request(`${BASE_URL}/api/fonnte/token`, {
          method: 'POST',
          headers: makeHeaders('master_admin'),
          body: JSON.stringify({ token: 'NewCustomToken_888888', label: 'WA Cadangan TU' }),
        })
      );
      assert.equal(validTokRes.status, 200);
      const validTokJson = (await validTokRes.json()) as {
        tokenMeta: { activeSlot: string; activeLabel: string; hasRuntimeOverride: boolean };
        deviceStatus: { device: string };
      };
      assert.equal(validTokJson.tokenMeta.activeSlot, 'custom');
      assert.equal(validTokJson.tokenMeta.activeLabel, 'WA Cadangan TU');
      assert.equal(validTokJson.tokenMeta.hasRuntimeOverride, true);
      assert.equal(validTokJson.deviceStatus.device, '6289900001111');

      // 5b. Verify encrypted HttpOnly cookie survives a simulated Netlify cold start (memory reset)
      const setCookie = validTokRes.headers.get('set-cookie') || '';
      assert.ok(setCookie.includes('presensi_fonnte_rtok='));
      assert.ok(setCookie.includes('HttpOnly'));
      assert.ok(setCookie.includes('Secure'));
      assert.ok(setCookie.includes('SameSite=None'));
      assert.ok(setCookie.includes('Partitioned'));
      assert.ok(!setCookie.includes('NewCustomToken_888888'), 'Token must never appear in plaintext inside cookie');

      const cookiePair = setCookie.split(';')[0];
      resetServerlessStateForTest(); // Simulate Lambda cold start wiping RAM!

      const afterColdStartRes = await handleFonnteServerlessRequest(
        new Request(`${BASE_URL}/api/fonnte/status?checkDevice=1`, {
          method: 'GET',
          headers: makeHeaders('master_admin', { Cookie: cookiePair }),
        })
      );
      assert.equal(afterColdStartRes.status, 200);
      const afterColdStartJson = (await afterColdStartRes.json()) as {
        tokenMeta: { activeSlot: string; activeLabel: string; hasRuntimeOverride: boolean };
        deviceStatus: { device: string };
      };
      assert.equal(afterColdStartJson.tokenMeta.activeSlot, 'custom');
      assert.equal(afterColdStartJson.tokenMeta.activeLabel, 'WA Cadangan TU');
      assert.equal(afterColdStartJson.tokenMeta.hasRuntimeOverride, true);
      assert.equal(afterColdStartJson.deviceStatus.device, '6289900001111');

      // 5c. Tampered cookie is safely ignored and falls back to server env FONNTE_TOKEN
      const tamperedRes = await handleFonnteServerlessRequest(
        new Request(`${BASE_URL}/api/fonnte/status?checkDevice=1`, {
          method: 'GET',
          headers: makeHeaders('master_admin', { Cookie: 'presensi_fonnte_rtok=tampered_garbage_value' }),
        })
      );
      assert.equal(tamperedRes.status, 200);
      const tamperedJson = (await tamperedRes.json()) as {
        tokenMeta: { activeSlot: string };
        deviceStatus: { device: string };
      };
      assert.equal(tamperedJson.tokenMeta.activeSlot, 'primary');
      assert.equal(tamperedJson.deviceStatus.device, '6281200009999');

      // 6. Enqueue 1 item from scan_kiosk succeeds immediately in serverless mode
      const enqueueRes = await handleFonnteServerlessRequest(
        new Request(`${BASE_URL}/api/fonnte/enqueue`, {
          method: 'POST',
          headers: makeHeaders('scan_kiosk'),
          body: JSON.stringify({
            items: [
              {
                nis: '0081234567',
                studentName: 'Ahmad Fauzi',
                kelas: 'X IPA 1',
                target: '081234567890',
                status: 'Hadir Tepat Waktu',
                tanggal: '2026-11-24',
                message: 'Ananda hadir tepat waktu.',
              },
            ],
          }),
        })
      );
      assert.equal(enqueueRes.status, 200);
      const enqueueJson = (await enqueueRes.json()) as {
        enqueued: number;
        queue: { counts: { sent: number } };
      };
      assert.equal(enqueueJson.enqueued, 1);
      assert.equal(enqueueJson.queue.counts.sent, 1);

      // 7. Reset token back to primary env token
      const delRes = await handleFonnteServerlessRequest(
        new Request(`${BASE_URL}/api/fonnte/token`, {
          method: 'DELETE',
          headers: makeHeaders('master_admin'),
        })
      );
      assert.equal(delRes.status, 200);
      const delJson = (await delRes.json()) as {
        tokenMeta: { activeSlot: string; hasRuntimeOverride: boolean };
      };
      assert.equal(delJson.tokenMeta.activeSlot, 'primary');
      assert.equal(delJson.tokenMeta.hasRuntimeOverride, false);

      // 8. Test message route works for staff and rejects invalid phone
      const badTestRes = await handleFonnteServerlessRequest(
        new Request(`${BASE_URL}/api/fonnte/test`, {
          method: 'POST',
          headers: makeHeaders('master_admin'),
          body: JSON.stringify({ target: '123', message: 'Halo' }),
        })
      );
      assert.equal(badTestRes.status, 400);

      const okTestRes = await handleFonnteServerlessRequest(
        new Request(`${BASE_URL}/api/fonnte/test`, {
          method: 'POST',
          headers: makeHeaders('master_admin'),
          body: JSON.stringify({ target: '081234567890', message: 'Tes Netlify' }),
        })
      );
      assert.equal(okTestRes.status, 200);

      // 9. Unknown subpath returns 404 JSON
      const unknownRes = await handleFonnteServerlessRequest(
        new Request(`${BASE_URL}/api/fonnte/unknown-route`, {
          method: 'GET',
          headers: makeHeaders('master_admin'),
        })
      );
      assert.equal(unknownRes.status, 404);
      assert.ok(capturedCalls.some((c) => c.url === 'https://api.fonnte.com/device'));
      assert.ok(capturedCalls.some((c) => c.url === 'https://api.fonnte.com/send'));
    } finally {
      globalThis.fetch = prevFetch;
      if (prevEnvToken === undefined) {
        delete process.env.FONNTE_TOKEN;
      } else {
        process.env.FONNTE_TOKEN = prevEnvToken;
      }
      resetServerlessStateForTest();
    }
  });

  await t.test('auto-connects via Netlify.env.get primary FONNTE_TOKEN, caches device check, and never leaks raw token', async () => {
    resetServerlessStateForTest();
    const prevEnvToken = process.env.FONNTE_TOKEN;
    const prevFetch = globalThis.fetch;
    const g = globalThis as { Netlify?: { env?: { get?: (key: string) => string | undefined } } };
    const prevNetlify = g.Netlify;

    delete process.env.FONNTE_TOKEN;
    const secretPrimaryToken = 'NetlifySecretPrimary_778899';
    g.Netlify = {
      env: {
        get: (key: string) => (key === 'FONNTE_TOKEN' ? ` "${secretPrimaryToken}" ` : undefined),
      },
    };

    let deviceApiHits = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      if (url === 'https://api.fonnte.com/device') {
        deviceApiHits++;
        assert.equal(headers.get('Authorization'), secretPrimaryToken);
        return new Response(
          JSON.stringify({
            status: true,
            device_status: 'connect',
            device: '6281122334455',
            name: 'WA Utama Sekolah',
            quota: 1000,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ status: false }), { status: 404 });
    }) as typeof fetch;

    try {
      const res1 = await handleFonnteServerlessRequest(
        new Request(`${BASE_URL}/api/fonnte/status?checkDevice=1`, {
          method: 'GET',
          headers: makeHeaders('scan_kiosk'),
        })
      );
      assert.equal(res1.status, 200);
      const rawText1 = await res1.text();
      assert.ok(!rawText1.includes(secretPrimaryToken), 'Response must never leak raw FONNTE_TOKEN');
      const json1 = JSON.parse(rawText1) as {
        configured: boolean;
        primaryConfigured: boolean;
        autoConnected: boolean;
        tokenMeta: { activeSlot: string; maskedToken: string };
        deviceStatus: { connected: boolean; device: string };
      };
      assert.equal(json1.configured, true);
      assert.equal(json1.primaryConfigured, true);
      assert.equal(json1.autoConnected, true);
      assert.equal(json1.tokenMeta.activeSlot, 'primary');
      assert.equal(json1.tokenMeta.maskedToken, 'Netl••••8899');
      assert.equal(json1.deviceStatus.connected, true);
      assert.equal(json1.deviceStatus.device, '6281122334455');
      assert.equal(deviceApiHits, 1);

      // Second auto-check within TTL uses warm cache instead of spamming Fonnte
      const res2 = await handleFonnteServerlessRequest(
        new Request(`${BASE_URL}/api/fonnte/status?checkDevice=1`, {
          method: 'GET',
          headers: makeHeaders('master_admin'),
        })
      );
      assert.equal(res2.status, 200);
      assert.equal(deviceApiHits, 1);

      // Explicit force=1 bypasses cache for manual refresh
      const res3 = await handleFonnteServerlessRequest(
        new Request(`${BASE_URL}/api/fonnte/status?checkDevice=1&force=1`, {
          method: 'GET',
          headers: makeHeaders('master_admin'),
        })
      );
      assert.equal(res3.status, 200);
      assert.equal(deviceApiHits, 2);
    } finally {
      globalThis.fetch = prevFetch;
      g.Netlify = prevNetlify;
      if (prevEnvToken === undefined) {
        delete process.env.FONNTE_TOKEN;
      } else {
        process.env.FONNTE_TOKEN = prevEnvToken;
      }
      resetServerlessStateForTest();
    }
  });
});

