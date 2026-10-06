import React, { useState, useEffect } from 'react';
import { X, Check, ArrowDownLeft, ArrowUpRight, Calendar, Tag, FileText } from 'lucide-react';
import {
  Transaction,
  TransactionType,
  Category,
  CATEGORIES_META,
} from '../types/finance';
import { formatIDR, getTodayDateString } from '../lib/currency';

interface TransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: {
    type: TransactionType;
    amount: number;
    category: Category;
    description: string;
    date: string;
    source: 'web';
  }) => Promise<void>;
  editingTx: Transaction | null;
  prefillData?: Partial<Transaction> | null;
}

export const TransactionModal: React.FC<TransactionModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingTx,
  prefillData,
}) => {
  const [type, setType] = useState<TransactionType>('expense');
  const [amountStr, setAmountStr] = useState('');
  const [category, setCategory] = useState<Category>('food');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(getTodayDateString());
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sync state when editing or prefilling
  useEffect(() => {
    if (editingTx) {
      setType(editingTx.type);
      setAmountStr(String(editingTx.amount));
      setCategory(editingTx.category);
      setDescription(editingTx.description);
      setDate(editingTx.date);
    } else if (prefillData) {
      setType(prefillData.type || 'expense');
      setAmountStr(prefillData.amount ? String(prefillData.amount) : '');
      setCategory(
        prefillData.category || (prefillData.type === 'income' ? 'salary' : 'food')
      );
      setDescription(prefillData.description || '');
      setDate(prefillData.date || getTodayDateString());
    } else {
      // Default reset
      setType('expense');
      setAmountStr('');
      setCategory('food');
      setDescription('');
      setDate(getTodayDateString());
    }
    setErrorMsg(null);
  }, [editingTx, prefillData, isOpen]);

  // Adjust category when type changes if needed
  const handleTypeChange = (newType: TransactionType) => {
    setType(newType);
    if (newType === 'income') {
      if (
        !['salary', 'business', 'freelance', 'other_income'].includes(category)
      ) {
        setCategory('salary');
      }
    } else {
      if (
        ['salary', 'business', 'freelance', 'other_income'].includes(category)
      ) {
        setCategory('food');
      }
    }
  };

  const addAmount = (addition: number) => {
    const current = parseInt(amountStr.replace(/\D/g, ''), 10) || 0;
    setAmountStr(String(current + addition));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numericAmount = parseInt(amountStr.replace(/\D/g, ''), 10);

    if (isNaN(numericAmount) || numericAmount <= 0) {
      setErrorMsg('Masukkan nominal yang valid dan lebih dari 0.');
      return;
    }
    if (!description.trim()) {
      setErrorMsg('Masukkan deskripsi transaksi.');
      return;
    }
    if (!date) {
      setErrorMsg('Pilih tanggal transaksi.');
      return;
    }

    setIsSaving(true);
    setErrorMsg(null);

    try {
      await onSave({
        type,
        amount: numericAmount,
        category,
        description: description.trim(),
        date,
        source: 'web',
      });
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal menyimpan transaksi.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  // Filter available categories by active type
  const availableCategories = Object.values(CATEGORIES_META).filter(
    (meta) => meta.type === type
  );

  const numericValue = parseInt(amountStr.replace(/\D/g, ''), 10) || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">
            {editingTx ? 'Edit Transaksi' : 'Catat Transaksi'}
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4">
          {errorMsg && (
            <div className="p-3 text-xs rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300">
              {errorMsg}
            </div>
          )}

          {/* Type Switcher */}
          <div className="grid grid-cols-2 gap-2 bg-slate-100 dark:bg-slate-800 p-1.5 rounded-2xl">
            <button
              type="button"
              onClick={() => handleTypeChange('expense')}
              className={`py-2 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                type === 'expense'
                  ? 'bg-rose-500 text-white shadow-md shadow-rose-500/25'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <ArrowDownLeft className="w-4 h-4" />
              Pengeluaran
            </button>
            <button
              type="button"
              onClick={() => handleTypeChange('income')}
              className={`py-2 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                type === 'income'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/25'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <ArrowUpRight className="w-4 h-4" />
              Pemasukan
            </button>
          </div>

          {/* Amount Input */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Nominal (IDR)
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-3 text-base font-bold text-slate-400">
                Rp
              </span>
              <input
                type="number"
                inputMode="numeric"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                placeholder="0"
                className="w-full pl-11 pr-4 py-2.5 text-xl font-bold bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/30"
              />
            </div>
            {numericValue > 0 && (
              <p className="mt-1 text-right text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                {formatIDR(numericValue)}
              </p>
            )}

            {/* Quick Chips */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {[10000, 25000, 50000, 100000, 500000].map((add) => (
                <button
                  key={add}
                  type="button"
                  onClick={() => addAmount(add)}
                  className="px-2.5 py-1 text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg transition-colors cursor-pointer"
                >
                  +{formatIDR(add).replace('Rp ', '')}
                </button>
              ))}
            </div>
          </div>

          {/* Category Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Kategori
            </label>
            <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto pr-1">
              {availableCategories.map((cat) => {
                const isSelected = category === cat.key;
                return (
                  <button
                    key={cat.key}
                    type="button"
                    onClick={() => setCategory(cat.key)}
                    className={`p-2.5 rounded-xl border text-left text-xs font-medium flex items-center gap-2 transition-all cursor-pointer ${
                      isSelected
                        ? 'border-emerald-600 dark:border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 shadow-sm'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 hover:border-slate-300'
                    }`}
                  >
                    <span className="truncate">{cat.labelId}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Deskripsi
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Contoh: Kopi pagi, Makan siang geprek, Gaji kantor..."
              className="w-full px-3.5 py-2.5 text-xs bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          {/* Date Picker */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Tanggal Transaksi
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3.5 py-2 text-xs bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          {/* Receipt Details Card (if transaction originated from receipt scan) */}
          {editingTx?.receipt && (
            <div className="rounded-2xl border border-sky-200 dark:border-sky-900/60 bg-sky-50/50 dark:bg-sky-950/20 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-sky-900 dark:text-sky-300 flex items-center gap-1.5">
                  🧾 Rincian Struk Belanja
                </span>
                <span className="text-[10px] bg-sky-100 dark:bg-sky-900/60 text-sky-700 dark:text-sky-300 px-2 py-0.5 rounded-full font-semibold">
                  Tersimpan Otomatis
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-[10px] text-slate-400">Toko / Merchant:</span>
                  <p className="font-semibold text-slate-800 dark:text-slate-200">
                    {editingTx.receipt.merchantName}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400">Pembayaran:</span>
                  <p className="font-semibold text-slate-800 dark:text-slate-200 uppercase">
                    {editingTx.receipt.paymentMethod || 'Tunai'}
                  </p>
                </div>
              </div>

              {/* Items List */}
              {editingTx.receipt.items && editingTx.receipt.items.length > 0 && (
                <div className="border-t border-sky-200/60 dark:border-sky-800/60 pt-2.5">
                  <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                    Daftar Barang ({editingTx.receipt.items.length} item):
                  </span>
                  <div className="mt-1.5 space-y-1.5 max-h-36 overflow-y-auto pr-1">
                    {editingTx.receipt.items.map((it, idx) => (
                      <div key={idx} className="flex justify-between items-center text-xs">
                        <span className="text-slate-700 dark:text-slate-300">
                          {it.name} <span className="text-slate-400 text-[11px]">x{it.quantity}</span>
                        </span>
                        <span className="font-semibold text-slate-900 dark:text-white">
                          {formatIDR(it.totalPrice)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Subtotal, Tax, Total Breakdown */}
              <div className="border-t border-sky-200/60 dark:border-sky-800/60 pt-2 text-[11px] space-y-1 text-slate-600 dark:text-slate-400">
                <div className="flex justify-between">
                  <span>Subtotal:</span>
                  <span>{formatIDR(editingTx.receipt.subtotal)}</span>
                </div>
                {editingTx.receipt.discount > 0 && (
                  <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                    <span>Diskon:</span>
                    <span>-{formatIDR(editingTx.receipt.discount)}</span>
                  </div>
                )}
                {editingTx.receipt.tax > 0 && (
                  <div className="flex justify-between">
                    <span>Pajak (PPN):</span>
                    <span>+{formatIDR(editingTx.receipt.tax)}</span>
                  </div>
                )}
                {editingTx.receipt.serviceCharge > 0 && (
                  <div className="flex justify-between">
                    <span>Biaya Layanan:</span>
                    <span>+{formatIDR(editingTx.receipt.serviceCharge)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-xs text-slate-900 dark:text-white pt-1 border-t border-sky-200/40 dark:border-sky-800/40">
                  <span>Total Struk:</span>
                  <span>{formatIDR(editingTx.receipt.grandTotal)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Submit Actions */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={isSaving}
              className="w-full py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white font-bold text-xs shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              {isSaving
                ? 'Menyimpan...'
                : editingTx
                ? 'Simpan Perubahan'
                : 'Catat Transaksi'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
