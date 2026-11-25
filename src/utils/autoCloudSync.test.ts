import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_SCHOOL_WORKSPACE_ID,
  resolveActiveCloudWorkspaceId,
  resolveEffectiveGasScriptUrl,
  shouldApplyCloudCollectionSnapshot,
  shouldBridgeGasDataToFirestore,
} from './autoCloudSync';
import { DEFAULT_GAS_WEBAPP_URL } from './startupSyncPrompt';

describe('autoCloudSync coordinator', () => {
  it('always resolves to the canonical shared school workspace ID regardless of Google Auth state', () => {
    assert.equal(resolveActiveCloudWorkspaceId(null), AUTO_SCHOOL_WORKSPACE_ID);
    assert.equal(resolveActiveCloudWorkspaceId(undefined), AUTO_SCHOOL_WORKSPACE_ID);
    assert.equal(resolveActiveCloudWorkspaceId('some_google_uid_123'), AUTO_SCHOOL_WORKSPACE_ID);
    assert.match(AUTO_SCHOOL_WORKSPACE_ID, /^[a-zA-Z0-9_-]{1,128}$/);
  });

  it('auto-populates DEFAULT_GAS_WEBAPP_URL when saved URL is empty and preserves custom URLs', () => {
    assert.equal(resolveEffectiveGasScriptUrl(''), DEFAULT_GAS_WEBAPP_URL);
    assert.equal(resolveEffectiveGasScriptUrl('   '), DEFAULT_GAS_WEBAPP_URL);
    assert.equal(resolveEffectiveGasScriptUrl(undefined), DEFAULT_GAS_WEBAPP_URL);
    assert.equal(
      resolveEffectiveGasScriptUrl('  https://script.google.com/macros/s/custom/exec  '),
      'https://script.google.com/macros/s/custom/exec'
    );
  });

  it('bridges Google Sheets data to Firestore once when Firestore is empty and avoids repeat loops', () => {
    const gasResult = {
      ok: true,
      hasRemoteData: true,
      studentsCount: 42,
      recordsCount: 15,
      accountsCount: 5,
      schedulesCount: 8,
      subjectRecordsCount: 0,
    };

    // Initial bridge when Firestore has 0 students
    assert.equal(
      shouldBridgeGasDataToFirestore({
        cloudConnected: true,
        alreadyBridged: false,
        forcePullRemote: false,
        gasResult,
        cloudCountsBeforeGas: { students: 0, records: 0, schedules: 0, accounts: 0 },
      }),
      true
    );

    // Do NOT loop on subsequent 10-second background polls after already bridged
    assert.equal(
      shouldBridgeGasDataToFirestore({
        cloudConnected: true,
        alreadyBridged: true,
        forcePullRemote: false,
        gasResult,
        cloudCountsBeforeGas: { students: 0, records: 0, schedules: 0, accounts: 0 },
      }),
      false
    );

    // Do NOT waste writes when Firestore already has populated collections
    assert.equal(
      shouldBridgeGasDataToFirestore({
        cloudConnected: true,
        alreadyBridged: false,
        forcePullRemote: false,
        gasResult,
        cloudCountsBeforeGas: { students: 42, records: 15, schedules: 8, accounts: 5 },
      }),
      false
    );

    // Always allow explicit forcePullRemote mirror when cloud is connected
    assert.equal(
      shouldBridgeGasDataToFirestore({
        cloudConnected: true,
        alreadyBridged: true,
        forcePullRemote: true,
        gasResult,
        cloudCountsBeforeGas: { students: 42, records: 15, schedules: 8, accounts: 5 },
      }),
      true
    );

    // Never bridge when offline / cloud disconnected or GAS failed
    assert.equal(
      shouldBridgeGasDataToFirestore({
        cloudConnected: false,
        alreadyBridged: false,
        forcePullRemote: true,
        gasResult,
        cloudCountsBeforeGas: { students: 0, records: 0, schedules: 0, accounts: 0 },
      }),
      false
    );
  });

  it('protects local/GAS data from an initially empty Firestore snapshot while allowing real deletions later', () => {
    // Initially empty Firestore must NOT wipe 30 students loaded from Sheets/cache
    assert.equal(
      shouldApplyCloudCollectionSnapshot({
        incomingCount: 0,
        localCount: 30,
        hasReceivedNonEmptyCloud: false,
        gasAutoSyncConfigured: true,
      }),
      false
    );

    // Non-empty Firestore snapshot always applies
    assert.equal(
      shouldApplyCloudCollectionSnapshot({
        incomingCount: 12,
        localCount: 30,
        hasReceivedNonEmptyCloud: false,
        gasAutoSyncConfigured: true,
      }),
      true
    );

    // Once Firestore has delivered non-empty data, intentional clearing/deletion applies
    assert.equal(
      shouldApplyCloudCollectionSnapshot({
        incomingCount: 0,
        localCount: 30,
        hasReceivedNonEmptyCloud: true,
        gasAutoSyncConfigured: true,
      }),
      true
    );
  });
});
