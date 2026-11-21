import type { ExcelColumnName, LoanElevenFields } from './financial.ts';
import {
  extractHtmlTitle,
  fetchApiBinaryWithRetry,
  fetchApiJsonWithRetry,
} from './fetch-retry.ts';
import type {
  DashboardResponse,
  ElevenColumnImportReport,
  FundingListResponse,
  FundingTransaction,
  LoanDetailResponse,
  LoanFilterOptions,
  LoanPayment,
  LoanRecord,
  SheetPreview,
  SyncedWorkbookInfo,
  WorkbookRecord,
} from '../types/app.ts';

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export interface LoanQueryFilters {
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

export function createApiClient(getIdToken: () => Promise<string>) {
  async function request<T>(
    url: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = await getIdToken();
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const { res, rawText, looksLikeHtml, parsedBody } =
      await fetchApiJsonWithRetry(url, {
        ...options,
        headers,
      });

    const trimmed = rawText.trim();

    if (!res.ok) {
      let errMsg = `Request failed (${res.status})`;
      let errCode: string | undefined;
      if (parsedBody && typeof parsedBody === 'object') {
        const obj = parsedBody as { error?: unknown; code?: unknown };
        if (typeof obj.error === 'string' && obj.error) errMsg = obj.error;
        if (typeof obj.code === 'string') errCode = obj.code;
      } else if (looksLikeHtml) {
        const title = extractHtmlTitle(rawText);
        const titleSuffix = title ? `, "${title}"` : '';
        if (res.status === 403) {
          errMsg = `Preview session access was blocked (HTTP 403${titleSuffix}). Please reload the full browser tab and sign in again.`;
        } else {
          errMsg = `Server is still waking up (HTTP ${res.status}${titleSuffix}). Please wait a moment and try again.`;
        }
      }
      throw new ApiError(errMsg, res.status, errCode);
    }

    if (looksLikeHtml) {
      const title = extractHtmlTitle(rawText);
      const detail = [
        `HTTP ${res.status}`,
        res.redirected ? `redirected to ${res.url}` : null,
        title ? `title: "${title}"` : null,
      ]
        .filter(Boolean)
        .join(', ');
      throw new ApiError(
        `Server did not finish starting in time (${detail}). Please retry in a few seconds.`,
        503
      );
    }

    if (parsedBody === null && trimmed) {
      throw new ApiError(
        `Server returned an invalid JSON response from ${url}. Please retry.`,
        502
      );
    }

    return parsedBody as T;
  }

  return {
    getDashboard: (params?: { startDate?: string; endDate?: string }) => {
      const qs = new URLSearchParams();
      if (params?.startDate) qs.set('startDate', params.startDate);
      if (params?.endDate) qs.set('endDate', params.endDate);
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      return request<DashboardResponse>(`/api/dashboard${suffix}`);
    },

    listWorkbooks: () =>
      request<{ workbooks: WorkbookRecord[] }>('/api/excel/workbooks'),

    uploadWorkbook: async (file: File) => {
      const fileDataBase64 = await fileToBase64(file);
      return request<{
        workbook: WorkbookRecord;
        autoImportReport: ElevenColumnImportReport | null;
        preview: Record<string, SheetPreview>;
      }>('/api/excel/upload', {
        method: 'POST',
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type,
          fileDataBase64,
        }),
      });
    },

    getWorkbookPreview: (workbookId: number) =>
      request<{
        workbook: WorkbookRecord;
        preview: Record<string, SheetPreview>;
      }>(`/api/excel/workbooks/${workbookId}/preview`),

    importWorkbookSheet: (
      workbookId: number,
      sheetName: string,
      columnOverrides?: Partial<Record<ExcelColumnName, string | null>>
    ) =>
      request<{ report: ElevenColumnImportReport }>(
        `/api/excel/workbooks/${workbookId}/import`,
        {
          method: 'POST',
          body: JSON.stringify({ sheetName, columnOverrides }),
        }
      ),

    exportWorkbook: (payload: {
      sourceWorkbookId?: number | null;
      fileName?: string;
      overwriteOriginal?: boolean;
      confirmOverwrite?: boolean;
    }) =>
      request<{ workbook: WorkbookRecord & { overwritten?: boolean } }>(
        '/api/excel/export',
        {
          method: 'POST',
          body: JSON.stringify(payload),
        }
      ),

    downloadWorkbook: async (workbookId: number, fallbackFileName: string) => {
      const token = await getIdToken();
      const res = await fetchApiBinaryWithRetry(
        `/api/excel/workbooks/${workbookId}/download`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (!res.ok || contentType.includes('text/html')) {
        let errMsg = 'Failed to download workbook.';
        try {
          const body = await res.json();
          if (body?.error) errMsg = body.error;
        } catch {
          if (contentType.includes('text/html')) {
            errMsg = 'Server is starting up. Please retry download in a moment.';
          }
        }
        throw new ApiError(errMsg, res.status);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fallbackFileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },

    deleteWorkbook: (workbookId: number) =>
      request<{ deletedId: number }>(`/api/excel/workbooks/${workbookId}`, {
        method: 'DELETE',
      }),

    listLoans: (params?: LoanQueryFilters) => {
      const qs = new URLSearchParams();
      if (params?.workbookId) qs.set('workbookId', String(params.workbookId));
      if (params?.product) qs.set('product', params.product);
      if (params?.fosName) qs.set('fosName', params.fosName);
      if (params?.bkt) qs.set('bkt', params.bkt);
      if (params?.receiptMode) qs.set('receiptMode', params.receiptMode);
      if (params?.receiptDateFrom) qs.set('receiptDateFrom', params.receiptDateFrom);
      if (params?.receiptDateTo) qs.set('receiptDateTo', params.receiptDateTo);
      if (params?.receivedDateFrom) qs.set('receivedDateFrom', params.receivedDateFrom);
      if (params?.receivedDateTo) qs.set('receivedDateTo', params.receivedDateTo);
      if (params?.search) qs.set('search', params.search);
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      return request<{ loans: LoanRecord[]; filterOptions: LoanFilterOptions }>(
        `/api/loans${suffix}`
      );
    },

    searchLoans: (params: {
      q: string;
      mode: 'partial' | 'exact';
      field: 'all' | 'loan' | 'customerName';
    }) => {
      const qs = new URLSearchParams({
        q: params.q,
        mode: params.mode,
        field: params.field,
      });
      return request<{
        loans: LoanRecord[];
        query: string;
        mode: string;
        field: string;
      }>(`/api/loans/search?${qs.toString()}`);
    },

    createLoan: (payload: LoanElevenFields & { workbookId?: number | null }) =>
      request<{ loan: LoanRecord; syncedWorkbook: SyncedWorkbookInfo | null }>(
        '/api/loans',
        {
          method: 'POST',
          body: JSON.stringify(payload),
        }
      ),

    getLoanDetail: (id: number) =>
      request<LoanDetailResponse>(`/api/loans/${id}`),

    updateLoan: (id: number, payload: Partial<LoanElevenFields>) =>
      request<{ loan: LoanRecord; syncedWorkbook: SyncedWorkbookInfo | null }>(
        `/api/loans/${id}`,
        {
          method: 'PATCH',
          body: JSON.stringify(payload),
        }
      ),

    deleteLoan: (id: number) =>
      request<{ deletedId: number; syncedWorkbook: SyncedWorkbookInfo | null }>(
        `/api/loans/${id}`,
        {
          method: 'DELETE',
        }
      ),

    addLoanPayment: (
      loanRecordId: number,
      payload: {
        amount: number;
        paymentDate: string;
        paymentMethod?: string | null;
        referenceNumber?: string | null;
        notes?: string | null;
      }
    ) =>
      request<{
        payment: LoanPayment;
        formattedAmount: string;
      }>(`/api/loans/${loanRecordId}/payments`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),

    deleteLoanPayment: (loanRecordId: number, paymentId: number) =>
      request<{ deletedId: number }>(
        `/api/loans/${loanRecordId}/payments/${paymentId}`,
        { method: 'DELETE' }
      ),

    listFunding: (params?: {
      startDate?: string;
      endDate?: string;
      search?: string;
    }) => {
      const qs = new URLSearchParams();
      if (params?.startDate) qs.set('startDate', params.startDate);
      if (params?.endDate) qs.set('endDate', params.endDate);
      if (params?.search) qs.set('search', params.search);
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      return request<FundingListResponse>(`/api/funding${suffix}`);
    },

    createFunding: (payload: {
      fundingSource: string;
      amount: number;
      fundingDate: string;
      referenceDetails?: string | null;
      notes?: string | null;
    }) =>
      request<{ transaction: FundingTransaction }>('/api/funding', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),

    updateFunding: (
      fundingId: number,
      payload: {
        fundingSource: string;
        amount: number;
        fundingDate: string;
        referenceDetails?: string | null;
        notes?: string | null;
      }
    ) =>
      request<{ transaction: FundingTransaction }>(`/api/funding/${fundingId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),

    deleteFunding: (fundingId: number) =>
      request<{ deletedId: number }>(`/api/funding/${fundingId}`, {
        method: 'DELETE',
      }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
