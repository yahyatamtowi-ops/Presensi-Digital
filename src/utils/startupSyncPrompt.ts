export const DEFAULT_FIREBASE_SYNC_EMAIL = 'tamtowiyahya65@gmail.com';
export const MASKED_SYNC_EMAIL_DISPLAY = '***************';
export const DEFAULT_GAS_WEBAPP_URL =
  'https://script.google.com/macros/s/AKfycbzJ2PD3WZTstS5LJY8_4MMDUBMfVesizIZaBE_8Wa32TJliGcqFArrylWmO9tRSQ-pG8Q/exec';

export type StartupSyncStep = 'firebase' | 'sheets' | 'done';

/**
 * Always returns the fixed masked placeholder so the target Firebase account
 * email stays hidden on screen while the user confirms the connection.
 */
export function getMaskedConfirmationEmail(_email?: string): string {
  return MASKED_SYNC_EMAIL_DISPLAY;
}

/**
 * Determines whether the first-open sync prompt should appear and which step
 * to show based on current Firebase Cloud and Google Sheets connection state.
 */
export function resolveInitialStartupSyncStep(params: {
  firebaseConnected: boolean;
  sheetsUrl: string;
  dismissed: boolean;
}): StartupSyncStep {
  if (params.dismissed) {
    return 'done';
  }
  const hasSheetsUrl = Boolean((params.sheetsUrl || '').trim());
  if (!params.firebaseConnected && !hasSheetsUrl) {
    return 'firebase';
  }
  if (!params.firebaseConnected) {
    return 'firebase';
  }
  if (!hasSheetsUrl) {
    return 'sheets';
  }
  return 'done';
}

/**
 * Computes the next step after an action succeeds inside the startup sync wizard.
 */
export function resolveNextStartupSyncStep(
  currentStep: StartupSyncStep,
  state: { firebaseConnected: boolean; sheetsConnected: boolean }
): StartupSyncStep {
  if (currentStep === 'firebase' && state.firebaseConnected) {
    return state.sheetsConnected ? 'done' : 'sheets';
  }
  if (currentStep === 'sheets' && state.sheetsConnected) {
    return 'done';
  }
  return currentStep;
}

/**
 * Returns the trimmed Google Apps Script URL or the default prefilled deployment URL.
 */
export function normalizeGasUrlForConfirmation(url?: string): string {
  const trimmed = (url || '').trim();
  return trimmed || DEFAULT_GAS_WEBAPP_URL;
}
