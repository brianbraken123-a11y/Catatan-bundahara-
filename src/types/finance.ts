/**
 * Finance and transaction type definitions for CatatKas
 */

export type TransactionType = 'income' | 'expense';

export type IncomeCategory =
  | 'salary'
  | 'business'
  | 'freelance'
  | 'other_income';

export type ExpenseCategory =
  | 'food'
  | 'transportation'
  | 'housing'
  | 'bills'
  | 'shopping'
  | 'entertainment'
  | 'health'
  | 'education'
  | 'digital'
  | 'other_expense';

export type Category = IncomeCategory | ExpenseCategory;

export type TransactionSource = 'web' | 'telegram' | 'telegram_receipt';

export interface ReceiptItem {
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface ReceiptData {
  merchantName: string;
  transactionDate: string; // YYYY-MM-DD
  transactionTime?: string;
  currency: 'IDR' | string;
  items: ReceiptItem[];
  subtotal: number;
  discount: number;
  tax: number;
  serviceCharge: number;
  otherCharges: number;
  grandTotal: number;
  paymentMethod?: string;
  confidence?: number;
  uncertainFields?: string[];
  isReadable?: boolean;
  suggestedCategory?: Category;
  captionContext?: string;
}

export interface EditHistoryEntry {
  type: TransactionType;
  amount: number;
  category: Category;
  description: string;
  date?: string;
  editedAt: string;
  editSource: string;
}

export interface Transaction {
  id: string;
  userId: string;
  type: TransactionType;
  amount: number;
  category: Category;
  description: string;
  date: string; // YYYY-MM-DD
  source: TransactionSource;
  createdAt: string;
  updatedAt: string;
  receipt?: ReceiptData;
  lastEditedFrom?: {
    type: TransactionType;
    amount: number;
    category: Category;
    description: string;
    date?: string;
  };
  editSource?: string;
  editHistory?: EditHistoryEntry[];
}

export interface CategoryMeta {
  key: Category;
  type: TransactionType;
  labelId: string; // Indonesian label
  icon: string;
  color: string;
  bgLight: string;
  bgDark: string;
}

export const CATEGORIES_META: Record<Category, CategoryMeta> = {
  // Income
  salary: {
    key: 'salary',
    type: 'income',
    labelId: 'Gaji Pokok',
    icon: 'Briefcase',
    color: 'text-emerald-500',
    bgLight: 'bg-emerald-50',
    bgDark: 'dark:bg-emerald-950/40',
  },
  business: {
    key: 'business',
    type: 'income',
    labelId: 'Bisnis / Usaha',
    icon: 'Store',
    color: 'text-teal-500',
    bgLight: 'bg-teal-50',
    bgDark: 'dark:bg-teal-950/40',
  },
  freelance: {
    key: 'freelance',
    type: 'income',
    labelId: 'Freelance & Proyek',
    icon: 'Laptop',
    color: 'text-cyan-500',
    bgLight: 'bg-cyan-50',
    bgDark: 'dark:bg-cyan-950/40',
  },
  other_income: {
    key: 'other_income',
    type: 'income',
    labelId: 'Pendapatan Lain',
    icon: 'Coins',
    color: 'text-blue-500',
    bgLight: 'bg-blue-50',
    bgDark: 'dark:bg-blue-950/40',
  },

  // Expenses
  food: {
    key: 'food',
    type: 'expense',
    labelId: 'Makanan & Minuman',
    icon: 'Utensils',
    color: 'text-rose-500',
    bgLight: 'bg-rose-50',
    bgDark: 'dark:bg-rose-950/40',
  },
  transportation: {
    key: 'transportation',
    type: 'expense',
    labelId: 'Transportasi & Bensin',
    icon: 'Car',
    color: 'text-amber-500',
    bgLight: 'bg-amber-50',
    bgDark: 'dark:bg-amber-950/40',
  },
  housing: {
    key: 'housing',
    type: 'expense',
    labelId: 'Kos / Kontrakan / Rumah',
    icon: 'Home',
    color: 'text-orange-500',
    bgLight: 'bg-orange-50',
    bgDark: 'dark:bg-orange-950/40',
  },
  bills: {
    key: 'bills',
    type: 'expense',
    labelId: 'Listrik, Air & Tagihan',
    icon: 'Receipt',
    color: 'text-yellow-600',
    bgLight: 'bg-yellow-50',
    bgDark: 'dark:bg-yellow-950/40',
  },
  shopping: {
    key: 'shopping',
    type: 'expense',
    labelId: 'Belanja & Kebutuhan',
    icon: 'ShoppingBag',
    color: 'text-purple-500',
    bgLight: 'bg-purple-50',
    bgDark: 'dark:bg-purple-950/40',
  },
  entertainment: {
    key: 'entertainment',
    type: 'expense',
    labelId: 'Hiburan & Hobi',
    icon: 'Gamepad2',
    color: 'text-indigo-500',
    bgLight: 'bg-indigo-50',
    bgDark: 'dark:bg-indigo-950/40',
  },
  health: {
    key: 'health',
    type: 'expense',
    labelId: 'Kesehatan & Obat',
    icon: 'HeartPulse',
    color: 'text-pink-500',
    bgLight: 'bg-pink-50',
    bgDark: 'dark:bg-pink-950/40',
  },
  education: {
    key: 'education',
    type: 'expense',
    labelId: 'Pendidikan & Kursus',
    icon: 'GraduationCap',
    color: 'text-sky-500',
    bgLight: 'bg-sky-50',
    bgDark: 'dark:bg-sky-950/40',
  },
  digital: {
    key: 'digital',
    type: 'expense',
    labelId: 'Pulsa, Data & Langganan',
    icon: 'Smartphone',
    color: 'text-violet-500',
    bgLight: 'bg-violet-50',
    bgDark: 'dark:bg-violet-950/40',
  },
  other_expense: {
    key: 'other_expense',
    type: 'expense',
    labelId: 'Pengeluaran Lainnya',
    icon: 'HelpCircle',
    color: 'text-slate-500',
    bgLight: 'bg-slate-100',
    bgDark: 'dark:bg-slate-800',
  },
};

export interface ParsedTransactionResult {
  type?: TransactionType;
  amount?: number;
  category?: Category;
  description?: string;
  date?: string; // YYYY-MM-DD
  confidence?: number;
  isAmbiguous: boolean;
  clarificationQuestion?: string;
}

export interface MonthlySummary {
  currentBalance: number;
  totalIncomeMonth: number;
  totalExpenseMonth: number;
  todayExpense: number;
  todayIncome: number;
  categoryBreakdown: {
    category: Category;
    amount: number;
    percentage: number;
    type: TransactionType;
  }[];
}
