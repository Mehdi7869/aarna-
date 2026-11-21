export const EXCEL_COLUMNS = [
  'LOAN',
  'EMI',
  'Customer Name',
  'FOS NAME',
  'BKT',
  'Banking Remarks',
  'Receipt Date',
  'Receipt Mode',
  'Received Date',
  'Received Remarks',
  'Product',
] as const;

export type ExcelColumnName = (typeof EXCEL_COLUMNS)[number];

export interface LoanElevenFields {
  loan: string;
  emi: string | null;
  customerName: string | null;
  fosName: string | null;
  bkt: string | null;
  bankingRemarks: string | null;
  receiptDate: string | null;
  receiptMode: string | null;
  receivedDate: string | null;
  receivedRemarks: string | null;
  product: string | null;
}

export function roundCurrency(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function parseNumericValue(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? roundCurrency(raw) : null;
  }
  if (typeof raw === 'boolean') return null;

  const str = String(raw).trim();
  if (!str) return null;

  const isAccountingNeg = /^\(.*\)$/.test(str);
  const cleaned = str
    .replace(/^\(|\)$/g, '')
    .replace(/^(?:rs\.?|inr)\s*/i, '')
    .replace(/[$€£¥₹,\s]/g, '')
    .trim();

  if (!cleaned || !/^-?\d*(\.\d+)?$/.test(cleaned)) {
    return null;
  }

  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return roundCurrency(isAccountingNeg ? -Math.abs(parsed) : parsed);
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

const MONTH_MAP: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/**
 * Parses common Indian & ISO Excel date strings (e.g. YYYY-MM-DD, DD/MM/YYYY,
 * DD-MM-YYYY, DD-MMM-YY, DD-MMM-YYYY) into YYYY-MM-DD for accurate range
 * filtering while leaving the original displayed string untouched in storage.
 */
export function parseFlexibleDateToIso(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    const candidate = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (isValidIsoDate(candidate)) return candidate;
  }

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY (or 2-digit year DD/MM/YY)
  const dmyMatch = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (dmyMatch) {
    const first = Number(dmyMatch[1]);
    const second = Number(dmyMatch[2]);
    let year = Number(dmyMatch[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;

    // Prefer DD/MM/YYYY (Indian Excel standard), fallback to MM/DD/YYYY if second > 12
    let day = first;
    let month = second;
    if (second > 12 && first <= 12) {
      month = first;
      day = second;
    }
    const candidate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (isValidIsoDate(candidate)) return candidate;
  }

  // DD-MMM-YYYY or DD-MMM-YY or DD MMM YYYY (e.g. 15-Nov-26, 04 Jan 2026)
  const textMonthMatch = s.match(/^(\d{1,2})[\s-/]+([a-zA-Z]{3,9})[\s-/]+(\d{2,4})$/);
  if (textMonthMatch) {
    const day = Number(textMonthMatch[1]);
    const monthKey = textMonthMatch[2].slice(0, 3).toLowerCase();
    const month = MONTH_MAP[monthKey];
    let year = Number(textMonthMatch[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    if (month) {
      const candidate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (isValidIsoDate(candidate)) return candidate;
    }
  }

  // Fallback native Date parse
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = parsed.getMonth() + 1;
    const d = parsed.getDate();
    if (y >= 1900 && y <= 2100) {
      const candidate = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (isValidIsoDate(candidate)) return candidate;
    }
  }

  return null;
}

export function formatCurrency(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe);
}

export function formatDateDisplay(isoOrDate: string | null | undefined): string {
  if (!isoOrDate) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoOrDate)) {
    const [y, m, d] = isoOrDate.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return new Intl.DateTimeFormat('en-IN', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      timeZone: 'UTC',
    }).format(dt);
  }
  const dt = new Date(isoOrDate);
  if (Number.isNaN(dt.getTime())) return String(isoOrDate);
  return new Intl.DateTimeFormat('en-IN', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(dt);
}

export function formatDateTimeDisplay(isoOrDate: string | null | undefined): string {
  if (!isoOrDate) return '—';
  const dt = new Date(isoOrDate);
  if (Number.isNaN(dt.getTime())) return String(isoOrDate);
  return new Intl.DateTimeFormat('en-IN', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(dt);
}
