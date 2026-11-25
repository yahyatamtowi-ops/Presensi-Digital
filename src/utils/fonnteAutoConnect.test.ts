import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FONNTE_CONFIG } from './fonntePacing';
import {
  PRIMARY_FONNTE_ENV_KEYS,
  computeFonnteConnectionSummary,
  readServerFonnteEnvToken,
  resolveAutoEnabledFonnteConfig,
  sanitizeServerFonnteEnvToken,
} from './fonnteAutoConnect';

test('Fonnte Auto-Connect Pure Logic', async (t) => {
  await t.test('sanitizes quoted or whitespace-padded server env tokens and rejects unsafe input', () => {
    assert.equal(sanitizeServerFonnteEnvToken('  "PrimaryToken_123456"  '), 'PrimaryToken_123456');
    assert.equal(sanitizeServerFonnteEnvToken("  'PrimaryToken_123456' "), 'PrimaryToken_123456');
    assert.equal(sanitizeServerFonnteEnvToken('   '), '');
    assert.equal(sanitizeServerFonnteEnvToken('short'), '');
    assert.equal(sanitizeServerFonnteEnvToken('ValidPart\r\nX-Injected: 1'), '');
    assert.equal(sanitizeServerFonnteEnvToken(undefined), '');
  });

  await t.test('reads primary token from Netlify.env first and falls back to process.env with zero hardcoded defaults', () => {
    const fromNetlify = readServerFonnteEnvToken(PRIMARY_FONNTE_ENV_KEYS, {
      netlifyEnvGet: (key) => (key === 'FONNTE_TOKEN' ? '"NetlifyPrimary_998877"' : undefined),
      processEnv: { FONNTE_TOKEN: 'ProcessFallback_112233' },
    });
    assert.equal(fromNetlify, 'NetlifyPrimary_998877');

    const fromProcessAlias = readServerFonnteEnvToken(PRIMARY_FONNTE_ENV_KEYS, {
      netlifyEnvGet: () => undefined,
      processEnv: { FONNTE_PRIMARY_TOKEN: 'PrimaryAliasToken_445566' },
    });
    assert.equal(fromProcessAlias, 'PrimaryAliasToken_445566');

    const noneConfigured = readServerFonnteEnvToken(PRIMARY_FONNTE_ENV_KEYS, {
      netlifyEnvGet: () => '',
      processEnv: {},
    });
    assert.equal(noneConfigured, '');
  });

  await t.test('auto-enables Fonnte on first load when primary server token is configured, but respects explicit admin opt-out', () => {
    const firstLoadConfigured = resolveAutoEnabledFonnteConfig({
      currentConfig: { ...DEFAULT_FONNTE_CONFIG, enabled: false },
      hasSavedPreference: false,
      serverStatus: { configured: true },
    });
    assert.equal(firstLoadConfigured.autoActivated, true);
    assert.equal(firstLoadConfigured.nextConfig.enabled, true);

    const adminTurnedOff = resolveAutoEnabledFonnteConfig({
      currentConfig: { ...DEFAULT_FONNTE_CONFIG, enabled: false },
      hasSavedPreference: true,
      serverStatus: { configured: true },
    });
    assert.equal(adminTurnedOff.autoActivated, false);
    assert.equal(adminTurnedOff.nextConfig.enabled, false);

    const missingServerToken = resolveAutoEnabledFonnteConfig({
      currentConfig: { ...DEFAULT_FONNTE_CONFIG, enabled: false },
      hasSavedPreference: false,
      serverStatus: { configured: false },
    });
    assert.equal(missingServerToken.autoActivated, false);
    assert.equal(missingServerToken.nextConfig.enabled, false);
  });

  await t.test('computes concise connection badge summaries for every server state', () => {
    assert.equal(computeFonnteConnectionSummary(null, true).badgeText, 'Menyambungkan...');
    assert.equal(
      computeFonnteConnectionSummary({
        configured: false,
        queue: {
          running: false,
          paused: false,
          tokenConfigured: false,
          nextSendAt: null,
          sentInCurrentBatch: 0,
          counts: { pending: 0, sending: 0, sent: 0, failed: 0, total: 0 },
          pacing: DEFAULT_FONNTE_CONFIG.pacing,
          estimatedRemainingSec: 0,
          jobs: [],
        },
      }).state,
      'missing_token'
    );

    const autoConnected = computeFonnteConnectionSummary({
      configured: true,
      primaryConfigured: true,
      autoConnected: true,
      tokenMeta: {
        configured: true,
        activeSlot: 'primary',
        activeLabel: 'Token Utama Server',
        maskedToken: 'Prim••••3456',
        hasRuntimeOverride: false,
        availableEnvSlots: [],
      },
      deviceStatus: { checked: true, connected: true, device: '6281200009999' },
      queue: {
        running: false,
        paused: false,
        tokenConfigured: true,
        nextSendAt: null,
        sentInCurrentBatch: 0,
        counts: { pending: 0, sending: 0, sent: 0, failed: 0, total: 0 },
        pacing: DEFAULT_FONNTE_CONFIG.pacing,
        estimatedRemainingSec: 0,
        jobs: [],
      },
    });
    assert.equal(autoConnected.state, 'auto_connected');
    assert.equal(autoConnected.badgeText, 'Terhubung Otomatis');
    assert.equal(autoConnected.tone, 'emerald');
  });
});
