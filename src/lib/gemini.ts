import { GoogleGenAI, Type } from '@google/genai';
import { ParsedTransactionResult, Category, TransactionType } from '../types/finance';
import { parseIDRAmountText, getTodayDateString } from './currency';

export const VALID_INCOME_CATEGORIES: Category[] = [
  'salary',
  'business',
  'freelance',
  'other_income',
];

export const VALID_EXPENSE_CATEGORIES: Category[] = [
  'food',
  'transportation',
  'housing',
  'bills',
  'shopping',
  'entertainment',
  'health',
  'education',
  'digital',
  'other_expense',
];

export const ALL_CATEGORIES = [...VALID_INCOME_CATEGORIES, ...VALID_EXPENSE_CATEGORIES];

/**
 * Explicit Income phrases (Must ALWAYS be classified as income)
 */
export const EXPLICIT_INCOME_PHRASES: string[] = [
  'dana masuk',
  'uang masuk',
  'duit masuk',
  'pemasukan masuk',
  'pemasukan',
  'menerima uang',
  'terima uang',
  'dapat uang',
  'uang diterima',
  'transfer masuk',
  'transferan masuk',
  'saldo masuk',
  'gaji',
  'gajian',
  'bonus',
  'komisi',
  'pendapatan',
  'hasil jualan',
  'hasil penjualan',
  'refund',
  'pengembalian dana',
  'dibayar',
  'pembayaran diterima',
];

/**
 * Explicit Expense phrases (Must ALWAYS be classified as expense)
 */
export const EXPLICIT_EXPENSE_PHRASES: string[] = [
  'uang keluar',
  'duit keluar',
  'dana keluar',
  'pengeluaran',
  'beli',
  'bayar',
  'pembayaran',
  'keluar',
  'makan',
  'minum',
  'kopi',
  'bensin',
  'pulsa',
  'kuota',
  'listrik',
  'sewa',
  'kos',
  'kost',
  'belanja',
  'transport',
  'ongkos',
  'jajan',
  'geprek',
  'ayam',
  'nasi',
  'snack',
];

/**
 * Check if text contains explicit income phrase
 */
export function detectExplicitIncomePhrase(text: string): string | null {
  const lower = text.toLowerCase().trim();
  for (const phrase of EXPLICIT_INCOME_PHRASES) {
    // Match phrase as whole word or boundary
    const regex = new RegExp(`(?:^|\\b|\\s)${phrase.replace(/\s+/g, '\\s+')}(?:$|\\b|\\s)`, 'i');
    if (regex.test(lower)) {
      return phrase;
    }
  }
  return null;
}

/**
 * Check if text contains explicit expense phrase
 */
export function detectExplicitExpensePhrase(text: string): string | null {
  const lower = text.toLowerCase().trim();
  for (const phrase of EXPLICIT_EXPENSE_PHRASES) {
    const regex = new RegExp(`(?:^|\\b|\\s)${phrase.replace(/\s+/g, '\\s+')}(?:$|\\b|\\s)`, 'i');
    if (regex.test(lower)) {
      return phrase;
    }
  }
  return null;
}

/**
 * Check for ambiguous neutral phrases (e.g., "transfer 2 juta")
 */
export function detectAmbiguousTransfer(text: string): boolean {
  const lower = text.toLowerCase().trim();
  // If it specifies "transfer masuk" or "transfer keluar", it's NOT ambiguous
  if (lower.includes('masuk') || lower.includes('keluar')) {
    return false;
  }
  // If just "transfer 2jt" or "tf 500k" without masuk/keluar or clear recipient/sender
  if (/\b(?:transfer|tf|trf)\b/i.test(lower) && !/\b(?:dari|ke|buat|untuk)\b/i.test(lower)) {
    return true;
  }
  return false;
}

/**
 * Rate Limit error and circuit breaker tracking
 */
export class RateLimitError extends Error {
  constructor(
    message: string = '⚠️ AI sedang mencapai batas penggunaan. Coba lagi setelah kuota tersedia.'
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export function isRateLimitError(err: any): boolean {
  if (!err) return false;
  if (err instanceof RateLimitError || err.name === 'RateLimitError') return true;
  const status = err.status || err.statusCode || err.response?.status;
  if (status === 429) return true;
  const msg = (err.message || err.toString() || '').toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests')
  );
}

let rateLimitCooldownUntil = 0;

export function checkRateLimitCooldown(): void {
  const now = Date.now();
  if (now < rateLimitCooldownUntil) {
    const remainingSec = Math.ceil((rateLimitCooldownUntil - now) / 1000);
    console.warn(`[Gemini Rate Limit] Cooldown active for ${remainingSec}s. Skipping Gemini request.`);
    throw new RateLimitError();
  }
}

export function setRateLimitCooldown(durationMs = 60000): void {
  rateLimitCooldownUntil = Date.now() + durationMs;
  console.warn(`[Gemini Rate Limit] Cooldown set for ${durationMs / 1000}s until ${new Date(rateLimitCooldownUntil).toISOString()}`);
}

/**
 * Determine whether natural language interpretation is actually required
 * vs whether the transaction can be resolved deterministically with 100% confidence.
 */
export function isNaturalLanguageInterpretationRequired(text: string): boolean {
  const lower = text.toLowerCase().trim();

  // 1. Ambiguous transfer is handled deterministically by asking clarification
  if (detectAmbiguousTransfer(lower)) {
    return false;
  }

  // 2. Missing numeric amount is handled deterministically
  const amount = parseIDRAmountText(lower);
  if (!amount || amount <= 0) {
    return false;
  }

  // 3. Short explicit phrases with obvious category and amount don't need Gemini
  const incomePhrase = detectExplicitIncomePhrase(lower);
  if (incomePhrase) {
    const words = lower.split(/\s+/);
    if (words.length <= 6) {
      return false;
    }
  }

  const expensePhrase = detectExplicitExpensePhrase(lower);
  if (expensePhrase) {
    const words = lower.split(/\s+/);
    if (words.length <= 6) {
      return false;
    }
  }

  // Long, colloquial, or context-heavy sentences require natural language interpretation
  return true;
}

/**
 * Initialize Gemini SDK using server-side GEMINI_API_KEY
 */
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({ apiKey });
}

/**
 * Parse Indonesian text into structured transaction data
 * Optimized to minimize Gemini API calls:
 * - Deterministic logic is preferred for standard patterns (0 API calls)
 * - Gemini is called ONLY when natural-language interpretation is actually required (1 API call)
 * - 429 RESOURCE_EXHAUSTED triggers a circuit breaker cooldown and friendly message without repeated retries
 */
export async function parseTransactionWithGemini(
  text: string,
  referenceDate?: string,
  options?: { forceAi?: boolean }
): Promise<ParsedTransactionResult> {
  const todayStr = referenceDate || getTodayDateString();
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  // PRIORITY 1: Check for Ambiguous Transfer phrasing first (Deterministic, 0 Gemini calls)
  if (detectAmbiguousTransfer(lower)) {
    const amount = parseIDRAmountText(lower);
    return {
      type: undefined,
      amount: amount || undefined,
      category: undefined,
      description: trimmed,
      date: todayStr,
      confidence: 0.5,
      isAmbiguous: true,
      clarificationQuestion: 'Ini uang masuk atau uang keluar?',
    };
  }

  // Pre-detect explicit Income / Expense phrases
  const explicitIncomeMatch = detectExplicitIncomePhrase(lower);
  const explicitExpenseMatch = detectExplicitExpensePhrase(lower);

  // OPTIMIZATION: If natural language interpretation is NOT required and forceAi is false,
  // resolve deterministically with zero Gemini API calls!
  if (!options?.forceAi && !isNaturalLanguageInterpretationRequired(trimmed)) {
    return parseWithRuleFallback(
      trimmed,
      todayStr,
      explicitIncomeMatch,
      explicitExpenseMatch
    );
  }

  // Check rate limit cooldown before calling Gemini
  checkRateLimitCooldown();

  const gemini = getGeminiClient();

  if (gemini) {
    try {
      const prompt = `
Anda adalah sistem parser transaksi keuangan pribadi bahasa Indonesia (CatatKas).
Tugas Anda adalah mengekstrak data terstruktur dari input pengguna:
"${trimmed}"

Tanggal hari ini: ${todayStr}

ATURAN KLASIFIKASI KETAT (BERDASARKAN PRIORITAS):
1. PRIORITAS 1 - KATA KUNCI PEMASUKAN:
   Jika pesan memuat frasa berikut, jenis transaksi WAJIB "income":
   - "dana masuk", "uang masuk", "duit masuk", "pemasukan", "transfer masuk", "transferan masuk", "saldo masuk", "gaji", "gajian", "bonus", "komisi", "pendapatan", "hasil jualan", "hasil penjualan", "refund", "pengembalian dana", "dapat uang", "dibayar", "pembayaran diterima", "terima uang", "menerima uang".
   CONTOH:
   - "Dana masuk 4.995.000" => type: "income", amount: 4995000, category: "other_income", description: "Dana masuk"
   - "uang masuk 500 ribu" => type: "income", amount: 500000, category: "other_income", description: "Uang masuk"
   - "transfer masuk 2 juta" => type: "income", amount: 2000000, category: "other_income", description: "Transfer masuk"
   - "gaji 7.5 juta" => type: "income", amount: 7500000, category: "salary", description: "Gaji"

2. PRIORITAS 2 - KATA KUNCI PENGELUARAN:
   Jika pesan memuat frasa pengeluaran eksplisit, jenis transaksi WAJIB "expense":
   - "beli", "bayar", "uang keluar", "pengeluaran", "keluar", "makan", "minum", "kopi", "bensin", "pulsa", "kuota", "listrik", "sewa", "kos", "belanja", "ongkos", "transport".
   CONTOH:
   - "kopi 18 ribu" => type: "expense", amount: 18000, category: "food", description: "kopi"
   - "bayar kos 1.2 juta" => type: "expense", amount: 1200000, category: "housing", description: "bayar kos"
   - "bensin 50rb" => type: "expense", amount: 50000, category: "transportation", description: "bensin"
   - "uang keluar 300 ribu" => type: "expense", amount: 300000, category: "other_expense", description: "Uang keluar"

3. AMBIGUITAS:
   - "transfer 2 juta" (tanpa keterangan masuk/keluar) => isAmbiguous: true, clarificationQuestion: "Ini uang masuk atau uang keluar?"
   - "tadi beli sesuatu 50 ribu" => isAmbiguous: true, clarificationQuestion: "Ini mau dicatat sebagai kategori apa? Makanan, belanja, transportasi, atau lainnya?"
   - Pesan tanpa nominal (contoh: "beli kopi") => isAmbiguous: true, clarificationQuestion: "Berapa nominal atau harga kopi tersebut?"

Kategori yang Valid:
- Pemasukan: salary, business, freelance, other_income
- Pengeluaran: food, transportation, housing, bills, shopping, entertainment, health, education, digital, other_expense

Output HARUS JSON sesuai format berikut:
`;

      const response = await gemini.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              type: {
                type: Type.STRING,
                description: 'Jenis transaksi: income atau expense',
              },
              amount: {
                type: Type.NUMBER,
                description: 'Jumlah transaksi dalam angka Rupiah bulat',
              },
              category: {
                type: Type.STRING,
                description: 'Kategori transaksi yang valid',
              },
              description: {
                type: Type.STRING,
                description: 'Deskripsi transaksi',
              },
              date: {
                type: Type.STRING,
                description: 'Tanggal transaksi YYYY-MM-DD',
              },
              confidence: {
                type: Type.NUMBER,
                description: 'Nilai keyakinan 0.0 - 1.0',
              },
              isAmbiguous: {
                type: Type.BOOLEAN,
                description: 'True jika ambigu atau belum lengkap',
              },
              clarificationQuestion: {
                type: Type.STRING,
                description: 'Pertanyaan klarifikasi jika isAmbiguous true',
              },
            },
            required: ['type', 'isAmbiguous'],
          },
          temperature: 0.0,
        },
      });

      const responseText = response.text?.trim() || '{}';
      const parsed = JSON.parse(responseText);

      // Validate & enforce Priority 1 explicit phrase overrides
      return validateAndSanitizeGeminiOutput(
        parsed,
        trimmed,
        todayStr,
        explicitIncomeMatch,
        explicitExpenseMatch
      );
    } catch (err: any) {
      if (isRateLimitError(err)) {
        setRateLimitCooldown(60000);
        console.warn('[Gemini 429 RESOURCE_EXHAUSTED] Rate limit reached. Backing off without repeated retries.');
        throw new RateLimitError();
      }
      console.error('Gemini parsing error, falling back to deterministic rules:', err);
    }
  }

  // Fallback to Deterministic Rules
  return parseWithRuleFallback(
    trimmed,
    todayStr,
    explicitIncomeMatch,
    explicitExpenseMatch
  );
}

/**
 * Strict server-side validator for Gemini parsed JSON
 */
function validateAndSanitizeGeminiOutput(
  raw: any,
  rawText: string,
  todayStr: string,
  explicitIncomePhrase: string | null,
  explicitExpensePhrase: string | null
): ParsedTransactionResult {
  if (raw.isAmbiguous) {
    return {
      isAmbiguous: true,
      clarificationQuestion:
        raw.clarificationQuestion ||
        'Ini mau dicatat sebagai kategori apa? Makanan, belanja, transportasi, atau lainnya?',
      amount: typeof raw.amount === 'number' ? raw.amount : undefined,
    };
  }

  // PRIORITY 1 ENFORCEMENT: Explicit Income phrases ALWAYS override
  let type: TransactionType;
  if (explicitIncomePhrase) {
    type = 'income';
  } else if (explicitExpensePhrase) {
    type = 'expense';
  } else {
    type = raw.type === 'income' ? 'income' : 'expense';
  }

  const amount =
    typeof raw.amount === 'number' && raw.amount > 0
      ? Math.round(raw.amount)
      : parseIDRAmountText(rawText);

  if (!amount || amount <= 0) {
    return {
      isAmbiguous: true,
      clarificationQuestion:
        'Berapa nominal transaksi yang ingin dicatat? (Contoh: kopi 18k)',
    };
  }

  let category: Category = (raw.category || '').toLowerCase().trim();

  // Ensure category aligns with type
  if (type === 'income') {
    if (!VALID_INCOME_CATEGORIES.includes(category)) {
      if (rawText.toLowerCase().includes('gaji') || rawText.toLowerCase().includes('gajian')) {
        category = 'salary';
      } else if (rawText.toLowerCase().includes('jual') || rawText.toLowerCase().includes('toko')) {
        category = 'business';
      } else if (rawText.toLowerCase().includes('freelance') || rawText.toLowerCase().includes('proyek')) {
        category = 'freelance';
      } else {
        category = 'other_income';
      }
    }
  } else {
    if (!VALID_EXPENSE_CATEGORIES.includes(category)) {
      category = 'other_expense';
    }
  }

  const description = (raw.description || rawText).toString().trim().slice(0, 200);

  let date = todayStr;
  if (raw.date && /^\d{4}-\d{2}-\d{2}$/.test(raw.date)) {
    date = raw.date;
  }

  return {
    type,
    amount,
    category,
    description: description || (type === 'income' ? 'Pemasukan' : 'Pengeluaran'),
    date,
    confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.98,
    isAmbiguous: false,
  };
}

/**
 * Deterministic rule-based parser adhering strictly to the user's priority rules
 */
export function parseWithRuleFallback(
  text: string,
  todayStr: string,
  preIncomeMatch?: string | null,
  preExpenseMatch?: string | null
): ParsedTransactionResult {
  const lower = text.toLowerCase().trim();

  // Extract numeric amount
  const amount = parseIDRAmountText(lower);
  if (!amount || amount <= 0) {
    return {
      isAmbiguous: true,
      clarificationQuestion:
        'Berapa jumlah nominalnya? (Contoh: kopi 18 ribu, makan 25k, bensin 50rb)',
    };
  }

  // Check for ambiguous neutral phrases (e.g., "transfer 2 juta")
  if (detectAmbiguousTransfer(lower)) {
    return {
      isAmbiguous: true,
      amount,
      clarificationQuestion: 'Ini uang masuk atau uang keluar?',
    };
  }

  // Generic ambiguity check
  if (
    (lower.includes('sesuatu') ||
      lower.includes('beli barang') ||
      (lower.includes('pengeluaran') && !lower.includes('makan') && !lower.includes('bensin'))) &&
    !lower.includes('masuk')
  ) {
    return {
      isAmbiguous: true,
      amount,
      clarificationQuestion:
        'Ini mau dicatat sebagai kategori apa? Makanan, belanja, transportasi, atau lainnya?',
    };
  }

  const explicitIncomeMatch = preIncomeMatch !== undefined ? preIncomeMatch : detectExplicitIncomePhrase(lower);
  const explicitExpenseMatch = preExpenseMatch !== undefined ? preExpenseMatch : detectExplicitExpensePhrase(lower);

  // CLASSIFICATION PRIORITY 1: Explicit income vs expense phrases
  let type: TransactionType;
  let category: Category;

  if (explicitIncomeMatch) {
    type = 'income';
    if (lower.includes('gaji') || lower.includes('gajian') || lower.includes('payroll')) {
      category = 'salary';
    } else if (lower.includes('jual') || lower.includes('omset') || lower.includes('omzet') || lower.includes('toko') || lower.includes('bisnis')) {
      category = 'business';
    } else if (lower.includes('freelance') || lower.includes('proyek') || lower.includes('desain') || lower.includes('komisi')) {
      category = 'freelance';
    } else {
      category = 'other_income';
    }
  } else if (explicitExpenseMatch) {
    type = 'expense';
    if (
      lower.includes('kopi') ||
      lower.includes('makan') ||
      lower.includes('ayam') ||
      lower.includes('geprek') ||
      lower.includes('nasi') ||
      lower.includes('sarapan') ||
      lower.includes('bakso') ||
      lower.includes('mie') ||
      lower.includes('minum') ||
      lower.includes('snack') ||
      lower.includes('jajan')
    ) {
      category = 'food';
    } else if (
      lower.includes('bensin') ||
      lower.includes('pertalite') ||
      lower.includes('pertamax') ||
      lower.includes('gojek') ||
      lower.includes('grab') ||
      lower.includes('ojol') ||
      lower.includes('parkir') ||
      lower.includes('tol') ||
      lower.includes('angkot') ||
      lower.includes('transport') ||
      lower.includes('ongkos')
    ) {
      category = 'transportation';
    } else if (
      lower.includes('kos') ||
      lower.includes('kost') ||
      lower.includes('kontrakan') ||
      lower.includes('sewa')
    ) {
      category = 'housing';
    } else if (
      lower.includes('listrik') ||
      lower.includes('pln') ||
      lower.includes('token') ||
      lower.includes('pdam') ||
      lower.includes('air') ||
      lower.includes('wifi') ||
      lower.includes('indihome')
    ) {
      category = 'bills';
    } else if (
      lower.includes('beli baju') ||
      lower.includes('shopee') ||
      lower.includes('tokopedia') ||
      lower.includes('sepatu') ||
      lower.includes('belanja')
    ) {
      category = 'shopping';
    } else if (
      lower.includes('pulsa') ||
      lower.includes('kuota') ||
      lower.includes('paket data') ||
      lower.includes('netflix') ||
      lower.includes('spotify')
    ) {
      category = 'digital';
    } else if (
      lower.includes('obat') ||
      lower.includes('dokter') ||
      lower.includes('apotek') ||
      lower.includes('klinik')
    ) {
      category = 'health';
    } else if (
      lower.includes('bioskop') ||
      lower.includes('game') ||
      lower.includes('steam') ||
      lower.includes('nonton')
    ) {
      category = 'entertainment';
    } else {
      category = 'other_expense';
    }
  } else {
    // Default fallback if no explicit phrase
    type = 'expense';
    category = 'other_expense';
  }

  // Clean description by stripping out the number part
  let description = text
    .replace(/(?:rp\.?|idr)?\s*[\d.,]+\s*(?:ribu|rb|k|juta|jt)?/gi, '')
    .trim();
  if (!description) {
    description = text.trim();
  }

  return {
    type,
    amount,
    category,
    description: description.slice(0, 100),
    date: todayStr,
    confidence: 0.95,
    isAmbiguous: false,
  };
}
