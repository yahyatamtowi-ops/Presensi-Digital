import {
  validateFonnteTokenInput,
  type FonnteConfig,
  type FonnteStatusResponse,
} from './fonntePacing.ts';

export const PRIMARY_FONNTE_ENV_KEYS = ['FONNTE_TOKEN', 'FONNTE_PRIMARY_TOKEN'] as const;
export const BACKUP_2_FONNTE_ENV_KEYS = ['FONNTE_TOKEN_2'] as const;
export const BACKUP_3_FONNTE_ENV_KEYS = ['FONNTE_TOKEN_3'] as const;

export interface ServerEnvReader {
  processEnv?: Record<string, string | undefined>;
  netlifyEnvGet?: (key: string) => string | undefined;
}

/**
 * Cleans an environment-provided Fonnte token value by trimming surrounding
 * whitespace and accidental matching quotes ("..." or '...'), then validating
 * it against strict header-safe token rules. Returns '' if invalid or empty.
 */
export function sanitizeServerFonnteEnvToken(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let cleaned = raw.trim();
  if (
    cleaned.length >= 2 &&
    ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'")))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  if (!cleaned) return '';
  const validation = validateFonnteTokenInput(cleaned);
  return validation.valid ? validation.sanitized : '';
}

/**
 * Reads the first valid server-side Fonnte token from Netlify Functions v2
 * `Netlify.env.get(...)` and/or Node `process.env[...]`, in priority order.
 * Never falls back to any hardcoded literal token.
 */
export function readServerFonnteEnvToken(
  keys: readonly string[],
  reader: ServerEnvReader
): string {
  for (const key of keys) {
    if (typeof reader.netlifyEnvGet === 'function') {
      try {
        const netlifyVal = sanitizeServerFonnteEnvToken(reader.netlifyEnvGet(key));
        if (netlifyVal) return netlifyVal;
      } catch {
        // Ignore unavailable Netlify runtime env getter and check process.env
      }
    }
    if (reader.processEnv) {
      const procVal = sanitizeServerFonnteEnvToken(reader.processEnv[key]);
      if (procVal) return procVal;
    }
  }
  return '';
}

/**
 * Automatically activates Fonnte notification delivery on first load when the
 * server/Netlify already has a configured primary token, while strictly
 * respecting an explicit admin opt-out saved in browser preferences.
 */
export function resolveAutoEnabledFonnteConfig(params: {
  currentConfig: FonnteConfig;
  hasSavedPreference: boolean;
  serverStatus: Pick<FonnteStatusResponse, 'configured'> | null | undefined;
}): { nextConfig: FonnteConfig; autoActivated: boolean } {
  if (
    !params.hasSavedPreference &&
    Boolean(params.serverStatus?.configured) &&
    !params.currentConfig.enabled
  ) {
    return {
      nextConfig: {
        ...params.currentConfig,
        enabled: true,
      },
      autoActivated: true,
    };
  }

  return {
    nextConfig: params.currentConfig,
    autoActivated: false,
  };
}

export type FonnteConnectionState =
  | 'checking'
  | 'auto_connected'
  | 'token_ready'
  | 'device_disconnected'
  | 'missing_token';

export interface FonnteConnectionSummary {
  state: FonnteConnectionState;
  badgeText: string;
  tone: 'emerald' | 'amber' | 'slate';
}

/**
 * Derives a concise, user-friendly connection badge summary from server status.
 */
export function computeFonnteConnectionSummary(
  status: FonnteStatusResponse | null,
  checking = false
): FonnteConnectionSummary {
  if (!status) {
    return {
      state: 'checking',
      badgeText: checking ? 'Menyambungkan...' : 'Memeriksa Server...',
      tone: 'slate',
    };
  }

  if (!status.configured) {
    return {
      state: 'missing_token',
      badgeText: 'Menunggu Secret Server',
      tone: 'amber',
    };
  }

  if (status.deviceStatus?.checked) {
    if (status.deviceStatus.connected) {
      const isPrimary = !status.tokenMeta?.hasRuntimeOverride && status.tokenMeta?.activeSlot === 'primary';
      return {
        state: 'auto_connected',
        badgeText: isPrimary ? 'Terhubung Otomatis' : 'Terhubung',
        tone: 'emerald',
      };
    }
    return {
      state: 'device_disconnected',
      badgeText: 'Perangkat WA Terputus',
      tone: 'amber',
    };
  }

  return {
    state: 'token_ready',
    badgeText: 'Token Utama Aktif',
    tone: 'emerald',
  };
}
