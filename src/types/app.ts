import type { ExcelColumnName, LoanElevenFields } from '../lib/financial.ts';

export type ExcelCellValue = string | number | boolean | null;

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

export interface WorkbookRecord {
  id: number;
  fileName: string;
  mimeType: string;
  fileSize: number;
  kind: 'upload' | 'export' | string;
  sheetNames: string[];
  activeSheet: string | null;
  columnHeaders: string[];
  columnMapping: Partial<Record<ExcelColumnName, string | null>> | null;
  sourceWorkbookId: number | null;
  rowCount: number;
  importedCount: number;
  duplicateCount: number;
  failedCount: number;
  importReport: ElevenColumnImportReport | null;
  createdAt: string;
  updatedAt: string;
}

export interface SheetPreview {
  name: string;
  headers: string[];
  matchedExpectedColumns: string[];
  missingExpectedColumns: string[];
  extraColumns: string[];
  rowCount: number;
  previewRows: Array<{
    rowNumber: number;
    values: Record<string, ExcelCellValue>;
  }>;
}

export interface LoanRecord extends LoanElevenFields {
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

export interface SyncedWorkbookInfo {
  id: number;
  fileName: string;
  updatedAt: string;
}

export interface LoanFilterOptions {
  products: string[];
  fosNames: string[];
  bkts: string[];
  receiptModes: string[];
}

export interface LoanPayment {
  id: number;
  loanId: number;
  amount: number;
  paymentDate: string;
  paymentMethod: string | null;
  referenceNumber: string | null;
  notes: string | null;
  createdAt: string;
}

export interface LoanDetailResponse {
  loan: LoanRecord;
  sameLoanRecordCount: number;
  workbook: {
    id: number;
    fileName: string;
    activeSheet: string | null;
  } | null;
  payments: LoanPayment[];
}

export interface FundingTransaction {
  id: number;
  fundingSource: string;
  amount: number;
  fundingDate: string;
  referenceDetails: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FundingListResponse {
  transactions: FundingTransaction[];
  filteredTotal: number;
  allTimeTotal: number;
  totalCount: number;
  timeline: Array<{
    date: string;
    amount: number;
    cumulative: number;
  }>;
}

export interface DashboardResponse {
  metrics: {
    totalLoanRecords: number;
    distinctLoanNumbers: number;
    totalScheduledEmi: number;
    totalPaymentsReceived: number;
    allTimePaymentsReceived: number;
    totalFundingReceived: number;
    productBreakdown: Record<string, number>;
  };
  paymentTrends: Array<{ date: string; amount: number }>;
  fundingTrends: Array<{ date: string; amount: number }>;
  recentLoanUpdates: LoanRecord[];
  recentPayments: Array<{
    id: number;
    loanRecordId: number;
    loanNumber: string;
    customerName: string | null;
    amount: number;
    paymentDate: string;
    paymentMethod: string | null;
    referenceNumber: string | null;
    createdAt: string;
  }>;
  recentFunding: Array<{
    id: number;
    fundingSource: string;
    amount: number;
    fundingDate: string;
    referenceDetails: string | null;
    notes: string | null;
    createdAt: string;
  }>;
}

export type AppPage =
  | 'dashboard'
  | 'loan-search'
  | 'loan-management'
  | 'funding-management'
  | 'excel-management';
