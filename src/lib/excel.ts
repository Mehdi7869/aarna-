import * as XLSX from 'xlsx';
import type { ExcelCellValue } from '../db/schema.ts';
import { EXCEL_COLUMNS, type ExcelColumnName } from './financial.ts';

export interface ParsedSheetRow {
  rowNumber: number; // 1-indexed Excel row number
  values: Record<string, ExcelCellValue>;
}

export interface ParsedSheetData {
  name: string;
  headers: string[];
  matchedExpectedColumns: string[];
  missingExpectedColumns: string[];
  extraColumns: string[];
  rowCount: number;
  rows: ParsedSheetRow[];
}

export interface ParsedWorkbookResult {
  sheetNames: string[];
  sheets: Record<string, ParsedSheetData>;
}

function normalizeHeaderKey(header: string): string {
  return header
    .trim()
    .replace(/[_.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

const FALLBACK_HEADER_ALIASES: Record<string, ExcelColumnName> = {
  loan: 'LOAN',
  'loan no': 'LOAN',
  'loan number': 'LOAN',
  'loan id': 'LOAN',
  'loan account': 'LOAN',
  'loan a/c': 'LOAN',
  'loan ac': 'LOAN',
  'agreement no': 'LOAN',
  'agreement number': 'LOAN',
  'account no': 'LOAN',
  'lan': 'LOAN',
  emi: 'EMI',
  'emi amount': 'EMI',
  'customer name': 'Customer Name',
  'cust name': 'Customer Name',
  customer: 'Customer Name',
  'borrower name': 'Customer Name',
  'fos name': 'FOS NAME',
  fos: 'FOS NAME',
  'executive name': 'FOS NAME',
  bkt: 'BKT',
  bucket: 'BKT',
  'banking remarks': 'Banking Remarks',
  'bank remarks': 'Banking Remarks',
  'receipt date': 'Receipt Date',
  'receipt mode': 'Receipt Mode',
  'received date': 'Received Date',
  'received remarks': 'Received Remarks',
  product: 'Product',
  'product name': 'Product',
};

export function matchCanonicalColumnName(header: string): ExcelColumnName | null {
  const exactNorm = header.trim().replace(/\s+/g, ' ').toLowerCase();
  for (const col of EXCEL_COLUMNS) {
    if (col.trim().replace(/\s+/g, ' ').toLowerCase() === exactNorm) {
      return col;
    }
  }
  const relaxed = normalizeHeaderKey(header);
  return FALLBACK_HEADER_ALIASES[relaxed] ?? null;
}

/**
 * Extracts a cell's value while preserving its original Excel formatting
 * (leading zeros, date formatting, text, numbers) as faithfully as possible.
 */
function readPreservedCell(cell: XLSX.CellObject | undefined): ExcelCellValue {
  if (!cell || cell.t === 'z') return null;

  // Preserve formatted text (cell.w) for dates or formatted strings/codes
  if (cell.t === 'd') {
    if (typeof cell.w === 'string' && cell.w.trim() !== '') {
      return cell.w.trim();
    }
    if (cell.v instanceof Date && !Number.isNaN(cell.v.getTime())) {
      const adjusted = new Date(cell.v.getTime() + 1000);
      const y = adjusted.getUTCFullYear();
      const m = String(adjusted.getUTCMonth() + 1).padStart(2, '0');
      const d = String(adjusted.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    return null;
  }

  if (cell.t === 'n') {
    if (typeof cell.w === 'string' && cell.w.trim() !== '') {
      const formatted = cell.w.trim();
      // Never return scientific notation (e.g. 6.65E+07) when the underlying integer is exact
      if (
        /[eE][+-]?\d+$/.test(formatted) &&
        typeof cell.v === 'number' &&
        Number.isFinite(cell.v)
      ) {
        return Number.isInteger(cell.v)
          ? String(cell.v)
          : String(Number(cell.v.toFixed(6)));
      }
      const looksLikeDate =
        /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(formatted) ||
        /^\d{1,2}[\s-/]+[a-zA-Z]{3,9}[\s-/]+\d{2,4}$/.test(formatted);
      if (looksLikeDate) {
        return formatted;
      }
      // Preserve leading-zero numeric codes (e.g. "0012345") or explicit formatted text
      if (/^0\d+$/.test(formatted)) {
        return formatted;
      }
      // Preserve formatted display string when it carries currency formatting
      if (/[₹$]/.test(formatted)) {
        return formatted;
      }
    }
    if (typeof cell.v === 'number' && Number.isFinite(cell.v)) {
      return Number.isInteger(cell.v) ? cell.v : Number(cell.v.toFixed(6));
    }
    return cell.w ? String(cell.w) : null;
  }

  if (cell.t === 'b') {
    return Boolean(cell.v);
  }

  if (cell.t === 's') {
    const text = typeof cell.v === 'string' ? cell.v : String(cell.w ?? '');
    return text === '' ? null : text;
  }

  if (cell.w !== undefined && cell.w !== '') return String(cell.w);
  if (cell.v !== undefined && cell.v !== null && cell.v !== '') return String(cell.v);
  return null;
}

export function parseWorkbookBuffer(buffer: Buffer): ParsedWorkbookResult {
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: false,
    cellNF: true,
    cellText: true,
  });

  const sheetNames = workbook.SheetNames || [];
  const sheets: Record<string, ParsedSheetData> = {};

  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet || !sheet['!ref']) {
      sheets[sheetName] = {
        name: sheetName,
        headers: [],
        matchedExpectedColumns: [],
        missingExpectedColumns: [...EXCEL_COLUMNS],
        extraColumns: [],
        rowCount: 0,
        rows: [],
      };
      continue;
    }

    const range = XLSX.utils.decode_range(sheet['!ref']);

    // Scan up to the first 15 rows to locate the actual column header row
    // (handles Excel files that have title/summary banners above the table header).
    let firstNonEmptyRow = range.s.r;
    let foundFirstNonEmpty = false;
    let bestHeaderRow = range.s.r;
    let bestMatchScore = 0;

    const scanEndRow = Math.min(range.e.r, range.s.r + 15);
    for (let r = range.s.r; r <= scanEndRow; r++) {
      let rowHasContent = false;
      const matchedInRow = new Set<ExcelColumnName>();

      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const val = readPreservedCell(sheet[addr]);
        if (val !== null && String(val).trim() !== '') {
          rowHasContent = true;
          const canonical = matchCanonicalColumnName(String(val));
          if (canonical) {
            matchedInRow.add(canonical);
          }
        }
      }

      if (rowHasContent && !foundFirstNonEmpty) {
        firstNonEmptyRow = r;
        foundFirstNonEmpty = true;
      }

      const score = matchedInRow.size + (matchedInRow.has('LOAN') ? 2 : 0);
      if (score > bestMatchScore) {
        bestMatchScore = score;
        bestHeaderRow = r;
      }
    }

    const headerRow = bestMatchScore > 0 ? bestHeaderRow : firstNonEmptyRow;

    const headers: string[] = [];
    const seenHeaders = new Map<string, number>();

    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r: headerRow, c });
      const rawHeader = readPreservedCell(sheet[addr]);
      const rawStr =
        rawHeader !== null && String(rawHeader).trim() !== ''
          ? String(rawHeader).trim()
          : '';

      if (!rawStr) {
        // Check whether column has any non-empty values below header
        let colHasData = false;
        for (let r = headerRow + 1; r <= range.e.r; r++) {
          const val = readPreservedCell(sheet[XLSX.utils.encode_cell({ r, c })]);
          if (val !== null && String(val).trim() !== '') {
            colHasData = true;
            break;
          }
        }
        if (!colHasData) {
          headers.push('');
          continue;
        }
      }

      let name = rawStr || `Column ${c - range.s.c + 1}`;
      const count = seenHeaders.get(name) || 0;
      seenHeaders.set(name, count + 1);
      if (count > 0) {
        name = `${name} (${count + 1})`;
      }
      headers.push(name);
    }

    const activeColumns: Array<{ colIdx: number; header: string }> = [];
    for (let i = 0; i < headers.length; i++) {
      if (headers[i]) {
        activeColumns.push({ colIdx: range.s.c + i, header: headers[i] });
      }
    }

    const activeHeaderNames = activeColumns.map((c) => c.header);
    const matchedCanonical = new Set<string>();
    const extraColumns: string[] = [];

    for (const h of activeHeaderNames) {
      const canonical = matchCanonicalColumnName(h);
      if (canonical) {
        matchedCanonical.add(canonical);
      } else {
        extraColumns.push(h);
      }
    }

    const matchedExpectedColumns = EXCEL_COLUMNS.filter((c) =>
      matchedCanonical.has(c)
    );
    const missingExpectedColumns = EXCEL_COLUMNS.filter(
      (c) => !matchedCanonical.has(c)
    );

    const rows: ParsedSheetRow[] = [];
    for (let r = headerRow + 1; r <= range.e.r; r++) {
      const values: Record<string, ExcelCellValue> = {};
      let hasAnyValue = false;

      for (const { colIdx, header } of activeColumns) {
        const addr = XLSX.utils.encode_cell({ r, c: colIdx });
        const val = readPreservedCell(sheet[addr]);
        if (val !== null && String(val).trim() !== '') {
          hasAnyValue = true;
        }
        values[header] = val;
      }

      if (hasAnyValue) {
        rows.push({
          rowNumber: r + 1, // 1-indexed Excel row number
          values,
        });
      }
    }

    sheets[sheetName] = {
      name: sheetName,
      headers: activeHeaderNames,
      matchedExpectedColumns,
      missingExpectedColumns,
      extraColumns,
      rowCount: rows.length,
      rows,
    };
  }

  return { sheetNames, sheets };
}

export interface ExportLoanRow {
  id: number;
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
  rawData: Record<string, ExcelCellValue>;
}

export interface ExportWorkbookOptions {
  loans: ExportLoanRow[];
  sourceWorkbook?: {
    fileDataBase64: string;
    activeSheet: string | null;
    sheetNames: string[];
  } | null;
}

/**
 * Exports the latest updated records from Supabase using the EXACT 11-column
 * Excel structure without renaming columns or inventing additional columns.
 */
export function buildExportWorkbookBuffer(options: ExportWorkbookOptions): {
  buffer: Buffer;
  sheetNames: string[];
  primarySheetName: string;
  columnHeaders: string[];
  rowCount: number;
} {
  const { loans, sourceWorkbook } = options;

  let wb: XLSX.WorkBook;
  let primarySheetName = 'Sheet1';

  if (sourceWorkbook?.fileDataBase64) {
    try {
      const originalBuffer = Buffer.from(sourceWorkbook.fileDataBase64, 'base64');
      wb = XLSX.read(originalBuffer, { type: 'buffer', cellDates: false });
      primarySheetName =
        sourceWorkbook.activeSheet &&
        wb.SheetNames.includes(sourceWorkbook.activeSheet)
          ? sourceWorkbook.activeSheet
          : wb.SheetNames[0] || 'Sheet1';
    } catch {
      wb = XLSX.utils.book_new();
    }
  } else {
    wb = XLSX.utils.book_new();
  }

  const exactHeaders = [...EXCEL_COLUMNS];

  const sheetObjects = loans.map((record) => {
    const rowObj: Record<string, string | number | boolean | null> = {
      LOAN: record.loan ?? '',
      EMI: record.emi ?? '',
      'Customer Name': record.customerName ?? '',
      'FOS NAME': record.fosName ?? '',
      BKT: record.bkt ?? '',
      'Banking Remarks': record.bankingRemarks ?? '',
      'Receipt Date': record.receiptDate ?? '',
      'Receipt Mode': record.receiptMode ?? '',
      'Received Date': record.receivedDate ?? '',
      'Received Remarks': record.receivedRemarks ?? '',
      Product: record.product ?? '',
    };
    return rowObj;
  });

  const primarySheet = XLSX.utils.json_to_sheet(sheetObjects, {
    header: exactHeaders,
  });

  primarySheet['!cols'] = [
    { wch: 18 }, // LOAN
    { wch: 14 }, // EMI
    { wch: 24 }, // Customer Name
    { wch: 20 }, // FOS NAME
    { wch: 10 }, // BKT
    { wch: 26 }, // Banking Remarks
    { wch: 16 }, // Receipt Date
    { wch: 16 }, // Receipt Mode
    { wch: 16 }, // Received Date
    { wch: 26 }, // Received Remarks
    { wch: 18 }, // Product
  ];

  if (wb.SheetNames.includes(primarySheetName)) {
    wb.Sheets[primarySheetName] = primarySheet;
  } else {
    XLSX.utils.book_append_sheet(wb, primarySheet, primarySheetName);
  }

  const outBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  return {
    buffer: outBuffer,
    sheetNames: wb.SheetNames,
    primarySheetName,
    columnHeaders: exactHeaders,
    rowCount: loans.length,
  };
}
