import type { AttendanceRecord } from '../types';
import type { GasAction, PendingSyncItem } from './gasApi';

const IDB_NAME = 'presensi_digital_offline_v1';
const IDB_VERSION = 1;
const IDB_STORE = 'offline_kv';
const IDB_QUEUE_KEY = 'sync_queue_v2';
const IDB_RECORDS_BACKUP_KEY = 'offline_records_backup_v1';

export interface OfflineQueueSummary {
  total: number;
  attendanceCount: number;
  subjectAttendanceCount: number;
  otherCount: number;
  oldestCreatedAt: string | null;
}

export function isBrowserOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
}

export function isLikelyNetworkError(err: unknown): boolean {
  if (!isBrowserOnline()) return true;
  if (err instanceof TypeError) return true;
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /failed to fetch|networkerror|load failed|timeout|offline|internet|disconnected|network request failed/i.test(
    msg
  );
}

function extractDailyRecordKey(payload: Record<string, unknown>): string | null {
  const nested =
    payload.record && typeof payload.record === 'object'
      ? (payload.record as Record<string, unknown>)
      : payload;
  const tanggal = String(nested.tanggal ?? payload.tanggal ?? '').trim();
  const nis = String(nested.nis ?? payload.nis ?? '').trim().toLowerCase();
  if (!tanggal || !nis) return null;
  return `${tanggal}__${nis}`;
}

function extractSubjectRecordKey(payload: Record<string, unknown>): string | null {
  const nested =
    payload.record && typeof payload.record === 'object'
      ? (payload.record as Record<string, unknown>)
      : payload;
  const tanggal = String(nested.tanggal ?? payload.tanggal ?? '').trim();
  const assignmentId = String(nested.assignment_id ?? payload.assignment_id ?? '').trim();
  const nis = String(nested.nis ?? payload.nis ?? '').trim().toLowerCase();
  if (!tanggal || !assignmentId || !nis) return null;
  return `${tanggal}__${assignmentId}__${nis}`;
}

function mergeDailyRecordPayloads(
  prevPayload: Record<string, unknown>,
  nextPayload: Record<string, unknown>
): Record<string, unknown> {
  const prevRec =
    prevPayload.record && typeof prevPayload.record === 'object'
      ? (prevPayload.record as Record<string, unknown>)
      : prevPayload;
  const nextRec =
    nextPayload.record && typeof nextPayload.record === 'object'
      ? (nextPayload.record as Record<string, unknown>)
      : nextPayload;

  const prevJamMasuk = String(prevRec.jam_masuk ?? '').trim();
  const nextJamMasuk = String(nextRec.jam_masuk ?? '').trim();
  const mergedJamMasuk =
    nextJamMasuk && nextJamMasuk !== '-' ? nextJamMasuk : prevJamMasuk || '-';

  const prevJamPulang = String(prevRec.jam_pulang ?? '').trim();
  const nextJamPulang = String(nextRec.jam_pulang ?? '').trim();
  const mergedJamPulang =
    nextJamPulang && nextJamPulang !== '-' ? nextJamPulang : prevJamPulang || '-';

  const mergedRecord: Record<string, unknown> = {
    ...prevRec,
    ...nextRec,
    jam_masuk: mergedJamMasuk,
    jam_pulang: mergedJamPulang,
  };
  delete mergedRecord.record;

  if (!mergedRecord.alasan_pulang_cepat && prevRec.alasan_pulang_cepat) {
    mergedRecord.alasan_pulang_cepat = prevRec.alasan_pulang_cepat;
  }

  return {
    ...mergedRecord,
    record: mergedRecord,
  };
}

/**
 * Pure coalescing queue helper:
 * - Preserves FIFO order for distinct actions.
 * - Coalesces duplicate `savePengaturan`, `syncAkun`, and `syncAll` mutations to avoid bloat.
 * - Coalesces repeated daily attendance updates for the same `(tanggal, nis)` so an offline
 *   check-in followed by an offline checkout merges into one complete record without losing
 *   `jam_masuk`, `Terlambat` status, or `alasan_pulang_cepat`.
 * - Coalesces repeated subject attendance updates for the same `(tanggal, assignment_id, nis)`.
 */
export function coalesceOfflineQueue(
  currentQueue: PendingSyncItem[],
  incoming: PendingSyncItem
): PendingSyncItem[] {
  const safeQueue = Array.isArray(currentQueue) ? [...currentQueue] : [];
  const action: GasAction = incoming.action;

  if (action === 'savePengaturan' || action === 'syncAkun' || action === 'syncAll') {
    const filtered = safeQueue.filter((item) => item.action !== action);
    return [...filtered, incoming];
  }

  if (action === 'recordPresensi' || action === 'updateStatusPresensi') {
    const incomingKey = extractDailyRecordKey(incoming.payload);
    if (incomingKey) {
      const existingIdx = safeQueue.findIndex(
        (item) =>
          (item.action === 'recordPresensi' || item.action === 'updateStatusPresensi') &&
          extractDailyRecordKey(item.payload) === incomingKey
      );
      if (existingIdx !== -1) {
        const prevItem = safeQueue[existingIdx];
        const mergedPayload = mergeDailyRecordPayloads(prevItem.payload, incoming.payload);
        const updated: PendingSyncItem = {
          ...incoming,
          id: prevItem.id,
          createdAt: prevItem.createdAt,
          payload: mergedPayload,
        };
        safeQueue[existingIdx] = updated;
        return safeQueue;
      }
    }
  }

  if (action === 'recordPresensiMapel') {
    const incomingKey = extractSubjectRecordKey(incoming.payload);
    if (incomingKey) {
      const existingIdx = safeQueue.findIndex(
        (item) =>
          item.action === 'recordPresensiMapel' &&
          extractSubjectRecordKey(item.payload) === incomingKey
      );
      if (existingIdx !== -1) {
        safeQueue[existingIdx] = {
          ...incoming,
          id: safeQueue[existingIdx].id,
          createdAt: safeQueue[existingIdx].createdAt,
        };
        return safeQueue;
      }
    }
  }

  return [...safeQueue, incoming];
}

export function summarizeOfflineQueue(queue: PendingSyncItem[]): OfflineQueueSummary {
  const list = Array.isArray(queue) ? queue : [];
  let attendanceCount = 0;
  let subjectAttendanceCount = 0;
  let otherCount = 0;
  let oldestCreatedAt: string | null = null;

  for (const item of list) {
    if (!item) continue;
    if (item.action === 'recordPresensi' || item.action === 'updateStatusPresensi') {
      attendanceCount++;
    } else if (
      item.action === 'recordPresensiMapel' ||
      item.action === 'bulkRecordPresensiMapel'
    ) {
      subjectAttendanceCount++;
    } else {
      otherCount++;
    }
    if (item.createdAt && (!oldestCreatedAt || item.createdAt < oldestCreatedAt)) {
      oldestCreatedAt = item.createdAt;
    }
  }

  return {
    total: list.length,
    attendanceCount,
    subjectAttendanceCount,
    otherCount,
    oldestCreatedAt,
  };
}

// ============================================================
// IndexedDB Durable Backup Store (survives reload & quota pressure)
// ============================================================

function openOfflineDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openOfflineDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    } catch {
      db.close();
      resolve(null);
    }
  });
}

async function idbPut<T>(key: string, value: T): Promise<void> {
  const db = await openOfflineDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.put(value, key);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

export async function mirrorOfflineQueueToIdb(queue: PendingSyncItem[]): Promise<void> {
  await idbPut(IDB_QUEUE_KEY, queue);
}

export async function readOfflineQueueFromIdb(): Promise<PendingSyncItem[]> {
  const stored = await idbGet<unknown>(IDB_QUEUE_KEY);
  if (!Array.isArray(stored)) return [];
  return stored.filter(
    (item): item is PendingSyncItem =>
      Boolean(
        item &&
          typeof item === 'object' &&
          typeof (item as PendingSyncItem).action === 'string' &&
          (item as PendingSyncItem).payload &&
          typeof (item as PendingSyncItem).payload === 'object'
      )
  );
}

export async function mirrorRecordsBackupToIdb(records: AttendanceRecord[]): Promise<void> {
  await idbPut(IDB_RECORDS_BACKUP_KEY, {
    savedAt: new Date().toISOString(),
    records,
  });
}

export async function readRecordsBackupFromIdb(): Promise<AttendanceRecord[]> {
  const stored = await idbGet<{ records?: AttendanceRecord[] }>(IDB_RECORDS_BACKUP_KEY);
  if (!stored || !Array.isArray(stored.records)) return [];
  return stored.records;
}
