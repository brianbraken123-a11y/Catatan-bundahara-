import { formatIDR, getTodayDateString, getCurrentMonthString, formatIndonesianDate } from './currency';
import { parseTransactionWithGemini, isRateLimitError } from './gemini';
import {
  getUserIdByTelegramChatId,
  linkTelegramChatWithCode,
  addTransactionFromTelegram,
  getUserTransactionsForSummary,
} from './serverFirestore';
import { CATEGORIES_META, Category } from '../types/finance';
import {
  handleNaturalLanguageCorrection,
  handleEditCommand,
  handleUndoCommand,
  handleConfirmationCommand,
  handleSessionMessage,
} from './telegramCorrection';
import {
  downloadTelegramPhoto,
  scanReceiptWithGemini,
  getPendingReceipt,
  setPendingReceipt,
  clearPendingReceipt,
  formatReceiptConfirmationMessage,
  checkForDuplicateReceipt,
  applyUserCorrectionToReceipt,
  saveConfirmedReceiptToFirestore,
} from './geminiReceipt';

const TELEGRAM_API_BASE = 'https://api.telegram.org';

/**
 * Send a message via Telegram Bot API
 */
export async function sendTelegramMessage(
  chatId: number | string,
  text: string,
  options?: {
    parse_mode?: 'Markdown' | 'HTML';
    reply_markup?: any;
  }
) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === 'your_telegram_bot_token') {
    console.warn('TELEGRAM_BOT_TOKEN is not set. Mocking sent message:', { chatId, text });
    return { ok: true, mocked: true };
  }

  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: options?.parse_mode || 'HTML',
        reply_markup: options?.reply_markup,
      }),
    });
    return await res.json();
  } catch (err) {
    console.error('Failed to send Telegram message:', err);
    throw err;
  }
}

/**
 * Process incoming Telegram Update from webhook
 */
export async function handleTelegramUpdate(update: any): Promise<void> {
  const message = update.message || update.edited_message;
  if (!message || (!message.text && !message.photo)) {
    return;
  }

  const chatId = message.chat.id;
  const username = message.from?.username || message.from?.first_name || '';

  // 1. Handle Photo Messages (Receipt Scanning)
  if (Array.isArray(message.photo) && message.photo.length > 0) {
    const userId = await getUserIdByTelegramChatId(chatId);
    if (!userId) {
      await sendTelegramMessage(
        chatId,
        `⚠️ <b>Akun Belum Terhubung!</b>\n\nSilakan tautkan akun Anda terlebih dahulu sebelum memindai struk:\n1. Buka dashboard web CatatKas\n2. Dapatkan kode 6 digit di tab Telegram\n3. Kirim: <code>/start [kode]</code>`
      );
      return;
    }

    await sendTelegramMessage(chatId, '🧾 Struk diterima. Sedang membaca...');

    try {
      const highestPhoto = message.photo[message.photo.length - 1];
      const { buffer, mimeType } = await downloadTelegramPhoto(highestPhoto.file_id);
      const receiptData = await scanReceiptWithGemini(buffer, mimeType, message.caption);

      if (!receiptData.isReadable || receiptData.grandTotal <= 0) {
        await sendTelegramMessage(
          chatId,
          `⚠️ <b>Struknya kurang jelas untuk dibaca.</b>\n\nCoba kirim foto yang:\n• lebih terang\n• tidak blur\n• seluruh struk terlihat\n• tidak terpotong`
        );
        return;
      }

      // Check duplicate
      const duplicateTx = await checkForDuplicateReceipt(userId, receiptData);

      // Save to pending state (expires in 15 mins)
      setPendingReceipt(chatId, {
        receiptId: 'rcpt_' + Date.now(),
        userId,
        chatId,
        receiptData,
        createdAt: Date.now(),
        expiresAt: Date.now() + 15 * 60 * 1000,
        isDuplicateWarning: Boolean(duplicateTx),
      });

      const confirmMsg = formatReceiptConfirmationMessage(receiptData, Boolean(duplicateTx));
      await sendTelegramMessage(chatId, confirmMsg);
    } catch (err: any) {
      if (isRateLimitError(err)) {
        console.warn('[Telegram Photo] Gemini rate limit reached (429)');
        await sendTelegramMessage(
          chatId,
          '⚠️ AI sedang mencapai batas penggunaan. Coba lagi setelah kuota tersedia.'
        );
        return;
      }
      console.error('Error scanning receipt:', err);
      await sendTelegramMessage(
        chatId,
        `⚠️ Kendala saat membaca struk: ${err.message || 'Coba kirim foto struk yang lebih terang dan jelas.'}`
      );
    }
    return;
  }

  // Text message handling
  const text = (message.text || '').trim();
  if (!text) return;

  // 1. Handle /start command (may contain 6-digit link code)
  if (text.startsWith('/start')) {
    const parts = text.split(/\s+/);
    const code = parts[1]?.trim();

    if (code) {
      const linkResult = await linkTelegramChatWithCode(chatId, code, username);
      if (linkResult.success) {
        await sendTelegramMessage(
          chatId,
          `Kode berhasil diterima. Akun Telegram Anda telah terhubung.\n\nSekarang Anda dapat mencatat transaksi keuangan langsung dari chat ini:\n• <i>kopi 18 ribu</i>\n• <i>makan geprek 25k</i>\n• <i>bensin 50rb</i>\n• <i>gaji 7.5 juta</i>\n\nKetik /help untuk panduan ringkasan saldo.`
        );
        return;
      } else {
        await sendTelegramMessage(
          chatId,
          `⚠️ <b>Gagal Menautkan:</b>\n${linkResult.message}\n\nBuka dashboard web CatatKas dan klik tombol <b>Hubungkan Telegram</b> untuk mendapatkan kode 6-digit baru.`
        );
        return;
      }
    }

    // Check if already linked
    const existingUserId = await getUserIdByTelegramChatId(chatId);
    if (existingUserId) {
      await sendTelegramMessage(
        chatId,
        `👋 <b>Hai ${username || 'teman'}!</b>\n\nAkun Anda sudah terhubung dengan CatatKas. Silakan kirim transaksi langsung atau gunakan perintah:\n• /balance - Cek saldo saat ini\n• /today - Ringkasan hari ini\n• /summary atau /month - Ringkasan bulan ini\n• /help - Bantuan format input`
      );
      return;
    }

    await sendTelegramMessage(
      chatId,
      `👋 <b>Selamat datang di CatatKas Bot!</b>\n\nUntuk mulai mencatat keuangan pribadi Anda, hubungkan akun Telegram ini dengan akun web CatatKas Anda:\n\n1. Buka aplikasi web CatatKas\n2. Klik menu <b>Integrasi Telegram</b>\n3. Klik <b>Buat Kode Tautan</b>\n4. Kirim kode tersebut ke sini dengan perintah:\n<code>/start KODE_6_DIGIT</code>\n\nContoh: <code>/start 123456</code>`
    );
    return;
  }

  // 2. Handle /help command
  if (text === '/help') {
    await sendTelegramMessage(
      chatId,
      `📖 <b>Panduan Penggunaan CatatKas Bot:</b>\n\n<b>Contoh Input Transaksi:</b>\n• <code>kopi 18 ribu</code> (Pengeluaran Makan)\n• <code>bensin 50rb</code> (Pengeluaran Transport)\n• <code>dana masuk 4.995.000</code> (Pemasukan)\n• <code>gaji 7.5 juta</code> (Pemasukan Gaji)\n\n<b>Koreksi & Edit Transaksi:</b>\n• <code>ubah transaksi dana masuk 4.995.000 jadi pemasukan</code>\n• <code>koreksi bensin 50rb jadi 60rb</code>\n• <code>ubah transaksi terakhir jadi pemasukan</code>\n• /edit - Pilih transaksi untuk diedit\n• /undo - Batalkan koreksi terakhir\n\n<b>Daftar Perintah Cepat:</b>\n• /balance - Total saldo kas bersih\n• /today - Ringkasan hari ini\n• /summary atau /month - Ringkasan bulan ini\n• /link [kode] - Menghubungkan akun web`
    );
    return;
  }

  // 3. Handle /link command
  if (text.startsWith('/link')) {
    const parts = text.split(/\s+/);
    const code = parts[1]?.trim();
    if (!code) {
      await sendTelegramMessage(
        chatId,
        `⚠️ Format salah. Gunakan: <code>/link KODE_6_DIGIT</code>\n\nDapatkan kode 6-digit dari dashboard web CatatKas.`
      );
      return;
    }
    const res = await linkTelegramChatWithCode(chatId, code, username);
    await sendTelegramMessage(chatId, res.message);
    return;
  }

  // For other commands or text, check if user is linked
  const userId = await getUserIdByTelegramChatId(chatId);
  if (!userId) {
    await sendTelegramMessage(
      chatId,
      `⚠️ <b>Akun Belum Terhubung!</b>\n\nSilakan tautkan akun Anda terlebih dahulu:\n1. Buka dashboard web CatatKas\n2. Dapatkan kode 6 digit di tab Telegram\n3. Kirim: <code>/start [kode]</code>`
    );
    return;
  }

  // Check for Pending Receipt Confirmation or Correction
  const pendingReceipt = getPendingReceipt(chatId);
  if (pendingReceipt) {
    const trimmedLower = text.toLowerCase().trim();

    // Confirm receipt
    if (trimmedLower === '/confirm' || trimmedLower === 'ya' || trimmedLower === 'simpan' || trimmedLower === 'ok') {
      try {
        const savedTx = await saveConfirmedReceiptToFirestore(userId, pendingReceipt.receiptData);
        clearPendingReceipt(chatId);
        await sendTelegramMessage(
          chatId,
          `✅ <b>Transaksi struk berhasil dicatat!</b>\n\n🔴 Pengeluaran\n💰 <b>${formatIDR(savedTx.amount)}</b>\n🏪 ${savedTx.description}\n📅 ${formatIndonesianDate(savedTx.date, { includeDayName: false })}\n\n<i>Ketik /today atau /balance untuk cek saldo kas.</i>`
        );
      } catch (saveErr: any) {
        await sendTelegramMessage(chatId, `⚠️ Gagal menyimpan transaksi struk: ${saveErr.message}`);
      }
      return;
    }

    // Cancel receipt
    if (trimmedLower === '/cancel' || trimmedLower === 'batal') {
      clearPendingReceipt(chatId);
      await sendTelegramMessage(chatId, '❌ Pencatatan struk dibatalkan.');
      return;
    }

    // Attempt user correction to pending receipt
    const correctionResult = applyUserCorrectionToReceipt(pendingReceipt.receiptData, text);
    if (correctionResult) {
      pendingReceipt.receiptData = correctionResult.updated;
      const updatedMsg = `✏️ <b>${correctionResult.changedDescription}</b>\n\n` + formatReceiptConfirmationMessage(correctionResult.updated, pendingReceipt.isDuplicateWarning);
      await sendTelegramMessage(chatId, updatedMsg);
      return;
    }
  }

  // Handle Confirmation commands (/confirm or /cancel) for transaction edit/correction
  if (text === '/confirm' || text.toLowerCase() === 'ya' || text.toLowerCase() === 'konfirmasi') {
    const handled = await handleConfirmationCommand(chatId, userId, true, sendTelegramMessage);
    if (handled) return;
  }

  if (text === '/cancel' || text.toLowerCase() === 'batal') {
    const handled = await handleConfirmationCommand(chatId, userId, false, sendTelegramMessage);
    if (handled) return;
  }

  // Handle /undo command
  if (text === '/undo') {
    await handleUndoCommand(chatId, userId, sendTelegramMessage);
    return;
  }

  // Handle /edit command
  if (text.startsWith('/edit')) {
    const parts = text.split(/\s+/);
    await handleEditCommand(chatId, userId, parts[1], sendTelegramMessage);
    return;
  }

  // Check if user is in an active session (e.g. editing a field or choosing transaction)
  const handledSession = await handleSessionMessage(chatId, userId, text, sendTelegramMessage);
  if (handledSession) {
    return;
  }

  // Check if message is a natural language correction request
  const handledCorrection = await handleNaturalLanguageCorrection(chatId, userId, text, sendTelegramMessage);
  if (handledCorrection) {
    return;
  }

  // 4. Handle /balance command
  if (text === '/balance') {
    const txs = await getUserTransactionsForSummary(userId);
    let totalIncome = 0;
    let totalExpense = 0;

    for (const tx of txs) {
      if (tx.type === 'income') totalIncome += tx.amount;
      if (tx.type === 'expense') totalExpense += tx.amount;
    }
    const balance = totalIncome - totalExpense;

    await sendTelegramMessage(
      chatId,
      `💳 <b>Saldo Kas Saat Ini:</b>\n\n<b>${formatIDR(balance)}</b>\n\n• Total Pemasukan: ${formatIDR(totalIncome)}\n• Total Pengeluaran: ${formatIDR(totalExpense)}\n• Total Transaksi: ${txs.length} transaksi`
    );
    return;
  }

  // 5. Handle /today command
  if (text === '/today') {
    const todayStr = getTodayDateString();
    const txs = await getUserTransactionsForSummary(userId, todayStr, todayStr);

    let income = 0;
    let expense = 0;
    const items: string[] = [];

    for (const tx of txs) {
      if (tx.type === 'income') {
        income += tx.amount;
        items.push(`🟢 +${formatIDR(tx.amount)}: ${tx.description}`);
      } else {
        expense += tx.amount;
        items.push(`🔴 -${formatIDR(tx.amount)}: ${tx.description}`);
      }
    }

    const itemsText = items.length > 0 ? `\n\n<b>Daftar Hari Ini:</b>\n${items.join('\n')}` : '\n\n<i>Belum ada transaksi hari ini.</i>';

    await sendTelegramMessage(
      chatId,
      `📅 <b>Ringkasan Hari Ini (${todayStr}):</b>\n\n• Pemasukan: <b>${formatIDR(income)}</b>\n• Pengeluaran: <b>${formatIDR(expense)}</b>\n• Selisih: <b>${formatIDR(income - expense)}</b>${itemsText}`
    );
    return;
  }

  // 6. Handle /summary and /month commands
  if (text === '/summary' || text === '/month') {
    const currentMonth = getCurrentMonthString(); // YYYY-MM
    const startDate = `${currentMonth}-01`;
    const endDate = `${currentMonth}-31`;

    const txs = await getUserTransactionsForSummary(userId, startDate, endDate);

    let totalIncome = 0;
    let totalExpense = 0;
    const catMap: Record<string, number> = {};

    for (const tx of txs) {
      if (tx.type === 'income') {
        totalIncome += tx.amount;
      } else {
        totalExpense += tx.amount;
        catMap[tx.category] = (catMap[tx.category] || 0) + tx.amount;
      }
    }

    const categoryList = Object.entries(catMap)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, amt]) => {
        const meta = CATEGORIES_META[cat as Category];
        const label = meta ? meta.labelId : cat;
        const pct = totalExpense > 0 ? Math.round((amt / totalExpense) * 100) : 0;
        return `• ${label}: <b>${formatIDR(amt)}</b> (${pct}%)`;
      })
      .slice(0, 5);

    const breakdownText =
      categoryList.length > 0
        ? `\n\n<b>Pengeluaran Terbesar:</b>\n${categoryList.join('\n')}`
        : '';

    await sendTelegramMessage(
      chatId,
      `📊 <b>Ringkasan Bulan Ini (${currentMonth}):</b>\n\n• Total Pemasukan: <b>${formatIDR(totalIncome)}</b>\n• Total Pengeluaran: <b>${formatIDR(totalExpense)}</b>\n• Tabungan Bersih: <b>${formatIDR(totalIncome - totalExpense)}</b>${breakdownText}\n\n<i>Ketik /today untuk pengeluaran hari ini.</i>`
    );
    return;
  }

  // 7. Natural language transaction parsing via Gemini
  try {
    const parsed = await parseTransactionWithGemini(text);

    // If ambiguous or incomplete
    if (parsed.isAmbiguous || !parsed.amount || !parsed.type || !parsed.category) {
      const question =
        parsed.clarificationQuestion ||
        'Ini mau dicatat sebagai kategori apa? Makanan, belanja, transportasi, atau lainnya? Sertakan juga nominalnya (contoh: kopi 18k).';
      await sendTelegramMessage(chatId, `❓ ${question}`);
      return;
    }

    // Server-side strict validation
    const validAmount = Math.round(parsed.amount);
    if (validAmount <= 0) {
      await sendTelegramMessage(
        chatId,
        '⚠️ Nominal harus lebih dari 0 Rupiah. Contoh: <code>makan siang 25k</code>'
      );
      return;
    }

    // Save transaction to Firestore
    const savedTx = await addTransactionFromTelegram(userId, {
      type: parsed.type,
      amount: validAmount,
      category: parsed.category,
      description: parsed.description || (parsed.type === 'income' ? 'Pemasukan' : 'Pengeluaran'),
      date: parsed.date || getTodayDateString(),
    });

    const meta = CATEGORIES_META[savedTx.category as Category];
    const categoryLabel = meta ? meta.labelId : savedTx.category;
    const typeLabel = savedTx.type === 'income' ? '🟢 Pemasukan' : '🔴 Pengeluaran';

    await sendTelegramMessage(
      chatId,
      `✅ <b>Transaksi Berhasil Dicatat!</b>\n\n${typeLabel}\n💰 <b>Jumlah:</b> ${formatIDR(savedTx.amount)}\n🏷️ <b>Kategori:</b> ${categoryLabel}\n📝 <b>Deskripsi:</b> ${savedTx.description}\n📅 <b>Tanggal:</b> ${savedTx.date}\n\n<i>Ketik /today atau /balance untuk mengecek saldo.</i>`
    );
  } catch (err: any) {
    if (isRateLimitError(err)) {
      console.warn('[Telegram Transaction] Gemini rate limit reached (429)');
      await sendTelegramMessage(
        chatId,
        '⚠️ AI sedang mencapai batas penggunaan. Coba lagi setelah kuota tersedia.'
      );
      return;
    }
    console.error('Error processing transaction message:', err);
    await sendTelegramMessage(
      chatId,
      `⚠️ Maaf, terjadi kendala teknis saat memproses pesan: ${err.message || 'Silakan coba lagi nanti'}`
    );
  }
}
