import { useState } from 'react';
import {
  Check,
  X,
  Pencil,
  ArrowUpRight,
  Download,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import type { ApiClient } from '../lib/api.ts';
import type { LoanElevenFields } from '../lib/financial.ts';
import type { LoanRecord, SyncedWorkbookInfo } from '../types/app.ts';

export type EditableLoanFieldKey = keyof LoanElevenFields;

const TABLE_COLUMNS: Array<{
  key: EditableLoanFieldKey;
  label: string;
  mono?: boolean;
  alignRight?: boolean;
  minWidthClass: string;
}> = [
  { key: 'loan', label: 'LOAN', mono: true, minWidthClass: 'min-w-[130px]' },
  { key: 'emi', label: 'EMI', mono: true, alignRight: true, minWidthClass: 'min-w-[100px]' },
  { key: 'customerName', label: 'Customer Name', minWidthClass: 'min-w-[170px]' },
  { key: 'fosName', label: 'FOS NAME', minWidthClass: 'min-w-[140px]' },
  { key: 'bkt', label: 'BKT', mono: true, minWidthClass: 'min-w-[80px]' },
  { key: 'bankingRemarks', label: 'Banking Remarks', minWidthClass: 'min-w-[170px]' },
  { key: 'receiptDate', label: 'Receipt Date', mono: true, minWidthClass: 'min-w-[120px]' },
  { key: 'receiptMode', label: 'Receipt Mode', minWidthClass: 'min-w-[125px]' },
  { key: 'receivedDate', label: 'Received Date', mono: true, minWidthClass: 'min-w-[120px]' },
  { key: 'receivedRemarks', label: 'Received Remarks', minWidthClass: 'min-w-[170px]' },
  { key: 'product', label: 'Product', minWidthClass: 'min-w-[120px]' },
];

interface EditableLoanTableProps {
  api: ApiClient;
  loans: LoanRecord[];
  onOpenLoan: (loanId: number) => void;
  onLoanUpdated: (updated: LoanRecord, syncedWorkbook: SyncedWorkbookInfo | null) => void;
}

export function EditableLoanTable({
  api,
  loans,
  onOpenLoan,
  onLoanUpdated,
}: EditableLoanTableProps) {
  // Single-cell quick edit state
  const [editingCell, setEditingCell] = useState<{
    loanId: number;
    field: EditableLoanFieldKey;
  } | null>(null);
  const [cellDraft, setCellDraft] = useState('');

  // Full-row edit state
  const [editingRowId, setEditingRowId] = useState<number | null>(null);
  const [rowDraft, setRowDraft] = useState<LoanElevenFields | null>(null);

  const [savingId, setSavingId] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<{
    message: string;
    syncedWorkbook: SyncedWorkbookInfo | null;
  } | null>(null);
  const [downloadingWbId, setDownloadingWbId] = useState<number | null>(null);

  const startCellEdit = (record: LoanRecord, field: EditableLoanFieldKey) => {
    if (savingId !== null) return;
    if (editingRowId === record.id) return;
    setEditingRowId(null);
    setRowDraft(null);
    setSaveError(null);
    setEditingCell({ loanId: record.id, field });
    setCellDraft(record[field] ?? '');
  };

  const cancelCellEdit = () => {
    setEditingCell(null);
    setCellDraft('');
  };

  const commitCellEdit = async (
    record: LoanRecord,
    field: EditableLoanFieldKey,
    columnLabel: string
  ) => {
    const nextVal = cellDraft.trim();
    const prevVal = (record[field] ?? '').trim();

    if (field === 'loan' && !nextVal) {
      setSaveError('LOAN number cannot be empty.');
      return;
    }

    if (nextVal === prevVal) {
      cancelCellEdit();
      return;
    }

    setSavingId(record.id);
    setSaveError(null);
    try {
      const payload: Partial<LoanElevenFields> = {
        [field]: field === 'loan' ? nextVal : nextVal || null,
      };
      const res = await api.updateLoan(record.id, payload);
      cancelCellEdit();
      onLoanUpdated(res.loan, res.syncedWorkbook);
      setSaveFeedback({
        message: res.syncedWorkbook
          ? `Updated "${columnLabel}" for LOAN ${res.loan.loan} and synced directly to ${res.syncedWorkbook.fileName}.`
          : `Updated "${columnLabel}" for LOAN ${res.loan.loan} in Supabase.`,
        syncedWorkbook: res.syncedWorkbook,
      });
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : 'Failed to save cell change.'
      );
    } finally {
      setSavingId(null);
    }
  };

  const startRowEdit = (record: LoanRecord) => {
    if (savingId !== null) return;
    cancelCellEdit();
    setSaveError(null);
    setEditingRowId(record.id);
    setRowDraft({
      loan: record.loan,
      emi: record.emi ?? '',
      customerName: record.customerName ?? '',
      fosName: record.fosName ?? '',
      bkt: record.bkt ?? '',
      bankingRemarks: record.bankingRemarks ?? '',
      receiptDate: record.receiptDate ?? '',
      receiptMode: record.receiptMode ?? '',
      receivedDate: record.receivedDate ?? '',
      receivedRemarks: record.receivedRemarks ?? '',
      product: record.product ?? '',
    });
  };

  const cancelRowEdit = () => {
    setEditingRowId(null);
    setRowDraft(null);
  };

  const saveRowEdit = async (loanId: number) => {
    if (!rowDraft) return;
    if (!rowDraft.loan.trim()) {
      setSaveError('LOAN number cannot be empty.');
      return;
    }

    setSavingId(loanId);
    setSaveError(null);
    try {
      const res = await api.updateLoan(loanId, {
        loan: rowDraft.loan.trim(),
        emi: rowDraft.emi?.trim() || null,
        customerName: rowDraft.customerName?.trim() || null,
        fosName: rowDraft.fosName?.trim() || null,
        bkt: rowDraft.bkt?.trim() || null,
        bankingRemarks: rowDraft.bankingRemarks?.trim() || null,
        receiptDate: rowDraft.receiptDate?.trim() || null,
        receiptMode: rowDraft.receiptMode?.trim() || null,
        receivedDate: rowDraft.receivedDate?.trim() || null,
        receivedRemarks: rowDraft.receivedRemarks?.trim() || null,
        product: rowDraft.product?.trim() || null,
      });
      cancelRowEdit();
      onLoanUpdated(res.loan, res.syncedWorkbook);
      setSaveFeedback({
        message: res.syncedWorkbook
          ? `Saved row #${res.loan.id} (LOAN ${res.loan.loan}) and synced directly to ${res.syncedWorkbook.fileName}.`
          : `Saved row #${res.loan.id} (LOAN ${res.loan.loan}) in Supabase.`,
        syncedWorkbook: res.syncedWorkbook,
      });
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : 'Failed to save row changes.'
      );
    } finally {
      setSavingId(null);
    }
  };

  const handleDownloadSynced = async (wb: SyncedWorkbookInfo) => {
    setDownloadingWbId(wb.id);
    setSaveError(null);
    try {
      await api.downloadWorkbook(wb.id, wb.fileName);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : 'Failed to download updated Excel file.'
      );
    } finally {
      setDownloadingWbId(null);
    }
  };

  return (
    <div className="space-y-3">
      {/* Inline Editing Tip + Feedback */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 px-1">
        <span>
          Click any cell to edit directly inline (press <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-[11px] text-slate-700">Enter</kbd> to save, <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded font-mono text-[11px] text-slate-700">Esc</kbd> to cancel). Edits automatically sync back to your Excel sheet.
        </span>
      </div>

      {saveError && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-xs text-red-700 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{saveError}</span>
          </div>
          <button
            type="button"
            onClick={() => setSaveError(null)}
            className="text-red-600 hover:text-red-800 cursor-pointer"
            aria-label="Dismiss error"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {saveFeedback && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5 text-xs text-emerald-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-700" />
            <span>{saveFeedback.message}</span>
          </div>
          <div className="flex items-center gap-2">
            {saveFeedback.syncedWorkbook && (
              <button
                type="button"
                disabled={downloadingWbId === saveFeedback.syncedWorkbook.id}
                onClick={() =>
                  void handleDownloadSynced(saveFeedback.syncedWorkbook!)
                }
                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-700 text-white text-xs font-semibold rounded-md hover:bg-emerald-800 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                <span>
                  {downloadingWbId === saveFeedback.syncedWorkbook.id
                    ? 'Downloading...'
                    : 'Download Updated Excel'}
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setSaveFeedback(null)}
              className="p-1 text-emerald-700 hover:text-emerald-900 cursor-pointer"
              aria-label="Dismiss notice"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Full 11-Column Editable Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-3 py-3 whitespace-nowrap">Row</th>
                {TABLE_COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className={`px-3 py-3 whitespace-nowrap ${col.minWidthClass} ${
                      col.alignRight ? 'text-right' : ''
                    }`}
                  >
                    {col.label}
                  </th>
                ))}
                <th className="px-3 py-3 whitespace-nowrap text-right sticky right-0 bg-slate-50 border-l border-slate-200">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {loans.map((record) => {
                const isRowEditing = editingRowId === record.id && rowDraft !== null;
                const isSaving = savingId === record.id;

                return (
                  <tr
                    key={record.id}
                    className={
                      isRowEditing
                        ? 'bg-slate-50/90'
                        : 'hover:bg-slate-50/60 transition-colors'
                    }
                  >
                    <td className="px-3 py-2.5 font-mono text-slate-400 tabular-nums whitespace-nowrap">
                      {record.sourceRowNumber ? `R${record.sourceRowNumber}` : `#${record.id}`}
                    </td>

                    {TABLE_COLUMNS.map((col) => {
                      const isCellEditing =
                        editingCell?.loanId === record.id &&
                        editingCell?.field === col.key;
                      const rawValue = record[col.key] ?? '';

                      if (isRowEditing && rowDraft) {
                        return (
                          <td key={col.key} className="px-2 py-1.5">
                            <input
                              type="text"
                              aria-label={`${col.label} for ${record.loan}`}
                              value={rowDraft[col.key] ?? ''}
                              onChange={(e) =>
                                setRowDraft((prev) =>
                                  prev ? { ...prev, [col.key]: e.target.value } : prev
                                )
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  void saveRowEdit(record.id);
                                } else if (e.key === 'Escape') {
                                  e.preventDefault();
                                  cancelRowEdit();
                                }
                              }}
                              disabled={isSaving}
                              className={`w-full px-2 py-1.5 text-xs bg-white border border-slate-400 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-900 ${
                                col.mono ? 'font-mono' : ''
                              } ${col.alignRight ? 'text-right' : ''}`}
                            />
                          </td>
                        );
                      }

                      if (isCellEditing) {
                        return (
                          <td key={col.key} className="px-2 py-1.5">
                            <div className="flex items-center gap-1">
                              <input
                                type="text"
                                autoFocus
                                aria-label={`Edit ${col.label}`}
                                value={cellDraft}
                                onChange={(e) => setCellDraft(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    void commitCellEdit(record, col.key, col.label);
                                  } else if (e.key === 'Escape') {
                                    e.preventDefault();
                                    cancelCellEdit();
                                  }
                                }}
                                disabled={isSaving}
                                className={`w-full min-w-[90px] px-2 py-1 text-xs bg-white border border-slate-900 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-900 ${
                                  col.mono ? 'font-mono' : ''
                                } ${col.alignRight ? 'text-right' : ''}`}
                              />
                              <button
                                type="button"
                                disabled={isSaving}
                                onClick={() =>
                                  void commitCellEdit(record, col.key, col.label)
                                }
                                title="Save & sync to Excel"
                                aria-label="Save cell"
                                className="p-1 bg-slate-900 text-white rounded hover:bg-slate-800 disabled:opacity-50 cursor-pointer shrink-0"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={isSaving}
                                onClick={cancelCellEdit}
                                title="Cancel"
                                aria-label="Cancel edit"
                                className="p-1 bg-slate-100 text-slate-600 rounded hover:bg-slate-200 cursor-pointer shrink-0"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        );
                      }

                      return (
                        <td
                          key={col.key}
                          onClick={() => startCellEdit(record, col.key)}
                          title={`${rawValue || '(empty)'} — Click to edit directly`}
                          className={`px-3 py-2.5 cursor-text group hover:bg-slate-100/80 transition-colors ${
                            col.mono ? 'font-mono tabular-nums' : ''
                          } ${col.alignRight ? 'text-right' : ''} ${
                            col.key === 'loan'
                              ? 'font-semibold text-slate-900 whitespace-nowrap'
                              : 'text-slate-800 max-w-[240px] truncate'
                          }`}
                        >
                          {rawValue ? (
                            rawValue
                          ) : (
                            <span className="text-slate-300 group-hover:text-slate-500">
                              —
                            </span>
                          )}
                        </td>
                      );
                    })}

                    <td className="px-3 py-2 text-right whitespace-nowrap sticky right-0 bg-white border-l border-slate-100">
                      {isRowEditing ? (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={() => void saveRowEdit(record.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-900 text-white text-xs font-semibold rounded-md hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>{isSaving ? 'Syncing...' : 'Save'}</span>
                          </button>
                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={cancelRowEdit}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-slate-100 text-slate-700 text-xs font-medium rounded-md hover:bg-slate-200 cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={() => startRowEdit(record)}
                            title="Edit entire row inline"
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200 cursor-pointer"
                          >
                            <Pencil className="w-3 h-3" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenLoan(record.id)}
                            title="Open record details & payment ledger"
                            className="inline-flex items-center gap-0.5 text-slate-600 hover:text-slate-900 font-semibold cursor-pointer"
                          >
                            <span>Details</span>
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
