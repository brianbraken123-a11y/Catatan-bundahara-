import React, { useState } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Calendar,
  Sparkles,
  ArrowRight,
  Send,
  PieChart,
  History,
  Clock,
  ChevronRight,
  PlusCircle,
  HelpCircle,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import {
  Transaction,
  MonthlySummary,
  CATEGORIES_META,
  Category,
  ParsedTransactionResult,
} from '../types/finance';
import {
  formatIDR,
  formatIndonesianDate,
  formatMonthYear,
  getCurrentMonthString,
} from '../lib/currency';

interface DashboardViewProps {
  transactions: Transaction[];
  selectedMonth: string;
  onChangeMonth: (m: string) => void;
  onOpenAddModal: (prefill?: Partial<Transaction>) => void;
  onEditTransaction: (tx: Transaction) => void;
  onDeleteTransaction: (id: string) => void;
  onViewAllTransactions: () => void;
  onOpenIntegrations: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  transactions,
  selectedMonth,
  onChangeMonth,
  onOpenAddModal,
  onEditTransaction,
  onDeleteTransaction,
  onViewAllTransactions,
  onOpenIntegrations,
}) => {
  // AI Natural Language Quick Input state
  const [aiText, setAiText] = useState('');
  const [isParsingAi, setIsParsingAi] = useState(false);
  const [aiFeedback, setAiFeedback] = useState<string | null>(null);

  // Compute metrics for the selected month and overall
  const now = new Date();
  const currentMonthStr = getCurrentMonthString();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  // Current balance across all recorded transactions
  let currentBalance = 0;
  let totalIncomeMonth = 0;
  let totalExpenseMonth = 0;
  let todayExpense = 0;
  let todayIncome = 0;

  const categoryExpenseMap: Record<string, number> = {};

  transactions.forEach((tx) => {
    // Overall balance
    if (tx.type === 'income') currentBalance += tx.amount;
    else currentBalance -= tx.amount;

    // Selected Month metrics
    if (tx.date.startsWith(selectedMonth)) {
      if (tx.type === 'income') {
        totalIncomeMonth += tx.amount;
      } else {
        totalExpenseMonth += tx.amount;
        categoryExpenseMap[tx.category] =
          (categoryExpenseMap[tx.category] || 0) + tx.amount;
      }
    }

    // Today metrics
    if (tx.date === todayStr) {
      if (tx.type === 'expense') todayExpense += tx.amount;
      else todayIncome += tx.amount;
    }
  });

  // Category breakdown list
  const categoryBreakdown = Object.entries(categoryExpenseMap)
    .map(([cat, amount]) => ({
      category: cat as Category,
      amount,
      percentage:
        totalExpenseMonth > 0 ? Math.round((amount / totalExpenseMonth) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  // Recent 5 transactions
  const recentTransactions = [...transactions].slice(0, 5);

  // Handle Quick AI Parser
  const handleQuickAiSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiText.trim()) return;

    setIsParsingAi(true);
    setAiFeedback(null);

    try {
      const res = await fetch('/api/gemini/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: aiText.trim(), date: todayStr }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Gagal memproses teks');
      }

      const parsed: ParsedTransactionResult = await res.json();

      if (parsed.isAmbiguous) {
        setAiFeedback(
          parsed.clarificationQuestion ||
            'Informasi kurang jelas. Mohon lengkapi nominal dan kategorinya.'
        );
        return;
      }

      if (parsed.amount && parsed.type && parsed.category) {
        // Open modal prefilled with AI result so user can review and confirm
        onOpenAddModal({
          type: parsed.type,
          amount: parsed.amount,
          category: parsed.category,
          description: parsed.description || aiText.trim(),
          date: parsed.date || todayStr,
        });
        setAiText('');
        setAiFeedback(null);
      } else {
        setAiFeedback('Tidak dapat mendeteksi nominal transaksi. Silakan coba lagi.');
      }
    } catch (err: any) {
      setAiFeedback(err.message || 'Terjadi kesalahan saat memproses');
    } finally {
      setIsParsingAi(false);
    }
  };

  return (
    <div className="space-y-5 pb-20 pt-2">
      {/* Saldo Hero Card */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-700 p-6 text-white shadow-xl shadow-teal-900/10">
        <div className="relative z-10">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-emerald-100">
              Total Saldo Bersih
            </span>
            <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-semibold text-white backdrop-blur-md">
              IDR
            </span>
          </div>

          <div className="mt-2 flex items-baseline">
            <h2 className="text-3xl font-extrabold tracking-tight">
              {formatIDR(currentBalance)}
            </h2>
          </div>

          {/* Quick Stats Grid inside Hero */}
          <div className="mt-5 grid grid-cols-2 gap-3 border-t border-white/15 pt-4">
            <div>
              <div className="flex items-center gap-1.5 text-xs text-emerald-100">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-300" />
                <span>Pemasukan {formatMonthYear(selectedMonth).split(' ')[0]}</span>
              </div>
              <p className="mt-1 text-sm font-bold text-white">
                +{formatIDR(totalIncomeMonth)}
              </p>
            </div>

            <div>
              <div className="flex items-center gap-1.5 text-xs text-rose-100">
                <TrendingDown className="w-3.5 h-3.5 text-rose-300" />
                <span>Pengeluaran {formatMonthYear(selectedMonth).split(' ')[0]}</span>
              </div>
              <p className="mt-1 text-sm font-bold text-white">
                -{formatIDR(totalExpenseMonth)}
              </p>
            </div>
          </div>
        </div>

        {/* Subtle decorative circles */}
        <div className="absolute -bottom-8 -right-8 w-36 h-36 rounded-full bg-white/10 blur-xl pointer-events-none" />
        <div className="absolute -top-10 -left-10 w-32 h-32 rounded-full bg-teal-400/20 blur-lg pointer-events-none" />
      </div>

      {/* Today's Expense Callout & Month Selector */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 text-xs font-medium">
            <Clock className="w-3.5 h-3.5 text-amber-500" />
            <span>Pengeluaran Hari Ini</span>
          </div>
          <p className="mt-1.5 text-base font-bold text-slate-900 dark:text-white">
            {formatIDR(todayExpense)}
          </p>
          <span className="text-[10px] text-slate-400">
            {todayIncome > 0 ? `+${formatIDR(todayIncome)} masuk` : 'Belum ada pemasukan'}
          </span>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 text-xs font-medium">
            <Calendar className="w-3.5 h-3.5 text-emerald-500" />
            <span>Bulan Aktif</span>
          </div>
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => onChangeMonth(e.target.value)}
            className="mt-1 text-xs font-semibold text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-800 py-1 px-2 rounded-lg border border-slate-200 dark:border-slate-700 outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
      </div>

      {/* Gemini AI Natural Language Quick Input Bar */}
      <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900/50 bg-gradient-to-r from-emerald-50/70 via-teal-50/40 to-white dark:from-emerald-950/20 dark:via-slate-900 dark:to-slate-900 p-4 shadow-sm">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800 dark:text-emerald-400">
          <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400 animate-pulse" />
          <span>Catat Instan dengan AI Gemini</span>
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
          Ketik natural seperti chat: <i>"kopi 18rb"</i>, <i>"bensin 50k"</i>, atau <i>"gaji 7.5jt"</i>
        </p>

        <form onSubmit={handleQuickAiSubmit} className="mt-2.5 flex items-center gap-2">
          <input
            type="text"
            value={aiText}
            onChange={(e) => setAiText(e.target.value)}
            placeholder="Contoh: makan ayam geprek 25k..."
            className="flex-1 text-xs bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/30"
          />
          <button
            type="submit"
            disabled={isParsingAi || !aiText.trim()}
            className="px-3.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium text-xs flex items-center gap-1 transition-all cursor-pointer"
          >
            {isParsingAi ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
          </button>
        </form>

        {aiFeedback && (
          <div className="mt-2.5 text-[11px] p-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{aiFeedback}</span>
          </div>
        )}
      </div>

      {/* Monthly Income vs Expense Progress Bar */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-slate-900 dark:text-white">
            Rasio Bulan Ini ({formatMonthYear(selectedMonth)})
          </span>
          <span className="text-slate-500 dark:text-slate-400">
            {totalIncomeMonth > 0
              ? `${Math.min(100, Math.round((totalExpenseMonth / totalIncomeMonth) * 100))}% terpakai`
              : '0%'}
          </span>
        </div>

        {/* Visual Bar */}
        <div className="mt-2.5 h-2.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex">
          <div
            style={{
              width: `${
                totalIncomeMonth + totalExpenseMonth > 0
                  ? Math.round(
                      (totalIncomeMonth / (totalIncomeMonth + totalExpenseMonth)) * 100
                    )
                  : 50
              }%`,
            }}
            className="bg-emerald-500 h-full transition-all duration-500"
            title="Pemasukan"
          />
          <div
            style={{
              width: `${
                totalIncomeMonth + totalExpenseMonth > 0
                  ? Math.round(
                      (totalExpenseMonth / (totalIncomeMonth + totalExpenseMonth)) * 100
                    )
                  : 50
              }%`,
            }}
            className="bg-rose-500 h-full transition-all duration-500"
            title="Pengeluaran"
          />
        </div>

        <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            Pemasukan: {formatIDR(totalIncomeMonth)}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-rose-500" />
            Pengeluaran: {formatIDR(totalExpenseMonth)}
          </span>
        </div>
      </div>

      {/* Spending by Category */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PieChart className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Pengeluaran per Kategori
            </h3>
          </div>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {formatMonthYear(selectedMonth)}
          </span>
        </div>

        {categoryBreakdown.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400">
            Belum ada catatan pengeluaran pada bulan ini.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {categoryBreakdown.map((item) => {
              const meta = CATEGORIES_META[item.category];
              return (
                <div key={item.category} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-800 dark:text-slate-200">
                      {meta ? meta.labelId : item.category}
                    </span>
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {formatIDR(item.amount)} ({item.percentage}%)
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      style={{ width: `${item.percentage}%` }}
                      className="h-full bg-rose-500 rounded-full transition-all duration-300"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent Transactions List */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Transaksi Terbaru
            </h3>
          </div>
          <button
            onClick={onViewAllTransactions}
            className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-0.5"
          >
            Lihat Semua <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {recentTransactions.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400">
            Belum ada transaksi. Klik tombol (+) di bawah atau kirim via Telegram.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {recentTransactions.map((tx) => {
              const meta = CATEGORIES_META[tx.category];
              const isIncome = tx.type === 'income';

              return (
                <div
                  key={tx.id}
                  onClick={() => onEditTransaction(tx)}
                  className="py-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/40 rounded-xl px-1 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold ${
                        isIncome
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400'
                          : 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {isIncome ? '+' : '-'}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-900 dark:text-white line-clamp-1">
                        {tx.description}
                      </p>
                      <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                        <span>{meta ? meta.labelId : tx.category}</span>
                        <span>•</span>
                        <span>{formatIndonesianDate(tx.date, { shortMonth: true })}</span>
                        {tx.source === 'telegram_receipt' || tx.receipt ? (
                          <span className="bg-sky-50 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400 px-1.5 py-0.5 rounded text-[9px] font-bold">
                            🧾 Struk
                          </span>
                        ) : tx.source === 'telegram' ? (
                          <span className="bg-sky-50 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400 px-1 rounded text-[9px] font-medium">
                            Bot
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>

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
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
