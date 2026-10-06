import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  collection,
  query,
  where,
  getDocs,
  Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { Transaction } from '../types/finance';

let dbInstance: Firestore | null = null;

export function getServerFirestore(): Firestore {
  if (dbInstance) return dbInstance;

  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  const databaseId = (firebaseConfig as any).firestoreDatabaseId;

  if (databaseId && databaseId !== '(default)') {
    dbInstance = getFirestore(app, databaseId);
  } else {
    dbInstance = getFirestore(app);
  }

  return dbInstance;
}

// Server-side helper to record incoming Telegram deduplication ID
export async function isUpdateAlreadyProcessed(updateId: number | string): Promise<boolean> {
  try {
    const db = getServerFirestore();
    const docRef = doc(db, 'telegramUpdates', String(updateId));
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return true;
    }
    await setDoc(docRef, {
      updateId: String(updateId),
      processedAt: new Date().toISOString(),
    });
    return false;
  } catch (err) {
    console.warn('Idempotency check warning:', err);
    return false;
  }
}

// Map Telegram Chat ID to User ID
export async function getUserIdByTelegramChatId(chatId: string | number): Promise<string | null> {
  try {
    const db = getServerFirestore();
    const docRef = doc(db, 'telegramUsers', String(chatId));
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return snap.data()?.userId || null;
    }
    return null;
  } catch (err) {
    console.error('Error getting user by telegram chat ID:', err);
    return null;
  }
}

// Link Telegram Chat ID to User ID via 6-digit code
export async function linkTelegramChatWithCode(
  chatId: string | number,
  code: string,
  username?: string
): Promise<{ success: boolean; message: string; userId?: string }> {
  try {
    const db = getServerFirestore();
    const codeRef = doc(db, 'telegramLinkCodes', code.trim());
    const snap = await getDoc(codeRef);

    if (!snap.exists()) {
      return {
        success: false,
        message: 'Kode tautan tidak ditemukan atau sudah kadaluarsa. Silakan buat kode baru di dashboard web.',
      };
    }

    const data = snap.data();
    const expiresAt = new Date(data?.expiresAt).getTime();
    if (Date.now() > expiresAt) {
      await deleteDoc(codeRef);
      return {
        success: false,
        message: 'Kode tautan sudah kadaluarsa (lebih dari 15 menit). Buat kode baru di dashboard web.',
      };
    }

    const userId = data?.userId;
    if (!userId) {
      return { success: false, message: 'Data tautan tidak valid.' };
    }

    // Save telegram mapping
    await setDoc(doc(db, 'telegramUsers', String(chatId)), {
      chatId: String(chatId),
      userId,
      username: username || '',
      linkedAt: new Date().toISOString(),
    });

    // Update user document
    try {
      await setDoc(
        doc(db, 'users', userId),
        {
          telegramChatId: String(chatId),
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch (e) {
      console.warn('User document update notice:', e);
    }

    // Delete used code
    await deleteDoc(codeRef);

    return {
      success: true,
      message: 'Kode berhasil diterima. Akun Telegram Anda telah terhubung.',
      userId,
    };
  } catch (err: any) {
    console.error('Error linking telegram code:', err);
    return {
      success: false,
      message: `Gagal menghubungkan akun: ${err.message}`,
    };
  }
}

// Server-side add transaction from Telegram
export async function addTransactionFromTelegram(
  userId: string,
  data: {
    type: 'income' | 'expense';
    amount: number;
    category: string;
    description: string;
    date: string;
  }
): Promise<Transaction> {
  const db = getServerFirestore();
  const txCol = collection(db, 'transactions');
  const txDocRef = doc(txCol);
  const nowIso = new Date().toISOString();

  const newTx: Transaction = {
    id: txDocRef.id,
    userId,
    type: data.type,
    amount: data.amount,
    category: data.category as any,
    description: data.description,
    date: data.date,
    source: 'telegram',
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await setDoc(txDocRef, newTx);
  return newTx;
}

// Server-side query transactions for Telegram summary commands
export async function getUserTransactionsForSummary(
  userId: string,
  startDate?: string,
  endDate?: string
): Promise<Transaction[]> {
  try {
    const db = getServerFirestore();
    const txCol = collection(db, 'transactions');
    let q = query(txCol, where('userId', '==', userId));

    const snapshot = await getDocs(q);
    const txs: Transaction[] = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data() as Transaction;
      if (startDate && data.date < startDate) return;
      if (endDate && data.date > endDate) return;
      txs.push(data);
    });
    return txs;
  } catch (err) {
    console.error('Error fetching transactions for summary:', err);
    return [];
  }
}

// Get user's recent transactions sorted by createdAt or date descending
export async function getUserRecentTransactions(
  userId: string,
  limitCount: number = 5
): Promise<Transaction[]> {
  try {
    const db = getServerFirestore();
    const txCol = collection(db, 'transactions');
    const q = query(txCol, where('userId', '==', userId));
    const snapshot = await getDocs(q);
    const txs: Transaction[] = [];
    snapshot.forEach((docSnap) => {
      txs.push(docSnap.data() as Transaction);
    });
    txs.sort((a, b) => {
      const timeA = new Date(a.createdAt || a.date).getTime();
      const timeB = new Date(b.createdAt || b.date).getTime();
      return timeB - timeA;
    });
    return txs.slice(0, limitCount);
  } catch (err) {
    console.error('Error fetching recent transactions:', err);
    return [];
  }
}

// Find transactions matching correction search criteria
export async function findTransactionsForCorrection(
  userId: string,
  criteria: {
    amount?: number;
    description?: string;
    isLast?: boolean;
    type?: string;
  }
): Promise<Transaction[]> {
  try {
    const db = getServerFirestore();
    const txCol = collection(db, 'transactions');
    const q = query(txCol, where('userId', '==', userId));
    const snapshot = await getDocs(q);
    const allTxs: Transaction[] = [];
    snapshot.forEach((docSnap) => {
      allTxs.push(docSnap.data() as Transaction);
    });

    allTxs.sort((a, b) => {
      const timeA = new Date(a.createdAt || a.date).getTime();
      const timeB = new Date(b.createdAt || b.date).getTime();
      return timeB - timeA;
    });

    if (allTxs.length === 0) return [];

    if (criteria.isLast) {
      return [allTxs[0]];
    }

    // Filter by criteria
    const matches = allTxs.filter((tx) => {
      if (criteria.amount !== undefined && tx.amount !== criteria.amount) {
        return false;
      }
      if (criteria.description) {
        const queryDesc = criteria.description.toLowerCase().trim();
        const txDesc = tx.description.toLowerCase().trim();
        if (!txDesc.includes(queryDesc) && !queryDesc.includes(txDesc)) {
          return false;
        }
      }
      return true;
    });

    return matches;
  } catch (err) {
    console.error('Error finding transaction for correction:', err);
    return [];
  }
}

// Update an existing transaction in place with audit trail
export async function updateExistingTransaction(
  userId: string,
  transactionId: string,
  changes: Partial<Pick<Transaction, 'type' | 'amount' | 'category' | 'description' | 'date'>>,
  editSource: string = 'telegram'
): Promise<{ success: boolean; transaction?: Transaction; previousState?: any; message?: string }> {
  try {
    const db = getServerFirestore();
    const txRef = doc(db, 'transactions', transactionId);
    const snap = await getDoc(txRef);

    if (!snap.exists()) {
      return { success: false, message: 'Transaksi tidak ditemukan.' };
    }

    const existing = snap.data() as Transaction;
    if (existing.userId !== userId) {
      return { success: false, message: 'Akses ditolak: bukan transaksi Anda.' };
    }

    const previousState = {
      type: existing.type,
      amount: existing.amount,
      category: existing.category,
      description: existing.description,
      date: existing.date,
    };

    const nowIso = new Date().toISOString();
    const historyEntry = {
      ...previousState,
      editedAt: nowIso,
      editSource,
    };

    const updatedData: Partial<Transaction> = {
      ...changes,
      updatedAt: nowIso,
      lastEditedFrom: previousState,
      editSource,
      editHistory: [...(existing.editHistory || []), historyEntry],
    };

    await setDoc(txRef, updatedData, { merge: true });

    const finalTx: Transaction = {
      ...existing,
      ...updatedData,
    };

    return {
      success: true,
      transaction: finalTx,
      previousState,
    };
  } catch (err: any) {
    console.error('Error updating existing transaction:', err);
    return { success: false, message: err.message };
  }
}

// Undo user's most recent edit
export async function undoLastTransactionEdit(
  userId: string
): Promise<{ success: boolean; revertedTx?: Transaction; previousState?: any; message?: string }> {
  try {
    const db = getServerFirestore();
    const txCol = collection(db, 'transactions');
    const q = query(txCol, where('userId', '==', userId));
    const snapshot = await getDocs(q);

    const editedTxs: Transaction[] = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data() as Transaction;
      if (data.lastEditedFrom) {
        editedTxs.push(data);
      }
    });

    if (editedTxs.length === 0) {
      return {
        success: false,
        message: 'Tidak ada riwayat koreksi transaksi yang dapat dibatalkan.',
      };
    }

    // Sort by updatedAt descending
    editedTxs.sort((a, b) => {
      const timeA = new Date(a.updatedAt || a.createdAt).getTime();
      const timeB = new Date(b.updatedAt || b.createdAt).getTime();
      return timeB - timeA;
    });

    const targetTx = editedTxs[0];
    const previousState = targetTx.lastEditedFrom!;
    const txRef = doc(db, 'transactions', targetTx.id);

    const nowIso = new Date().toISOString();
    const revertedData = {
      type: previousState.type,
      amount: previousState.amount,
      category: previousState.category,
      description: previousState.description,
      date: previousState.date || targetTx.date,
      updatedAt: nowIso,
      editSource: 'undo_telegram',
    };

    await updateDoc(txRef, {
      ...revertedData,
      lastEditedFrom: deleteField(),
    });

    const resultTx: Transaction = {
      ...targetTx,
      ...revertedData,
      lastEditedFrom: undefined,
    };

    return {
      success: true,
      revertedTx: resultTx,
      previousState: {
        type: targetTx.type,
        amount: targetTx.amount,
        category: targetTx.category,
        description: targetTx.description,
      },
    };
  } catch (err: any) {
    console.error('Error undoing edit:', err);
    return { success: false, message: err.message };
  }
}
