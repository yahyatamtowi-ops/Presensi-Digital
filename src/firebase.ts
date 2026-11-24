import { initializeApp } from 'firebase/app';
import {
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

function createOfflineCapableFirestore(): Firestore {
  if (typeof window !== 'undefined') {
    try {
      return initializeFirestore(
        app,
        {
          localCache: persistentLocalCache({
            tabManager: persistentMultipleTabManager(),
          }),
        },
        firebaseConfig.firestoreDatabaseId
      );
    } catch {
      // Fallback for private browsing or already-initialized HMR instance
    }
  }
  return getFirestore(app, firebaseConfig.firestoreDatabaseId);
}

export const db = createOfflineCapableFirestore();
export const auth = getAuth(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: Array<{
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }>;
  };
}

export function buildFirestoreErrorInfo(
  error: unknown,
  operationType: OperationType,
  path: string | null
): FirestoreErrorInfo {
  return {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData.map((provider) => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL,
        })) || [],
    },
    operationType,
    path,
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo = buildFirestoreErrorInfo(error, operationType, path);
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function isTopLevelStandaloneWindow(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self === window.top;
  } catch {
    return false;
  }
}

export async function signInWithGoogle(loginHintEmail?: string): Promise<User> {
  const hint = (loginHintEmail || '').trim();
  const provider = hint
    ? (() => {
        const hintedProvider = new GoogleAuthProvider();
        hintedProvider.setCustomParameters({
          prompt: 'select_account',
          login_hint: hint,
        });
        return hintedProvider;
      })()
    : googleProvider;

  try {
    const result = await signInWithPopup(auth, provider);
    return result.user;
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: unknown }).code || '')
        : '';
    // On standalone hosts like Netlify mobile browsers where popups are blocked, fall back smoothly to redirect flow
    if (code === 'auth/popup-blocked' && isTopLevelStandaloneWindow()) {
      await signInWithRedirect(auth, provider);
      // Browser navigates away; return a never-resolving promise so caller does not flash an error during redirect
      return new Promise<User>(() => {});
    }
    throw err;
  }
}

export async function signOutFirebase(): Promise<void> {
  await signOut(auth);
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

if (typeof window !== 'undefined') {
  void getRedirectResult(auth).catch(() => {
    // Ignore non-fatal redirect check errors (e.g. third-party storage partition or no active redirect)
  });
  void testConnection();
}
