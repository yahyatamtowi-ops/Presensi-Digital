import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FIREBASE_SYNC_EMAIL,
  DEFAULT_GAS_WEBAPP_URL,
  MASKED_SYNC_EMAIL_DISPLAY,
  getMaskedConfirmationEmail,
  normalizeGasUrlForConfirmation,
  resolveInitialStartupSyncStep,
  resolveNextStartupSyncStep,
} from './startupSyncPrompt';

test('startupSyncPrompt', async (t) => {
  await t.test('masks the Firebase confirmation email completely as ***************', () => {
    const masked = getMaskedConfirmationEmail(DEFAULT_FIREBASE_SYNC_EMAIL);
    assert.equal(masked, MASKED_SYNC_EMAIL_DISPLAY);
    assert.equal(masked, '***************');
    assert.equal(masked.includes('tamtowiyahya65'), false);
    assert.equal(masked.includes('@'), false);
  });

  await t.test('opens on Firebase step first when neither Firebase nor Google Sheets is connected', () => {
    assert.equal(
      resolveInitialStartupSyncStep({
        firebaseConnected: false,
        sheetsUrl: '',
        dismissed: false,
      }),
      'firebase'
    );
  });

  await t.test('opens directly on Sheets step when Firebase is already verified but Sheets URL is empty', () => {
    assert.equal(
      resolveInitialStartupSyncStep({
        firebaseConnected: true,
        sheetsUrl: '   ',
        dismissed: false,
      }),
      'sheets'
    );
  });

  await t.test('stays done when both services are connected or prompt was dismissed', () => {
    assert.equal(
      resolveInitialStartupSyncStep({
        firebaseConnected: true,
        sheetsUrl: DEFAULT_GAS_WEBAPP_URL,
        dismissed: false,
      }),
      'done'
    );
    assert.equal(
      resolveInitialStartupSyncStep({
        firebaseConnected: false,
        sheetsUrl: '',
        dismissed: true,
      }),
      'done'
    );
    assert.equal(
      resolveInitialStartupSyncStep({
        firebaseConnected: false,
        sheetsUrl: '',
        dismissed: false,
        autoCloudEnabled: true,
      }),
      'done'
    );
  });

  await t.test('advances from Firebase step to Google Apps Script step once Firebase is verified', () => {
    assert.equal(
      resolveNextStartupSyncStep('firebase', {
        firebaseConnected: true,
        sheetsConnected: false,
      }),
      'sheets'
    );
    assert.equal(
      resolveNextStartupSyncStep('firebase', {
        firebaseConnected: true,
        sheetsConnected: true,
      }),
      'done'
    );
    assert.equal(
      resolveNextStartupSyncStep('sheets', {
        firebaseConnected: true,
        sheetsConnected: true,
      }),
      'done'
    );
  });

  await t.test('prefills the configured Google Apps Script Web App deployment URL', () => {
    assert.equal(normalizeGasUrlForConfirmation(''), DEFAULT_GAS_WEBAPP_URL);
    assert.equal(
      normalizeGasUrlForConfirmation('  https://script.google.com/macros/s/custom/exec  '),
      'https://script.google.com/macros/s/custom/exec'
    );
  });
});
