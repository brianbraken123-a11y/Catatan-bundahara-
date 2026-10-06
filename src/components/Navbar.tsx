import React from 'react';
import { User } from 'firebase/auth';
import { Wallet, Sun, Moon, LogOut, Send, ShieldCheck } from 'lucide-react';

interface NavbarProps {
  user: User | null;
  onLogin: () => void;
  onLogout: () => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onOpenIntegrations: () => void;
  telegramLinked: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  user,
  onLogin,
  onLogout,
  darkMode,
  onToggleDarkMode,
  onOpenIntegrations,
  telegramLinked,
}) => {
  return (
    <header className="sticky top-0 z-30 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 transition-colors">
      <div className="max-w-md mx-auto px-4 h-16 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center space-x-2.5">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-sm shadow-emerald-500/20">
            <Wallet className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-slate-900 dark:text-white leading-tight">
              CatatKas
            </h1>
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Keuangan Pribadi
            </p>
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center space-x-1.5">
          {/* Telegram Status Badge Button */}
          {user && (
            <button
              onClick={onOpenIntegrations}
              title={telegramLinked ? 'Telegram Terhubung' : 'Hubungkan Telegram'}
              className={`p-2 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-all ${
                telegramLinked
                  ? 'bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-800'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <Send className="w-4 h-4" />
              {telegramLinked ? (
                <span className="hidden sm:inline text-xs font-semibold">Tersambung</span>
              ) : (
                <span className="text-[11px]">Hubungkan</span>
              )}
            </button>
          )}

          {/* Dark Mode Toggle */}
          <button
            onClick={onToggleDarkMode}
            aria-label="Toggle tema gelap"
            className="p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* User Profile / Logout */}
          {user ? (
            <div className="flex items-center space-x-1 pl-1">
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName || 'User'}
                  className="w-8 h-8 rounded-full border border-slate-200 dark:border-slate-700 object-cover"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 flex items-center justify-center font-bold text-xs border border-emerald-300 dark:border-emerald-800">
                  {user.displayName ? user.displayName.charAt(0).toUpperCase() : 'U'}
                </div>
              )}
              <button
                onClick={onLogout}
                title="Keluar akun"
                className="p-2 rounded-xl text-slate-500 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={onLogin}
              className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
            >
              Masuk
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
