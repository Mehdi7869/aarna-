import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  Pencil,
  Save,
  X,
  Trash2,
  Plus,
  AlertCircle,
  CheckCircle2,
  Info,
  Download,
} from 'lucide-react';
import type { ApiClient } from '../lib/api.ts';
import type { LoanDetailResponse, LoanPayment } from '../types/app.ts';
import {
  type LoanElevenFields,
  formatCurrency,
  formatDateDisplay,
  formatDateTimeDisplay,
} from '../lib/financial.ts';
import { StatusText } from './StatusText.tsx';

interface LoanDetailViewProps {
  api: ApiClient;
  loanId: number;
  onBack: () => void;
  onDeleted: () => void;
}

export function LoanDetailView({
  api,
  loanId,
  onBack,
  onDeleted,
}: LoanDetailViewProps) {
  const [detail, setDetail] = useState<LoanDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Edit 11 fields state
  const [editing, setEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editForm, setEditForm] = useState<LoanElevenFields>({
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
  });

  // Delete record confirmation
  const [confirmDeleteLoan, setConfirmDeleteLoan] = useState(false);
  const [deletingLoan, setDeletingLoan] = useState(false);

  // Add Payment form state
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(
    () => new Date().toISOString().slice(0, 10)
  );
  const [paymentMethod, setPaymentMethod] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [addingPayment, setAddingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [deletePaymentTarget, setDeletePaymentTarget] =
    useState<LoanPayment | null>(null);
  const [deletingPayment, setDeletingPayment] = useState(false);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getLoanDetail(loanId);
      setDetail(res);
      setEditForm({
        loan: res.loan.loan,
        emi: res.loan.emi ?? '',
        customerName: res.loan.customerName ?? '',
        fosName: res.loan.fosName ?? '',
        bkt: res.loan.bkt ?? '',
        bankingRemarks: res.loan.bankingRemarks ?? '',
        receiptDate: res.loan.receiptDate ?? '',
        receiptMode: res.loan.receiptMode ?? '',
        receivedDate: res.loan.receivedDate ?? '',
        receivedRemarks: res.loan.receivedRemarks ?? '',
        product: res.loan.product ?? '',
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load loan details.'
      );
    } finally {
      setLoading(false);
    }
  }, [api, loanId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editForm.loan.trim()) {
      setError('LOAN number cannot be empty.');
      return;
    }

    setSavingEdit(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.updateLoan(loanId, {
        loan: editForm.loan.trim(),
        emi: editForm.emi?.trim() || null,
        customerName: editForm.customerName?.trim() || null,
        fosName: editForm.fosName?.trim() || null,
        bkt: editForm.bkt?.trim() || null,
        bankingRemarks: editForm.bankingRemarks?.trim() || null,
        receiptDate: editForm.receiptDate?.trim() || null,
        receiptMode: editForm.receiptMode?.trim() || null,
        receivedDate: editForm.receivedDate?.trim() || null,
        receivedRemarks: editForm.receivedRemarks?.trim() || null,
        product: editForm.product?.trim() || null,
      });
      setEditing(false);
      setNotice(
        res.syncedWorkbook
          ? `Loan record updated in Supabase and synced directly to ${res.syncedWorkbook.fileName}.`
          : 'Loan record updated in Supabase.'
      );
      await loadDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update loan record.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteLoan = async () => {
    setDeletingLoan(true);
    setError(null);
    try {
      await api.deleteLoan(loanId);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete loan record.');
      setDeletingLoan(false);
      setConfirmDeleteLoan(false);
    }
  };

  const handleAddPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setPaymentError(null);

    const parsedAmount = Number(paymentAmount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setPaymentError('Enter a valid payment amount greater than zero.');
      return;
    }
    if (!paymentDate) {
      setPaymentError('Select a valid payment date.');
      return;
    }

    setAddingPayment(true);
    try {
      await api.addLoanPayment(loanId, {
        amount: parsedAmount,
        paymentDate,
        paymentMethod: paymentMethod.trim() || null,
        referenceNumber: referenceNumber.trim() || null,
        notes: paymentNotes.trim() || null,
      });
      setPaymentAmount('');
      setPaymentMethod('');
      setReferenceNumber('');
      setPaymentNotes('');
      setNotice('Payment transaction recorded in Supabase.');
      await loadDetail();
    } catch (err) {
      setPaymentError(
        err instanceof Error ? err.message : 'Failed to add payment transaction.'
      );
    } finally {
      setAddingPayment(false);
    }
  };

  const handleConfirmDeletePayment = async () => {
    if (!deletePaymentTarget) return;
    setDeletingPayment(true);
    setPaymentError(null);
    try {
      await api.deleteLoanPayment(loanId, deletePaymentTarget.id);
      setDeletePaymentTarget(null);
      setNotice('Payment transaction removed.');
      await loadDetail();
    } catch (err) {
      setPaymentError(
        err instanceof Error ? err.message : 'Failed to delete payment.'
      );
    } finally {
      setDeletingPayment(false);
    }
  };

  if (loading) {
    return (
      <div className="p-10 text-center text-sm text-slate-500">
        Loading loan record from Supabase...
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-sm text-red-700">
          {error || 'Loan record not found.'}
        </div>
      </div>
    );
  }

  const { loan, sameLoanRecordCount, workbook, payments } = detail;

  return (
    <div className="space-y-6">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to list</span>
          </button>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold font-mono tracking-tight text-slate-900">
              {loan.loan}
            </h1>
            <span className="text-xs font-mono text-slate-500">
              Record #{loan.id}
            </span>
            <StatusText status={loan.paymentStatus} />
          </div>
          <p className="text-sm text-slate-600">
            {loan.customerName || 'Customer Name not provided'}
            {workbook
              ? ` · Imported from ${workbook.fileName}${
                  loan.sourceRowNumber ? ` (Row ${loan.sourceRowNumber})` : ''
                }`
              : ' · Manually created record'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-auto">
          {workbook && (
            <button
              type="button"
              onClick={() => void api.downloadWorkbook(workbook.id, workbook.fileName)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Excel</span>
            </button>
          )}
          {!editing ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span>Edit All 11 Fields</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>Cancel Edit</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setConfirmDeleteLoan(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-red-700 bg-white border border-red-200 rounded-lg hover:bg-red-50 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete</span>
          </button>
        </div>
      </div>

      {sameLoanRecordCount > 1 && (
        <div className="bg-slate-100 border border-slate-200 rounded-lg px-4 py-3 text-xs text-slate-700 flex items-start gap-2.5">
          <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
          <span>
            There are <strong>{sameLoanRecordCount}</strong> separate records in Supabase
            sharing LOAN number <span className="font-mono font-semibold">{loan.loan}</span>.
            Changes made here update only internal <strong>Record #{loan.id}</strong> and
            will not overwrite the other records.
          </span>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 flex items-center gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-800 flex items-center gap-2.5">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* All 11 Exact Excel Fields Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center justify-between pb-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Complete Loan Record (11 Excel Fields)
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Last updated {formatDateTimeDisplay(loan.updatedAt)} · Receipt Date and
              Received Date are stored separately; Banking Remarks and Received Remarks
              are stored separately.
            </p>
          </div>
        </div>

        {editing ? (
          <form onSubmit={handleSaveEdit} className="mt-5 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  LOAN <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editForm.loan}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, loan: e.target.value }))
                  }
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  EMI
                </label>
                <input
                  type="text"
                  value={editForm.emi ?? ''}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, emi: e.target.value }))
                  }
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Customer Name
                </label>
                <input
                  type="text"
                  value={editForm.customerName ?? ''}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, customerName: e.target.value }))
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
                  value={editForm.fosName ?? ''}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, fosName: e.target.value }))
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
                  value={editForm.bkt ?? ''}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, bkt: e.target.value }))
                  }
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Product
                </label>
                <input
                  type="text"
                  value={editForm.product ?? ''}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, product: e.target.value }))
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
                  value={editForm.receiptDate ?? ''}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, receiptDate: e.target.value }))
                  }
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Receipt Mode
                </label>
                <input
                  type="text"
                  value={editForm.receiptMode ?? ''}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, receiptMode: e.target.value }))
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
                  value={editForm.receivedDate ?? ''}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, receivedDate: e.target.value }))
                  }
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Banking Remarks
                </label>
                <textarea
                  rows={3}
                  value={editForm.bankingRemarks ?? ''}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, bankingRemarks: e.target.value }))
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Received Remarks
                </label>
                <textarea
                  rows={3}
                  value={editForm.receivedRemarks ?? ''}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, receivedRemarks: e.target.value }))
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingEdit}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>{savingEdit ? 'Saving...' : 'Save Changes to Supabase'}</span>
              </button>
            </div>
          </form>
        ) : (
          <dl className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-5 text-sm">
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                1. LOAN
              </dt>
              <dd className="mt-1 font-mono font-semibold text-slate-900">
                {loan.loan || '—'}
              </dd>
            </div>

            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                2. EMI
              </dt>
              <dd className="mt-1 font-mono font-semibold text-slate-900">
                {loan.emi || '—'}
              </dd>
            </div>

            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                3. Customer Name
              </dt>
              <dd className="mt-1 text-slate-900">{loan.customerName || '—'}</dd>
            </div>

            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                4. FOS NAME
              </dt>
              <dd className="mt-1 text-slate-900">{loan.fosName || '—'}</dd>
            </div>

            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                5. BKT
              </dt>
              <dd className="mt-1 font-mono text-slate-900">{loan.bkt || '—'}</dd>
            </div>

            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                11. Product
              </dt>
              <dd className="mt-1 text-slate-900">{loan.product || '—'}</dd>
            </div>

            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                7. Receipt Date
              </dt>
              <dd className="mt-1 font-mono text-slate-900">
                {loan.receiptDate || '—'}
              </dd>
            </div>

            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                8. Receipt Mode
              </dt>
              <dd className="mt-1 text-slate-900">{loan.receiptMode || '—'}</dd>
            </div>

            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                9. Received Date
              </dt>
              <dd className="mt-1 font-mono text-slate-900">
                {loan.receivedDate || '—'}
              </dd>
            </div>

            <div className="sm:col-span-2 lg:col-span-3 pt-4 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  6. Banking Remarks
                </dt>
                <dd className="mt-1 text-slate-800 whitespace-pre-wrap break-words">
                  {loan.bankingRemarks || '—'}
                </dd>
              </div>

              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  10. Received Remarks
                </dt>
                <dd className="mt-1 text-slate-800 whitespace-pre-wrap break-words">
                  {loan.receivedRemarks || '—'}
                </dd>
              </div>
            </div>
          </dl>
        )}
      </div>

      {/* Payment Ledger Summary & Separate Payment Entry */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Add Payment Form */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Record Payment Transaction
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Log actual payment amounts received separately from the Excel{' '}
              <strong>EMI</strong> field. Each entry is appended to payment history.
            </p>
          </div>

          <form onSubmit={handleAddPayment} className="space-y-3.5">
            {paymentError && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
                {paymentError}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Actual Amount Received (₹) <span className="text-red-600">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Payment Date <span className="text-red-600">*</span>
              </label>
              <input
                type="date"
                required
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Payment Method
              </label>
              <input
                type="text"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                placeholder="e.g. UPI, NEFT, Cash, Cheque"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Reference Number
              </label>
              <input
                type="text"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder="UTR / Receipt / Transaction Ref"
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Notes
              </label>
              <textarea
                rows={2}
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <button
              type="submit"
              disabled={addingPayment}
              className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 disabled:opacity-60 transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>{addingPayment ? 'Recording...' : 'Add Payment'}</span>
            </button>
          </form>
        </div>

        {/* Payment History Table */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
          <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Logged Payment History
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Total logged payments: <strong className="font-mono text-slate-900">{formatCurrency(loan.totalPaid)}</strong>{' '}
                across {payments.length} transaction(s). Listed EMI ({loan.emi || '—'}) is
                kept separate.
              </p>
            </div>
          </div>

          {payments.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              No payment transactions logged for this record yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="px-5 py-3">Date</th>
                    <th className="px-4 py-3 text-right">Amount (₹)</th>
                    <th className="px-4 py-3">Method</th>
                    <th className="px-4 py-3">Reference</th>
                    <th className="px-4 py-3">Notes</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {payments.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50/70">
                      <td className="px-5 py-3 font-mono text-slate-800 whitespace-nowrap">
                        {formatDateDisplay(p.paymentDate)}
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold text-emerald-700 text-right tabular-nums whitespace-nowrap">
                        {formatCurrency(p.amount)}
                      </td>
                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                        {p.paymentMethod || '—'}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-700 whitespace-nowrap">
                        {p.referenceNumber || '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-600 max-w-[200px] truncate">
                        {p.notes || '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setDeletePaymentTarget(p)}
                          aria-label="Delete payment transaction"
                          className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Delete Loan Record Confirmation Modal */}
      {confirmDeleteLoan && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-900">
              Delete Loan Record #{loan.id}
            </h3>
            <p className="text-sm text-slate-600">
              Permanently delete internal record <strong>#{loan.id}</strong> (LOAN{' '}
              <span className="font-mono">{loan.loan}</span>) and its logged payment
              transactions from Supabase?
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteLoan(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingLoan}
                onClick={() => void handleDeleteLoan()}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-60 cursor-pointer"
              >
                {deletingLoan ? 'Deleting...' : 'Delete Record'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Payment Confirmation Modal */}
      {deletePaymentTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-900">
              Delete Payment Transaction
            </h3>
            <p className="text-sm text-slate-600">
              Remove the logged payment of{' '}
              <strong className="font-mono">
                {formatCurrency(deletePaymentTarget.amount)}
              </strong>{' '}
              dated {formatDateDisplay(deletePaymentTarget.paymentDate)}?
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDeletePaymentTarget(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingPayment}
                onClick={() => void handleConfirmDeletePayment()}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-60 cursor-pointer"
              >
                {deletingPayment ? 'Removing...' : 'Remove Payment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
