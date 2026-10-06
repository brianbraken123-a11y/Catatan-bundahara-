import { GoogleGenAI, Type } from '@google/genai';
import { ReceiptData, ReceiptItem, Category, CATEGORIES_META, Transaction } from '../types/finance';
import { formatIDR, formatIndonesianDate, getTodayDateString, parseIDRAmountText } from './currency';
import { getServerFirestore, addTransactionFromTelegram } from './serverFirestore';
import { collection, query, where, getDocs, doc, setDoc } from 'firebase/firestore';
import {
  checkRateLimitCooldown,
  setRateLimitCooldown,
  isRateLimitError,
  RateLimitError,
} from './gemini';

const TELEGRAM_API_BASE = 'https://api.telegram.org';

export interface PendingReceiptState {
  receiptId: string;
  userId: string;
  chatId: number | string;
  receiptData: ReceiptData;
  createdAt: number;
  expiresAt: number;
  isDuplicateWarning?: boolean;
}

// In-memory pending receipts per Telegram chat ID (expires in 15 minutes)
const pendingReceipts = new Map<number | string, PendingReceiptState>();

export function getPendingReceipt(chatId: number | string): PendingReceiptState | null {
  const state = pendingReceipts.get(chatId);
  if (!state) return null;
  if (Date.now() > state.expiresAt) {
    pendingReceipts.delete(chatId);
    return null;
  }
  return state;
}

export function setPendingReceipt(chatId: number | string, state: PendingReceiptState) {
  pendingReceipts.set(chatId, state);
}

export function clearPendingReceipt(chatId: number | string) {
  pendingReceipts.delete(chatId);
}

/**
 * Download highest resolution photo from Telegram Bot API
 */
export async function downloadTelegramPhoto(
  fileId: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN belum dikonfigurasi.');
  }

  // 1. Get file path
  const getFileRes = await fetch(`${TELEGRAM_API_BASE}/bot${token}/getFile?file_id=${fileId}`);
  if (!getFileRes.ok) {
    throw new Error(`Gagal mengambil data foto Telegram (HTTP ${getFileRes.status})`);
  }
  const fileData = await getFileRes.json();
  if (!fileData.ok || !fileData.result?.file_path) {
    throw new Error('Informasi file foto Telegram tidak valid.');
  }

  const filePath = fileData.result.file_path;
  const downloadUrl = `${TELEGRAM_API_BASE}/file/bot${token}/${filePath}`;

  // 2. Download binary bytes
  const photoRes = await fetch(downloadUrl);
  if (!photoRes.ok) {
    throw new Error(`Gagal mengunduh foto dari Telegram (HTTP ${photoRes.status})`);
  }

  const arrayBuffer = await photoRes.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  let mimeType = 'image/jpeg';
  if (filePath.endsWith('.png')) mimeType = 'image/png';
  else if (filePath.endsWith('.webp')) mimeType = 'image/webp';

  return { buffer, mimeType };
}

/**
 * Scan receipt image using Gemini multimodal model
 */
export async function scanReceiptWithGemini(
  imageBuffer: Buffer,
  mimeType: string,
  caption?: string
): Promise<ReceiptData> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY tidak dikonfigurasi untuk pemindaian gambar.');
  }

  const ai = new GoogleGenAI({ apiKey });
  const todayStr = getTodayDateString();

  const prompt = `
Anda adalah sistem Optical Character Recognition (OCR) dan ekstraksi struk/nota belanja Indonesia tingkat lanjut untuk CatatKas.
Tugas Anda adalah membaca gambar struk dan mengekstrak rincian transaksi belanja.

Tanggal hari ini: ${todayStr}
${caption ? `Catatan/Keterangan tambahan dari pengguna: "${caption}"` : ''}

ATURAN EKSTRAKSI PENTING:
1. Akurasi Nominal (MATA UANG IDR):
   - Seluruh nilai nominal HARUS berupa bilangan bulat positif (integer).
   - Contoh: Rp 18.500 -> 18500 (BUKAN 18.5 atau 1850).
   - Rp 4.995.000 -> 4995000.
2. Itemisasi:
   - Ekstrak setiap item barang/makanan yang tertera (nama, jumlah kuantitas, harga satuan unit, dan total harga item).
   - Jika kuantitas tidak tertera jelas, gunakan default 1.
3. Rincian Pajak & Diskon:
   - Pisahkan dengan cermat antara Subtotal barang, Diskon (potongan), Pajak (PPN/PB1), Service Charge (biaya layanan), dan Grand Total (Total Akhir yang dibayarkan).
   - Jangan menambahkan pajak dua kali.
4. Kategori Pengeluaran:
   - Pilih satu kategori yang paling sesuai dari daftar berikut:
     food, transportation, housing, bills, shopping, entertainment, health, education, digital, other_expense
   - Contoh pedoman:
     * Kafe, restoran, warung makan, bakery -> food
     * SPBU, bensin, parkir, tol, ojol -> transportation
     * Apotek, obat, klinik -> health
     * Supermarket, minimarket, alfamart, indomaret, toko baju -> shopping
     * Pulsa, data, kuota -> digital
     * Jika ragu atau tidak jelas -> other_expense
   - Jika ada caption tambahan dari pengguna (misal "makan" atau "ini belanja bulanan"), utamakan konteks tersebut.
5. Kejujuran OCR:
   - Jangan pernah mengarang informasi yang tidak terbaca dari struk.
   - Jika struk buram, gelap, terpotong, atau bukan struk belanja, set isReadable: false dan sebutkan kolom yang tidak terbaca di uncertainFields (contoh: ["grandTotal", "transactionDate"]).
   - Jika struk terbaca jelas, set isReadable: true.

Kembalikan output JSON sesuai skema berikut.
`;

  // Check rate limit cooldown before calling Gemini multimodal model
  checkRateLimitCooldown();

  const base64Image = imageBuffer.toString('base64');

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                data: base64Image,
                mimeType,
              },
            },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            merchantName: { type: Type.STRING, description: 'Nama toko/merchant' },
            transactionDate: { type: Type.STRING, description: 'Tanggal struk format YYYY-MM-DD' },
            transactionTime: { type: Type.STRING, description: 'Waktu transaksi HH:MM' },
            currency: { type: Type.STRING, description: 'Mata uang, default IDR' },
            items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  quantity: { type: Type.NUMBER },
                  unitPrice: { type: Type.NUMBER },
                  totalPrice: { type: Type.NUMBER },
                },
                required: ['name', 'quantity', 'totalPrice'],
              },
            },
            subtotal: { type: Type.NUMBER },
            discount: { type: Type.NUMBER },
            tax: { type: Type.NUMBER },
            serviceCharge: { type: Type.NUMBER },
            otherCharges: { type: Type.NUMBER },
            grandTotal: { type: Type.NUMBER },
            paymentMethod: { type: Type.STRING },
            confidence: { type: Type.NUMBER },
            isReadable: { type: Type.BOOLEAN },
            uncertainFields: { type: Type.ARRAY, items: { type: Type.STRING } },
            suggestedCategory: { type: Type.STRING },
          },
          required: ['merchantName', 'grandTotal', 'isReadable'],
        },
        temperature: 0.1,
      },
    });

    const responseText = response.text?.trim() || '{}';
    const parsed = JSON.parse(responseText);

    return sanitizeReceiptData(parsed, todayStr, caption);
  } catch (err: any) {
    if (isRateLimitError(err)) {
      setRateLimitCooldown(60000);
      console.warn('[Gemini Receipt OCR 429 RESOURCE_EXHAUSTED]: Rate limit reached, cooldown set.');
      throw new RateLimitError();
    }
    console.error('[Gemini Receipt OCR Error]:', err);
    throw err;
  }
}

/**
 * Sanitize and validate structured receipt data
 */
export function sanitizeReceiptData(raw: any, todayStr: string, caption?: string): ReceiptData {
  const isReadable = raw.isReadable !== false && typeof raw.grandTotal === 'number' && raw.grandTotal > 0;
  const merchantName = (raw.merchantName || 'Struk Belanja').toString().trim().slice(0, 100);

  let date = todayStr;
  if (raw.transactionDate && /^\d{4}-\d{2}-\d{2}$/.test(raw.transactionDate)) {
    date = raw.transactionDate;
  }

  const items: ReceiptItem[] = Array.isArray(raw.items)
    ? raw.items.map((item: any) => ({
        name: (item.name || 'Item').toString().trim().slice(0, 100),
        quantity: Math.max(1, Math.round(item.quantity || 1)),
        unitPrice: Math.round(item.unitPrice || item.totalPrice || 0),
        totalPrice: Math.round(item.totalPrice || (item.unitPrice || 0) * (item.quantity || 1)),
      }))
    : [];

  const subtotal = Math.round(raw.subtotal || items.reduce((acc, i) => acc + i.totalPrice, 0));
  const discount = Math.round(raw.discount || 0);
  const tax = Math.round(raw.tax || 0);
  const serviceCharge = Math.round(raw.serviceCharge || 0);
  const otherCharges = Math.round(raw.otherCharges || 0);

  let grandTotal = Math.round(raw.grandTotal || 0);
  if (grandTotal <= 0) {
    grandTotal = Math.max(0, subtotal - discount + tax + serviceCharge + otherCharges);
  }

  // Determine category
  let suggestedCategory: Category = 'food';
  const validCategories = Object.keys(CATEGORIES_META) as Category[];
  if (raw.suggestedCategory && validCategories.includes(raw.suggestedCategory)) {
    suggestedCategory = raw.suggestedCategory;
  } else {
    // Contextual inference
    const textContext = `${merchantName} ${items.map((i) => i.name).join(' ')} ${caption || ''}`.toLowerCase();
    if (textContext.includes('spbu') || textContext.includes('pertamina') || textContext.includes('bensin') || textContext.includes('shell')) {
      suggestedCategory = 'transportation';
    } else if (textContext.includes('apotek') || textContext.includes('obat') || textContext.includes('klinik') || textContext.includes('kimia farma')) {
      suggestedCategory = 'health';
    } else if (textContext.includes('indomaret') || textContext.includes('alfamart') || textContext.includes('supermarket') || textContext.includes('belanja')) {
      suggestedCategory = 'shopping';
    } else if (textContext.includes('pulsa') || textContext.includes('kuota') || textContext.includes('telkomsel')) {
      suggestedCategory = 'digital';
    } else if (textContext.includes('kopi') || textContext.includes('cafe') || textContext.includes('resto') || textContext.includes('makan') || textContext.includes('bakso')) {
      suggestedCategory = 'food';
    } else {
      suggestedCategory = 'other_expense';
    }
  }

  return {
    merchantName: merchantName || 'Struk Belanja',
    transactionDate: date,
    transactionTime: raw.transactionTime || '',
    currency: 'IDR',
    items,
    subtotal,
    discount,
    tax,
    serviceCharge,
    otherCharges,
    grandTotal,
    paymentMethod: (raw.paymentMethod || 'cash').toString().toLowerCase(),
    confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.95,
    uncertainFields: Array.isArray(raw.uncertainFields) ? raw.uncertainFields : [],
    isReadable,
    suggestedCategory,
    captionContext: caption,
  };
}

/**
 * Format confirmation message for receipt summary
 */
export function formatReceiptConfirmationMessage(
  receipt: ReceiptData,
  isDuplicate: boolean = false
): string {
  const meta = CATEGORIES_META[receipt.suggestedCategory || 'food'];
  const catLabel = meta ? meta.labelId : receipt.suggestedCategory;

  const itemLines = receipt.items.slice(0, 6).map((item) => {
    const qtyText = item.quantity > 1 ? ` x${item.quantity}` : '';
    return `• ${item.name}${qtyText} — ${formatIDR(item.totalPrice)}`;
  });

  if (receipt.items.length > 6) {
    itemLines.push(`• <i>(+ ${receipt.items.length - 6} item lainnya...)</i>`);
  }

  const itemsSection = itemLines.length > 0 ? `\n🛒 <b>Item:</b>\n${itemLines.join('\n')}\n` : '';

  let breakdownSection = '';
  if (receipt.subtotal > 0 && (receipt.tax > 0 || receipt.discount > 0 || receipt.serviceCharge > 0)) {
    breakdownSection += `\nSubtotal: ${formatIDR(receipt.subtotal)}`;
    if (receipt.discount > 0) breakdownSection += `\nDiskon: -${formatIDR(receipt.discount)}`;
    if (receipt.tax > 0) breakdownSection += `\nPajak: +${formatIDR(receipt.tax)}`;
    if (receipt.serviceCharge > 0) breakdownSection += `\nLayanan: +${formatIDR(receipt.serviceCharge)}`;
    breakdownSection += '\n';
  }

  // Financial reconciliation validation
  const calculatedItemsTotal = receipt.items.reduce((acc, i) => acc + i.totalPrice, 0);
  let warningSection = '';
  if (calculatedItemsTotal > 0 && Math.abs(calculatedItemsTotal - (receipt.subtotal || receipt.grandTotal)) > 2000) {
    warningSection = '\n⚠️ <i>Catatan: Ada sedikit perbedaan antara rincian item dan total struk. Mohon periksa sebelum menyimpan.</i>\n';
  }

  const duplicateSection = isDuplicate
    ? '\n⚠️ <b>Struk yang sangat mirip sudah pernah dicatat sebelumnya!</b>\nTetap simpan transaksi ini?\n'
    : '';

  return `🧾 <b>STRUK TERDETEKSI</b>\n\n🏪 <b>Merchant:</b>\n${receipt.merchantName}\n\n📅 <b>Tanggal:</b>\n${formatIndonesianDate(receipt.transactionDate, { includeDayName: false })}\n${itemsSection}${breakdownSection}\nTotal:\n💰 <b>${formatIDR(receipt.grandTotal)}</b>\n\n📂 <b>Kategori:</b>\n${catLabel}\n${warningSection}${duplicateSection}\nSimpan transaksi?\n\n/confirm\n/cancel\n\n<i>Ketik koreksi langsung bila ada yang salah (contoh: "totalnya 65 ribu" atau "kategorinya belanja")</i>`;
}

/**
 * Check if a similar receipt already exists in Firestore (Duplicate Protection)
 */
export async function checkForDuplicateReceipt(
  userId: string,
  receipt: ReceiptData
): Promise<Transaction | null> {
  try {
    const db = getServerFirestore();
    const txCol = collection(db, 'transactions');
    const q = query(
      txCol,
      where('userId', '==', userId),
      where('amount', '==', receipt.grandTotal)
    );

    const snapshot = await getDocs(q);
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data() as Transaction;
      // Match merchant or date
      const descMatch =
        data.description.toLowerCase().includes(receipt.merchantName.toLowerCase()) ||
        receipt.merchantName.toLowerCase().includes(data.description.toLowerCase());
      if (descMatch && data.date === receipt.transactionDate) {
        return data;
      }
    }
    return null;
  } catch (err) {
    console.error('Error checking duplicate receipt:', err);
    return null;
  }
}

/**
 * Parse user corrections to pending receipt data
 */
export function applyUserCorrectionToReceipt(
  current: ReceiptData,
  text: string
): { updated: ReceiptData; changedDescription: string } | null {
  const lower = text.toLowerCase().trim();
  const updated = { ...current, items: [...current.items] };
  let changedDescription = '';

  // 1. Correct Total: e.g. "totalnya 65 ribu", "total 65000", "jadi 60rb"
  const totalMatch = lower.match(/(?:total(?:nya)?|jumlah(?:nya)?|jadi)\s*(?:rp\.?|idr)?\s*([\d]+(?:[.,]\d+)?\s*(?:juta|jt|ribu|rb|k)?|\d{1,3}(?:\.\d{3})+)/i);
  if (totalMatch) {
    const parsedAmount = parseIDRAmountText(totalMatch[1]);
    if (parsedAmount && parsedAmount > 0) {
      updated.grandTotal = parsedAmount;
      changedDescription = `Total diubah menjadi ${formatIDR(parsedAmount)}`;
      return { updated, changedDescription };
    }
  }

  // 2. Correct Merchant Name: e.g. "tokonya bukan Kopi Senja, tapi Kopi Senja Barat" or "merchant Kopi ABC"
  const merchantMatch = text.match(/(?:tokonya|merchant(?:nya)?|tempatnya|namanya|bukan .+ tapi)\s+(?:bukan .+ tapi\s+)?(.+)$/i);
  if (merchantMatch && merchantMatch[1]) {
    const newMerchant = merchantMatch[1].replace(/^(?:tapi|namanya|tokonya)\s+/i, '').trim();
    if (newMerchant.length > 1) {
      updated.merchantName = newMerchant;
      changedDescription = `Nama toko diubah menjadi "${newMerchant}"`;
      return { updated, changedDescription };
    }
  }

  // 3. Correct Category: e.g. "kategorinya belanja", "kategori makanan"
  for (const [catKey, meta] of Object.entries(CATEGORIES_META)) {
    if (lower.includes(meta.labelId.toLowerCase()) || lower.includes(catKey.toLowerCase())) {
      updated.suggestedCategory = catKey as Category;
      changedDescription = `Kategori diubah menjadi ${meta.labelId}`;
      return { updated, changedDescription };
    }
  }

  // 4. Correct Date: e.g. "tanggalnya kemarin", "tanggal 2026-10-05"
  if (lower.includes('kemarin')) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    updated.transactionDate = dateStr;
    changedDescription = `Tanggal diubah menjadi Kemarin (${dateStr})`;
    return { updated, changedDescription };
  }

  const dateMatch = lower.match(/(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) {
    updated.transactionDate = dateMatch[1];
    changedDescription = `Tanggal diubah menjadi ${dateMatch[1]}`;
    return { updated, changedDescription };
  }

  // 5. Remove Item: e.g. "hapus roti dari daftar"
  const deleteItemMatch = lower.match(/hapus\s+([a-zA-Z0-9\s]+?)(?:\s+dari\s+daftar|$)/i);
  if (deleteItemMatch) {
    const itemNameToDelete = deleteItemMatch[1].trim();
    const prevCount = updated.items.length;
    updated.items = updated.items.filter((item) => !item.name.toLowerCase().includes(itemNameToDelete));
    if (updated.items.length < prevCount) {
      // Recalculate grand total
      const newItemsTotal = updated.items.reduce((acc, i) => acc + i.totalPrice, 0);
      updated.subtotal = newItemsTotal;
      updated.grandTotal = Math.max(0, newItemsTotal + updated.tax + updated.serviceCharge - updated.discount);
      changedDescription = `Item "${itemNameToDelete}" dihapus dari rincian`;
      return { updated, changedDescription };
    }
  }

  // 6. Change Item Quantity: e.g. "jumlah kopinya 3", "kopi jadi 3"
  const qtyMatch = lower.match(/(?:jumlah|banyak)?\s*([a-zA-Z\s]+?)\s*(?:nya)?\s*(?:jadi)?\s*(\d+)/i);
  if (qtyMatch) {
    const targetItemName = qtyMatch[1].replace(/jumlah|kopinya|banyak/g, '').trim();
    const newQty = parseInt(qtyMatch[2], 10);
    if (targetItemName && newQty > 0) {
      const foundItem = updated.items.find((item) => item.name.toLowerCase().includes(targetItemName));
      if (foundItem) {
        foundItem.quantity = newQty;
        foundItem.totalPrice = foundItem.unitPrice * newQty;
        const newItemsTotal = updated.items.reduce((acc, i) => acc + i.totalPrice, 0);
        updated.subtotal = newItemsTotal;
        updated.grandTotal = Math.max(0, newItemsTotal + updated.tax + updated.serviceCharge - updated.discount);
        changedDescription = `Jumlah ${foundItem.name} diubah menjadi ${newQty}`;
        return { updated, changedDescription };
      }
    }
  }

  return null;
}

/**
 * Save confirmed receipt to Firestore
 */
export async function saveConfirmedReceiptToFirestore(
  userId: string,
  receipt: ReceiptData
): Promise<Transaction> {
  const db = getServerFirestore();
  const txCol = collection(db, 'transactions');
  const txDocRef = doc(txCol);
  const nowIso = new Date().toISOString();

  const newTx: Transaction = {
    id: txDocRef.id,
    userId,
    type: 'expense',
    amount: receipt.grandTotal,
    category: receipt.suggestedCategory || 'food',
    description: receipt.merchantName || 'Struk Belanja',
    date: receipt.transactionDate || getTodayDateString(),
    source: 'telegram_receipt',
    receipt,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await setDoc(txDocRef, newTx);
  return newTx;
}
