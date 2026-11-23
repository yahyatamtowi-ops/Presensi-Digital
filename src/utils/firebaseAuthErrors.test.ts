import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFirebaseAuthorizedDomainsUrl,
  extractFirebaseErrorCode,
  parseFirebaseAuthError,
} from './firebaseAuthErrors';

test('firebaseAuthErrors', async (t) => {
  await t.test('detects auth/unauthorized-domain from FirebaseError code and message', () => {
    const byCode = parseFirebaseAuthError(
      { code: 'auth/unauthorized-domain', message: 'Firebase: Error (auth/unauthorized-domain).' },
      'ais-pre-example.asia-northeast1.run.app',
      'gen-lang-client-0337420353'
    );
    assert.equal(byCode.isUnauthorizedDomain, true);
    assert.equal(byCode.isUserCancelled, false);
    assert.equal(byCode.hostname, 'ais-pre-example.asia-northeast1.run.app');
    assert.equal(
      byCode.consoleAuthorizedDomainsUrl,
      'https://console.firebase.google.com/project/gen-lang-client-0337420353/authentication/settings'
    );
    assert.ok(byCode.description.includes('ais-pre-example.asia-northeast1.run.app'));

    const byMessageOnly = parseFirebaseAuthError(
      new Error('Firebase: Error (auth/unauthorized-domain).'),
      'sekolah.example.sch.id',
      'gen-lang-client-0337420353'
    );
    assert.equal(byMessageOnly.code, 'auth/unauthorized-domain');
    assert.equal(byMessageOnly.isUnauthorizedDomain, true);
  });

  await t.test('classifies popup cancel, popup blocked, and network errors cleanly', () => {
    const cancelled = parseFirebaseAuthError(
      { code: 'auth/popup-closed-by-user' },
      'localhost',
      'proj-1'
    );
    assert.equal(cancelled.isUserCancelled, true);
    assert.equal(cancelled.isUnauthorizedDomain, false);

    const blocked = parseFirebaseAuthError(
      { code: 'auth/popup-blocked' },
      'localhost',
      'proj-1'
    );
    assert.equal(blocked.isUserCancelled, false);
    assert.ok(blocked.title.toLowerCase().includes('popup'));

    const offline = parseFirebaseAuthError(
      { code: 'auth/network-request-failed' },
      'localhost',
      'proj-1'
    );
    assert.ok(offline.title.toLowerCase().includes('internet'));
  });

  await t.test('extractFirebaseErrorCode and URL builder handle edge cases safely', () => {
    assert.equal(
      extractFirebaseErrorCode(new Error('Firebase: Error (auth/operation-not-allowed).')),
      'auth/operation-not-allowed'
    );
    assert.equal(buildFirebaseAuthorizedDomainsUrl(''), 'https://console.firebase.google.com/');
  });
});
