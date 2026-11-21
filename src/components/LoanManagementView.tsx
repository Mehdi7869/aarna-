import { useCallback, useEffect, useState } from 'react';
import {
  Plus,
  X,
  RotateCcw,
  FileSpreadsheet,
  Download,
  AlertCircle,
} from 'lucide-react';
import type { ApiClient } from '../lib/api.ts';
import type {
  AppPage,
  LoanFilterOptions,
  LoanRecord,
  SyncedWorkbookInfo,
  WorkbookRecord,
} from '../types/app.ts';
import type { LoanElevenFields } from '../lib/financial.ts';
import { EditableLoanTable } from './EditableLoanTable.tsx';

interface LoanManagementViewProps {
  api: ApiClient;
  onOpenLoan: (loanId: number) => void;
  onNavigate: (page: AppPage) => void;
}

const EMPTY_FORM: LoanElevenFields = {
  loan: '',
  emi: '',
  customerName: '',
  fosName: '',
  bkt: '',
  bankingRemarks: '',
  receiptDate: '',
  receiptMode: '',
  receivedDate: '',
  receivedRemarks: '',
  product: '',
};

export function LoanManagementView({
  api,
  onOpenLoan,
  onNavigate,
}: LoanManagementViewProps) {
  const [loans, setLoans] = useState<LoanRecord[]>([]);
  const [workbooks, setWorkbooks] = useState<WorkbookRecord[]>([]);
  const [filterOptions, setFilterOptions] = useState<LoanFilterOptions>({
    products: [],
    fosNames: [],
    bkts: [],
    receiptModes: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [workbookId, setWorkbookId] = useState('');
  const [product, setProduct] = useState('');
  const [fosName, setFosName] = useState('');
  const [bkt, setBkt] = useState('');
  const [receiptMode, setReceiptMode] = useState('');
  const [receiptDateFrom, setReceiptDateFrom] = useState('');
  const [receiptDateTo, setReceiptDateTo] = useState('');
  const [receivedDateFrom, setReceivedDateFrom] = useState('');
  const [receivedDateTo, setReceivedDateTo] = useState('');

  // Add Loan Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState<LoanElevenFields>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [downloadingWbId, setDownloadingWbId] = useState<number | null>(null);

  const loadWorkbooks = useCallback(async () => {
    try {
      const res = await api.listWorkbooks();
      setWorkbooks(res.workbooks.filter((w) => w.kind === 'upload'));
    } catch {
      // Non-blocking for loan list
    }
  }, [api]);

  const loadLoans = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listLoans({
        search: search.trim() || undefined,
        workbookId: workbookId ? Number(workbookId) : undefined,
        product: product || undefined,
        fosName: fosName || undefined,
        bkt: bkt || undefined,
        receiptMode: receiptMode || undefined,
        receiptDateFrom: receiptDateFrom || undefined,
        receiptDateTo: receiptDateTo || undefined,
        receivedDateFrom: receivedDateFrom || undefined,
        receivedDateTo: receivedDateTo || undefined,
      });
      setLoans(res.loans);
      setFilterOptions(res.filterOptions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load loan records.');
    } finally {
      setLoading(false);
    }
  }, [
    api,
    search,
    workbookId,
    product,
    fosName,
    bkt,
    receiptMode,
    receiptDateFrom,
    receiptDateTo,
    receivedDateFrom,
    receivedDateTo,
  ]);

  useEffect(() => {
    void loadWorkbooks();
  }, [loadWorkbooks]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadLoans();
    }, 180);
    return () => clearTimeout(timer);
  }, [loadLoans]);

  const hasActiveFilters = Boolean(
    search.trim() ||
      workbookId ||
      product ||
      fosName ||
      bkt ||
      receiptMode ||
      receiptDateFrom ||
      receiptDateTo ||
      receivedDateFrom ||
      receivedDateTo
  );

  const clearFilters = () => {
    setSearch('');
    setWorkbookId('');
    setProduct('');
    setFosName('');
    setBkt('');
    setReceiptMode('');
    setReceiptDateFrom('');
    setReceiptDateTo('');
    setReceivedDateFrom('');
    setReceivedDateTo('');
  };

  const activeDownloadWorkbook =
    (workbookId
      ? workbooks.find((w) => String(w.id) === workbookId)
      : workbooks[0]) ?? null;

  const handleDownloadWorkbook = async (wb: WorkbookRecord) => {
    setDownloadingWbId(wb.id);
    setError(null);
    try {
      await api.downloadWorkbook(wb.id, wb.fileName);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to download updated Excel file.'
      );
    } finally {
      setDownloadingWbId(null);
    }
  };

  const handleLoanUpdated = (
    updated: LoanRecord,
    _syncedWorkbook: SyncedWorkbookInfo | null
  ) => {
    setLoans((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item))
    );
    void loadWorkbooks();
  };

  const handleCreateLoan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.loan.trim()) {
      setFormError('LOAN number is required.');
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const targetWbId = workbookId
        ? Number(workbookId)
        : workbooks.length === 1
          ? workbooks[0].id
          : null;
      await api.createLoan({
        loan: form.loan.trim(),
        emi: form.emi?.trim() || null,
        customerName: form.customerName?.trim() || null,
        fosName: form.fosName?.trim() || null,
        bkt: form.bkt?.trim() || null,
        bankingRemarks: form.bankingRemarks?.trim() || null,
        receiptDate: form.receiptDate?.trim() || null,
        receiptMode: form.receiptMode?.trim() || null,
        receivedDate: form.receivedDate?.trim() || null,
        receivedRemarks: form.receivedRemarks?.trim() || null,
        product: form.product?.trim() || null,
        workbookId: targetWbId,
      });
      setForm(EMPTY_FORM);
      setShowAddModal(false);
      await loadLoans();
      await loadWorkbooks();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Failed to create loan record.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-display tracking-tight text-slate-900">
            Loan Management
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Browse, filter, and directly edit all 11 Excel columns inline. Every edit is
            saved in Supabase and synced straight back to your Excel workbook.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-auto">
          {activeDownloadWorkbook && (
            <button
              type="button"
              disabled={downloadingWbId === activeDownloadWorkbook.id}
              onClick={() => void handleDownloadWorkbook(activeDownloadWorkbook)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Download className="w-4 h-4" />
              <span>
                {downloadingWbId === activeDownloadWorkbook.id
                  ? 'Downloading...'
                  : 'Download Updated Excel'}
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={() => onNavigate('excel-management')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Import / Export Excel</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setForm(EMPTY_FORM);
              setFormError(null);
              setShowAddModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Add Loan Record</span>
          </button>
        </div>
      </div>

      {/* Filters Panel */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="sm:col-span-2 lg:col-span-1">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
              LOAN / Customer Name
            </label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter text..."
              className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
              Product
            </label>
            <select
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="">All Products</option>
              {filterOptions.products.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
              FOS NAME
            </label>
            <select
              value={fosName}
              onChange={(e) => setFosName(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="">All FOS Names</option>
              {filterOptions.fosNames.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
              BKT
            </label>
            <select
              value={bkt}
              onChange={(e) => setBkt(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="">All BKT</option>
              {filterOptions.bkts.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
              Receipt Mode
            </label>
            <select
              value={receiptMode}
              onChange={(e) => setReceiptMode(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="">All Receipt Modes</option>
              {filterOptions.receiptModes.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Separate Receipt Date & Received Date Range Filters + Source Workbook */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-3 border-t border-slate-100">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
              Receipt Date (From)
            </label>
            <input
              type="date"
              value={receiptDateFrom}
              onChange={(e) => setReceiptDateFrom(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
              Receipt Date (To)
            </label>
            <input
              type="date"
              value={receiptDateTo}
              onChange={(e) => setReceiptDateTo(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
              Received Date (From)
            </label>
            <input
              type="date"
              value={receivedDateFrom}
              onChange={(e) => setReceivedDateFrom(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
              Received Date (To)
            </label>
            <input
              type="date"
              value={receivedDateTo}
              onChange={(e) => setReceivedDateTo(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
              Source Workbook
            </label>
            <select
              value={workbookId}
              onChange={(e) => setWorkbookId(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="">All Workbooks</option>
              {workbooks.map((wb) => (
                <option key={wb.id} value={String(wb.id)}>
                  {wb.fileName}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-slate-500 font-mono tabular-nums">
            {loading ? 'Loading records...' : `${loans.length} record(s) matched`}
          </span>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Clear Filters</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 flex items-center gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Records Table (Direct Inline Editing Synced Back to Excel) */}
      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
          Fetching loan records from Supabase...
        </div>
      ) : loans.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-2">
          <p className="text-sm font-medium text-slate-800">
            {hasActiveFilters
              ? 'No loan records match your active filters.'
              : 'No loan records stored in Supabase yet.'}
          </p>
          <p className="text-xs text-slate-500">
            {hasActiveFilters
              ? 'Try clearing or adjusting your filter selections.'
              : 'Upload your Excel workbook in Excel Management or add a loan record manually.'}
          </p>
        </div>
      ) : (
        <EditableLoanTable
          api={api}
          loans={loans}
          onOpenLoan={onOpenLoan}
          onLoanUpdated={handleLoanUpdated}
        />
      )}

      {/* Add Loan Record Modal (All 11 Exact Fields) */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full p-6 my-8">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Add New Loan Record (11 Fields)
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Saved directly to Supabase PostgreSQL with a unique internal database ID.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                aria-label="Close modal"
                className="p-1.5 text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateLoan} className="mt-5 space-y-4">
              {formError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5 text-xs text-red-700">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    LOAN <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={form.loan}
                    onChange={(e) => setForm((f) => ({ ...f, loan: e.target.value }))}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    EMI
                  </label>
                  <input
                    type="text"
                    value={form.emi ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, emi: e.target.value }))}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Customer Name
                  </label>
                  <input
                    type="text"
                    value={form.customerName ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, customerName: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    FOS NAME
                  </label>
                  <input
                    type="text"
                    value={form.fosName ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, fosName: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    BKT
                  </label>
                  <input
                    type="text"
                    value={form.bkt ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, bkt: e.target.value }))}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Product
                  </label>
                  <input
                    type="text"
                    value={form.product ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, product: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Receipt Date
                  </label>
                  <input
                    type="text"
                    value={form.receiptDate ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, receiptDate: e.target.value }))
                    }
                    placeholder="e.g. DD/MM/YYYY or YYYY-MM-DD"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Receipt Mode
                  </label>
                  <input
                    type="text"
                    value={form.receiptMode ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, receiptMode: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Received Date
                  </label>
                  <input
                    type="text"
                    value={form.receivedDate ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, receivedDate: e.target.value }))
                    }
                    placeholder="e.g. DD/MM/YYYY or YYYY-MM-DD"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Banking Remarks
                  </label>
                  <textarea
                    rows={2}
                    value={form.bankingRemarks ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, bankingRemarks: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Received Remarks
                  </label>
                  <textarea
                    rows={2}
                    value={form.receivedRemarks ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, receivedRemarks: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
                >
                  {saving ? 'Saving...' : 'Save Loan Record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
