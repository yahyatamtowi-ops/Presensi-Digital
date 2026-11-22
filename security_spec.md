# Security Specification — PresensiQR Firestore

## 1. Access Matrix & Data Invariants
- **Bootstrapped Admin**: `tamtowiyahya65@gmail.com` (requires `request.auth.token.email_verified == true`), plus any UID present in `/admins/{uid}` with `role == 'admin'`.
- **Workspace Isolation (Master Gate)**:
  - Each school workspace lives at `/schools/{schoolId}` where `schoolId == request.auth.uid` and `resource.data.ownerId == request.auth.uid`.
  - All subcollections (`students`, `attendance`, `subjects`, `schedules`, `subjectAssignments`, `subjectRecords`, `accounts`) store `ownerId == schoolId`.
  - No unauthenticated access anywhere. Every request requires `isVerifiedUser()` (`request.auth != null && request.auth.token.email_verified == true`).
  - No blanket `isSignedIn()` read access on any collection containing PII (`students` contains `no_wa_ortu`; `accounts` contains internal role credentials).
- **Immutability**:
  - `ownerId` is immutable on all documents (`request.resource.data.ownerId == resource.data.ownerId` on update).
  - `createdAt` on `/schools/{schoolId}` must equal `request.time` on create and remain immutable on update.
  - `updatedAt` on all documents must equal `request.time` on create and update.
- **Query Enforcer (Pillar 8)**:
  - Every `allow list` rule strictly verifies `isVerifiedUser() && (resource.data.ownerId == request.auth.uid || isAdmin())` with zero `get()` calls.
  - Every client query filters with `where('ownerId', '==', uid)`.
- **Path & Type Bounds**:
  - Every single-doc rule checks `isValidId(docId)` (`^[a-zA-Z0-9_-]{1,128}$`).
  - Every string field has strict `.size()` bounds and enum/regex checks matching `firebase-blueprint.json`.
  - Every update rule enforces `request.resource.data.diff(resource.data).affectedKeys().hasOnly(...)` with explicit allowed keys.

## 2. Adversarial "Dirty Dozen" Payloads (Must All Be REJECTED)
1. **Unauthenticated Read/Write**: `auth = null` attempting `get` or `create` on `/schools/uid1/students/stu1`.
2. **Unverified Email Bypass**: `auth = { uid: 'u1', token: { email: 'tamtowiyahya65@gmail.com', email_verified: false } }` attempting admin read on `/schools/u2`.
3. **Cross-Tenant Student PII Read**: Verified `userB` attempting `get` or `list` on `/schools/userA/students/stu1`.
4. **Cross-Tenant Account Credential Read**: Verified `userB` attempting `get` on `/schools/userA/accounts/acc1`.
5. **OwnerId Hijack on Create**: Verified `userB` creating `/schools/userB/students/stu1` with `ownerId: 'userA'`.
6. **OwnerId Mutation on Update**: Verified `userA` updating `/schools/userA/students/stu1` changing `ownerId` to `'userB'`.
7. **Shadow Field Injection on Update**: Verified `userA` updating `/schools/userA` injecting undeclared field `isAdmin: true`.
8. **CreatedAt Forgery / Backdating**: Verified `userA` creating `/schools/userA` with `createdAt` not equal to `request.time`, or mutating `createdAt` on update.
9. **Invalid Path Traversal / Bad Doc ID**: Creating `/schools/userA/students/..bad$id` failing `isValidId()`.
10. **Oversized String DoS**: Creating `/schools/userA/attendance/rec1` with `alasan_pulang_cepat` exceeding 300 chars or `nama` exceeding 160 chars.
11. **Invalid Enum / Regex Poisoning**: Creating `/schools/userA/attendance/rec1` with `status: 'Bolos'` or `tanggal: '2026/05/01'`, or `/schools/userA` with `batas_jam_masuk: '99:99'`.
12. **Privilege Escalation to `/admins/{uid}`**: Non-admin verified `userB` attempting `create` on `/admins/userB` with `{ role: 'admin' }`.
