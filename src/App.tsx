/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import {
  auth,
  loginWithGoogle,
  logoutUser,
  subscribeUserTransactions,
  addTransaction,
  updateTransaction,
  deleteTransaction,
  testFirestoreConnection,
  getUserProfile,
  parseFirebaseAuthError,
  FirebaseAuthErrorDetail,
} from './lib/firebase';
import { Transaction, TransactionType, Category } from './types/finance';
import { getCurrentMonthString } from './lib/currency';
import { Navbar } from './components/Navbar';
import { BottomNav, ActiveTab } from './components/BottomNav';
import { DashboardView } from './components/DashboardView';
import { TransactionsView } from './components/TransactionsView';
import { TransactionModal } from './components/TransactionModal';
import { IntegrationModal } from './components/IntegrationModal';
import { AuthScreen } from './components/AuthScreen';
import { Loader2, AlertCircle } from 'lucide-react';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<FirebaseAuthErrorDetail | null>(null);

  // App Theme
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    return (
      localStorage.getItem('catatkas_theme') === 'dark' ||
      (!('catatkas_theme' in localStorage) &&
        window.matchMedia('(prefers-color-scheme: dark)').matches)
    );
  });

  // Active View and Selected Month
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonthString());

  // Data state
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [firestoreError, setFirestoreError] = useState<string | null>(null);
  const [telegramLinked, setTelegramLinked] = useState<boolean>(false);

  // Modal States
  const [isTxModalOpen, setIsTxModalOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [prefillTx, setPrefillTx] = useState<Partial<Transaction> | null>(null);
  const [isIntegrationModalOpen, setIsIntegrationModalOpen] = useState(false);

  // Delete Confirmation State
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Apply dark mode class to root HTML
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('catatkas_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('catatkas_theme', 'light');
    }
  }, [darkMode]);

  // Auth State Listener
  useEffect(() => {
    testFirestoreConnection().catch(console.warn);

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);

      if (currentUser) {
        // Check if telegram chat is linked
        try {
          const profile = await getUserProfile(currentUser.uid);
          setTelegramLinked(Boolean(profile?.telegramChatId));
        } catch (e) {
          console.warn('Profile fetch note:', e);
        }
      }
    });

    return () => unsubscribe();
  }, []);

  // Real-time Firestore Transactions Subscription
  useEffect(() => {
    if (!user) {
      setTransactions([]);
      setIsDataLoading(false);
      return;
    }

    setIsDataLoading(true);
    setFirestoreError(null);

    const unsubscribe = subscribeUserTransactions(
      user.uid,
      (txs) => {
        setTransactions(txs);
        setIsDataLoading(false);
      },
      (err) => {
        setFirestoreError('Gagal memuat data transaksi dari Firestore.');
        setIsDataLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user]);

  // Handlers
  const handleLogin = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    setLoginError(null);

    try {
      const res = await loginWithGoogle();
      if (res?.user) {
        setUser(res.user);
      }
    } catch (err: any) {
      const parsed = parseFirebaseAuthError(err);
      // Requirement 5: Log error to console with error.code, error.message, error.name
      console.error('Firebase Auth Error:', {
        code: err?.code || parsed.code,
        message: err?.message || parsed.message,
        name: err?.name || parsed.name,
      });
      setLoginError(parsed);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logoutUser();
      setUser(null);
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  const handleOpenAddModal = (prefill?: Partial<Transaction>) => {
    setEditingTx(null);
    setPrefillTx(prefill || null);
    setIsTxModalOpen(true);
  };

  const handleEditTransaction = (tx: Transaction) => {
    setPrefillTx(null);
    setEditingTx(tx);
    setIsTxModalOpen(true);
  };

  const handleSaveTransaction = async (data: {
    type: TransactionType;
    amount: number;
    category: Category;
    description: string;
    date: string;
    source: 'web';
  }) => {
    if (!user) return;

    if (editingTx) {
      await updateTransaction(editingTx.id, {
        type: data.type,
        amount: data.amount,
        category: data.category,
        description: data.description,
        date: data.date,
      });
    } else {
      await addTransaction({
        userId: user.uid,
        type: data.type,
        amount: data.amount,
        category: data.category,
        description: data.description,
        date: data.date,
        source: data.source,
      });
    }
  };

  const handleDeleteTransaction = async (id: string) => {
    setDeleteConfirmId(id);
  };

  const confirmDelete = async () => {
    if (!deleteConfirmId) return;
    try {
      await deleteTransaction(deleteConfirmId);
      setDeleteConfirmId(null);
    } catch (err: any) {
      alert('Gagal menghapus transaksi: ' + err.message);
    }
  };

  // Auth Loading Screen
  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-4">
        <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
        <p className="mt-3 text-xs font-semibold text-slate-500">Memuat CatatKas...</p>
      </div>
    );
  }

  // Not Logged In Screen
  if (!user) {
    return (
      <AuthScreen
        onLogin={handleLogin}
        isLoading={isLoggingIn}
        error={loginError}
        onClearError={() => setLoginError(null)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-100/60 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col transition-colors selection:bg-emerald-500 selection:text-white">
      {/* Top Navbar */}
      <Navbar
        user={user}
        onLogin={handleLogin}
        onLogout={handleLogout}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode(!darkMode)}
        onOpenIntegrations={() => setIsIntegrationModalOpen(true)}
        telegramLinked={telegramLinked}
      />

      {/* Main Container constrained to Mobile Screen Width (max-w-md) */}
      <main className="flex-1 max-w-md w-full mx-auto px-4 pt-3">
        {firestoreError && (
          <div className="mb-4 p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{firestoreError}</span>
          </div>
        )}

        {isDataLoading ? (
          <div className="py-24 flex flex-col items-center justify-center">
            <Loader2 className="w-7 h-7 text-emerald-600 animate-spin" />
            <p className="mt-2 text-xs text-slate-400">Sinkronisasi data...</p>
          </div>
        ) : (
          <>
            {activeTab === 'dashboard' && (
              <DashboardView
                transactions={transactions}
                selectedMonth={selectedMonth}
                onChangeMonth={setSelectedMonth}
                onOpenAddModal={handleOpenAddModal}
                onEditTransaction={handleEditTransaction}
                onDeleteTransaction={handleDeleteTransaction}
                onViewAllTransactions={() => setActiveTab('transactions')}
                onOpenIntegrations={() => setIsIntegrationModalOpen(true)}
              />
            )}

            {activeTab === 'transactions' && (
              <TransactionsView
                transactions={transactions}
                selectedMonth={selectedMonth}
                onChangeMonth={setSelectedMonth}
                onEditTransaction={handleEditTransaction}
                onDeleteTransaction={handleDeleteTransaction}
                onOpenAddModal={() => handleOpenAddModal()}
              />
            )}

            {activeTab === 'integrations' && (
              <div className="pt-2">
                <IntegrationModal
                  isOpen={true}
                  onClose={() => setActiveTab('dashboard')}
                  userId={user.uid}
                  transactions={transactions}
                  selectedMonth={selectedMonth}
                  telegramLinked={telegramLinked}
                />
              </div>
            )}
          </>
        )}
      </main>

      {/* Mobile Bottom Navigation */}
      <BottomNav
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        onOpenAddModal={() => handleOpenAddModal()}
      />

      {/* Add / Edit Transaction Modal */}
      <TransactionModal
        isOpen={isTxModalOpen}
        onClose={() => {
          setIsTxModalOpen(false);
          setEditingTx(null);
          setPrefillTx(null);
        }}
        onSave={handleSaveTransaction}
        editingTx={editingTx}
        prefillData={prefillTx}
      />

      {/* Integrations & Export Modal (popup when opened via Navbar) */}
      {isIntegrationModalOpen && activeTab !== 'integrations' && (
        <IntegrationModal
          isOpen={isIntegrationModalOpen}
          onClose={() => setIsIntegrationModalOpen(false)}
          userId={user.uid}
          transactions={transactions}
          selectedMonth={selectedMonth}
          telegramLinked={telegramLinked}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-xs bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-2xl text-center">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 flex items-center justify-center">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                Hapus Transaksi?
              </h4>
              <p className="text-xs text-slate-500 mt-1">
                Tindakan ini tidak dapat dibatalkan.
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmId(null)}
                className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                className="flex-1 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-xs font-bold text-white shadow-md shadow-rose-600/30"
              >
                Hapus
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
