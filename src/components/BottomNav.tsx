import React from 'react';
import { LayoutDashboard, ReceiptText, Plus, Share2 } from 'lucide-react';

export type ActiveTab = 'dashboard' | 'transactions' | 'integrations';

interface BottomNavProps {
  activeTab: ActiveTab;
  onChangeTab: (tab: ActiveTab) => void;
  onOpenAddModal: () => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onChangeTab,
  onOpenAddModal,
}) => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 transition-colors">
      <div className="max-w-md mx-auto px-6 h-16 flex items-center justify-between">
        {/* Ringkasan */}
        <button
          onClick={() => onChangeTab('dashboard')}
          className={`flex flex-col items-center justify-center flex-1 py-1 transition-colors ${
            activeTab === 'dashboard'
              ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          <LayoutDashboard className="w-5 h-5 mb-0.5" />
          <span className="text-[11px]">Ringkasan</span>
        </button>

        {/* Floating Add Button */}
        <div className="flex-1 flex justify-center -translate-y-3">
          <button
            onClick={onOpenAddModal}
            aria-label="Tambah Transaksi Baru"
            className="w-13 h-13 rounded-full bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white shadow-lg shadow-emerald-600/30 flex items-center justify-center transition-all cursor-pointer"
          >
            <Plus className="w-7 h-7 stroke-[2.5]" />
          </button>
        </div>

        {/* Transaksi */}
        <button
          onClick={() => onChangeTab('transactions')}
          className={`flex flex-col items-center justify-center flex-1 py-1 transition-colors ${
            activeTab === 'transactions'
              ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          <ReceiptText className="w-5 h-5 mb-0.5" />
          <span className="text-[11px]">Transaksi</span>
        </button>

        {/* Integrasi / Ekspor */}
        <button
          onClick={() => onChangeTab('integrations')}
          className={`flex flex-col items-center justify-center flex-1 py-1 transition-colors ${
            activeTab === 'integrations'
              ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          <Share2 className="w-5 h-5 mb-0.5" />
          <span className="text-[11px]">Integrasi</span>
        </button>
      </div>
    </nav>
  );
};
