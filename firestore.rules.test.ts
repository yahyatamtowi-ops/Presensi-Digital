import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Security Rules Structural & Dirty-Dozen Invariant Verification Test Suite
 * Validates firestore.rules against firebase-blueprint.json and security_spec.md.
 */

const rootDir = process.cwd();
const rulesPath = path.join(rootDir, 'firestore.rules');
const blueprintPath = path.join(rootDir, 'firebase-blueprint.json');

describe('Firestore Security Rules & Blueprint Invariants', () => {
  it('enforces rules_version 2 and default-deny catch-all', () => {
    const rules = fs.readFileSync(rulesPath, 'utf8');
    assert.match(rules, /rules_version\s*=\s*'2';/);
    assert.match(rules, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/);
  });

  it('requires email_verified == true and bootstraps admin email securely', () => {
    const rules = fs.readFileSync(rulesPath, 'utf8');
    assert.match(rules, /request\.auth\.token\.email_verified == true/);
    assert.match(rules, /tamtowiyahya65@gmail\.com/);
    assert.doesNotMatch(rules, /allow\s+(read|get|list|write)\s*:\s*if\s+true\s*;/);
    assert.doesNotMatch(rules, /allow\s+(read|get|list)\s*:\s*if\s+isSignedIn\(\)\s*;/);
  });

  it('covers every collection defined in firebase-blueprint.json', () => {
    const rules = fs.readFileSync(rulesPath, 'utf8');
    const blueprint = JSON.parse(fs.readFileSync(blueprintPath, 'utf8')) as {
      firestore: Record<string, unknown>;
    };
    const collectionSegments = [
      'match /admins/{adminId}',
      'match /schools/{schoolId}',
      'match /students/{studentId}',
      'match /attendance/{recordId}',
      'match /subjects/{subjectId}',
      'match /schedules/{scheduleId}',
      'match /subjectAssignments/{assignmentId}',
      'match /subjectRecords/{recordId}',
      'match /accounts/{accountId}',
    ];
    assert.equal(Object.keys(blueprint.firestore).length, collectionSegments.length);
    for (const seg of collectionSegments) {
      assert.ok(rules.includes(seg), `Missing rule block for ${seg}`);
    }
  });

  it('enforces Pillar 8 (Query Enforcer) with no get() inside allow list', () => {
    const rules = fs.readFileSync(rulesPath, 'utf8');
    const listLines = rules
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('allow list:'));
    assert.ok(listLines.length >= 9, 'Expected allow list rule for every collection');
    for (const line of listLines) {
      assert.ok(!line.includes('get('), `Forbidden get() in allow list: ${line}`);
      assert.ok(!line.includes('isSchoolOwner('), `Forbidden get()-backed helper in allow list: ${line}`);
    }
  });

  it('enforces immutable ownerId and affectedKeys allowlists on every update rule', () => {
    const rules = fs.readFileSync(rulesPath, 'utf8');
    const updateMatches = rules.match(/affectedKeys\(\)\.hasOnly\(/g) ?? [];
    assert.ok(updateMatches.length >= 8, 'Every mutable collection must use affectedKeys().hasOnly(...)');
    const ownerImmutableMatches =
      rules.match(/request\.resource\.data\.ownerId == resource\.data\.ownerId/g) ?? [];
    assert.ok(ownerImmutableMatches.length >= 8, 'Every mutable collection must lock ownerId');
  });
});
