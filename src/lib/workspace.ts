import { Transaction, CATEGORIES_META } from '../types/finance';
import { formatMonthYear, formatIDR } from './currency';
import { getAccessToken } from './firebase';

export interface ExportResult {
  spreadsheetId: string;
  spreadsheetUrl: string;
  title: string;
  rowCount: number;
}

/**
 * Export transactions to Google Sheets using client-side OAuth Bearer token
 */
export async function exportTransactionsToGoogleSheets(
  transactions: Transaction[],
  monthStr: string // YYYY-MM
): Promise<ExportResult> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('Akses Google Workspace belum tersedia. Silakan hubungkan ulang akun Google Anda.');
  }

  const formattedMonth = formatMonthYear(monthStr);
  const title = `CatatKas - Laporan Keuangan ${formattedMonth}`;

  // 1. Create a new Spreadsheet via Sheets API v4
  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        title,
      },
      sheets: [
        {
          properties: {
            title: 'Daftar Transaksi',
            gridProperties: {
              frozenRowCount: 1,
            },
          },
        },
      ],
    }),
  });

  if (!createRes.ok) {
    const errorData = await createRes.json().catch(() => ({}));
    throw new Error(
      errorData.error?.message || `Gagal membuat Google Spreadsheet (HTTP ${createRes.status})`
    );
  }

  const sheetData = await createRes.json();
  const spreadsheetId = sheetData.spreadsheetId;
  const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

  // 2. Prepare tabular data
  const headers = [
    'Tanggal',
    'Tipe',
    'Kategori',
    'Deskripsi',
    'Jumlah (Rp)',
    'Sumber',
  ];

  let totalIncome = 0;
  let totalExpense = 0;

  const rows = transactions.map((t) => {
    const meta = CATEGORIES_META[t.category];
    const categoryName = meta ? meta.labelId : t.category;
    const typeLabel = t.type === 'income' ? 'Pemasukan' : 'Pengeluaran';

    if (t.type === 'income') totalIncome += t.amount;
    else totalExpense += t.amount;

    return [
      t.date,
      typeLabel,
      categoryName,
      t.description,
      t.amount,
      t.source === 'telegram' ? 'Telegram Bot' : 'Web App',
    ];
  });

  // Summary rows at the bottom
  const emptyRow = ['', '', '', '', '', ''];
  const summaryIncomeRow = ['', '', '', 'TOTAL PEMASUKAN', totalIncome, ''];
  const summaryExpenseRow = ['', '', '', 'TOTAL PENGELUARAN', totalExpense, ''];
  const netRow = ['', '', '', 'SALDO BERSIH', totalIncome - totalExpense, ''];

  const allValues = [headers, ...rows, emptyRow, summaryIncomeRow, summaryExpenseRow, netRow];

  // 3. Write data to the spreadsheet
  const updateRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'Daftar Transaksi'!A1:F${allValues.length}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: allValues,
      }),
    }
  );

  if (!updateRes.ok) {
    console.warn('Could not populate rows, spreadsheet created empty:', await updateRes.text());
  }

  // 4. Update file description in Google Drive
  try {
    await fetch(`https://www.googleapis.com/drive/v3/files/${spreadsheetId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        description: `Laporan keuangan otomatis diekspor oleh CatatKas pada ${new Date().toLocaleDateString('id-ID')}. Total Pemasukan: ${formatIDR(totalIncome)}, Total Pengeluaran: ${formatIDR(totalExpense)}.`,
      }),
    });
  } catch (driveErr) {
    console.warn('Drive metadata update notice:', driveErr);
  }

  return {
    spreadsheetId,
    spreadsheetUrl,
    title,
    rowCount: transactions.length,
  };
}
