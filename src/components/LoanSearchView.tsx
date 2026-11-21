import { useCallback, useEffect, useState } from 'react';
import { Search, AlertCircle, Download } from 'lucide-react';
import type { ApiClient } from '../lib/api.ts';
import type {
  LoanRecord,
  SyncedWorkbookInfo,
  WorkbookRecord,
} from '../types/app.ts';
import { EditableLoanTable } from './EditableLoanTable.tsx';

interface LoanSearchViewProps {
  api: ApiClient;
  onOpenLoan: (loanId: number) => void;
}

export function LoanSearchView({ api, onOpenLoan }: LoanSearchViewProps) {
  const [query, setQuery] = useState('');
  const [field, setField] = useState<'all' | 'loan' | 'customerName'>('all');
  const [mode, setMode] = useState<'partial' | 'exact'>('partial');
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [results, setResults] = useState<LoanRecord[]>([]);
  const [lastQuery, setLastQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [workbooks, setWorkbooks] = useState<WorkbookRecord[]>([]);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const loadWorkbooks = useCallback(async () => {
    try {
      const res = await api.listWorkbooks();
      setWorkbooks(res.workbooks.filter((w) => w.kind === 'upload'));
    } catch {
      // Non-blocking
    }
  }, [api]);

  useEffect(() => {
    void loadWorkbooks();
  }, [loadWorkbooks]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      setError('Enter a LOAN number or Customer Name to search.');
      return;
    }

    setSearching(true);
    setError(null);
    try {
      const res = await api.searchLoans({ q: trimmed, mode, field });
      setResults(res.loans);
      setLastQuery(trimmed);
      setHasSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search request failed.');
    } finally {
      setSearching(false);
    }
  };

  const handleLoanUpdated = (
    updated: LoanRecord,
    _syncedWorkbook: SyncedWorkbookInfo | null
  ) => {
    setResults((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item))
    );
    void loadWorkbooks();
  };

  const primaryResultWorkbook = (() => {
    const wbId = results.find((r) => r.workbookId)?.workbookId ?? workbooks[0]?.id;
    if (!wbId) return null;
    return workbooks.find((w) => w.id === wbId) ?? null;
  })();

  const handleDownloadWorkbook = async (wb: WorkbookRecord) => {
    setDownloadingId(wb.id);
    setError(null);
    try {
      await api.downloadWorkbook(wb.id, wb.fileName);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to download updated Excel file.'
      );
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-display tracking-tight text-slate-900">
            Loan Search
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Search directly by <strong>LOAN</strong> number or{' '}
            <strong>Customer Name</strong>. Click any cell in the result table to edit
            directly—every change automatically syncs back to your Excel sheet.
          </p>
        </div>

        {primaryResultWorkbook && (
          <button
            type="button"
            disabled={downloadingId === primaryResultWorkbook.id}
            onClick={() => void handleDownloadWorkbook(primaryResultWorkbook)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-60 transition-colors cursor-pointer self-start sm:self-auto whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>
              {downloadingId === primaryResultWorkbook.id
                ? 'Downloading...'
                : `Download Excel (${primaryResultWorkbook.fileName})`}
            </span>
          </button>
        )}
      </div>

      {/* Prominent Search Panel */}
      <form
        onSubmit={handleSearch}
        className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
      >
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Enter LOAN number or Customer Name..."
              aria-label="Search by LOAN number or Customer Name"
              className="w-full pl-11 pr-4 py-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>
          <button
            type="submit"
            disabled={searching}
            className="px-6 py-3 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap"
          >
            {searching ? 'Searching...' : 'Search Supabase'}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-4 pt-1 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-500 uppercase tracking-wider">
              Search Field:
            </span>
            <select
              aria-label="Search field"
              value={field}
              onChange={(e) =>
                setField(e.target.value as 'all' | 'loan' | 'customerName')
              }
              className="px-3 py-1.5 bg-white border border-slate-300 rounded-md text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="all">LOAN & Customer Name</option>
              <option value="loan">LOAN (Primary Identifier)</option>
              <option value="customerName">Customer Name</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-500 uppercase tracking-wider">
              Match Type:
            </span>
            <select
              aria-label="Match type"
              value={mode}
              onChange={(e) => setMode(e.target.value as 'partial' | 'exact')}
              className="px-3 py-1.5 bg-white border border-slate-300 rounded-md text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="partial">Partial Match</option>
              <option value="exact">Exact Match</option>
            </select>
          </div>
        </div>
      </form>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 flex items-center gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Search Results — Direct Inline Editable 11-Column Excel Table */}
      {hasSearched && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              {results.length === 0
                ? `No matching loan records for "${lastQuery}"`
                : `${results.length} matching record${results.length === 1 ? '' : 's'} for "${lastQuery}"`}
            </h2>
          </div>

          {results.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
              <p className="text-sm font-medium text-slate-800">
                No matching loan records found in Supabase.
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Verify the LOAN number or Customer Name, try Partial Match, or check the
                uploaded workbook column matching in Excel Management.
              </p>
            </div>
          ) : (
            <EditableLoanTable
              api={api}
              loans={results}
              onOpenLoan={onOpenLoan}
              onLoanUpdated={handleLoanUpdated}
            />
          )}
        </div>
      )}
    </div>
  );
}
