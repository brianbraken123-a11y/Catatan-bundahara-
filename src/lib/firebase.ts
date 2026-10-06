import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  getDocFromServer,
  Timestamp,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { Transaction } from '../types/finance';

// Initialize Firebase App
export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// Initialize Firestore using the specified firestoreDatabaseId
export const db = getFirestore(
  app,
  (firebaseConfig as any).firestoreDatabaseId
);

// Initialize Firebase Auth
export const auth = getAuth(app);

// Configure Google Auth Provider with Workspace Scopes (Sheets & Drive)
export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('https://www.googleapis.com/auth/spreadsheets');
googleProvider.addScope('https://www.googleapis.com/auth/drive.file');

// In-memory access token cache (CRITICAL: Do NOT store in localStorage per Workspace skill)
let cachedAccessToken: string | null = null;
let isSigningIn = false;

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const setCachedAccessToken = (token: string | null) => {
  cachedAccessToken = token;
};

// Firestore Error Handling matching strict security specification
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
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const currentUser = auth.currentUser;
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: currentUser?.uid,
      email: currentUser?.email,
      emailVerified: currentUser?.emailVerified,
      isAnonymous: currentUser?.isAnonymous,
      tenantId: currentUser?.tenantId,
      providerInfo:
        currentUser?.providerData?.map((p) => ({
          providerId: p.providerId,
          email: p.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Test initial connection to Firestore
export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firebase client is offline. Check configuration.');
      return false;
    }
    // Permissions error or non-existent doc is expected for test path, connection is active
    return true;
  }
}

// Sign In with Google
export const loginWithGoogle = async (): Promise<{
  user: User;
  accessToken: string;
} | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (credential?.accessToken) {
      cachedAccessToken = credential.accessToken;
    }

    // Upsert user document
    const userDocRef = doc(db, 'users', result.user.uid);
    try {
      const snap = await getDoc(userDocRef);
      if (!snap.exists()) {
        await setDoc(userDocRef, {
          userId: result.user.uid,
          email: result.user.email || '',
          displayName: result.user.displayName || 'Pengguna',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      } else {
        await updateDoc(userDocRef, {
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.warn('Could not upsert user doc:', e);
    }

    return { user: result.user, accessToken: cachedAccessToken || '' };
  } catch (error) {
    console.error('Login error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

// Sign Out
export const logoutUser = async () => {
  await signOut(auth);
  cachedAccessToken = null;
};

// Subscribe to real-time transactions for the current authenticated user
export const subscribeUserTransactions = (
  userId: string,
  onData: (txs: Transaction[]) => void,
  onError?: (err: any) => void
) => {
  const txCollection = collection(db, 'transactions');
  const q = query(
    txCollection,
    where('userId', '==', userId),
    orderBy('date', 'desc')
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const txs: Transaction[] = [];
      snapshot.forEach((d) => {
        const item = d.data() as Transaction;
        txs.push({
          ...item,
          id: d.id,
        });
      });
      onData(txs);
    },
    (error) => {
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.GET, 'transactions');
    }
  );
};

// Add a new transaction
export const addTransaction = async (
  tx: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>
): Promise<Transaction> => {
  const path = 'transactions';
  try {
    const txDocRef = doc(collection(db, path));
    const nowIso = new Date().toISOString();
    const newTx: Transaction = {
      ...tx,
      id: txDocRef.id,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    await setDoc(txDocRef, newTx);
    return newTx;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
};

// Update an existing transaction
export const updateTransaction = async (
  id: string,
  txData: Partial<Omit<Transaction, 'id' | 'userId' | 'createdAt'>>
): Promise<void> => {
  const path = `transactions/${id}`;
  try {
    const txDocRef = doc(db, 'transactions', id);
    await updateDoc(txDocRef, {
      ...txData,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
};

// Delete a transaction
export const deleteTransaction = async (id: string): Promise<void> => {
  const path = `transactions/${id}`;
  try {
    const txDocRef = doc(db, 'transactions', id);
    await deleteDoc(txDocRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
};

// Generate 6-digit Telegram pairing link code
export const generateTelegramLinkCode = async (
  userId: string
): Promise<string> => {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const path = `telegramLinkCodes/${code}`;
  try {
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 mins expiry
    await setDoc(doc(db, 'telegramLinkCodes', code), {
      code,
      userId,
      createdAt: new Date().toISOString(),
      expiresAt,
    });
    return code;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
};

// Get User Profile to check linked Telegram Chat ID
export const getUserProfile = async (userId: string) => {
  const path = `users/${userId}`;
  try {
    const snap = await getDoc(doc(db, 'users', userId));
    return snap.exists() ? snap.data() : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
};
