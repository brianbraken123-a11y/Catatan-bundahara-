/**
 * Indonesian Currency and Date formatting utilities
 */

/**
 * Format a number into Indonesian Rupiah format (e.g. Rp 25.000)
 */
export function formatIDR(amount: number, showPrefix: boolean = true): string {
  if (isNaN(amount) || amount === null || amount === undefined) {
    return showPrefix ? 'Rp 0' : '0';
  }
  const formatted = Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return showPrefix ? `Rp ${formatted}` : formatted;
}

/**
 * Parse an Indonesian number text like "25k", "1.5jt", "50rb", "100.000", "4.995.000" into numeric value
 */
export function parseIDRAmountText(text: string): number | null {
  if (!text) return null;
  const lower = text.toLowerCase().trim();

  // 1. Look for million (juta / jt) e.g., "7.5 juta", "2 jt", "1,2 juta"
  const jtMatch = lower.match(/(?:rp\.?|idr)?\s*([\d]+(?:[.,]\d+)?)\s*(?:juta|jt)\b/i);
  if (jtMatch) {
    const num = parseFloat(jtMatch[1].replace(',', '.'));
    if (!isNaN(num)) return Math.round(num * 1000000);
  }

  // 2. Look for thousand (ribu / rb / k) e.g., "500 ribu", "50rb", "18k", "25 k"
  const rbMatch = lower.match(/(?:rp\.?|idr)?\s*([\d]+(?:[.,]\d+)?)\s*(?:ribu|rb|k)\b/i);
  if (rbMatch) {
    const num = parseFloat(rbMatch[1].replace(',', '.'));
    if (!isNaN(num)) return Math.round(num * 1000);
  }

  // 3. Look for dot-separated numbers like "4.995.000" or "100.000"
  const dotFormattedMatch = lower.match(/(?:rp\.?|idr)?\s*(\d{1,3}(?:\.\d{3})+)/i);
  if (dotFormattedMatch) {
    const digits = dotFormattedMatch[1].replace(/\./g, '');
    const val = parseInt(digits, 10);
    if (!isNaN(val)) return val;
  }

  // 4. Look for raw number sequence of 4 digits or more e.g. "50000"
  const rawNumMatch = lower.match(/(?:rp\.?|idr)?\s*(\d{4,})/i);
  if (rawNumMatch) {
    const val = parseInt(rawNumMatch[1], 10);
    if (!isNaN(val)) return val;
  }

  // 5. Fallback for smaller numbers e.g. "500"
  const digitOnly = lower.replace(/[^0-9]/g, '');
  if (digitOnly.length > 0) {
    const parsed = parseInt(digitOnly, 10);
    return isNaN(parsed) ? null : parsed;
  }

  return null;
}

/**
 * Format date string (YYYY-MM-DD) into Indonesian readable format
 */
export function formatIndonesianDate(
  dateStr: string,
  options: { includeDayName?: boolean; shortMonth?: boolean } = {
    includeDayName: true,
    shortMonth: false,
  }
): string {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-').map((n) => parseInt(n, 10));
  if (!year || !month || !day) return dateStr;

  const dateObj = new Date(year, month - 1, day);
  const now = new Date();
  const todayStr = getTodayDateString();

  if (dateStr === todayStr) {
    return 'Hari ini';
  }

  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  if (dateStr === yesterdayStr) {
    return 'Kemarin';
  }

  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const months = [
    'Januari',
    'Februari',
    'Maret',
    'April',
    'Mei',
    'Juni',
    'Juli',
    'Agustus',
    'September',
    'Oktober',
    'November',
    'Desember',
  ];
  const shortMonths = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'Mei',
    'Jun',
    'Jul',
    'Ags',
    'Sep',
    'Okt',
    'Nov',
    'Des',
  ];

  const dayName = days[dateObj.getDay()];
  const monthName = options.shortMonth
    ? shortMonths[month - 1]
    : months[month - 1];

  if (options.includeDayName) {
    return `${dayName}, ${day} ${monthName} ${year}`;
  }
  return `${day} ${monthName} ${year}`;
}

/**
 * Get today's date formatted as YYYY-MM-DD in local time
 */
export function getTodayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Get month string (YYYY-MM)
 */
export function getCurrentMonthString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Format Month Year (e.g. "Oktober 2026")
 */
export function formatMonthYear(monthStr: string): string {
  if (!monthStr) return '';
  const [year, month] = monthStr.split('-').map((n) => parseInt(n, 10));
  const months = [
    'Januari',
    'Februari',
    'Maret',
    'April',
    'Mei',
    'Juni',
    'Juli',
    'Agustus',
    'September',
    'Oktober',
    'November',
    'Desember',
  ];
  return `${months[month - 1]} ${year}`;
}
