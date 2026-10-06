import { Transaction, TransactionType, Category, CATEGORIES_META } from '../types/finance';
import { formatIDR, formatIndonesianDate, parseIDRAmountText } from './currency';
import {
  getUserRecentTransactions,
  findTransactionsForCorrection,
  updateExistingTransaction,
  undoLastTransactionEdit,
} from './serverFirestore';

export interface CorrectionSession {
  stage?: 'IDLE' | 'AWAITING_CONFIRMATION' | 'CHOOSE_MATCH' | 'SELECT_FIELD' | 'INPUT_VALUE';
  pendingConfirmation?: {
    txId: string;
    originalTx: Transaction;
    changes: Partial<Transaction>;
  };
  candidateTransactions?: Transaction[];
  pendingChangesForCandidates?: Partial<Transaction>;
  selectedTxId?: string;
  selectedField?: 'type' | 'amount' | 'category' | 'description' | 'date';
}

// In-memory sessions per Telegram Chat ID
const sessions = new Map<number | string, CorrectionSession>();

export function getSession(chatId: number | string): CorrectionSession {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, { stage: 'IDLE' });
  }
  return sessions.get(chatId)!;
}

export function clearSession(chatId: number | string) {
  sessions.set(chatId, { stage: 'IDLE' });
}

/**
 * Identify if an incoming text is an edit/correction request
 */
export function parseCorrectionIntent(text: string): {
  isCorrection: boolean;
  isLast?: boolean;
  searchAmount?: number;
  searchDescription?: string;
  changes: Partial<Pick<Transaction, 'type' | 'amount' | 'category' | 'description' | 'date'>>;
} {
  const lower = text.toLowerCase().trim();

  // Correction indicator keywords
  const hasCorrectionKeyword =
    lower.startsWith('ubah') ||
    lower.startsWith('ganti') ||
    lower.startsWith('koreksi') ||
    lower.startsWith('edit') ||
    lower.includes('salah, itu') ||
    lower.includes('salah itu') ||
    lower.includes('harusnya') ||
    lower.includes('harus nya') ||
    lower.includes('jadikan');

  if (!hasCorrectionKeyword) {
    return { isCorrection: false, changes: {} };
  }

  const isLast =
    lower.includes('terakhir') ||
    lower.includes('barusan') ||
    (lower.includes('tadi') && !lower.includes('kopi tadi'));

  const changes: Partial<Pick<Transaction, 'type' | 'amount' | 'category' | 'description' | 'date'>> = {};

  // Check type change intent
  if (
    lower.includes('jadi pemasukan') ||
    lower.includes('itu pemasukan') ||
    lower.includes('harusnya pemasukan') ||
    lower.includes('ubah jadi pemasukan')
  ) {
    changes.type = 'income';
    changes.category = 'other_income';
  } else if (
    lower.includes('jadi pengeluaran') ||
    lower.includes('itu pengeluaran') ||
    lower.includes('harusnya pengeluaran') ||
    lower.includes('ubah jadi pengeluaran')
  ) {
    changes.type = 'expense';
    changes.category = 'other_expense';
  }

  // Check amount change intent e.g. "jadi 60rb", "jadi 75.000", "jadi Rp50.000"
  const amountMatch = lower.match(/(?:jadi|ke|menjadi)\s*(?:rp\.?|idr)?\s*([\d]+(?:[.,]\d+)?\s*(?:juta|jt|ribu|rb|k)?|\d{1,3}(?:\.\d{3})+)/i);
  if (amountMatch) {
    const parsedNewAmount = parseIDRAmountText(amountMatch[1]);
    if (parsedNewAmount && parsedNewAmount > 0) {
      changes.amount = parsedNewAmount;
    }
  }

  // Check category change intent e.g. "ubah kategori ... jadi Makanan & Minuman"
  for (const [catKey, meta] of Object.entries(CATEGORIES_META)) {
    if (
      lower.includes(meta.labelId.toLowerCase()) ||
      lower.includes(`jadi ${catKey.toLowerCase()}`)
    ) {
      changes.category = catKey as Category;
      changes.type = meta.type;
      break;
    }
  }

  // Check description change intent e.g. "ubah deskripsi transaksi terakhir jadi Kuota Internet"
  const descMatch = text.match(/(?:ubah|ganti)\s+(?:deskripsi|keterangan)\s+(?:transaksi\s+)?(?:terakhir\s+)?jadi\s+(.+)$/i);
  if (descMatch && descMatch[1]) {
    changes.description = descMatch[1].trim();
  }

  // Extract search amount from query (excluding the "jadi [amount]" part)
  let searchAmount: number | undefined;
  const beforeJadi = lower.split(/(?:jadi|ke|menjadi|harusnya)/)[0];
  const foundSearchAmt = parseIDRAmountText(beforeJadi);
  if (foundSearchAmt && foundSearchAmt > 0) {
    searchAmount = foundSearchAmt;
  }

  // Extract search description from query
  let searchDescription: string | undefined;
  let cleanDesc = beforeJadi
    .replace(/(?:ubah|ganti|koreksi|transaksi|yang|tadi|terakhir)/gi, '')
    .replace(/(?:rp\.?|idr)?\s*[\d.,]+\s*(?:ribu|rb|k|juta|jt)?/gi, '')
    .trim();

  if (cleanDesc.length > 1) {
    searchDescription = cleanDesc;
  }

  return {
    isCorrection: true,
    isLast,
    searchAmount,
    searchDescription,
    changes,
  };
}

/**
 * Handle Natural Language Correction flow
 */
export async function handleNaturalLanguageCorrection(
  chatId: number | string,
  userId: string,
  text: string,
  sendMessage: (chatId: number | string, msg: string) => Promise<any>
): Promise<boolean> {
  const intent = parseCorrectionIntent(text);
  if (!intent.isCorrection) return false;

  // Find candidate transactions
  const candidates = await findTransactionsForCorrection(userId, {
    isLast: intent.isLast,
    amount: intent.searchAmount,
    description: intent.searchDescription,
  });

  if (candidates.length === 0) {
    await sendMessage(
      chatId,
      '⚠️ Tidak ditemukan transaksi yang cocok untuk dikoreksi.\n\nKetik <code>/edit</code> untuk melihat daftar transaksi terakhir.'
    );
    return true;
  }

  // If multiple candidates match -> Ask user to choose
  if (candidates.length > 1) {
    const session = getSession(chatId);
    session.stage = 'CHOOSE_MATCH';
    session.candidateTransactions = candidates;
    session.pendingChangesForCandidates = intent.changes;

    const listLines = candidates.map((tx, idx) => {
      const typeIcon = tx.type === 'income' ? '🟢' : '🔴';
      return `${idx + 1}. ${typeIcon} ${formatIDR(tx.amount)} — ${tx.description} (${tx.date})`;
    });

    await sendMessage(
      chatId,
      `⚠️ <b>Ada beberapa transaksi yang cocok:</b>\n\n${listLines.join('\n')}\n\nBalas dengan nomor transaksi yang ingin diubah (contoh: <code>1</code> atau <code>2</code>).`
    );
    return true;
  }

  // Exactly one candidate found
  const targetTx = candidates[0];
  return await stageOrApplyCorrection(chatId, userId, targetTx, intent.changes, sendMessage);
}

/**
 * Stage correction (Confirmation prompt or instant apply)
 */
export async function stageOrApplyCorrection(
  chatId: number | string,
  userId: string,
  targetTx: Transaction,
  changes: Partial<Transaction>,
  sendMessage: (chatId: number | string, msg: string) => Promise<any>
): Promise<boolean> {
  const session = getSession(chatId);

  // If changing transaction type (income <-> expense) or large correction -> Request Confirmation
  const isTypeChange = changes.type && changes.type !== targetTx.type;
  const isAmountChange = changes.amount && changes.amount !== targetTx.amount;

  if (isTypeChange || isAmountChange) {
    session.stage = 'AWAITING_CONFIRMATION';
    session.pendingConfirmation = {
      txId: targetTx.id,
      originalTx: targetTx,
      changes,
    };

    const beforeIcon = targetTx.type === 'income' ? '🟢' : '🔴';
    const beforeLabel = targetTx.type === 'income' ? 'Pemasukan' : 'Pengeluaran';
    const afterType = changes.type || targetTx.type;
    const afterIcon = afterType === 'income' ? '🟢' : '🔴';
    const afterLabel = afterType === 'income' ? 'Pemasukan' : 'Pengeluaran';
    const afterAmount = changes.amount !== undefined ? changes.amount : targetTx.amount;
    const afterDesc = changes.description || targetTx.description;

    await sendMessage(
      chatId,
      `🔄 <b>Koreksi transaksi</b>\n\n<b>Sebelum:</b>\n${beforeIcon} ${beforeLabel}\n${formatIDR(targetTx.amount)}\n${targetTx.description}\n\n<b>Sesudah:</b>\n${afterIcon} ${afterLabel}\n${formatIDR(afterAmount)}\n${afterDesc}\n\nKonfirmasi perubahan?\n/confirm\n/cancel`
    );
    return true;
  }

  // Simple category or description change -> Apply immediately
  const updateRes = await updateExistingTransaction(userId, targetTx.id, changes, 'telegram');
  if (updateRes.success && updateRes.transaction) {
    const updated = updateRes.transaction;
    const typeLabel = updated.type === 'income' ? '🟢 Pemasukan' : '🔴 Pengeluaran';
    const meta = CATEGORIES_META[updated.category];
    const catLabel = meta ? meta.labelId : updated.category;

    await sendMessage(
      chatId,
      `✅ <b>Transaksi berhasil dikoreksi</b>\n\n${typeLabel}\n💰 ${formatIDR(updated.amount)}\n📝 ${updated.description}\n🏷️ ${catLabel}\n📅 ${formatIndonesianDate(updated.date, { includeDayName: false })}`
    );
  } else {
    await sendMessage(chatId, `⚠️ Gagal memperbarui transaksi: ${updateRes.message}`);
  }

  clearSession(chatId);
  return true;
}

/**
 * Handle confirmation commands (/confirm or /cancel)
 */
export async function handleConfirmationCommand(
  chatId: number | string,
  userId: string,
  isConfirm: boolean,
  sendMessage: (chatId: number | string, msg: string) => Promise<any>
): Promise<boolean> {
  const session = getSession(chatId);
  if (session.stage !== 'AWAITING_CONFIRMATION' || !session.pendingConfirmation) {
    return false;
  }

  if (!isConfirm) {
    clearSession(chatId);
    await sendMessage(chatId, '❌ Koreksi transaksi dibatalkan.');
    return true;
  }

  const { txId, originalTx, changes } = session.pendingConfirmation;
  const updateRes = await updateExistingTransaction(userId, txId, changes, 'telegram');

  if (updateRes.success && updateRes.transaction) {
    const updated = updateRes.transaction;
    const fromLabel = originalTx.type === 'income' ? 'Pemasukan' : 'Pengeluaran';
    const toLabel = updated.type === 'income' ? 'Pemasukan' : 'Pengeluaran';

    await sendMessage(
      chatId,
      `✅ <b>Transaksi berhasil dikoreksi</b>\n\n🔄 ${fromLabel} → ${toLabel}\n💰 ${formatIDR(updated.amount)}\n📝 ${updated.description}\n📅 ${formatIndonesianDate(updated.date, { includeDayName: false })}`
    );
  } else {
    await sendMessage(chatId, `⚠️ Gagal memperbarui transaksi: ${updateRes.message}`);
  }

  clearSession(chatId);
  return true;
}

/**
 * Handle /undo command
 */
export async function handleUndoCommand(
  chatId: number | string,
  userId: string,
  sendMessage: (chatId: number | string, msg: string) => Promise<any>
): Promise<void> {
  const undoRes = await undoLastTransactionEdit(userId);

  if (!undoRes.success || !undoRes.revertedTx || !undoRes.previousState) {
    await sendMessage(
      chatId,
      '⚠️ Tidak ada riwayat koreksi transaksi yang dapat dibatalkan.'
    );
    return;
  }

  const reverted = undoRes.revertedTx;
  const prev = undoRes.previousState;

  const prevIcon = prev.type === 'income' ? '🟢' : '🔴';
  const prevLabel = prev.type === 'income' ? 'Pemasukan' : 'Pengeluaran';
  const revIcon = reverted.type === 'income' ? '🟢' : '🔴';
  const revLabel = reverted.type === 'income' ? 'Pemasukan' : 'Pengeluaran';

  await sendMessage(
    chatId,
    `↩️ <b>Koreksi terakhir dibatalkan.</b>\n\n${reverted.description}\n${formatIDR(reverted.amount)}\n${prevIcon} ${prevLabel} → ${revIcon} ${revLabel}`
  );
}

/**
 * Handle /edit command
 */
export async function handleEditCommand(
  chatId: number | string,
  userId: string,
  argText: string | undefined,
  sendMessage: (chatId: number | string, msg: string) => Promise<any>
): Promise<void> {
  const recent = await getUserRecentTransactions(userId, 5);
  if (recent.length === 0) {
    await sendMessage(chatId, '⚠️ Belum ada transaksi yang dapat diedit.');
    return;
  }

  const session = getSession(chatId);
  session.candidateTransactions = recent;

  // If user provided an index directly e.g. "/edit 2"
  if (argText && /^\d+$/.test(argText.trim())) {
    const idx = parseInt(argText.trim(), 10) - 1;
    if (idx >= 0 && idx < recent.length) {
      await showEditFieldMenu(chatId, recent[idx], sendMessage);
      return;
    }
  }

  // Show list of 5 recent transactions
  session.stage = 'CHOOSE_MATCH';
  const lines = recent.map((tx, idx) => {
    const icon = tx.type === 'income' ? '🟢' : '🔴';
    return `${idx + 1}. ${icon} ${formatIDR(tx.amount)} — ${tx.description}`;
  });

  await sendMessage(
    chatId,
    `✏️ <b>Pilih transaksi yang ingin dikoreksi:</b>\n\n${lines.join('\n')}\n\nBalas dengan nomor transaksi:\n<code>/edit 1</code> atau cukup kirim angka <code>1</code>`
  );
}

/**
 * Display field edit options for a selected transaction
 */
export async function showEditFieldMenu(
  chatId: number | string,
  tx: Transaction,
  sendMessage: (chatId: number | string, msg: string) => Promise<any>
) {
  const session = getSession(chatId);
  session.stage = 'SELECT_FIELD';
  session.selectedTxId = tx.id;

  const icon = tx.type === 'income' ? '🟢' : '🔴';
  const label = tx.type === 'income' ? 'Pemasukan' : 'Pengeluaran';

  await sendMessage(
    chatId,
    `<b>Transaksi:</b>\n${icon} ${label}\n${formatIDR(tx.amount)}\n${tx.description}\n${formatIndonesianDate(tx.date, { includeDayName: false })}\n\n<b>Apa yang ingin diubah?</b>\n\n1. Jenis transaksi (Pemasukan / Pengeluaran)\n2. Nominal\n3. Kategori\n4. Deskripsi\n5. Tanggal\n6. Batalkan\n\n<i>Kirim nomor pilihan (1 - 6)</i>`
  );
}

/**
 * Handle dialog inputs when session is active
 */
export async function handleSessionMessage(
  chatId: number | string,
  userId: string,
  text: string,
  sendMessage: (chatId: number | string, msg: string) => Promise<any>
): Promise<boolean> {
  const session = getSession(chatId);
  if (!session || session.stage === 'IDLE' || !session.stage) {
    return false;
  }

  const trimmed = text.trim();

  // Cancel check
  if (trimmed === '/cancel' || trimmed.toLowerCase() === 'batal' || trimmed === '6') {
    clearSession(chatId);
    await sendMessage(chatId, '❌ Proses koreksi dibatalkan.');
    return true;
  }

  // Confirm check
  if (trimmed === '/confirm' || trimmed.toLowerCase() === 'ya' || trimmed.toLowerCase() === 'konfirmasi') {
    return await handleConfirmationCommand(chatId, userId, true, sendMessage);
  }

  // Stage: CHOOSE_MATCH
  if (session.stage === 'CHOOSE_MATCH' && session.candidateTransactions) {
    const choiceNum = parseInt(trimmed.replace('/edit', '').trim(), 10);
    if (!isNaN(choiceNum) && choiceNum >= 1 && choiceNum <= session.candidateTransactions.length) {
      const selected = session.candidateTransactions[choiceNum - 1];
      if (session.pendingChangesForCandidates) {
        return await stageOrApplyCorrection(chatId, userId, selected, session.pendingChangesForCandidates, sendMessage);
      } else {
        await showEditFieldMenu(chatId, selected, sendMessage);
        return true;
      }
    }
  }

  // Stage: SELECT_FIELD
  if (session.stage === 'SELECT_FIELD' && session.selectedTxId) {
    const recent = await getUserRecentTransactions(userId, 20);
    const targetTx = recent.find((t) => t.id === session.selectedTxId);
    if (!targetTx) {
      clearSession(chatId);
      await sendMessage(chatId, '⚠️ Transaksi tidak ditemukan.');
      return true;
    }

    if (trimmed === '1') {
      // Toggle Type
      const newType: TransactionType = targetTx.type === 'income' ? 'expense' : 'income';
      const newCategory: Category = newType === 'income' ? 'other_income' : 'other_expense';
      return await stageOrApplyCorrection(chatId, userId, targetTx, { type: newType, category: newCategory }, sendMessage);
    } else if (trimmed === '2') {
      session.stage = 'INPUT_VALUE';
      session.selectedField = 'amount';
      await sendMessage(chatId, `💰 <b>Ubah Nominal</b>\n\nNominal saat ini: ${formatIDR(targetTx.amount)}\nKirim nominal baru (contoh: 50.000 atau 60rb):`);
      return true;
    } else if (trimmed === '3') {
      session.stage = 'INPUT_VALUE';
      session.selectedField = 'category';
      const catList = Object.entries(CATEGORIES_META)
        .filter(([_, meta]) => meta.type === targetTx.type)
        .map(([_, meta], idx) => `${idx + 1}. ${meta.labelId}`);
      await sendMessage(chatId, `🏷️ <b>Ubah Kategori</b>\n\nPilih kategori baru:\n\n${catList.join('\n')}\n\nKirim nama kategori atau nomor.`);
      return true;
    } else if (trimmed === '4') {
      session.stage = 'INPUT_VALUE';
      session.selectedField = 'description';
      await sendMessage(chatId, `📝 <b>Ubah Deskripsi</b>\n\nDeskripsi saat ini: ${targetTx.description}\nKirim deskripsi baru:`);
      return true;
    } else if (trimmed === '5') {
      session.stage = 'INPUT_VALUE';
      session.selectedField = 'date';
      await sendMessage(chatId, `📅 <b>Ubah Tanggal</b>\n\nTanggal saat ini: ${targetTx.date}\nKirim tanggal baru format YYYY-MM-DD (contoh: 2026-10-06):`);
      return true;
    }
  }

  // Stage: INPUT_VALUE
  if (session.stage === 'INPUT_VALUE' && session.selectedTxId && session.selectedField) {
    const recent = await getUserRecentTransactions(userId, 20);
    const targetTx = recent.find((t) => t.id === session.selectedTxId);
    if (!targetTx) {
      clearSession(chatId);
      await sendMessage(chatId, '⚠️ Transaksi tidak ditemukan.');
      return true;
    }

    if (session.selectedField === 'amount') {
      const newAmt = parseIDRAmountText(trimmed);
      if (!newAmt || newAmt <= 0) {
        await sendMessage(chatId, '⚠️ Nominal tidak valid. Coba lagi (contoh: 60rb atau 50000):');
        return true;
      }
      return await stageOrApplyCorrection(chatId, userId, targetTx, { amount: newAmt }, sendMessage);
    }

    if (session.selectedField === 'description') {
      return await stageOrApplyCorrection(chatId, userId, targetTx, { description: trimmed.slice(0, 200) }, sendMessage);
    }

    if (session.selectedField === 'category') {
      let matchedCategory: Category | undefined;
      for (const [key, meta] of Object.entries(CATEGORIES_META)) {
        if (
          meta.labelId.toLowerCase().includes(trimmed.toLowerCase()) ||
          key.toLowerCase().includes(trimmed.toLowerCase())
        ) {
          matchedCategory = key as Category;
          break;
        }
      }
      if (!matchedCategory) {
        await sendMessage(chatId, '⚠️ Kategori tidak dikenali. Ketik nama kategori yang valid:');
        return true;
      }
      return await stageOrApplyCorrection(chatId, userId, targetTx, { category: matchedCategory }, sendMessage);
    }

    if (session.selectedField === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        await sendMessage(chatId, '⚠️ Format tanggal harus YYYY-MM-DD (contoh: 2026-10-06):');
        return true;
      }
      return await stageOrApplyCorrection(chatId, userId, targetTx, { date: trimmed }, sendMessage);
    }
  }

  return false;
}
