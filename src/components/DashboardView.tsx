import { useCallback, useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import {
  Briefcase,
  IndianRupee,
  Landmark,
  CalendarRange,
  ArrowUpRight,
  RotateCcw,
  AlertCircle,
} from 'lucide-react';
import type { ApiClient } from '../lib/api.ts';
import type { AppPage, DashboardResponse } from '../types/app.ts';
import { formatCurrency, formatDateDisplay } from '../lib/financial.ts';

interface DashboardViewProps {
  api: ApiClient;
  onOpenLoan: (loanId: number) => void;
  onNavigate: (page: AppPage) => void;
}

export function DashboardView({
  api,
  onOpenLoan,
  onNavigate,
}: DashboardViewProps) {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getDashboard({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      setData(res);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load dashboard metrics.'
      );
    } finally {
      setLoading(false);
    }
  }, [api, startDate, endDate]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const metrics = data?.metrics;
  const productEntries = metrics
    ? Object.entries(metrics.productBreakdown).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <div className="space-y-6">
      {/* Header & Date Filter */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-display tracking-tight text-slate-900">
            Financial Overview
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Live metrics computed directly from AARNA ENTERPRISES records in Supabase.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 bg-white border border-slate-200 rounded-lg px-3.5 py-2">
          <CalendarRange className="w-4 h-4 text-slate-500" />
          <input
            type="date"
            aria-label="Start date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="text-xs font-mono text-slate-800 border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-slate-900"
          />
          <span className="text-xs text-slate-400">to</span>
          <input
            type="date"
            aria-label="End date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="text-xs font-mono text-slate-800 border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-slate-900"
          />
          {(startDate || endDate) && (
            <button
              type="button"
              onClick={() => {
                setStartDate('');
                setEndDate('');
              }}
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 ml-1 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
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

      {/* 4 Primary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-semibold uppercase tracking-wider">
              Total Loan Records
            </span>
            <Briefcase className="w-4 h-4" />
          </div>
          <p className="mt-3 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {loading ? '—' : metrics?.totalLoanRecords ?? 0}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {loading
              ? 'Loading...'
              : `${metrics?.distinctLoanNumbers ?? 0} distinct LOAN number(s)`}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-semibold uppercase tracking-wider">
              Total Listed EMI
            </span>
            <IndianRupee className="w-4 h-4" />
          </div>
          <p className="mt-3 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {loading ? '—' : formatCurrency(metrics?.totalScheduledEmi ?? 0)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Scheduled EMI from records (not amount received)
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-semibold uppercase tracking-wider">
              Client Payments Logged
            </span>
            <IndianRupee className="w-4 h-4 text-emerald-700" />
          </div>
          <p className="mt-3 text-2xl font-bold font-mono tabular-nums text-emerald-700">
            {loading ? '—' : formatCurrency(metrics?.totalPaymentsReceived ?? 0)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {startDate || endDate
              ? `All-time: ${formatCurrency(metrics?.allTimePaymentsReceived ?? 0)}`
              : 'From recorded payment transactions only'}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-semibold uppercase tracking-wider">
              Total Funding Received
            </span>
            <Landmark className="w-4 h-4" />
          </div>
          <p className="mt-3 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {loading ? '—' : formatCurrency(metrics?.totalFundingReceived ?? 0)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Incoming capital (separate from repayments)
          </p>
        </div>
      </div>

      {/* Product Breakdown (Only shown when real records exist) */}
      {productEntries.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
            Records by Product
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {productEntries.map(([prod, count]) => (
              <div
                key={prod}
                className="px-3.5 py-2.5 border border-slate-200 rounded-lg"
              >
                <p className="text-xs font-medium text-slate-600 truncate" title={prod}>
                  {prod}
                </p>
                <p className="mt-1 text-lg font-bold font-mono tabular-nums text-slate-900">
                  {count}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trend Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-slate-900">
            Logged Client Payment Trends (₹)
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Actual payment transactions recorded against loan records.
          </p>
          <div className="mt-5 h-60">
            {!data || data.paymentTrends.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg">
                No logged payment transactions in the selected period.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.paymentTrends}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickFormatter={(v) => formatDateDisplay(v)}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickFormatter={(v) => `₹${Number(v).toLocaleString('en-IN')}`}
                  />
                  <Tooltip
                    formatter={(val: unknown) => [
                      formatCurrency(Number(val) || 0),
                      'Payments',
                    ]}
                    labelFormatter={(label) => formatDateDisplay(String(label))}
                  />
                  <Area
                    type="monotone"
                    dataKey="amount"
                    stroke="#047857"
                    fill="#d1fae5"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="text-sm font-semibold text-slate-900">
            Incoming Funding Trends (₹)
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Capital received tracked under Funding Management.
          </p>
          <div className="mt-5 h-60">
            {!data || data.fundingTrends.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-lg">
                No funding transactions in the selected period.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.fundingTrends}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickFormatter={(v) => formatDateDisplay(v)}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickFormatter={(v) => `₹${Number(v).toLocaleString('en-IN')}`}
                  />
                  <Tooltip
                    formatter={(val: unknown) => [
                      formatCurrency(Number(val) || 0),
                      'Funding',
                    ]}
                    labelFormatter={(label) => formatDateDisplay(String(label))}
                  />
                  <Area
                    type="monotone"
                    dataKey="amount"
                    stroke="#0f172a"
                    fill="#e2e8f0"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Recent Loan Updates */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            Recent Loan Records
          </h2>
          <button
            type="button"
            onClick={() => onNavigate('loan-management')}
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:text-slate-900 cursor-pointer"
          >
            <span>View All Loans</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {!data || data.recentLoanUpdates.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No loan records stored yet. Import your Excel workbook under Excel Management.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">LOAN</th>
                  <th className="px-4 py-3">Customer Name</th>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">FOS NAME</th>
                  <th className="px-4 py-3">BKT</th>
                  <th className="px-4 py-3 text-right">EMI</th>
                  <th className="px-4 py-3">Receipt Date</th>
                  <th className="px-4 py-3">Received Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {data.recentLoanUpdates.map((loan) => (
                  <tr
                    key={loan.id}
                    onClick={() => onOpenLoan(loan.id)}
                    className="hover:bg-slate-50/80 cursor-pointer"
                  >
                    <td className="px-4 py-3 font-mono text-slate-400">#{loan.id}</td>
                    <td className="px-4 py-3 font-mono font-semibold text-slate-900 whitespace-nowrap">
                      {loan.loan}
                    </td>
                    <td className="px-4 py-3 text-slate-800 max-w-[180px] truncate">
                      {loan.customerName || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                      {loan.product || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                      {loan.fosName || '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-700 whitespace-nowrap">
                      {loan.bkt || '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-right tabular-nums text-slate-900 whitespace-nowrap">
                      {loan.emi || '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-700 whitespace-nowrap">
                      {loan.receiptDate || '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-700 whitespace-nowrap">
                      {loan.receivedDate || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent Payments & Recent Funding */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">
              Recent Logged Client Payments
            </h2>
          </div>
          {!data || data.recentPayments.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No payment transactions logged yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-2.5">LOAN</th>
                    <th className="px-4 py-2.5">Customer Name</th>
                    <th className="px-4 py-2.5 text-right">Amount</th>
                    <th className="px-4 py-2.5">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {data.recentPayments.map((p) => (
                    <tr
                      key={p.id}
                      onClick={() => onOpenLoan(p.loanRecordId)}
                      className="hover:bg-slate-50/80 cursor-pointer"
                    >
                      <td className="px-4 py-2.5 font-mono font-semibold text-slate-900 whitespace-nowrap">
                        {p.loanNumber}
                      </td>
                      <td className="px-4 py-2.5 text-slate-700 truncate max-w-[150px]">
                        {p.customerName || '—'}
                      </td>
                      <td className="px-4 py-2.5 font-mono font-semibold text-emerald-700 text-right tabular-nums whitespace-nowrap">
                        {formatCurrency(p.amount)}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-600 whitespace-nowrap">
                        {formatDateDisplay(p.paymentDate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              Recent Funding Received
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('funding-management')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 hover:text-slate-900 cursor-pointer"
            >
              <span>Manage Funding</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
          {!data || data.recentFunding.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No funding transactions recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-2.5">Source</th>
                    <th className="px-4 py-2.5 text-right">Amount</th>
                    <th className="px-4 py-2.5">Date</th>
                    <th className="px-4 py-2.5">Reference</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {data.recentFunding.map((f) => (
                    <tr key={f.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-2.5 font-medium text-slate-900">
                        {f.fundingSource}
                      </td>
                      <td className="px-4 py-2.5 font-mono font-semibold text-slate-900 text-right tabular-nums whitespace-nowrap">
                        {formatCurrency(f.amount)}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-600 whitespace-nowrap">
                        {formatDateDisplay(f.fundingDate)}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 truncate max-w-[140px]">
                        {f.referenceDetails || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
