import { DEFAULT_GAS_WEBAPP_URL } from './startupSyncPrompt';

/**
 * Canonical shared Firestore workspace ID for SMA Negeri 1 Kabun.
 * Enables automatic, zero-login cross-device synchronization across
 * Master Admin, Kepala Sekolah, Wali Kelas, Guru, and Scan QR kiosks.
 */
export const AUTO_SCHOOL_WORKSPACE_ID = 'sman1_kabun_shared_workspace';

export const AUTO_WORKSPACE_DISPLAY_NAME =
  'Sinkronisasi Otomatis Sekolah (Firebase Cloud)';

export const AUTO_WORKSPACE_SUBTITLE =
  'Terhubung otomatis tanpa login Google';

/**
 * Resolves the active Firestore workspace document ID.
 * Always targets the shared school workspace so every device stays in sync
 * automatically without requiring Google Firebase sign-in popups.
 */
export function resolveActiveCloudWorkspaceId(_firebaseUserUid?: string | null): string {
  return AUTO_SCHOOL_WORKSPACE_ID;
}

/**
 * Resolves the effective Google Apps Script Web App URL.
 * Preserves any custom https:// deployment URL saved by Master Admin,
 * and falls back automatically to the built-in default deployment URL.
 */
export function resolveEffectiveGasScriptUrl(
  savedUrl?: string | null,
  defaultUrl: string = DEFAULT_GAS_WEBAPP_URL
): string {
  const trimmedSaved = (savedUrl || '').trim();
  if (trimmedSaved) {
    return trimmedSaved;
  }
  return (defaultUrl || '').trim();
}

export interface GasSyncSummary {
  ok: boolean;
  hasRemoteData: boolean;
  studentsCount: number;
  recordsCount: number;
  accountsCount: number;
  schedulesCount: number;
  subjectRecordsCount: number;
}

export interface CloudCountsSnapshot {
  students: number;
  records: number;
  schedules: number;
  accounts: number;
}

/**
 * Decides whether remote data pulled from Google Sheets should be mirrored
 * automatically into Firestore to keep both cloud backends aligned without
 * triggering infinite write loops or exhausting Firestore free-tier quota.
 */
export function shouldBridgeGasDataToFirestore(params: {
  cloudConnected: boolean;
  alreadyBridged: boolean;
  forcePullRemote: boolean;
  gasResult: GasSyncSummary;
  cloudCountsBeforeGas: CloudCountsSnapshot;
}): boolean {
  if (!params.cloudConnected) return false;
  if (!params.gasResult.ok || !params.gasResult.hasRemoteData) return false;

  if (params.forcePullRemote) {
    return true;
  }

  if (params.alreadyBridged) {
    return false;
  }

  const { gasResult, cloudCountsBeforeGas } = params;
  return (
    (cloudCountsBeforeGas.students === 0 && gasResult.studentsCount > 0) ||
    (cloudCountsBeforeGas.records === 0 && gasResult.recordsCount > 0) ||
    (cloudCountsBeforeGas.schedules === 0 && gasResult.schedulesCount > 0) ||
    (cloudCountsBeforeGas.accounts === 0 && gasResult.accountsCount > 0)
  );
}

/**
 * Protects local / Google Sheets data from being accidentally wiped by an
 * initially empty Firestore subcollection snapshot on first workspace bootstrap.
 * Once Firestore has delivered non-empty data in the current session, empty
 * snapshots (e.g. intentional resets or deletions) are applied normally.
 */
export function shouldApplyCloudCollectionSnapshot(params: {
  incomingCount: number;
  localCount: number;
  hasReceivedNonEmptyCloud: boolean;
  gasAutoSyncConfigured: boolean;
}): boolean {
  if (params.incomingCount > 0) {
    return true;
  }
  if (params.hasReceivedNonEmptyCloud) {
    return true;
  }
  if (params.localCount > 0 && params.gasAutoSyncConfigured) {
    return false;
  }
  return params.localCount === 0;
}
