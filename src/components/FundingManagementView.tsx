import React, { useCallback, useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { Plus, Pencil, Trash2, Calendar, Search, X } from 'lucide-react';
import type { ApiClient } from '../lib/api.ts';
import type { FundingListResponse, FundingTransaction } from '../types/app.ts';
import {
  formatCurrency,
  formatDateDisplay,
  parseNumericValue,
} from '../lib/financial.ts';

interface FundingManagementViewProps {
  api: ApiClient;
}

export function FundingManagementView({ api }: FundingManagementViewProps) {
  const [data, setData] = useState<FundingListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [search, setSearch] = useState('');

  // Modal state for Create / Edit
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<FundingTransaction | null>(null);
  const [fundingSource, setFundingSource] = useState('');
  const [amount, setAmount] = useState('');
  const [fundingDate, setFundingDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [referenceDetails, setReferenceDetails] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const loadFunding = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listFunding({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        search: search.trim() || undefined,
      });
      setData(res);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to load funding records.'
      );
    } finally {
      setLoading(false);
    }
  }, [api, startDate, endDate, search]);

  useEffect(() => {
    loadFunding();
  }, [loadFunding]);

  const openCreateModal = () => {
    setEditingItem(null);
    setFundingSource('');
    setAmount('');
    setFundingDate(new Date().toISOString().slice(0, 10));
    setReferenceDetails('');
    setNotes('');
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (item: FundingTransaction) => {
    setEditingItem(item);
    setFundingSource(item.fundingSource);
    setAmount(String(item.amount));
    setFundingDate(item.fundingDate);
    setReferenceDetails(item.referenceDetails ?? '');
    setNotes(item.notes ?? '');
    setFormError(null);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!fundingSource.trim()) {
      setFormError('Funding source is required.');
      return;
    }

    const parsedAmt = parseNumericValue(amount);
    if (parsedAmt === null || parsedAmt <= 0) {
      setFormError('Amount received must be greater than 0.');
      return;
    }

    if (!fundingDate) {
      setFormError('Funding date is required.');
      return;
    }

    setSaving(true);
    try {
      if (editingItem) {
        await api.updateFunding(editingItem.id, {
          fundingSource: fundingSource.trim(),
          amount: parsedAmt,
          fundingDate,
          referenceDetails: referenceDetails.trim() || null,
          notes: notes.trim() || null,
        });
      } else {
        await api.createFunding({
          fundingSource: fundingSource.trim(),
          amount: parsedAmt,
          fundingDate,
          referenceDetails: referenceDetails.trim() || null,
          notes: notes.trim() || null,
        });
      }
      setModalOpen(false);
      await loadFunding();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Unable to save funding record.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    setError(null);
    try {
      await api.deleteFunding(id);
      setConfirmDeleteId(null);
      await loadFunding();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to delete funding record.'
      );
    }
  };

  const hasFilters = Boolean(startDate || endDate || search.trim());
  const transactions = data?.transactions ?? [];
  const timeline = data?.timeline ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Funding Management
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Record and audit incoming capital separately from client loan repayments.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Record Funding</span>
        </button>
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 bg-white border border-slate-200 rounded-xl divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">
            {hasFilters ? 'Filtered Funding Received' : 'Total Funding Received'}
          </p>
          <p className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-slate-900">
            {loading && !data ? '—' : formatCurrency(data?.filteredTotal ?? 0)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Strictly segregated from client repayments
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">All-Time Funding</p>
          <p className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-slate-900">
            {loading && !data ? '—' : formatCurrency(data?.allTimeTotal ?? 0)}
          </p>
          <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {data?.totalCount ?? 0} total saved{' '}
            {(data?.totalCount ?? 0) === 1 ? 'entry' : 'entries'}
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">Showing Entries</p>
          <p className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-slate-900">
            {loading && !data ? '—' : transactions.length.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {hasFilters ? 'Matching active filters' : 'All recorded funding entries'}
          </p>
        </div>
      </div>

      {/* Date & Search Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <label className="text-xs text-slate-500" htmlFor="fund-start">
              From
            </label>
            <input
              id="fund-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="text-xs font-mono text-slate-900 bg-transparent focus:outline-none"
            />
            <span className="text-slate-300">/</span>
            <label className="text-xs text-slate-500" htmlFor="fund-end">
              To
            </label>
            <input
              id="fund-end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="text-xs font-mono text-slate-900 bg-transparent focus:outline-none"
            />
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter source or reference..."
              className="pl-8 pr-3 py-2 text-xs text-slate-900 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 w-56"
            />
          </div>
        </div>

        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setStartDate('');
              setEndDate('');
              setSearch('');
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            <span>Reset Filters</span>
          </button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="p-4 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {/* Funding Received Over Time Chart */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Funding Received Over Time
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Cumulative incoming capital plotted strictly from recorded funding dates
            </p>
          </div>
        </div>

        <div className="mt-6 h-60">
          {timeline.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={timeline}
                margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  tickFormatter={(val) => formatDateDisplay(val)}
                  axisLine={{ stroke: '#e2e8f0' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  tickFormatter={(val) => `₹${Number(val).toLocaleString('en-IN')}`}
                  axisLine={false}
                  tickLine={false}
                  width={88}
                />
                <Tooltip
                  formatter={(value: unknown, name: unknown) => [
                    formatCurrency(Number(value) || 0),
                    name === 'cumulative' ? 'Cumulative Funding' : 'Daily Funding',
                  ]}
                  labelFormatter={(label) => formatDateDisplay(String(label))}
                  contentStyle={{
                    borderRadius: '8px',
                    borderColor: '#e2e8f0',
                    fontSize: '12px',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="cumulative"
                  stroke="#0f172a"
                  strokeWidth={2}
                  fill="#cbd5e1"
                  fillOpacity={0.35}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center border border-dashed border-slate-200 rounded-lg px-6">
              <p className="text-sm font-medium text-slate-700">
                No funding timeline data available
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Record incoming funding entries to visualize capital inflows over time.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Funding History Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">
            Funding History
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            All saved incoming funding transactions
          </p>
        </div>

        {transactions.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-slate-700">
              No funding transactions recorded
              {hasFilters ? ' for the selected filter criteria' : ''}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Click &ldquo;Record Funding&rdquo; to log actual capital received.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-3 px-6">Date</th>
                  <th className="py-3 px-4">Funding Source</th>
                  <th className="py-3 px-4 text-right">Amount Received</th>
                  <th className="py-3 px-4">Reference Details</th>
                  <th className="py-3 px-4">Notes</th>
                  <th className="py-3 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {transactions.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/60">
                    <td className="py-3.5 px-6 font-mono text-slate-700 whitespace-nowrap">
                      {formatDateDisplay(item.fundingDate)}
                    </td>
                    <td className="py-3.5 px-4 font-medium text-slate-900">
                      {item.fundingSource}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                      {formatCurrency(item.amount)}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-slate-600">
                      {item.referenceDetails || '—'}
                    </td>
                    <td className="py-3.5 px-4 text-slate-600 max-w-xs truncate">
                      {item.notes || '—'}
                    </td>
                    <td className="py-3.5 px-6 text-right whitespace-nowrap">
                      {confirmDeleteId === item.id ? (
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleDelete(item.id)}
                            className="text-xs font-semibold text-red-700 hover:underline cursor-pointer"
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="text-xs text-slate-500 hover:text-slate-900 cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => openEditModal(item)}
                            className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(item.id)}
                            className="inline-flex items-center gap-1 text-slate-500 hover:text-red-700 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete</span>
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Funding Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="funding-modal-title"
        >
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 id="funding-modal-title" className="text-base font-semibold text-slate-900">
                {editingItem ? 'Edit Funding Record' : 'Record Incoming Funding'}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4">
              {formError && (
                <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-xs text-red-700">
                  {formError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="fund-source">
                  Funding Source <span className="text-red-600">*</span>
                </label>
                <input
                  id="fund-source"
                  type="text"
                  required
                  value={fundingSource}
                  onChange={(e) => setFundingSource(e.target.value)}
                  placeholder="Enter actual investor, facility, or capital source"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="fund-amt">
                    Amount Received <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="fund-amt"
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="fund-date">
                    Funding Date <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="fund-date"
                    type="date"
                    required
                    value={fundingDate}
                    onChange={(e) => setFundingDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="fund-ref">
                  Reference Details
                </label>
                <input
                  id="fund-ref"
                  type="text"
                  value={referenceDetails}
                  onChange={(e) => setReferenceDetails(e.target.value)}
                  placeholder="Wire confirmation, tranche ID, agreement reference"
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="fund-notes">
                  Notes
                </label>
                <textarea
                  id="fund-notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional details..."
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 resize-none"
                />
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                >
                  {saving
                    ? 'Saving...'
                    : editingItem
                      ? 'Save Changes'
                      : 'Save Funding'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
