import React, { useState, useMemo } from 'react';
import {
  Search,
  Filter,
  Trash2,
  Edit2,
  Calendar,
  Send,
  Globe,
  Receipt,
  SlidersHorizontal,
  ArrowUpDown,
} from 'lucide-react';
import {
  Transaction,
  TransactionType,
  Category,
  CATEGORIES_META,
} from '../types/finance';
import {
  formatIDR,
  formatIndonesianDate,
  formatMonthYear,
  getCurrentMonthString,
} from '../lib/currency';

interface TransactionsViewProps {
  transactions: Transaction[];
  selectedMonth: string;
  onChangeMonth: (m: string) => void;
  onEditTransaction: (tx: Transaction) => void;
  onDeleteTransaction: (id: string) => void;
  onOpenAddModal: () => void;
}

export const TransactionsView: React.FC<TransactionsViewProps> = ({
  transactions,
  selectedMonth,
  onChangeMonth,
  onEditTransaction,
  onDeleteTransaction,
  onOpenAddModal,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'expense' | 'income'>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterMonthOnly, setFilterMonthOnly] = useState(true);

  // Filtered list
  const filtered = useMemo(() => {
    return transactions.filter((tx) => {
      // Month filter
      if (filterMonthOnly && !tx.date.startsWith(selectedMonth)) {
        return false;
      }
      // Type filter
      if (filterType !== 'all' && tx.type !== filterType) {
        return false;
      }
      // Category filter
      if (filterCategory !== 'all' && tx.category !== filterCategory) {
        return false;
      }
      // Search
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const descMatch = tx.description.toLowerCase().includes(query);
        const meta = CATEGORIES_META[tx.category];
        const catMatch =
          meta?.labelId.toLowerCase().includes(query) ||
          tx.category.toLowerCase().includes(query);
        const amountMatch = String(tx.amount).includes(query);
        if (!descMatch && !catMatch && !amountMatch) return false;
      }
      return true;
    });
  }, [transactions, selectedMonth, filterMonthOnly, filterType, filterCategory, searchTerm]);

  // Group transactions by date
  const groupedByDate = useMemo(() => {
    const groups: { date: string; items: Transaction[]; totalIncome: number; totalExpense: number }[] = [];
    const dateMap = new Map<string, Transaction[]>();

    filtered.forEach((tx) => {
      const current = dateMap.get(tx.date) || [];
      current.push(tx);
      dateMap.set(tx.date, current);
    });

    // Sort by date descending
    const sortedDates = Array.from(dateMap.keys()).sort((a, b) => b.localeCompare(a));

    sortedDates.forEach((date) => {
      const items = dateMap.get(date) || [];
      let totalIncome = 0;
      let totalExpense = 0;
      items.forEach((item) => {
        if (item.type === 'income') totalIncome += item.amount;
        else totalExpense += item.amount;
      });
      groups.push({ date, items, totalIncome, totalExpense });
    });

    return groups;
  }, [filtered]);

  return (
    <div className="space-y-4 pb-20 pt-2">
      {/* Month & Filter Bar */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-1">
            <Calendar className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => onChangeMonth(e.target.value)}
              className="text-xs font-bold text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-800 py-1.5 px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 outline-none w-full"
            />
          </div>
          <button
            onClick={() => setFilterMonthOnly(!filterMonthOnly)}
            className={`text-xs px-2.5 py-1.5 rounded-xl font-medium border transition-colors shrink-0 ${
              !filterMonthOnly
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800'
                : 'bg-slate-50 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700'
            }`}
          >
            {filterMonthOnly ? 'Bulan Ini Saja' : 'Semua Bulan'}
          </button>
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Cari transaksi, nominal, atau kategori..."
            className="w-full text-xs pl-9 pr-3.5 py-2 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>

        {/* Type Filter Buttons */}
        <div className="flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
          <button
            onClick={() => setFilterType('all')}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              filterType === 'all'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            Semua ({filtered.length})
          </button>
          <button
            onClick={() => setFilterType('expense')}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              filterType === 'expense'
                ? 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 shadow-sm'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            Pengeluaran
          </button>
          <button
            onClick={() => setFilterType('income')}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              filterType === 'income'
                ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-sm'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            Pemasukan
          </button>
        </div>
      </div>

      {/* Grouped Transactions List */}
      {groupedByDate.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Tidak ada transaksi yang cocok dengan filter.
          </p>
          <button
            onClick={onOpenAddModal}
            className="mt-3 text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline"
          >
            + Tambah Transaksi Baru
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {groupedByDate.map((group) => (
            <div
              key={group.date}
              className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm"
            >
              {/* Date Header */}
              <div className="px-4 py-2.5 bg-slate-50/80 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
                <span className="font-bold text-slate-800 dark:text-slate-200">
                  {formatIndonesianDate(group.date)}
                </span>
                <div className="flex items-center gap-2 font-semibold text-[11px]">
                  {group.totalIncome > 0 && (
                    <span className="text-emerald-600 dark:text-emerald-400">
                      +{formatIDR(group.totalIncome)}
                    </span>
                  )}
                  {group.totalExpense > 0 && (
                    <span className="text-rose-600 dark:text-rose-400">
                      -{formatIDR(group.totalExpense)}
                    </span>
                  )}
                </div>
              </div>

              {/* Transactions in Date Group */}
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {group.items.map((tx) => {
                  const meta = CATEGORIES_META[tx.category];
                  const isIncome = tx.type === 'income';

                  return (
                    <div
                      key={tx.id}
                      className="p-3.5 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 ${
                            isIncome
                              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400'
                              : 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {isIncome ? '+' : '-'}
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-slate-900 dark:text-white">
                            {tx.description}
                          </p>
                          <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-0.5">
                            <span>{meta ? meta.labelId : tx.category}</span>
                            <span>•</span>
                            <span className="flex items-center gap-0.5">
                              {tx.source === 'telegram_receipt' || tx.receipt ? (
                                <span className="flex items-center gap-0.5 text-sky-600 dark:text-sky-400 font-semibold bg-sky-50 dark:bg-sky-950/60 px-1.5 py-0.2 rounded text-[10px]">
                                  <Receipt className="w-2.5 h-2.5" />
                                  <span>Struk</span>
                                </span>
                              ) : tx.source === 'telegram' ? (
                                <>
                                  <Send className="w-2.5 h-2.5 text-sky-500" />
                                  <span>Telegram</span>
                                </>
                              ) : (
                                <>
                                  <Globe className="w-2.5 h-2.5 text-emerald-500" />
                                  <span>Web</span>
                                </>
                              )}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p
                            className={`text-xs font-bold ${
                              isIncome
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-slate-900 dark:text-white'
                            }`}
                          >
                            {isIncome ? '+' : '-'}
                            {formatIDR(tx.amount)}
                          </p>
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center gap-1 pl-1">
                          <button
                            onClick={() => onEditTransaction(tx)}
                            title="Edit"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => onDeleteTransaction(tx.id)}
                            title="Hapus"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
