import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  User,
  browserLocalPersistence,
  setPersistence,
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

// Initialize Firebase Auth (Singleton)
export const auth = getAuth(app);

// Configure language & local persistence to persist session across page refreshes on Vercel
try {
  auth.useDeviceLanguage();
  setPersistence(auth, browserLocalPersistence).catch((err) => {
    console.warn('Notice: browserLocalPersistence configuration warning:', err);
  });
} catch (initErr) {
  console.warn('Notice setting auth persistence:', initErr);
}

// Configure Clean Google Auth Provider for basic user authentication
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account',
});

// Configure Google Auth Provider with Workspace Scopes (used on-demand for Sheets & Drive export)
export const workspaceGoogleProvider = new GoogleAuthProvider();
workspaceGoogleProvider.addScope('https://www.googleapis.com/auth/spreadsheets');
workspaceGoogleProvider.addScope('https://www.googleapis.com/auth/drive.file');
workspaceGoogleProvider.setCustomParameters({
  prompt: 'consent',
});

// In-memory access token cache (CRITICAL: Do NOT store in localStorage per Workspace skill)
let cachedAccessToken: string | null = null;
let isSigningIn = false;

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const setCachedAccessToken = (token: string | null) => {
  cachedAccessToken = token;
};

export const requestWorkspaceAccessToken = async (): Promise<string> => {
  if (cachedAccessToken) return cachedAccessToken;
  const result = await signInWithPopup(auth, workspaceGoogleProvider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (credential?.accessToken) {
    cachedAccessToken = credential.accessToken;
    return cachedAccessToken;
  }
  throw new Error('Gagal memperoleh token akses Google Workspace.');
};

/**
 * Detailed Firebase Auth Error Parser with User-Friendly Indonesian Explanations
 */
export interface FirebaseAuthErrorDetail {
  code: string;
  name: string;
  message: string;
  userMessage: string;
}

export function parseFirebaseAuthError(error: any): FirebaseAuthErrorDetail {
  const code = (error?.code || 'auth/unknown-error').toString();
  const name = (error?.name || 'FirebaseError').toString();
  const message = (error?.message || 'Terjadi kesalahan autentikasi').toString();

  let userMessage = 'Terjadi kesalahan saat masuk dengan Google. Silakan coba lagi.';

  switch (code) {
    case 'auth/popup-blocked':
      userMessage =
        'Jendela pop-up login diblokir oleh browser. Mohon izinkan pop-up (Allow pop-ups) pada pengaturan browser Anda lalu coba kembali.';
      break;
    case 'auth/popup-closed-by-user':
      userMessage =
        'Jendela login ditutup sebelum proses selesai. Silakan klik tombol "Masuk dengan Google" kembali.';
      break;
    case 'auth/cancelled-popup-request':
      userMessage =
        'Proses login sebelumnya dibatalkan karena ada proses baru yang sedang berjalan.';
      break;
    case 'auth/unauthorized-domain':
      userMessage =
        'Domain website ini (catatan-bundahara.vercel.app) belum diizinkan di Firebase Authentication. Tambahkan domain ini ke Firebase Console > Authentication > Settings > Authorized domains.';
      break;
    case 'auth/operation-not-allowed':
      userMessage =
        'Metode login Google belum diaktifkan di Firebase Console. Pastikan Google Provider sudah diaktifkan di menu Authentication > Sign-in method.';
      break;
    case 'auth/invalid-api-key':
      userMessage =
        'Kunci API Firebase tidak valid. Periksa konfigurasi proyek Firebase Anda.';
      break;
    case 'auth/app-deleted':
    case 'auth/app-not-authorized':
      userMessage =
        'Aplikasi tidak diotorisasi oleh Firebase. Periksa konfigurasi project.';
      break;
    case 'auth/network-request-failed':
      userMessage =
        'Koneksi internet bermasalah. Periksa koneksi internet Anda dan coba lagi.';
      break;
    case 'auth/account-exists-with-different-credential':
      userMessage =
        'Email Anda sudah terdaftar dengan metode autentikasi yang berbeda.';
      break;
    case 'auth/user-disabled':
      userMessage =
        'Akun pengguna ini telah dinonaktifkan oleh administrator.';
      break;
    case 'auth/internal-error':
      userMessage =
        'Terjadi kendala internal pada server Firebase. Silakan coba lagi dalam beberapa saat.';
      break;
    case 'auth/user-cancelled':
      userMessage = 'Proses masuk dibatalkan oleh pengguna.';
      break;
    default:
      if (message.includes('popup')) {
        userMessage =
          'Jendela pop-up login tidak dapat dibuka. Pastikan browser Anda tidak memblokir jendela pop-up.';
      } else if (message.includes('network') || message.includes('offline')) {
        userMessage = 'Koneksi jaringan terputus. Pastikan perangkat Anda terhubung ke internet.';
      } else {
        userMessage = `Gagal masuk: ${message}`;
      }
      break;
  }

  return {
    code,
    name,
    message,
    userMessage,
  };
}

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
  if (isSigningIn) {
    console.warn('Login request ignored: sign-in already in progress.');
    return null;
  }

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
  } catch (error: any) {
    // Log error to console with error.code, error.message, error.name per requirement 5
    console.error('Firebase Auth Error:', {
      code: error?.code,
      message: error?.message,
      name: error?.name,
    });
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
