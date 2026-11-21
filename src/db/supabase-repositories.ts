import path from 'path';
import type { PostgrestError } from '@supabase/supabase-js';
import type { ExcelCellValue } from './schema.ts';
import {
  EXCEL_COLUMNS,
  formatCurrency,
  isValidIsoDate,
  parseFlexibleDateToIso,
  parseNumericValue,
  roundCurrency,
  type ExcelColumnName,
  type LoanElevenFields,
} from '../lib/financial.ts';
import {
  buildExportWorkbookBuffer,
  matchCanonicalColumnName,
  parseWorkbookBuffer,
} from '../lib/excel.ts';
import {
  ensureStorageBucketExists,
  getSupabaseAdmin,
} from '../lib/supabase.ts';

export class DomainError extends Error {
  statusCode: number;
  code?: string;
  constructor(message: string, statusCode = 400, code?: string) {
    super(message);
    this.name = 'DomainError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface ElevenColumnImportReport {
  inserted: number;
  repeatedLoanNumbers: Array<{
    rowNumber: number;
    loan: string;
    note: string;
  }>;
  errors: Array<{
    rowNumber: number;
    reason: string;
  }>;
}

export interface LoanRecordDto extends LoanElevenFields {
  id: number;
  workbookId: number | null;
  sheetName: string | null;
  sourceRowNumber: number | null;
  emiNumeric: number | null;
  totalPaid: number;
  paymentCount: number;
  lastPaymentDate: string | null;
  paymentStatus: string;
  columnOrder: string[];
  rawData: Record<string, ExcelCellValue>;
  createdAt: string;
  updatedAt: string;
}

export interface LoanFilterOptionsDto {
  products: string[];
  fosNames: string[];
  bkts: string[];
  receiptModes: string[];
}

export interface LoanPaymentDto {
  id: number;
  loanId: number;
  amount: number;
  paymentDate: string;
  paymentMethod: string | null;
  referenceNumber: string | null;
  notes: string | null;
  createdAt: string;
}

export interface FundingDto {
  id: number;
  fundingSource: string;
  amount: number;
  fundingDate: string;
  referenceDetails: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DbWorkbookRow {
  id: number;
  user_id: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  kind: string;
  storage_path: string;
  sheet_names: string[];
  active_sheet: string | null;
  column_headers: string[];
  column_mapping: Record<string, string | null> | null;
  source_workbook_id: number | null;
  row_count: number;
  imported_count: number;
  duplicate_count: number;
  failed_count: number;
  import_report: ElevenColumnImportReport | null;
  created_at: string;
  updated_at: string;
}

interface DbLoanRow {
  id: number;
  user_id: string;
  workbook_id: number | null;
  sheet_name: string | null;
  source_row_number: number | null;
  loan: string;
  emi: string | null;
  emi_numeric: number | string | null;
  customer_name: string | null;
  fos_name: string | null;
  bkt: string | null;
  banking_remarks: string | null;
  receipt_date: string | null;
  receipt_mode: string | null;
  received_date: string | null;
  received_remarks: string | null;
  product: string | null;
  payment_status: string;
  column_order: string[];
  raw_data: Record<string, ExcelCellValue>;
  created_at: string;
  updated_at: string;
}

interface DbPaymentRow {
  id: number;
  user_id: string;
  loan_id: number;
  amount: number | string;
  payment_date: string;
  payment_method: string | null;
  reference_number: string | null;
  notes: string | null;
  created_at: string;
}

interface DbFundingRow {
  id: number;
  user_id: string;
  funding_source: string;
  amount: number | string;
  funding_date: string;
  reference_details: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function handleSupabaseError(error: PostgrestError, fallback: string): never {
  const msg = String(error?.message || '');
  const msgLower = msg.toLowerCase();
  const code = String(error?.code || '');

  if (
    code === '42P01' ||
    code === 'PGRST205' ||
    code === 'PGRST204' ||
    code === '42703' ||
    (code === '23502' && msgLower.includes('loan_identifier')) ||
    msgLower.includes('could not find the table') ||
    msgLower.includes('schema cache') ||
    msgLower.includes('does not exist')
  ) {
    throw new DomainError(
      `Supabase database schema needs to be initialized or updated (${code || 'SCHEMA'}: ${msg}). Please run the full supabase/schema.sql script in your Supabase Dashboard → SQL Editor, then retry.`,
      422,
      'DB_SCHEMA_UPDATE_REQUIRED'
    );
  }

  if (code === '42501' || msgLower.includes('row-level security')) {
    throw new DomainError(
      `Supabase Row Level Security blocked this operation (${code || 'RLS'}: ${msg}). Please run the full supabase/schema.sql script in your Supabase Dashboard → SQL Editor to ensure all RLS policies and table grants are active.`,
      422,
      'DB_RLS_POLICY_REQUIRED'
    );
  }

  const detail = msg ? ` (${code ? `${code}: ` : ''}${msg})` : '';
  throw new DomainError(`${fallback}${detail}`, 400, 'DB_ERROR');
}

function sanitizeStorageFileName(fileName: string): string {
  const base = path.basename(fileName || 'workbook.xlsx');
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  return safe || 'workbook.xlsx';
}

function sanitizePostgrestFilterTerm(raw: string): string {
  return raw
    .replace(/[,()*"\\]/g, ' ')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .trim();
}

function cellToPreservedString(val: ExcelCellValue | undefined): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val);
  return s.trim() === '' ? null : s;
}

function buildCanonicalRawData(
  fields: LoanElevenFields,
  existingRaw?: Record<string, ExcelCellValue>
): Record<string, ExcelCellValue> {
  return {
    ...(existingRaw || {}),
    LOAN: fields.loan,
    EMI: fields.emi,
    'Customer Name': fields.customerName,
    'FOS NAME': fields.fosName,
    BKT: fields.bkt,
    'Banking Remarks': fields.bankingRemarks,
    'Receipt Date': fields.receiptDate,
    'Receipt Mode': fields.receiptMode,
    'Received Date': fields.receivedDate,
    'Received Remarks': fields.receivedRemarks,
    Product: fields.product,
  };
}

function mapWorkbookDto(wb: DbWorkbookRow) {
  return {
    id: Number(wb.id),
    fileName: wb.file_name,
    mimeType: wb.mime_type,
    fileSize: wb.file_size,
    kind: wb.kind,
    sheetNames: wb.sheet_names || [],
    activeSheet: wb.active_sheet,
    columnHeaders: wb.column_headers || [],
    columnMapping: wb.column_mapping ?? null,
    sourceWorkbookId: wb.source_workbook_id ? Number(wb.source_workbook_id) : null,
    rowCount: wb.row_count ?? 0,
    importedCount: wb.imported_count ?? 0,
    duplicateCount: wb.duplicate_count ?? 0,
    failedCount: wb.failed_count ?? 0,
    importReport: wb.import_report ?? null,
    createdAt: wb.created_at,
    updatedAt: wb.updated_at,
  };
}

function hydrateLoanDto(
  row: DbLoanRow,
  agg?: { totalPaid: number; paymentCount: number; lastPaymentDate: string | null }
): LoanRecordDto {
  const totalPaid = agg?.totalPaid ?? 0;
  const paymentCount = agg?.paymentCount ?? 0;
  const parsedEmi =
    row.emi_numeric !== null && row.emi_numeric !== undefined
      ? roundCurrency(parseFloat(String(row.emi_numeric)))
      : parseNumericValue(row.emi);

  const fields: LoanElevenFields = {
    loan: row.loan || '',
    emi: row.emi ?? null,
    customerName: row.customer_name ?? null,
    fosName: row.fos_name ?? null,
    bkt: row.bkt ?? null,
    bankingRemarks: row.banking_remarks ?? null,
    receiptDate: row.receipt_date ?? null,
    receiptMode: row.receipt_mode ?? null,
    receivedDate: row.received_date ?? null,
    receivedRemarks: row.received_remarks ?? null,
    product: row.product ?? null,
  };

  return {
    id: Number(row.id),
    workbookId: row.workbook_id ? Number(row.workbook_id) : null,
    sheetName: row.sheet_name,
    sourceRowNumber: row.source_row_number,
    ...fields,
    emiNumeric: parsedEmi,
    totalPaid,
    paymentCount,
    lastPaymentDate: agg?.lastPaymentDate ?? null,
    paymentStatus: paymentCount > 0 ? 'Payments Logged' : 'Recorded',
    columnOrder:
      row.column_order && row.column_order.length > 0
        ? row.column_order
        : [...EXCEL_COLUMNS],
    rawData: buildCanonicalRawData(fields, row.raw_data || {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function fetchAllUserLoans(
  userId: string,
  options?: { workbookId?: number; preserveSheetOrder?: boolean }
): Promise<DbLoanRow[]> {
  const admin = getSupabaseAdmin();
  const pageSize = 1000;
  const rows: DbLoanRow[] = [];
  let offset = 0;

  while (true) {
    let query = admin
      .from('loans')
      .select('*')
      .eq('user_id', userId);

    if (options?.workbookId) {
      query = query.eq('workbook_id', options.workbookId);
    }

    if (options?.preserveSheetOrder) {
      query = query
        .order('source_row_number', { ascending: true, nullsFirst: false })
        .order('id', { ascending: true });
    } else {
      query = query
        .order('updated_at', { ascending: false })
        .order('id', { ascending: false });
    }

    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error) {
      handleSupabaseError(error, 'Unable to load loan records.');
    }

    const batch = (data || []) as DbLoanRow[];
    rows.push(...batch);
    if (batch.length < pageSize) {
      break;
    }
    offset += pageSize;
  }

  return rows;
}

async function getPaymentAggregatesByUser(userId: string) {
  const admin = getSupabaseAdmin();
  const pageSize = 1000;
  const allPayRows: Array<{
    loan_id: number;
    amount: number | string;
    payment_date: string;
  }> = [];
  let offset = 0;

  while (true) {
    const { data, error } = await admin
      .from('loan_payments')
      .select('loan_id, amount, payment_date')
      .eq('user_id', userId)
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      handleSupabaseError(error, 'Unable to load payment totals.');
    }

    const batch = (data || []) as Array<{
      loan_id: number;
      amount: number | string;
      payment_date: string;
    }>;
    allPayRows.push(...batch);
    if (batch.length < pageSize) {
      break;
    }
    offset += pageSize;
  }

  const map = new Map<
    number,
    { totalPaid: number; paymentCount: number; lastPaymentDate: string | null }
  >();

  for (const row of allPayRows) {
    const lid = Number(row.loan_id);
    const amt = parseFloat(String(row.amount || 0)) || 0;
    const prev = map.get(lid) || {
      totalPaid: 0,
      paymentCount: 0,
      lastPaymentDate: null,
    };
    const nextDate =
      !prev.lastPaymentDate || row.payment_date > prev.lastPaymentDate
        ? row.payment_date
        : prev.lastPaymentDate;

    map.set(lid, {
      totalPaid: roundCurrency(prev.totalPaid + amt),
      paymentCount: prev.paymentCount + 1,
      lastPaymentDate: nextDate,
    });
  }

  return map;
}

export interface SyncedWorkbookDto {
  id: number;
  fileName: string;
  updatedAt: string;
}

/**
 * Rebuilds the stored Excel workbook (.xlsx) in Supabase Storage from the
 * latest database rows belonging to that workbook, keeping all edits synced
 * directly into the Excel sheet while preserving the exact 11-column schema.
 */
export async function syncWorkbookExcelInStorage(
  userId: string,
  workbookId: number
): Promise<SyncedWorkbookDto | null> {
  const admin = getSupabaseAdmin();
  const { data: wbData, error: wbErr } = await admin
    .from('excel_workbooks')
    .select('*')
    .eq('id', workbookId)
    .eq('user_id', userId)
    .maybeSingle();

  if (wbErr || !wbData) {
    return null;
  }

  const wb = wbData as DbWorkbookRow;
  let sourceFileBase64 = '';
  try {
    const existingBuf = await downloadBufferFromStorage(wb.storage_path);
    sourceFileBase64 = existingBuf.toString('base64');
  } catch {
    sourceFileBase64 = '';
  }

  const loanRows = await fetchAllUserLoans(userId, {
    workbookId,
    preserveSheetOrder: true,
  });

  const exportLoans = loanRows.map((row) => hydrateLoanDto(row));
  const exportBuild = buildExportWorkbookBuffer({
    loans: exportLoans,
    sourceWorkbook: sourceFileBase64
      ? {
          fileDataBase64: sourceFileBase64,
          activeSheet: wb.active_sheet,
          sheetNames: wb.sheet_names || [],
        }
      : null,
  });

  await uploadBufferToStorage({
    storagePath: wb.storage_path,
    buffer: exportBuild.buffer,
    contentType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    upsert: true,
  });

  const updatedAt = new Date().toISOString();
  await admin
    .from('excel_workbooks')
    .update({
      file_size: exportBuild.buffer.length,
      sheet_names: exportBuild.sheetNames,
      active_sheet: exportBuild.primarySheetName,
      column_headers: exportBuild.columnHeaders,
      row_count: exportBuild.rowCount,
      updated_at: updatedAt,
    })
    .eq('id', wb.id)
    .eq('user_id', userId);

  return {
    id: Number(wb.id),
    fileName: wb.file_name,
    updatedAt,
  };
}

/**
 * Automatically imports any uploaded workbook that has not yet been imported
 * into public.loans so users can immediately search and edit records after
 * uploading an Excel sheet.
 */
async function ensureUploadedWorkbooksImported(userId: string): Promise<void> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('excel_workbooks')
    .select('id, active_sheet, sheet_names, imported_count, failed_count')
    .eq('user_id', userId)
    .eq('kind', 'upload')
    .eq('imported_count', 0)
    .eq('failed_count', 0);

  if (error || !data || data.length === 0) {
    return;
  }

  for (const wb of data as Array<{
    id: number;
    active_sheet: string | null;
    sheet_names: string[];
  }>) {
    try {
      const sheetName = wb.active_sheet || wb.sheet_names?.[0];
      if (!sheetName) continue;
      await importWorkbookSheet({
        userId,
        workbookId: Number(wb.id),
        sheetName,
      });
    } catch {
      // Non-fatal: workbook may require manual column override in Excel Management
    }
  }
}

function isBucketNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const msg = String((err as { message?: unknown }).message || '').toLowerCase();
  const status = String((err as { statusCode?: unknown; status?: unknown }).statusCode || (err as { status?: unknown }).status || '');
  return msg.includes('bucket not found') || (msg.includes('bucket') && status === '404');
}

function isStoragePolicyError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const msg = String((err as { message?: unknown }).message || '').toLowerCase();
  const status = String((err as { statusCode?: unknown; status?: unknown }).statusCode || (err as { status?: unknown }).status || '');
  return (
    msg.includes('row-level security') ||
    msg.includes('unauthorized') ||
    msg.includes('permission') ||
    status === '403'
  );
}

async function uploadBufferToStorage(params: {
  storagePath: string;
  buffer: Buffer;
  contentType: string;
  upsert: boolean;
}): Promise<string> {
  const admin = getSupabaseAdmin();
  const bucket = await ensureStorageBucketExists();

  const attemptUpload = () =>
    admin.storage.from(bucket).upload(params.storagePath, params.buffer, {
      contentType: params.contentType,
      upsert: params.upsert,
    });

  let { error: uploadErr } = await attemptUpload();

  // If the bucket doesn't exist yet, attempt one automatic creation in case permissions allow it
  if (uploadErr && isBucketNotFoundError(uploadErr)) {
    const { error: createErr } = await admin.storage.createBucket(bucket, {
      public: false,
      fileSizeLimit: 26214400, // 25 MB
    });
    if (!createErr || createErr.message.toLowerCase().includes('already exists')) {
      const retry = await attemptUpload();
      uploadErr = retry.error;
    }
  }

  if (uploadErr) {
    const detail = uploadErr.message || 'Unknown Supabase Storage error.';
    if (isBucketNotFoundError(uploadErr)) {
      throw new DomainError(
        `Supabase Storage bucket "${bucket}" was not found (${detail}). Create the private "${bucket}" bucket and Storage policies in your Supabase SQL Editor (using supabase/schema.sql), then retry.`,
        422,
        'STORAGE_BUCKET_MISSING'
      );
    }
    if (isStoragePolicyError(uploadErr)) {
      throw new DomainError(
        `Supabase Storage access was blocked by Row Level Security on bucket "${bucket}" (${detail}). Run the Storage policies in supabase/schema.sql in your Supabase SQL Editor, then retry.`,
        422,
        'STORAGE_POLICY_MISSING'
      );
    }
    throw new DomainError(
      `Unable to store Excel file in Supabase Storage (${detail}).`,
      422,
      'STORAGE_UPLOAD_FAILED'
    );
  }

  return bucket;
}

async function downloadBufferFromStorage(storagePath: string): Promise<Buffer> {
  const admin = getSupabaseAdmin();
  const bucket = await ensureStorageBucketExists();
  const { data, error } = await admin.storage.from(bucket).download(storagePath);

  if (error || !data) {
    const detail = error?.message || 'Unknown Supabase Storage error.';
    if (isBucketNotFoundError(error)) {
      throw new DomainError(
        `Supabase Storage bucket "${bucket}" was not found (${detail}). Run the Storage setup in supabase/schema.sql in your Supabase SQL Editor.`,
        422,
        'STORAGE_BUCKET_MISSING'
      );
    }
    if (isStoragePolicyError(error)) {
      throw new DomainError(
        `Supabase Storage download blocked by Row Level Security on bucket "${bucket}" (${detail}). Run the Storage policies in supabase/schema.sql.`,
        422,
        'STORAGE_POLICY_MISSING'
      );
    }
    throw new DomainError(
      `Unable to retrieve workbook file from Supabase Storage (${detail}).`,
      404
    );
  }

  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ============================================================================
// EXCEL WORKBOOKS (ORIGINAL UPLOAD, EXACT 11-COLUMN IMPORT & EXPORT)
// ============================================================================

export async function createUploadedWorkbook(params: {
  userId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  buffer: Buffer;
}) {
  const parsed = parseWorkbookBuffer(params.buffer);
  if (parsed.sheetNames.length === 0) {
    throw new DomainError('The uploaded Excel file contains no worksheets.', 400);
  }

  const firstSheet =
    parsed.sheetNames.find((name) =>
      parsed.sheets[name]?.matchedExpectedColumns.includes('LOAN')
    ) || parsed.sheetNames[0];
  const firstSheetData = parsed.sheets[firstSheet];

  const admin = getSupabaseAdmin();
  const safeName = sanitizeStorageFileName(params.fileName);
  const storagePath = `${params.userId}/uploads/${Date.now()}_${safeName}`;

  const bucket = await uploadBufferToStorage({
    storagePath,
    buffer: params.buffer,
    contentType: params.mimeType,
    upsert: false,
  });

  const { data, error } = await admin
    .from('excel_workbooks')
    .insert({
      user_id: params.userId,
      file_name: params.fileName,
      mime_type: params.mimeType,
      file_size: params.fileSize,
      kind: 'upload',
      storage_path: storagePath,
      sheet_names: parsed.sheetNames,
      active_sheet: firstSheet,
      column_headers: firstSheetData?.headers ?? [],
      column_mapping: null,
      row_count: firstSheetData?.rowCount ?? 0,
      imported_count: 0,
      duplicate_count: 0,
      failed_count: 0,
      import_report: null,
    })
    .select('*')
    .single();

  if (error || !data) {
    await admin.storage.from(bucket).remove([storagePath]);
    handleSupabaseError(
      error || ({ message: 'Insert failed', code: '' } as PostgrestError),
      'Unable to save workbook record in Supabase.'
    );
  }

  let wb = data as DbWorkbookRow;
  let autoImportReport: ElevenColumnImportReport | null = null;

  // Auto-import immediately whenever a LOAN column is matched so records are
  // searchable and editable right after upload without needing an extra click.
  if (
    firstSheetData &&
    firstSheetData.rowCount > 0 &&
    firstSheetData.matchedExpectedColumns.includes('LOAN')
  ) {
    try {
      autoImportReport = await importWorkbookSheet({
        userId: params.userId,
        workbookId: Number(wb.id),
        sheetName: firstSheet,
      });
      const { data: refreshed } = await admin
        .from('excel_workbooks')
        .select('*')
        .eq('id', wb.id)
        .eq('user_id', params.userId)
        .maybeSingle();
      if (refreshed) {
        wb = refreshed as DbWorkbookRow;
      }
    } catch {
      autoImportReport = null;
    }
  }

  return {
    workbook: mapWorkbookDto(wb),
    autoImportReport,
    preview: Object.fromEntries(
      parsed.sheetNames.map((name) => {
        const s = parsed.sheets[name];
        return [
          name,
          {
            name: s.name,
            headers: s.headers,
            matchedExpectedColumns: s.matchedExpectedColumns,
            missingExpectedColumns: s.missingExpectedColumns,
            extraColumns: s.extraColumns,
            rowCount: s.rowCount,
            previewRows: s.rows.slice(0, 100),
          },
        ];
      })
    ),
  };
}

export async function listWorkbooks(userId: string) {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('excel_workbooks')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    handleSupabaseError(error, 'Unable to load workbook records.');
  }

  return ((data || []) as DbWorkbookRow[]).map(mapWorkbookDto);
}

export async function getWorkbookWithPreview(userId: string, workbookId: number) {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('excel_workbooks')
    .select('*')
    .eq('id', workbookId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    handleSupabaseError(error, 'Unable to load workbook metadata.');
  }
  if (!data) {
    throw new DomainError('Workbook not found.', 404);
  }

  const wb = data as DbWorkbookRow;
  const buffer = await downloadBufferFromStorage(wb.storage_path);
  const parsed = parseWorkbookBuffer(buffer);

  return {
    workbook: mapWorkbookDto(wb),
    preview: Object.fromEntries(
      parsed.sheetNames.map((name) => {
        const s = parsed.sheets[name];
        return [
          name,
          {
            name: s.name,
            headers: s.headers,
            matchedExpectedColumns: s.matchedExpectedColumns,
            missingExpectedColumns: s.missingExpectedColumns,
            extraColumns: s.extraColumns,
            rowCount: s.rowCount,
            previewRows: s.rows.slice(0, 100),
          },
        ];
      })
    ),
  };
}

export async function getWorkbookBinary(userId: string, workbookId: number) {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('excel_workbooks')
    .select('*')
    .eq('id', workbookId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    handleSupabaseError(error, 'Unable to load workbook metadata.');
  }
  if (!data) {
    throw new DomainError('Workbook file not found.', 404);
  }

  const wb = data as DbWorkbookRow;
  const buffer = await downloadBufferFromStorage(wb.storage_path);

  return {
    id: Number(wb.id),
    fileName: wb.file_name,
    mimeType: wb.mime_type,
    storagePath: wb.storage_path,
    activeSheet: wb.active_sheet,
    columnHeaders: wb.column_headers || [],
    sheetNames: wb.sheet_names || [],
    fileDataBase64: buffer.toString('base64'),
    buffer,
  };
}

export async function importWorkbookSheet(params: {
  userId: string;
  workbookId: number;
  sheetName: string;
  columnOverrides?: Partial<Record<ExcelColumnName, string | null>>;
}) {
  const admin = getSupabaseAdmin();
  const { data: wbData, error: wbErr } = await admin
    .from('excel_workbooks')
    .select('*')
    .eq('id', params.workbookId)
    .eq('user_id', params.userId)
    .maybeSingle();

  if (wbErr) {
    handleSupabaseError(wbErr, 'Unable to load workbook.');
  }
  if (!wbData) {
    throw new DomainError('Workbook not found.', 404);
  }

  const wb = wbData as DbWorkbookRow;
  const buffer = await downloadBufferFromStorage(wb.storage_path);
  const parsed = parseWorkbookBuffer(buffer);
  const sheet = parsed.sheets[params.sheetName];

  if (!sheet) {
    throw new DomainError(
      `Sheet "${params.sheetName}" does not exist in this workbook.`,
      400
    );
  }

  // Resolve exact 11 columns automatically from header names (or explicit override)
  const resolvedHeaders: Record<ExcelColumnName, string | null> = {
    LOAN: null,
    EMI: null,
    'Customer Name': null,
    'FOS NAME': null,
    BKT: null,
    'Banking Remarks': null,
    'Receipt Date': null,
    'Receipt Mode': null,
    'Received Date': null,
    'Received Remarks': null,
    Product: null,
  };

  for (const header of sheet.headers) {
    const canonical = matchCanonicalColumnName(header);
    if (canonical && !resolvedHeaders[canonical]) {
      resolvedHeaders[canonical] = header;
    }
  }

  if (params.columnOverrides) {
    for (const col of EXCEL_COLUMNS) {
      const override = params.columnOverrides[col];
      if (override && sheet.headers.includes(override)) {
        resolvedHeaders[col] = override;
      }
    }
  }

  const loanHeader = resolvedHeaders.LOAN;
  if (!loanHeader) {
    throw new DomainError(
      'Column "LOAN" was not found in the selected worksheet. Verify the sheet headers match the 11 required columns.',
      400
    );
  }

  // Track existing LOAN numbers strictly for informational reporting — NEVER overwrite or drop!
  const { data: existingLoans, error: existingErr } = await admin
    .from('loans')
    .select('loan')
    .eq('user_id', params.userId);

  if (existingErr) {
    handleSupabaseError(existingErr, 'Unable to inspect existing loan records.');
  }

  const existingLoanSet = new Set(
    ((existingLoans || []) as Array<{ loan: string }>).map((l) =>
      (l.loan || '').trim().toLowerCase()
    )
  );
  const fileLoanCounts = new Map<string, number>();

  const report: ElevenColumnImportReport = {
    inserted: 0,
    repeatedLoanNumbers: [],
    errors: [],
  };

  const recordsToInsert: Array<Record<string, unknown>> = [];

  for (const row of sheet.rows) {
    const getVal = (col: ExcelColumnName): string | null => {
      const hdr = resolvedHeaders[col];
      if (!hdr) return null;
      return cellToPreservedString(row.values[hdr]);
    };

    const loanVal = getVal('LOAN');
    if (!loanVal || !loanVal.trim()) {
      report.errors.push({
        rowNumber: row.rowNumber,
        reason: `Row ${row.rowNumber} is missing a value in the "LOAN" column.`,
      });
      continue;
    }

    const loanClean = loanVal.trim();
    const normLoan = loanClean.toLowerCase();
    const seenInFile = fileLoanCounts.get(normLoan) || 0;
    fileLoanCounts.set(normLoan, seenInFile + 1);

    if (seenInFile > 0) {
      report.repeatedLoanNumbers.push({
        rowNumber: row.rowNumber,
        loan: loanClean,
        note: 'Repeated LOAN number within workbook — imported as separate record with unique ID.',
      });
    } else if (existingLoanSet.has(normLoan)) {
      report.repeatedLoanNumbers.push({
        rowNumber: row.rowNumber,
        loan: loanClean,
        note: 'LOAN number already exists in database — imported as separate record without overwriting.',
      });
    }

    const emiStr = getVal('EMI');
    const emiNum = parseNumericValue(emiStr);

    const fields: LoanElevenFields = {
      loan: loanClean,
      emi: emiStr,
      customerName: getVal('Customer Name'),
      fosName: getVal('FOS NAME'),
      bkt: getVal('BKT'),
      bankingRemarks: getVal('Banking Remarks'),
      receiptDate: getVal('Receipt Date'),
      receiptMode: getVal('Receipt Mode'),
      receivedDate: getVal('Received Date'),
      receivedRemarks: getVal('Received Remarks'),
      product: getVal('Product'),
    };

    // Preserve all original row values (never discard any Excel data)
    const preservedRaw = buildCanonicalRawData(fields, row.values);

    recordsToInsert.push({
      user_id: params.userId,
      workbook_id: wb.id,
      sheet_name: params.sheetName,
      source_row_number: row.rowNumber,
      loan: fields.loan,
      emi: fields.emi,
      emi_numeric: emiNum !== null ? emiNum.toFixed(2) : null,
      customer_name: fields.customerName,
      fos_name: fields.fosName,
      bkt: fields.bkt,
      banking_remarks: fields.bankingRemarks,
      receipt_date: fields.receiptDate,
      receipt_mode: fields.receiptMode,
      received_date: fields.receivedDate,
      received_remarks: fields.receivedRemarks,
      product: fields.product,
      payment_status: 'Recorded',
      column_order: [...EXCEL_COLUMNS],
      raw_data: preservedRaw,
    });
  }

  const chunkSize = 200;
  for (let i = 0; i < recordsToInsert.length; i += chunkSize) {
    const chunk = recordsToInsert.slice(i, i + chunkSize);
    if (chunk.length > 0) {
      const { error: insertErr } = await admin.from('loans').insert(chunk);
      if (insertErr) {
        handleSupabaseError(
          insertErr,
          'Unable to import records from this worksheet.'
        );
      }
    }
  }

  report.inserted = recordsToInsert.length;

  const { error: updateErr } = await admin
    .from('excel_workbooks')
    .update({
      active_sheet: params.sheetName,
      column_headers: sheet.headers,
      column_mapping: resolvedHeaders,
      row_count: sheet.rowCount,
      imported_count: (wb.imported_count || 0) + report.inserted,
      duplicate_count: report.repeatedLoanNumbers.length,
      failed_count: report.errors.length,
      import_report: report,
      updated_at: new Date().toISOString(),
    })
    .eq('id', wb.id)
    .eq('user_id', params.userId);

  if (updateErr) {
    handleSupabaseError(
      updateErr,
      'Records imported, but workbook import summary failed to update.'
    );
  }

  return report;
}

export async function saveExportedWorkbook(params: {
  userId: string;
  fileName: string;
  buffer: Buffer;
  sheetNames: string[];
  activeSheet: string;
  columnHeaders: string[];
  rowCount: number;
  sourceWorkbookId: number | null;
  overwriteSourceWorkbook: boolean;
}) {
  const admin = getSupabaseAdmin();
  const bucket = await ensureStorageBucketExists();
  const contentType =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  if (params.overwriteSourceWorkbook && params.sourceWorkbookId) {
    const { data: existing, error: fetchErr } = await admin
      .from('excel_workbooks')
      .select('*')
      .eq('id', params.sourceWorkbookId)
      .eq('user_id', params.userId)
      .maybeSingle();

    if (fetchErr) {
      handleSupabaseError(fetchErr, 'Unable to inspect source workbook.');
    }
    if (!existing) {
      throw new DomainError('Source workbook not found for overwrite.', 404);
    }

    const src = existing as DbWorkbookRow;
    await uploadBufferToStorage({
      storagePath: src.storage_path,
      buffer: params.buffer,
      contentType,
      upsert: true,
    });

    const { data: updated, error: updateErr } = await admin
      .from('excel_workbooks')
      .update({
        file_size: params.buffer.length,
        sheet_names: params.sheetNames,
        active_sheet: params.activeSheet,
        column_headers: params.columnHeaders,
        row_count: params.rowCount,
        updated_at: new Date().toISOString(),
      })
      .eq('id', src.id)
      .eq('user_id', params.userId)
      .select('*')
      .single();

    if (updateErr || !updated) {
      handleSupabaseError(
        updateErr || ({ message: 'Update failed', code: '' } as PostgrestError),
        'Unable to update overwritten workbook record.'
      );
    }

    return {
      ...mapWorkbookDto(updated as DbWorkbookRow),
      overwritten: true,
    };
  }

  const safeName = sanitizeStorageFileName(params.fileName);
  const storagePath = `${params.userId}/exports/${Date.now()}_${safeName}`;

  const exportBucket = await uploadBufferToStorage({
    storagePath,
    buffer: params.buffer,
    contentType,
    upsert: false,
  });

  const { data: inserted, error: insertErr } = await admin
    .from('excel_workbooks')
    .insert({
      user_id: params.userId,
      file_name: params.fileName,
      mime_type: contentType,
      file_size: params.buffer.length,
      kind: 'export',
      storage_path: storagePath,
      sheet_names: params.sheetNames,
      active_sheet: params.activeSheet,
      column_headers: params.columnHeaders,
      column_mapping: null,
      source_workbook_id: params.sourceWorkbookId,
      row_count: params.rowCount,
      imported_count: params.rowCount,
      duplicate_count: 0,
      failed_count: 0,
      import_report: null,
    })
    .select('*')
    .single();

  if (insertErr || !inserted) {
    await admin.storage.from(exportBucket).remove([storagePath]);
    handleSupabaseError(
      insertErr || ({ message: 'Insert failed', code: '' } as PostgrestError),
      'Unable to save exported workbook metadata.'
    );
  }

  return {
    ...mapWorkbookDto(inserted as DbWorkbookRow),
    overwritten: false,
  };
}

export async function deleteWorkbookById(userId: string, workbookId: number) {
  const admin = getSupabaseAdmin();
  const { data: existing, error: fetchErr } = await admin
    .from('excel_workbooks')
    .select('id, storage_path')
    .eq('id', workbookId)
    .eq('user_id', userId)
    .maybeSingle();

  if (fetchErr) {
    handleSupabaseError(fetchErr, 'Unable to locate workbook.');
  }
  if (!existing) {
    throw new DomainError('Workbook not found.', 404);
  }

  const { error: delErr } = await admin
    .from('excel_workbooks')
    .delete()
    .eq('id', workbookId)
    .eq('user_id', userId);

  if (delErr) {
    handleSupabaseError(delErr, 'Unable to delete workbook.');
  }

  try {
    const bucket = await ensureStorageBucketExists();
    if (existing.storage_path) {
      await admin.storage.from(bucket).remove([existing.storage_path]);
    }
  } catch (storageErr) {
    console.error('Non-fatal error deleting workbook file from storage:', storageErr);
  }

  return { deletedId: Number(existing.id) };
}

// ============================================================================
// LOANS: LIST, FILTER (Product, FOS NAME, BKT, Receipt Mode, Dates) & SEARCH
// ============================================================================

export interface LoanListFilters {
  workbookId?: number;
  product?: string;
  fosName?: string;
  bkt?: string;
  receiptMode?: string;
  receiptDateFrom?: string;
  receiptDateTo?: string;
  receivedDateFrom?: string;
  receivedDateTo?: string;
  search?: string;
}

export async function listLoans(
  userId: string,
  filters?: LoanListFilters
): Promise<{ loans: LoanRecordDto[]; filterOptions: LoanFilterOptionsDto }> {
  await ensureUploadedWorkbooksImported(userId);

  const [allRows, aggMap] = await Promise.all([
    fetchAllUserLoans(userId),
    getPaymentAggregatesByUser(userId),
  ]);

  // Build dynamic distinct filter options from actual database values
  const productSet = new Set<string>();
  const fosSet = new Set<string>();
  const bktSet = new Set<string>();
  const receiptModeSet = new Set<string>();

  for (const r of allRows) {
    if (r.product && r.product.trim()) productSet.add(r.product.trim());
    if (r.fos_name && r.fos_name.trim()) fosSet.add(r.fos_name.trim());
    if (r.bkt && r.bkt.trim()) bktSet.add(r.bkt.trim());
    if (r.receipt_mode && r.receipt_mode.trim()) {
      receiptModeSet.add(r.receipt_mode.trim());
    }
  }

  const filterOptions: LoanFilterOptionsDto = {
    products: Array.from(productSet).sort((a, b) => a.localeCompare(b)),
    fosNames: Array.from(fosSet).sort((a, b) => a.localeCompare(b)),
    bkts: Array.from(bktSet).sort((a, b) => a.localeCompare(b)),
    receiptModes: Array.from(receiptModeSet).sort((a, b) => a.localeCompare(b)),
  };

  let filtered = allRows;

  if (filters?.workbookId) {
    filtered = filtered.filter((r) => Number(r.workbook_id) === filters.workbookId);
  }
  if (filters?.product && filters.product.trim()) {
    const target = filters.product.trim().toLowerCase();
    filtered = filtered.filter(
      (r) => (r.product || '').trim().toLowerCase() === target
    );
  }
  if (filters?.fosName && filters.fosName.trim()) {
    const target = filters.fosName.trim().toLowerCase();
    filtered = filtered.filter(
      (r) => (r.fos_name || '').trim().toLowerCase() === target
    );
  }
  if (filters?.bkt && filters.bkt.trim()) {
    const target = filters.bkt.trim().toLowerCase();
    filtered = filtered.filter(
      (r) => (r.bkt || '').trim().toLowerCase() === target
    );
  }
  if (filters?.receiptMode && filters.receiptMode.trim()) {
    const target = filters.receiptMode.trim().toLowerCase();
    filtered = filtered.filter(
      (r) => (r.receipt_mode || '').trim().toLowerCase() === target
    );
  }
  if (filters?.search && filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    filtered = filtered.filter(
      (r) =>
        (r.loan || '').toLowerCase().includes(q) ||
        (r.customer_name || '').toLowerCase().includes(q) ||
        (r.fos_name || '').toLowerCase().includes(q) ||
        (r.product || '').toLowerCase().includes(q)
    );
  }

  // Flexible date filtering on Receipt Date & Received Date (preserving original Excel formats)
  const rcptFrom =
    filters?.receiptDateFrom && isValidIsoDate(filters.receiptDateFrom)
      ? filters.receiptDateFrom
      : null;
  const rcptTo =
    filters?.receiptDateTo && isValidIsoDate(filters.receiptDateTo)
      ? filters.receiptDateTo
      : null;
  if (rcptFrom || rcptTo) {
    filtered = filtered.filter((r) => {
      const iso = parseFlexibleDateToIso(r.receipt_date);
      if (!iso) return false;
      if (rcptFrom && iso < rcptFrom) return false;
      if (rcptTo && iso > rcptTo) return false;
      return true;
    });
  }

  const rcvdFrom =
    filters?.receivedDateFrom && isValidIsoDate(filters.receivedDateFrom)
      ? filters.receivedDateFrom
      : null;
  const rcvdTo =
    filters?.receivedDateTo && isValidIsoDate(filters.receivedDateTo)
      ? filters.receivedDateTo
      : null;
  if (rcvdFrom || rcvdTo) {
    filtered = filtered.filter((r) => {
      const iso = parseFlexibleDateToIso(r.received_date);
      if (!iso) return false;
      if (rcvdFrom && iso < rcvdFrom) return false;
      if (rcvdTo && iso > rcvdTo) return false;
      return true;
    });
  }

  return {
    loans: filtered.map((row) => hydrateLoanDto(row, aggMap.get(Number(row.id)))),
    filterOptions,
  };
}

function normalizeLoanCompact(value: string | null | undefined): string {
  return (value || '').replace(/[\s,_-]+/g, '').toLowerCase();
}

export async function searchLoansByLoanOrCustomer(params: {
  userId: string;
  query: string;
  mode: 'partial' | 'exact';
  field: 'all' | 'loan' | 'customerName';
}): Promise<LoanRecordDto[]> {
  const q = params.query.trim();
  if (!q) return [];

  await ensureUploadedWorkbooksImported(params.userId);

  const safe = sanitizePostgrestFilterTerm(q);
  if (!safe) return [];

  const admin = getSupabaseAdmin();
  let dbQuery = admin
    .from('loans')
    .select('*')
    .eq('user_id', params.userId)
    .order('source_row_number', { ascending: true, nullsFirst: false })
    .order('id', { ascending: true });

  const pattern = params.mode === 'exact' ? safe : `%${safe}%`;

  if (params.field === 'loan') {
    dbQuery = dbQuery.ilike('loan', pattern);
  } else if (params.field === 'customerName') {
    dbQuery = dbQuery.ilike('customer_name', pattern);
  } else {
    dbQuery = dbQuery.or(`loan.ilike.${pattern},customer_name.ilike.${pattern}`);
  }

  const [{ data, error }, aggMap] = await Promise.all([
    dbQuery,
    getPaymentAggregatesByUser(params.userId),
  ]);

  if (error) {
    handleSupabaseError(error, 'Unable to search loan records.');
  }

  const lowerQ = q.toLowerCase();
  const compactQ = normalizeLoanCompact(q);
  const compactQNoLeadingZeros = compactQ.replace(/^0+/, '');

  const matchesRow = (row: DbLoanRow): boolean => {
    const loanStr = (row.loan || '').trim().toLowerCase();
    const custStr = (row.customer_name || '').trim().toLowerCase();
    const loanCompact = normalizeLoanCompact(row.loan);
    const loanNoZeros = loanCompact.replace(/^0+/, '');

    const loanExact =
      loanStr === lowerQ ||
      (compactQ !== '' && loanCompact === compactQ) ||
      (compactQNoLeadingZeros !== '' && loanNoZeros === compactQNoLeadingZeros);
    const loanPartial =
      loanStr.includes(lowerQ) ||
      (compactQ !== '' && loanCompact.includes(compactQ));

    const custExact = custStr === lowerQ;
    const custPartial = custStr.includes(lowerQ);

    if (params.mode === 'exact') {
      if (params.field === 'loan') return loanExact;
      if (params.field === 'customerName') return custExact;
      return loanExact || custExact;
    }
    if (params.field === 'loan') return loanPartial;
    if (params.field === 'customerName') return custPartial;
    return loanPartial || custPartial;
  };

  let rows = ((data || []) as DbLoanRow[]).filter(matchesRow);

  // Fallback scan across all user loans when formatting differs (e.g. commas,
  // spaces, dashes, or leading zeros in Excel LOAN cells) or >1,000 rows exist.
  if (rows.length === 0) {
    const allRows = await fetchAllUserLoans(params.userId, {
      preserveSheetOrder: true,
    });
    rows = allRows.filter(matchesRow);
  }

  return rows.map((row) => hydrateLoanDto(row, aggMap.get(Number(row.id))));
}

export async function getLoanByIdWithPayments(userId: string, id: number) {
  const admin = getSupabaseAdmin();
  const { data: loanData, error: loanErr } = await admin
    .from('loans')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();

  if (loanErr) {
    handleSupabaseError(loanErr, 'Unable to load loan record.');
  }
  if (!loanData) {
    throw new DomainError('Loan record not found.', 404);
  }

  const loanRow = loanData as DbLoanRow;

  const [paymentsRes, workbookRes, siblingCountRes] = await Promise.all([
    admin
      .from('loan_payments')
      .select('*')
      .eq('loan_id', id)
      .eq('user_id', userId)
      .order('payment_date', { ascending: false })
      .order('id', { ascending: false }),
    loanRow.workbook_id
      ? admin
          .from('excel_workbooks')
          .select('id, file_name, active_sheet')
          .eq('id', loanRow.workbook_id)
          .eq('user_id', userId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    admin
      .from('loans')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('loan', loanRow.loan),
  ]);

  if (paymentsRes.error) {
    handleSupabaseError(paymentsRes.error, 'Unable to load payment history.');
  }

  const paymentsRows = (paymentsRes.data || []) as DbPaymentRow[];
  const totalPaid = roundCurrency(
    paymentsRows.reduce((acc, p) => acc + (parseFloat(String(p.amount)) || 0), 0)
  );
  const lastPaymentDate =
    paymentsRows.length > 0 ? paymentsRows[0].payment_date : null;

  const hydrated = hydrateLoanDto(loanRow, {
    totalPaid,
    paymentCount: paymentsRows.length,
    lastPaymentDate,
  });

  const payments: LoanPaymentDto[] = paymentsRows.map((p) => ({
    id: Number(p.id),
    loanId: Number(p.loan_id),
    amount: roundCurrency(parseFloat(String(p.amount)) || 0),
    paymentDate: p.payment_date,
    paymentMethod: p.payment_method,
    referenceNumber: p.reference_number,
    notes: p.notes,
    createdAt: p.created_at,
  }));

  const wb = workbookRes.data as {
    id: number;
    file_name: string;
    active_sheet: string | null;
  } | null;

  return {
    loan: hydrated,
    sameLoanRecordCount: siblingCountRes.count ?? 1,
    workbook: wb
      ? { id: Number(wb.id), fileName: wb.file_name, activeSheet: wb.active_sheet }
      : null,
    payments,
  };
}

export async function createManualLoan(
  userId: string,
  payload: LoanElevenFields & { workbookId?: number | null }
): Promise<{ loan: LoanRecordDto; syncedWorkbook: SyncedWorkbookDto | null }> {
  const loanClean = (payload.loan || '').trim();
  if (!loanClean) {
    throw new DomainError('LOAN number is required.', 400);
  }

  const cleanOrNull = (v: string | null | undefined) => {
    if (v === null || v === undefined) return null;
    return v.trim() === '' ? null : v.trim();
  };

  const fields: LoanElevenFields = {
    loan: loanClean,
    emi: cleanOrNull(payload.emi),
    customerName: cleanOrNull(payload.customerName),
    fosName: cleanOrNull(payload.fosName),
    bkt: cleanOrNull(payload.bkt),
    bankingRemarks: cleanOrNull(payload.bankingRemarks),
    receiptDate: cleanOrNull(payload.receiptDate),
    receiptMode: cleanOrNull(payload.receiptMode),
    receivedDate: cleanOrNull(payload.receivedDate),
    receivedRemarks: cleanOrNull(payload.receivedRemarks),
    product: cleanOrNull(payload.product),
  };

  const emiNum = parseNumericValue(fields.emi);
  const linkedWorkbookId =
    payload.workbookId && Number.isInteger(payload.workbookId) && payload.workbookId > 0
      ? payload.workbookId
      : null;

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('loans')
    .insert({
      user_id: userId,
      workbook_id: linkedWorkbookId,
      sheet_name: null,
      source_row_number: null,
      loan: fields.loan,
      emi: fields.emi,
      emi_numeric: emiNum !== null ? emiNum.toFixed(2) : null,
      customer_name: fields.customerName,
      fos_name: fields.fosName,
      bkt: fields.bkt,
      banking_remarks: fields.bankingRemarks,
      receipt_date: fields.receiptDate,
      receipt_mode: fields.receiptMode,
      received_date: fields.receivedDate,
      received_remarks: fields.receivedRemarks,
      product: fields.product,
      payment_status: 'Recorded',
      column_order: [...EXCEL_COLUMNS],
      raw_data: buildCanonicalRawData(fields),
    })
    .select('*')
    .single();

  if (error || !data) {
    handleSupabaseError(
      error || ({ message: 'Insert failed', code: '' } as PostgrestError),
      'Unable to create loan record.'
    );
  }

  let syncedWorkbook: SyncedWorkbookDto | null = null;
  if (linkedWorkbookId) {
    try {
      syncedWorkbook = await syncWorkbookExcelInStorage(userId, linkedWorkbookId);
    } catch (syncErr) {
      console.error('Non-fatal Excel sync error after loan create:', syncErr);
    }
  }

  return {
    loan: hydrateLoanDto(data as DbLoanRow, {
      totalPaid: 0,
      paymentCount: 0,
      lastPaymentDate: null,
    }),
    syncedWorkbook,
  };
}

export async function updateLoanRecord(
  userId: string,
  id: number,
  payload: Partial<LoanElevenFields>
): Promise<{ loan: LoanRecordDto; syncedWorkbook: SyncedWorkbookDto | null }> {
  const admin = getSupabaseAdmin();
  const { data: existingData, error: existingErr } = await admin
    .from('loans')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();

  if (existingErr) {
    handleSupabaseError(existingErr, 'Unable to load loan record.');
  }
  if (!existingData) {
    throw new DomainError('Loan record not found.', 404);
  }

  const current = existingData as DbLoanRow;

  const cleanOpt = (
    incoming: string | null | undefined,
    fallback: string | null
  ): string | null => {
    if (incoming === undefined) return fallback;
    if (incoming === null) return null;
    return incoming.trim() === '' ? null : incoming.trim();
  };

  const nextLoan =
    payload.loan !== undefined ? payload.loan.trim() : current.loan;
  if (!nextLoan) {
    throw new DomainError('LOAN number cannot be empty.', 400);
  }

  const fields: LoanElevenFields = {
    loan: nextLoan,
    emi: cleanOpt(payload.emi, current.emi),
    customerName: cleanOpt(payload.customerName, current.customer_name),
    fosName: cleanOpt(payload.fosName, current.fos_name),
    bkt: cleanOpt(payload.bkt, current.bkt),
    bankingRemarks: cleanOpt(payload.bankingRemarks, current.banking_remarks),
    receiptDate: cleanOpt(payload.receiptDate, current.receipt_date),
    receiptMode: cleanOpt(payload.receiptMode, current.receipt_mode),
    receivedDate: cleanOpt(payload.receivedDate, current.received_date),
    receivedRemarks: cleanOpt(payload.receivedRemarks, current.received_remarks),
    product: cleanOpt(payload.product, current.product),
  };

  const emiNum = parseNumericValue(fields.emi);

  const { data: updated, error: updateErr } = await admin
    .from('loans')
    .update({
      loan: fields.loan,
      emi: fields.emi,
      emi_numeric: emiNum !== null ? emiNum.toFixed(2) : null,
      customer_name: fields.customerName,
      fos_name: fields.fosName,
      bkt: fields.bkt,
      banking_remarks: fields.bankingRemarks,
      receipt_date: fields.receiptDate,
      receipt_mode: fields.receiptMode,
      received_date: fields.receivedDate,
      received_remarks: fields.receivedRemarks,
      product: fields.product,
      raw_data: buildCanonicalRawData(fields, current.raw_data || {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*')
    .single();

  if (updateErr || !updated) {
    handleSupabaseError(
      updateErr || ({ message: 'Update failed', code: '' } as PostgrestError),
      'Unable to save loan changes.'
    );
  }

  const updatedRow = updated as DbLoanRow;

  const [{ data: payRows }, syncedWorkbook] = await Promise.all([
    admin
      .from('loan_payments')
      .select('amount, payment_date')
      .eq('loan_id', id)
      .eq('user_id', userId),
    updatedRow.workbook_id
      ? syncWorkbookExcelInStorage(userId, Number(updatedRow.workbook_id)).catch(
          (syncErr) => {
            console.error('Non-fatal Excel sync error after loan update:', syncErr);
            return null;
          }
        )
      : Promise.resolve(null),
  ]);

  const paymentsList = (payRows || []) as Array<{
    amount: number | string;
    payment_date: string;
  }>;
  const totalPaid = roundCurrency(
    paymentsList.reduce((acc, p) => acc + (parseFloat(String(p.amount)) || 0), 0)
  );
  const lastPaymentDate =
    paymentsList.length > 0
      ? paymentsList.reduce(
          (max, p) => (p.payment_date > max ? p.payment_date : max),
          paymentsList[0].payment_date
        )
      : null;

  return {
    loan: hydrateLoanDto(updatedRow, {
      totalPaid,
      paymentCount: paymentsList.length,
      lastPaymentDate,
    }),
    syncedWorkbook,
  };
}

export async function deleteLoanRecord(userId: string, id: number) {
  const admin = getSupabaseAdmin();
  const { data: existing } = await admin
    .from('loans')
    .select('id, workbook_id')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();

  const { data, error } = await admin
    .from('loans')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .select('id');

  if (error) {
    handleSupabaseError(error, 'Unable to delete loan record.');
  }
  if (!data || data.length === 0) {
    throw new DomainError('Loan record not found.', 404);
  }

  let syncedWorkbook: SyncedWorkbookDto | null = null;
  if (existing?.workbook_id) {
    try {
      syncedWorkbook = await syncWorkbookExcelInStorage(
        userId,
        Number(existing.workbook_id)
      );
    } catch (syncErr) {
      console.error('Non-fatal Excel sync error after loan delete:', syncErr);
    }
  }

  return { deletedId: Number(data[0].id), syncedWorkbook };
}

// ============================================================================
// PAYMENTS (SEPARATE EXPLICIT PAYMENT TRANSACTIONS — NEVER ASSUMED FROM EMI)
// ============================================================================

export async function addLoanPaymentTransaction(params: {
  userId: string;
  loanRecordId: number;
  amount: number;
  paymentDate: string;
  paymentMethod?: string | null;
  referenceNumber?: string | null;
  notes?: string | null;
}) {
  const amount = roundCurrency(params.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new DomainError('Payment amount must be greater than 0.', 400);
  }

  if (!params.paymentDate || !isValidIsoDate(params.paymentDate)) {
    throw new DomainError(
      'Please provide a valid payment date (YYYY-MM-DD).',
      400
    );
  }

  const admin = getSupabaseAdmin();
  const { data: loanData, error: loanErr } = await admin
    .from('loans')
    .select('id')
    .eq('id', params.loanRecordId)
    .eq('user_id', params.userId)
    .maybeSingle();

  if (loanErr) {
    handleSupabaseError(loanErr, 'Unable to verify loan record.');
  }
  if (!loanData) {
    throw new DomainError('Loan record not found.', 404);
  }

  const { data: insertedPayment, error: insertErr } = await admin
    .from('loan_payments')
    .insert({
      user_id: params.userId,
      loan_id: params.loanRecordId,
      amount: amount.toFixed(2),
      payment_date: params.paymentDate,
      payment_method: params.paymentMethod?.trim() || null,
      reference_number: params.referenceNumber?.trim() || null,
      notes: params.notes?.trim() || null,
    })
    .select('*')
    .single();

  if (insertErr || !insertedPayment) {
    handleSupabaseError(
      insertErr || ({ message: 'Insert failed', code: '' } as PostgrestError),
      'Unable to record payment transaction.'
    );
  }

  await admin
    .from('loans')
    .update({
      payment_status: 'Payments Logged',
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.loanRecordId)
    .eq('user_id', params.userId);

  const payment = insertedPayment as DbPaymentRow;
  return {
    payment: {
      id: Number(payment.id),
      loanId: Number(payment.loan_id),
      amount: roundCurrency(parseFloat(String(payment.amount)) || 0),
      paymentDate: payment.payment_date,
      paymentMethod: payment.payment_method,
      referenceNumber: payment.reference_number,
      notes: payment.notes,
      createdAt: payment.created_at,
    },
    formattedAmount: formatCurrency(amount),
  };
}

export async function deleteLoanPaymentTransaction(
  userId: string,
  loanRecordId: number,
  paymentId: number
) {
  const admin = getSupabaseAdmin();
  const { data: deleted, error: delErr } = await admin
    .from('loan_payments')
    .delete()
    .eq('id', paymentId)
    .eq('loan_id', loanRecordId)
    .eq('user_id', userId)
    .select('id');

  if (delErr) {
    handleSupabaseError(delErr, 'Unable to remove payment transaction.');
  }
  if (!deleted || deleted.length === 0) {
    throw new DomainError('Payment transaction not found.', 404);
  }

  const { count } = await admin
    .from('loan_payments')
    .select('id', { count: 'exact', head: true })
    .eq('loan_id', loanRecordId)
    .eq('user_id', userId);

  await admin
    .from('loans')
    .update({
      payment_status: (count || 0) > 0 ? 'Payments Logged' : 'Recorded',
      updated_at: new Date().toISOString(),
    })
    .eq('id', loanRecordId)
    .eq('user_id', userId);

  return { deletedId: Number(deleted[0].id) };
}

// ============================================================================
// FUNDING MANAGEMENT (STRICTLY SEPARATE FROM LOAN REPAYMENTS)
// ============================================================================

export async function listFundingTransactions(
  userId: string,
  filters?: { startDate?: string; endDate?: string; search?: string }
) {
  const admin = getSupabaseAdmin();
  let filteredQuery = admin
    .from('funding_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('funding_date', { ascending: false })
    .order('id', { ascending: false });

  if (filters?.startDate && isValidIsoDate(filters.startDate)) {
    filteredQuery = filteredQuery.gte('funding_date', filters.startDate);
  }
  if (filters?.endDate && isValidIsoDate(filters.endDate)) {
    filteredQuery = filteredQuery.lte('funding_date', filters.endDate);
  }
  if (filters?.search && filters.search.trim()) {
    const safe = sanitizePostgrestFilterTerm(filters.search);
    if (safe) {
      filteredQuery = filteredQuery.or(
        `funding_source.ilike.%${safe}%,reference_details.ilike.%${safe}%,notes.ilike.%${safe}%`
      );
    }
  }

  const [{ data: filteredData, error: filtErr }, { data: allData, error: allErr }] =
    await Promise.all([
      filteredQuery,
      admin
        .from('funding_transactions')
        .select('amount')
        .eq('user_id', userId),
    ]);

  if (filtErr) {
    handleSupabaseError(filtErr, 'Unable to load funding records.');
  }
  if (allErr) {
    handleSupabaseError(allErr, 'Unable to calculate total funding.');
  }

  const items: FundingDto[] = ((filteredData || []) as DbFundingRow[]).map((f) => ({
    id: Number(f.id),
    fundingSource: f.funding_source,
    amount: roundCurrency(parseFloat(String(f.amount)) || 0),
    fundingDate: f.funding_date,
    referenceDetails: f.reference_details,
    notes: f.notes,
    createdAt: f.created_at,
    updatedAt: f.updated_at,
  }));

  const filteredTotal = roundCurrency(
    items.reduce((sum, item) => sum + item.amount, 0)
  );
  const allList = (allData || []) as Array<{ amount: number | string }>;
  const allTimeTotal = roundCurrency(
    allList.reduce((sum, item) => sum + (parseFloat(String(item.amount)) || 0), 0)
  );

  const byDate = new Map<string, number>();
  for (const item of items) {
    byDate.set(
      item.fundingDate,
      roundCurrency((byDate.get(item.fundingDate) || 0) + item.amount)
    );
  }
  const sortedDates = Array.from(byDate.keys()).sort();
  let cumulative = 0;
  const timeline = sortedDates.map((date) => {
    const amount = byDate.get(date) || 0;
    cumulative = roundCurrency(cumulative + amount);
    return { date, amount, cumulative };
  });

  return {
    transactions: items,
    filteredTotal,
    allTimeTotal,
    totalCount: allList.length,
    timeline,
  };
}

export async function createFundingTransaction(
  userId: string,
  payload: {
    fundingSource: string;
    amount: number;
    fundingDate: string;
    referenceDetails?: string | null;
    notes?: string | null;
  }
): Promise<FundingDto> {
  const fundingSource = payload.fundingSource.trim();
  if (!fundingSource) {
    throw new DomainError('Funding source is required.', 400);
  }
  const amount = roundCurrency(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new DomainError('Funding amount must be greater than 0.', 400);
  }
  if (!payload.fundingDate || !isValidIsoDate(payload.fundingDate)) {
    throw new DomainError('Please enter a valid funding date (YYYY-MM-DD).', 400);
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('funding_transactions')
    .insert({
      user_id: userId,
      funding_source: fundingSource,
      amount: amount.toFixed(2),
      funding_date: payload.fundingDate,
      reference_details: payload.referenceDetails?.trim() || null,
      notes: payload.notes?.trim() || null,
    })
    .select('*')
    .single();

  if (error || !data) {
    handleSupabaseError(
      error || ({ message: 'Insert failed', code: '' } as PostgrestError),
      'Unable to save funding record.'
    );
  }

  const f = data as DbFundingRow;
  return {
    id: Number(f.id),
    fundingSource: f.funding_source,
    amount: roundCurrency(parseFloat(String(f.amount)) || 0),
    fundingDate: f.funding_date,
    referenceDetails: f.reference_details,
    notes: f.notes,
    createdAt: f.created_at,
    updatedAt: f.updated_at,
  };
}

export async function updateFundingTransaction(
  userId: string,
  fundingId: number,
  payload: {
    fundingSource: string;
    amount: number;
    fundingDate: string;
    referenceDetails?: string | null;
    notes?: string | null;
  }
): Promise<FundingDto> {
  const fundingSource = payload.fundingSource.trim();
  if (!fundingSource) {
    throw new DomainError('Funding source is required.', 400);
  }
  const amount = roundCurrency(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new DomainError('Funding amount must be greater than 0.', 400);
  }
  if (!payload.fundingDate || !isValidIsoDate(payload.fundingDate)) {
    throw new DomainError('Please enter a valid funding date (YYYY-MM-DD).', 400);
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('funding_transactions')
    .update({
      funding_source: fundingSource,
      amount: amount.toFixed(2),
      funding_date: payload.fundingDate,
      reference_details: payload.referenceDetails?.trim() || null,
      notes: payload.notes?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', fundingId)
    .eq('user_id', userId)
    .select('*')
    .maybeSingle();

  if (error) {
    handleSupabaseError(error, 'Unable to update funding record.');
  }
  if (!data) {
    throw new DomainError('Funding record not found.', 404);
  }

  const f = data as DbFundingRow;
  return {
    id: Number(f.id),
    fundingSource: f.funding_source,
    amount: roundCurrency(parseFloat(String(f.amount)) || 0),
    fundingDate: f.funding_date,
    referenceDetails: f.reference_details,
    notes: f.notes,
    createdAt: f.created_at,
    updatedAt: f.updated_at,
  };
}

export async function deleteFundingTransaction(
  userId: string,
  fundingId: number
) {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('funding_transactions')
    .delete()
    .eq('id', fundingId)
    .eq('user_id', userId)
    .select('id');

  if (error) {
    handleSupabaseError(error, 'Unable to delete funding record.');
  }
  if (!data || data.length === 0) {
    throw new DomainError('Funding record not found.', 404);
  }

  return { deletedId: Number(data[0].id) };
}

// ============================================================================
// DASHBOARD ANALYTICS (DYNAMIC FROM SUPABASE — NEVER TREATING EMI AS PAID)
// ============================================================================

export async function getDashboardAnalytics(
  userId: string,
  filters?: { startDate?: string; endDate?: string }
) {
  const startDate =
    filters?.startDate && isValidIsoDate(filters.startDate)
      ? filters.startDate
      : undefined;
  const endDate =
    filters?.endDate && isValidIsoDate(filters.endDate)
      ? filters.endDate
      : undefined;

  const admin = getSupabaseAdmin();

  let paymentsQuery = admin
    .from('loan_payments')
    .select('*')
    .eq('user_id', userId)
    .order('payment_date', { ascending: false })
    .order('id', { ascending: false });
  if (startDate) paymentsQuery = paymentsQuery.gte('payment_date', startDate);
  if (endDate) paymentsQuery = paymentsQuery.lte('payment_date', endDate);

  let fundingQuery = admin
    .from('funding_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('funding_date', { ascending: false })
    .order('id', { ascending: false });
  if (startDate) fundingQuery = fundingQuery.gte('funding_date', startDate);
  if (endDate) fundingQuery = fundingQuery.lte('funding_date', endDate);

  await ensureUploadedWorkbooksImported(userId);

  const [allLoans, allPaymentAggMap, paymentsRes, fundingRes] =
    await Promise.all([
      fetchAllUserLoans(userId),
      getPaymentAggregatesByUser(userId),
      paymentsQuery,
      fundingQuery,
    ]);

  if (paymentsRes.error) {
    handleSupabaseError(paymentsRes.error, 'Unable to load dashboard payments.');
  }
  if (fundingRes.error) {
    handleSupabaseError(fundingRes.error, 'Unable to load dashboard funding.');
  }

  const filteredPayments = (paymentsRes.data || []) as DbPaymentRow[];
  const filteredFunding = (fundingRes.data || []) as DbFundingRow[];

  const loanLookup = new Map<number, DbLoanRow>();
  const distinctLoanNumbers = new Set<string>();
  const productCounts: Record<string, number> = {};
  let totalScheduledEmi = 0;
  let totalAllTimePayments = 0;

  for (const loan of allLoans) {
    const lid = Number(loan.id);
    loanLookup.set(lid, loan);
    if (loan.loan && loan.loan.trim()) {
      distinctLoanNumbers.add(loan.loan.trim().toLowerCase());
    }
    const prod = (loan.product || '').trim() || 'Unspecified';
    productCounts[prod] = (productCounts[prod] || 0) + 1;

    const emiVal =
      loan.emi_numeric !== null && loan.emi_numeric !== undefined
        ? parseFloat(String(loan.emi_numeric))
        : parseNumericValue(loan.emi);
    if (emiVal !== null && Number.isFinite(emiVal)) {
      totalScheduledEmi = roundCurrency(totalScheduledEmi + emiVal);
    }

    const agg = allPaymentAggMap.get(lid);
    if (agg) {
      totalAllTimePayments = roundCurrency(totalAllTimePayments + agg.totalPaid);
    }
  }

  const totalPaymentsInRange = roundCurrency(
    filteredPayments.reduce(
      (sum, p) => sum + (parseFloat(String(p.amount)) || 0),
      0
    )
  );
  const totalFundingInRange = roundCurrency(
    filteredFunding.reduce(
      (sum, f) => sum + (parseFloat(String(f.amount)) || 0),
      0
    )
  );

  const paymentByDate = new Map<string, number>();
  for (const p of filteredPayments) {
    paymentByDate.set(
      p.payment_date,
      roundCurrency(
        (paymentByDate.get(p.payment_date) || 0) +
          (parseFloat(String(p.amount)) || 0)
      )
    );
  }
  const paymentTrends = Array.from(paymentByDate.keys())
    .sort()
    .map((date) => ({
      date,
      amount: paymentByDate.get(date) || 0,
    }));

  const fundingByDate = new Map<string, number>();
  for (const f of filteredFunding) {
    fundingByDate.set(
      f.funding_date,
      roundCurrency(
        (fundingByDate.get(f.funding_date) || 0) +
          (parseFloat(String(f.amount)) || 0)
      )
    );
  }
  const fundingTrends = Array.from(fundingByDate.keys())
    .sort()
    .map((date) => ({
      date,
      amount: fundingByDate.get(date) || 0,
    }));

  return {
    metrics: {
      totalLoanRecords: allLoans.length,
      distinctLoanNumbers: distinctLoanNumbers.size,
      totalScheduledEmi,
      totalPaymentsReceived:
        startDate || endDate ? totalPaymentsInRange : totalAllTimePayments,
      allTimePaymentsReceived: totalAllTimePayments,
      totalFundingReceived: totalFundingInRange,
      productBreakdown: productCounts,
    },
    paymentTrends,
    fundingTrends,
    recentLoanUpdates: allLoans
      .slice(0, 8)
      .map((row) => hydrateLoanDto(row, allPaymentAggMap.get(Number(row.id)))),
    recentPayments: filteredPayments.slice(0, 8).map((p) => {
      const loanInfo = loanLookup.get(Number(p.loan_id));
      return {
        id: Number(p.id),
        loanRecordId: Number(p.loan_id),
        loanNumber: loanInfo?.loan || `#${p.loan_id}`,
        customerName: loanInfo?.customer_name ?? null,
        amount: roundCurrency(parseFloat(String(p.amount)) || 0),
        paymentDate: p.payment_date,
        paymentMethod: p.payment_method,
        referenceNumber: p.reference_number,
        createdAt: p.created_at,
      };
    }),
    recentFunding: filteredFunding.slice(0, 8).map((f) => ({
      id: Number(f.id),
      fundingSource: f.funding_source,
      amount: roundCurrency(parseFloat(String(f.amount)) || 0),
      fundingDate: f.funding_date,
      referenceDetails: f.reference_details,
      notes: f.notes,
      createdAt: f.created_at,
    })),
  };
}
