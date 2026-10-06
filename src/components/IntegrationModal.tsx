import React, { useState } from 'react';
import {
  X,
  Send,
  FileSpreadsheet,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  Clock,
  Sparkles,
  HelpCircle,
  AlertTriangle,
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import { Transaction } from '../types/finance';
import { formatMonthYear, formatIDR } from '../lib/currency';
import { generateTelegramLinkCode } from '../lib/firebase';
import { exportTransactionsToGoogleSheets, ExportResult } from '../lib/workspace';

interface IntegrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  transactions: Transaction[];
  selectedMonth: string;
  telegramLinked: boolean;
}

export const IntegrationModal: React.FC<IntegrationModalProps> = ({
  isOpen,
  onClose,
  userId,
  transactions,
  selectedMonth,
  telegramLinked,
}) => {
  const [activeTab, setActiveTab] = useState<'telegram' | 'sheets'>('telegram');

  // Telegram Link Code State
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // Google Sheets Export State
  const [isExporting, setIsExporting] = useState(false);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [showConfirmExportDialog, setShowConfirmExportDialog] = useState(false);

  // Telegram in-app simulator state
  const [simText, setSimText] = useState('');
  const [simLog, setSimLog] = useState<{ sender: 'user' | 'bot'; text: string }[]>([
    {
      sender: 'bot',
      text: 'Halo! Anda dapat mencoba mengirim perintah Telegram di sini seperti: /balance, /today, /summary, atau pesan natural "kopi 18 ribu"',
    },
  ]);
  const [isSimLoading, setIsSimLoading] = useState(false);

  if (!isOpen) return null;

  // Handle generating pairing code
  const handleGenerateCode = async () => {
    setIsGeneratingCode(true);
    try {
      const code = await generateTelegramLinkCode(userId);
      setLinkCode(code);
    } catch (err: any) {
      alert(`Gagal membuat kode: ${err.message}`);
    } finally {
      setIsGeneratingCode(false);
    }
  };

  const handleCopyCode = () => {
    if (!linkCode) return;
    navigator.clipboard.writeText(`/start ${linkCode}`);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  // Monthly transactions for export
  const monthTransactions = transactions.filter((t) =>
    t.date.startsWith(selectedMonth)
  );

  // Trigger Google Sheets Export (after explicit confirmation per Workspace skill)
  const handleConfirmAndExport = async () => {
    setShowConfirmExportDialog(false);
    setIsExporting(true);
    setExportError(null);
    setExportResult(null);

    try {
      const result = await exportTransactionsToGoogleSheets(
        monthTransactions,
        selectedMonth
      );
      setExportResult(result);
    } catch (err: any) {
      setExportError(err.message || 'Gagal mengekspor ke Google Sheets.');
    } finally {
      setIsExporting(false);
    }
  };

  // Telegram Simulator logic
  const handleSimSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!simText.trim()) return;

    const userMessage = simText.trim();
    setSimLog((prev) => [...prev, { sender: 'user', text: userMessage }]);
    setSimText('');
    setIsSimLoading(true);

    try {
      // Simulate Telegram command directly
      if (userMessage === '/balance') {
        let inc = 0;
        let exp = 0;
        transactions.forEach((t) => {
          if (t.type === 'income') inc += t.amount;
          else exp += t.amount;
        });
        setSimLog((prev) => [
          ...prev,
          {
            sender: 'bot',
            text: `💳 Saldo Kas Saat Ini:\n${formatIDR(inc - exp)}\n• Pemasukan: ${formatIDR(inc)}\n• Pengeluaran: ${formatIDR(exp)}\n• Total: ${transactions.length} transaksi`,
          },
        ]);
      } else if (userMessage === '/today') {
        const todayStr = new Date().toISOString().split('T')[0];
        const todays = transactions.filter((t) => t.date === todayStr);
        let inc = 0;
        let exp = 0;
        todays.forEach((t) => (t.type === 'income' ? (inc += t.amount) : (exp += t.amount)));
        setSimLog((prev) => [
          ...prev,
          {
            sender: 'bot',
            text: `📅 Ringkasan Hari Ini (${todayStr}):\n• Pemasukan: ${formatIDR(inc)}\n• Pengeluaran: ${formatIDR(exp)}\n• Selisih: ${formatIDR(inc - exp)}\n(${todays.length} transaksi)`,
          },
        ]);
      } else if (userMessage === '/summary' || userMessage === '/month') {
        let inc = 0;
        let exp = 0;
        monthTransactions.forEach((t) =>
          t.type === 'income' ? (inc += t.amount) : (exp += t.amount)
        );
        setSimLog((prev) => [
          ...prev,
          {
            sender: 'bot',
            text: `📊 Ringkasan Bulan Ini (${selectedMonth}):\n• Total Pemasukan: ${formatIDR(inc)}\n• Total Pengeluaran: ${formatIDR(exp)}\n• Tabungan Bersih: ${formatIDR(inc - exp)}`,
          },
        ]);
      } else if (userMessage === '/help') {
        setSimLog((prev) => [
          ...prev,
          {
            sender: 'bot',
            text: '📖 Format Input:\n• kopi 18 ribu\n• makan 25k\n• bensin 50rb\n• bayar kos 1.2 juta\n• gaji 7.5 juta\n\nPerintah:\n• /balance - Cek saldo\n• /today - Ringkasan hari ini\n• /summary - Ringkasan bulan ini',
          },
        ]);
      } else {
        // Natural language parsing with Gemini via server
        const res = await fetch('/api/gemini/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: userMessage }),
        });
        const parsed = await res.json();
        if (parsed.isAmbiguous) {
          setSimLog((prev) => [
            ...prev,
            {
              sender: 'bot',
              text: `❓ ${parsed.clarificationQuestion || 'Ini mau dicatat sebagai kategori apa? Makanan, belanja, atau lainnya?'}`,
            },
          ]);
        } else {
          setSimLog((prev) => [
            ...prev,
            {
              sender: 'bot',
              text: `✅ [Simulasi Berhasil Dicatat]\n${parsed.type === 'income' ? '🟢 Pemasukan' : '🔴 Pengeluaran'}\n💰 Jumlah: ${formatIDR(parsed.amount)}\n🏷️ Kategori: ${parsed.category}\n📝 Deskripsi: ${parsed.description}`,
            },
          ]);
        }
      }
    } catch (err: any) {
      setSimLog((prev) => [
        ...prev,
        { sender: 'bot', text: `⚠️ Kendala: ${err.message}` },
      ]);
    } finally {
      setIsSimLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Integrasi & Ekspor
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 px-6 pt-2">
          <button
            onClick={() => setActiveTab('telegram')}
            className={`flex items-center gap-2 pb-3 px-2 text-xs font-bold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'telegram'
                ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
            }`}
          >
            <Send className="w-4 h-4" />
            Telegram Bot
          </button>
          <button
            onClick={() => setActiveTab('sheets')}
            className={`flex items-center gap-2 pb-3 px-2 text-xs font-bold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'sheets'
                ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            Google Sheets & Drive
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-4">
          {activeTab === 'telegram' ? (
            <div className="space-y-4">
              {/* Pairing Status Banner */}
              <div
                className={`p-4 rounded-2xl border flex items-start gap-3 ${
                  telegramLinked
                    ? 'bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-800 text-sky-900 dark:text-sky-200'
                    : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200'
                }`}
              >
                <Send className="w-5 h-5 shrink-0 mt-0.5 text-sky-500" />
                <div className="text-xs flex-1">
                  <div className="flex items-center justify-between">
                    <p className="font-bold">
                      {telegramLinked
                        ? 'Telegram Sudah Terhubung'
                        : 'Hubungkan Akun Telegram Anda'}
                    </p>
                    <a
                      href="https://t.me/Bundahara23_bot"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] font-bold text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-0.5"
                    >
                      @Bundahara23_bot <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <p className="text-[11px] opacity-90 mt-0.5">
                    {telegramLinked
                      ? 'Anda dapat mencatat transaksi langsung dari chat Telegram atau cek ringkasan saldo kapan pun.'
                      : 'Buat kode tautan di bawah dan kirim ke bot Telegram @Bundahara23_bot untuk menghubungkan akun.'}
                  </p>
                </div>
              </div>

              {/* Pairing Code Generator */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900 dark:text-white">
                    Kode Tautan 6-Digit
                  </span>
                  <button
                    onClick={handleGenerateCode}
                    disabled={isGeneratingCode}
                    className="text-xs font-semibold text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingCode ? 'animate-spin' : ''}`} />
                    {linkCode ? 'Buat Baru' : 'Dapatkan Kode'}
                  </button>
                </div>

                {linkCode ? (
                  <div className="space-y-2">
                    <div className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-between">
                      <div>
                        <span className="text-xl font-mono font-extrabold tracking-widest text-slate-900 dark:text-white">
                          {linkCode}
                        </span>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          Berlaku selama 15 menit
                        </p>
                      </div>
                      <button
                        onClick={handleCopyCode}
                        className="px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-600 text-white font-bold text-xs flex items-center gap-1 transition-all cursor-pointer"
                      >
                        {copiedCode ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedCode ? 'Tersalin' : 'Salin'}
                      </button>
                    </div>

                    <a
                      href={`https://t.me/Bundahara23_bot?start=${linkCode}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full py-2.5 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-sky-500/25 transition-all"
                    >
                      <Send className="w-4 h-4" />
                      <span>Buka @Bundahara23_bot di Telegram</span>
                      <ExternalLink className="w-3.5 h-3.5 ml-0.5" />
                    </a>
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Klik tombol <b>Dapatkan Kode</b> untuk menghasilkan kode tautan sementara.
                  </p>
                )}

                {/* Steps instructions */}
                <div className="text-[11px] text-slate-600 dark:text-slate-400 space-y-1.5 pt-1">
                  <p className="font-semibold text-slate-800 dark:text-slate-200">
                    Langkah menghubungkan:
                  </p>
                  <ol className="list-decimal pl-4 space-y-1">
                    <li>Dapatkan kode 6-digit di atas</li>
                    <li>
                      Klik tombol <b>Buka @Bundahara23_bot di Telegram</b> atau cari bot di Telegram
                    </li>
                    <li>
                      Kirim perintah:{' '}
                      <code className="bg-slate-200 dark:bg-slate-700 px-1 py-0.5 rounded text-[10px]">
                        /start {linkCode || 'KODE_6_DIGIT'}
                      </code>
                    </li>
                  </ol>
                </div>
              </div>

              {/* In-App Telegram Simulator */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2.5">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-white">
                  <Sparkles className="w-3.5 h-3.5 text-sky-500" />
                  <span>Simulator Chat Telegram</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Uji coba respons bot dan pemrosesan AI langsung dari sini:
                </p>

                {/* Chat window */}
                <div className="h-44 overflow-y-auto bg-slate-50 dark:bg-slate-800/80 rounded-xl p-3 space-y-2 border border-slate-200 dark:border-slate-700/60 text-xs">
                  {simLog.map((log, idx) => (
                    <div
                      key={idx}
                      className={`flex ${log.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl px-3 py-2 text-[11px] whitespace-pre-wrap ${
                          log.sender === 'user'
                            ? 'bg-sky-500 text-white rounded-br-none'
                            : 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-bl-none shadow-sm'
                        }`}
                      >
                        {log.text}
                      </div>
                    </div>
                  ))}
                  {isSimLoading && (
                    <div className="flex justify-start">
                      <div className="bg-white dark:bg-slate-900 text-slate-400 border border-slate-200 dark:border-slate-700 rounded-2xl rounded-bl-none px-3 py-1.5 text-[11px]">
                        Sedang mengetik...
                      </div>
                    </div>
                  )}
                </div>

                {/* Input simulator */}
                <form onSubmit={handleSimSend} className="flex gap-2">
                  <input
                    type="text"
                    value={simText}
                    onChange={(e) => setSimText(e.target.value)}
                    placeholder="Ketik: /balance, /today, atau 'kopi 18k'..."
                    className="flex-1 text-xs px-3 py-2 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-sky-500"
                  />
                  <button
                    type="submit"
                    disabled={isSimLoading || !simText.trim()}
                    className="px-3 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white text-xs font-bold transition-all cursor-pointer"
                  >
                    Kirim
                  </button>
                </form>

                {/* Quick Chips for Simulator */}
                <div className="flex flex-wrap gap-1 pt-1">
                  {['/balance', '/today', '/summary', 'kopi 18 ribu', 'makan siang 25k', 'gaji 7.5 juta'].map((sample) => (
                    <button
                      key={sample}
                      type="button"
                      onClick={() => setSimText(sample)}
                      className="px-2 py-0.5 text-[10px] bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg cursor-pointer"
                    >
                      {sample}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* Google Sheets & Drive Tab */
            <div className="space-y-4">
              <div className="p-4 rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200 text-xs">
                <div className="flex items-center gap-2 font-bold mb-1">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                  <span>Ekspor ke Google Sheets & Google Drive</span>
                </div>
                <p className="text-[11px] leading-relaxed opacity-90">
                  Fitur ini akan membuat spreadsheet Google baru berisi seluruh rincian transaksi bulan <b>{formatMonthYear(selectedMonth)}</b> dengan format tabel terstruktur dan rumus total otomatis.
                </p>
              </div>

              {/* Month Export Summary Card */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
                <span className="text-xs font-bold text-slate-900 dark:text-white">
                  Ringkasan Data yang Akan Diekspor:
                </span>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700">
                    <span className="text-[10px] text-slate-400">Periode</span>
                    <p className="font-bold text-slate-800 dark:text-slate-200 mt-0.5">
                      {formatMonthYear(selectedMonth)}
                    </p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700">
                    <span className="text-[10px] text-slate-400">Total Transaksi</span>
                    <p className="font-bold text-slate-800 dark:text-slate-200 mt-0.5">
                      {monthTransactions.length} transaksi
                    </p>
                  </div>
                </div>

                {exportError && (
                  <div className="p-3 text-xs rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300">
                    {exportError}
                  </div>
                )}

                {exportResult && (
                  <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs space-y-2">
                    <div className="flex items-center gap-1.5 font-bold text-emerald-800 dark:text-emerald-300">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span>Berhasil Diekspor ke Google Sheets!</span>
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400">
                      Spreadsheet telah dibuat dan tersimpan di Google Drive Anda.
                    </p>
                    <a
                      href={exportResult.spreadsheetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-colors"
                    >
                      Buka di Google Sheets <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setShowConfirmExportDialog(true)}
                  disabled={isExporting || monthTransactions.length === 0}
                  className="w-full py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-98 disabled:opacity-50 text-white font-bold text-xs shadow-lg shadow-emerald-600/25 flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  {isExporting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Membuat Spreadsheet di Google Drive...</span>
                    </>
                  ) : (
                    <>
                      <FileSpreadsheet className="w-4 h-4" />
                      <span>Ekspor {monthTransactions.length} Transaksi ke Sheets</span>
                    </>
                  )}
                </button>
              </div>

              {/* Confirmation Dialog Modal as mandated by Workspace Integration Skill */}
              {showConfirmExportDialog && (
                <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-in fade-in">
                  <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-2xl">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center">
                        <FileSpreadsheet className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                          Konfirmasi Ekspor Data
                        </h4>
                        <p className="text-[11px] text-slate-500">
                          Google Drive & Google Sheets
                        </p>
                      </div>
                    </div>

                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                      Apakah Anda yakin ingin membuat spreadsheet baru dengan nama{' '}
                      <b>"CatatKas - Laporan Keuangan {formatMonthYear(selectedMonth)}"</b> di Google Drive Anda?
                    </p>

                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      File ini akan memuat {monthTransactions.length} baris transaksi bulan ini beserta rumus kalkulasi saldo kas.
                    </p>

                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setShowConfirmExportDialog(false)}
                        className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      >
                        Batal
                      </button>
                      <button
                        type="button"
                        onClick={handleConfirmAndExport}
                        className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-600/30 transition-colors"
                      >
                        Ya, Ekspor Sekarang
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
