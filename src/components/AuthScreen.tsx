import React from 'react';
import { Wallet, Send, FileSpreadsheet, Sparkles, ShieldCheck, AlertCircle, X, ExternalLink } from 'lucide-react';
import { FirebaseAuthErrorDetail } from '../lib/firebase';

interface AuthScreenProps {
  onLogin: () => void;
  isLoading: boolean;
  error?: FirebaseAuthErrorDetail | null;
  onClearError?: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  onLogin,
  isLoading,
  error,
  onClearError,
}) => {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-center items-center px-4 py-8">
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-8 shadow-xl text-center space-y-6">
        {/* App Logo */}
        <div className="mx-auto w-16 h-16 rounded-3xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20">
          <Wallet className="w-8 h-8" />
        </div>

        {/* Title & Tagline */}
        <div className="space-y-1.5">
          <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
            CatatKas
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Aplikasi Keuangan Pribadi Mobile-First & Telegram AI
          </p>
        </div>

        {/* Feature Highlights */}
        <div className="space-y-2.5 text-left pt-2">
          <div className="flex items-center gap-2.5 text-xs text-slate-700 dark:text-slate-300">
            <div className="w-6 h-6 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center shrink-0">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
            <span>Kategorisasi otomatis dengan AI Gemini</span>
          </div>
          <div className="flex items-center gap-2.5 text-xs text-slate-700 dark:text-slate-300">
            <div className="w-6 h-6 rounded-lg bg-sky-50 dark:bg-sky-950/60 text-sky-600 flex items-center justify-center shrink-0">
              <Send className="w-3.5 h-3.5" />
            </div>
            <span>Catat instan via chat Telegram bot</span>
          </div>
          <div className="flex items-center gap-2.5 text-xs text-slate-700 dark:text-slate-300">
            <div className="w-6 h-6 rounded-lg bg-teal-50 dark:bg-teal-950/60 text-teal-600 flex items-center justify-center shrink-0">
              <FileSpreadsheet className="w-3.5 h-3.5" />
            </div>
            <span>Ekspor laporan ke Google Sheets & Drive</span>
          </div>
        </div>

        {/* Firebase Auth Error Alert */}
        {error && (
          <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-left space-y-2 animate-in fade-in">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5 text-rose-800 dark:text-rose-300 font-bold text-xs">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>Gagal Masuk</span>
              </div>
              {onClearError && (
                <button
                  type="button"
                  onClick={onClearError}
                  className="p-1 rounded-lg text-rose-400 hover:text-rose-700 dark:hover:text-rose-200 hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Error Code Badge */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-md bg-rose-100 dark:bg-rose-900/70 text-rose-700 dark:text-rose-200 font-semibold">
                Kode: {error.code}
              </span>
            </div>

            {/* Friendly Indonesian Explanation */}
            <p className="text-xs text-rose-700 dark:text-rose-300 leading-relaxed">
              {error.userMessage}
            </p>

            {/* Specific Guidance for Known Firebase Setup Issues */}
            {error.code === 'auth/unauthorized-domain' && (
              <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 text-[11px] text-amber-900 dark:text-amber-200 space-y-1">
                <p className="font-semibold">Langkah Perbaikan di Firebase Console:</p>
                <ol className="list-decimal pl-4 space-y-0.5">
                  <li>Buka <b>Firebase Console</b> &gt; <b>Authentication</b></li>
                  <li>Pilih tab <b>Settings</b> &gt; <b>Authorized domains</b></li>
                  <li>Klik <b>Add domain</b> dan masukkan: <code className="font-mono font-bold bg-amber-100 dark:bg-amber-900/60 px-1 rounded">catatan-bundahara.vercel.app</code></li>
                </ol>
              </div>
            )}

            {error.code === 'auth/operation-not-allowed' && (
              <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 text-[11px] text-amber-900 dark:text-amber-200 space-y-1">
                <p className="font-semibold">Langkah Mengaktifkan Google Sign-in:</p>
                <ol className="list-decimal pl-4 space-y-0.5">
                  <li>Buka <b>Firebase Console</b> &gt; <b>Authentication</b></li>
                  <li>Pilih tab <b>Sign-in method</b></li>
                  <li>Klik <b>Google</b> dan aktifkan toggle <b>Enable</b> lalu simpan</li>
                </ol>
              </div>
            )}

            {error.code === 'auth/popup-blocked' && (
              <div className="p-2.5 rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-900/50 text-[11px] text-sky-900 dark:text-sky-200 space-y-1">
                <p className="font-semibold">Panduan Pop-up Browser:</p>
                <p>Klik ikon gembok/pengaturan di kolom URL browser Anda, lalu pilih <b>Izinkan Pop-up (Allow pop-ups)</b> untuk domain ini.</p>
              </div>
            )}
          </div>
        )}

        {/* Official Style Google Sign In Button */}
        <div className="pt-2">
          <button
            onClick={onLogin}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-800 dark:text-white font-semibold text-xs shadow-sm hover:shadow transition-all active:scale-98 cursor-pointer disabled:opacity-50"
          >
            <svg
              className="w-4 h-4 shrink-0"
              viewBox="0 0 48 48"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                fill="#EA4335"
                d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
              />
              <path
                fill="#4285F4"
                d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
              />
              <path
                fill="#FBBC05"
                d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
              />
              <path
                fill="#34A853"
                d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
              />
            </svg>
            <span>{isLoading ? 'Menghubungkan ke Google...' : 'Masuk dengan Google'}</span>
          </button>
        </div>

        <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
          <span>Data tersimpan aman di Firestore Anda</span>
        </div>
      </div>
    </div>
  );
};
