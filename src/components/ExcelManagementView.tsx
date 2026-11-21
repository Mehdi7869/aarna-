import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Upload,
  FileSpreadsheet,
  Download,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Layers,
  Info,
  Copy,
  Check,
} from 'lucide-react';
import { ApiError, type ApiClient } from '../lib/api.ts';
import type {
  ElevenColumnImportReport,
  SheetPreview,
  WorkbookRecord,
} from '../types/app.ts';
import {
  EXCEL_COLUMNS,
  type ExcelColumnName,
  formatDateTimeDisplay,
} from '../lib/financial.ts';

const STORAGE_SETUP_SQL = `INSERT INTO storage.buckets (id, name, public)
VALUES ('excel-workbooks', 'excel-workbooks', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Users access own workbook objects" ON storage.objects;
CREATE POLICY "Users access own workbook objects"
  ON storage.objects FOR ALL
  TO authenticated
  USING (
    bucket_id = 'excel-workbooks'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'excel-workbooks'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );`;

interface ExcelManagementViewProps {
  api: ApiClient;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function ExcelManagementView({ api }: ExcelManagementViewProps) {
  const [activeTab, setActiveTab] = useState<'import' | 'export' | 'files'>('import');
  const [workbooks, setWorkbooks] = useState<WorkbookRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storageSetupNeeded, setStorageSetupNeeded] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Upload & preview state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [activeWorkbook, setActiveWorkbook] = useState<WorkbookRecord | null>(null);
  const [previews, setPreviews] = useState<Record<string, SheetPreview>>({});
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [columnOverrides, setColumnOverrides] = useState<
    Partial<Record<ExcelColumnName, string | null>>
  >({});
  const [showMappingEditor, setShowMappingEditor] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] = useState<ElevenColumnImportReport | null>(
    null
  );

  // Export state
  const [exportSourceId, setExportSourceId] = useState<string>('');
  const [exportFileName, setExportFileName] = useState<string>('');
  const [overwriteOriginal, setOverwriteOriginal] = useState<boolean>(false);
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState<boolean>(false);
  const [exporting, setExporting] = useState<boolean>(false);

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<WorkbookRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadWorkbooks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listWorkbooks();
      setWorkbooks(res.workbooks);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load stored workbooks.'
      );
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadWorkbooks();
  }, [loadWorkbooks]);

  const activePreview: SheetPreview | null = useMemo(() => {
    if (!selectedSheet) return null;
    return previews[selectedSheet] || null;
  }, [previews, selectedSheet]);

  const computeAutoMapping = useCallback(
    (sheet: SheetPreview | undefined): Partial<Record<ExcelColumnName, string | null>> => {
      const result: Partial<Record<ExcelColumnName, string | null>> = {};
      if (!sheet) return result;
      for (const expected of EXCEL_COLUMNS) {
        const expectedNorm = normalizeHeader(expected);
        const matched = sheet.headers.find(
          (header) => normalizeHeader(header) === expectedNorm
        );
        result[expected] = matched ?? null;
      }
      return result;
    },
    []
  );

  const handleFileSelected = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    setStorageSetupNeeded(false);
    setNotice(null);
    setImportReport(null);
    try {
      const res = await api.uploadWorkbook(file);
      setActiveWorkbook(res.workbook);
      setPreviews(res.preview);
      const firstSheet =
        res.workbook.activeSheet || res.workbook.sheetNames[0] || '';
      setSelectedSheet(firstSheet);
      setColumnOverrides(
        res.workbook.columnMapping &&
          Object.keys(res.workbook.columnMapping).length > 0
          ? res.workbook.columnMapping
          : computeAutoMapping(res.preview[firstSheet])
      );
      setShowMappingEditor(false);
      if (res.autoImportReport) {
        setImportReport(res.autoImportReport);
        setNotice(
          `Uploaded "${res.workbook.fileName}" and automatically imported ${res.autoImportReport.inserted} record(s). All rows are now live in Loan Search & Loan Management, and any inline table edits sync directly back to this Excel file.`
        );
      } else {
        setNotice(
          `Uploaded "${res.workbook.fileName}" to Supabase Storage. Match the LOAN column below and click Import.`
        );
      }
      await loadWorkbooks();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to upload Excel file.';
      setError(message);
      if (
        (err instanceof ApiError &&
          (err.code === 'STORAGE_BUCKET_MISSING' ||
            err.code === 'STORAGE_POLICY_MISSING')) ||
        message.toLowerCase().includes('bucket')
      ) {
        setStorageSetupNeeded(true);
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleOpenPreview = async (wb: WorkbookRecord) => {
    setError(null);
    setNotice(null);
    setImportReport(wb.importReport || null);
    try {
      const res = await api.getWorkbookPreview(wb.id);
      setActiveWorkbook(res.workbook);
      setPreviews(res.preview);
      const sheet = res.workbook.activeSheet || res.workbook.sheetNames[0] || '';
      setSelectedSheet(sheet);
      setColumnOverrides(
        res.workbook.columnMapping && Object.keys(res.workbook.columnMapping).length > 0
          ? res.workbook.columnMapping
          : computeAutoMapping(res.preview[sheet])
      );
      setShowMappingEditor(false);
      setActiveTab('import');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load workbook preview.'
      );
    }
  };

  const handleSheetChange = (nextSheet: string) => {
    setSelectedSheet(nextSheet);
    setColumnOverrides(computeAutoMapping(previews[nextSheet]));
    setImportReport(null);
  };

  const handleRunImport = async () => {
    if (!activeWorkbook || !selectedSheet) return;
    if (!columnOverrides['LOAN']) {
      setError(
        'The "LOAN" column must be matched to a worksheet column before importing.'
      );
      return;
    }

    setImporting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.importWorkbookSheet(
        activeWorkbook.id,
        selectedSheet,
        columnOverrides
      );
      setImportReport(res.report);
      setNotice(
        `Import finished: ${res.report.inserted} record(s) stored in Supabase PostgreSQL` +
          (res.report.repeatedLoanNumbers.length > 0
            ? ` (${res.report.repeatedLoanNumbers.length} row(s) with repeated LOAN numbers preserved with unique internal IDs).`
            : '.')
      );
      await loadWorkbooks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Excel import failed.');
    } finally {
      setImporting(false);
    }
  };

  const executeExport = async (confirmedOverwrite: boolean) => {
    setExporting(true);
    setError(null);
    setNotice(null);
    try {
      const sourceWorkbookId = exportSourceId ? Number(exportSourceId) : null;
      const res = await api.exportWorkbook({
        sourceWorkbookId,
        fileName: exportFileName.trim() || undefined,
        overwriteOriginal,
        confirmOverwrite: confirmedOverwrite,
      });
      setShowOverwriteConfirm(false);
      await loadWorkbooks();
      await api.downloadWorkbook(res.workbook.id, res.workbook.fileName);
      setNotice(
        res.workbook.overwritten
          ? `Overwrote "${res.workbook.fileName}" in Supabase Storage with the latest 11-column data and started download.`
          : `Exported "${res.workbook.fileName}" with the exact 11-column structure, saved in Supabase Storage, and started download.`
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to export workbook.';
      setError(message);
      if (
        (err instanceof ApiError &&
          (err.code === 'STORAGE_BUCKET_MISSING' ||
            err.code === 'STORAGE_POLICY_MISSING')) ||
        message.toLowerCase().includes('bucket')
      ) {
        setStorageSetupNeeded(true);
      }
    } finally {
      setExporting(false);
    }
  };

  const handleExportSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (overwriteOriginal && exportSourceId) {
      setShowOverwriteConfirm(true);
      return;
    }
    void executeExport(false);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);
    try {
      await api.deleteWorkbook(deleteTarget.id);
      if (activeWorkbook?.id === deleteTarget.id) {
        setActiveWorkbook(null);
        setPreviews({});
        setSelectedSheet('');
        setImportReport(null);
      }
      setDeleteTarget(null);
      setNotice('Workbook removed from Supabase Storage.');
      await loadWorkbooks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete workbook.');
    } finally {
      setDeleting(false);
    }
  };

  const uploadedWorkbooks = useMemo(
    () => workbooks.filter((w) => w.kind === 'upload'),
    [workbooks]
  );

  const matchedCount = useMemo(() => {
    return EXCEL_COLUMNS.filter((col) => Boolean(columnOverrides[col])).length;
  }, [columnOverrides]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-display tracking-tight text-slate-900">
            Excel Management
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Upload .xlsx/.xls workbooks to Supabase Storage, verify the exact 11-column
            structure, import every row into PostgreSQL, and export updated files.
          </p>
        </div>

        <div className="inline-flex bg-white border border-slate-200 rounded-lg p-1 self-start">
          {(
            [
              { id: 'import', label: 'Upload & Import' },
              { id: 'export', label: 'Export Excel' },
              { id: 'files', label: `Stored Files (${workbooks.length})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={() => void loadWorkbooks()}
              className="px-2.5 py-1 text-xs font-semibold text-red-800 bg-red-100 rounded-md hover:bg-red-200 transition-colors cursor-pointer shrink-0"
            >
              Retry
            </button>
          </div>

          {storageSetupNeeded && (
            <div className="bg-white border border-red-200 rounded-lg p-4 text-slate-800 space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold text-slate-900">
                  One-Time Supabase Storage Setup (run in Supabase Dashboard → SQL Editor)
                </p>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(STORAGE_SETUP_SQL);
                    setCopiedSql(true);
                    setTimeout(() => setCopiedSql(false), 2500);
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-slate-800 bg-slate-100 rounded-md hover:bg-slate-200 cursor-pointer shrink-0"
                >
                  {copiedSql ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-700" />
                      <span>Copied SQL</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy Storage SQL</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="text-[11px] font-mono bg-slate-50 border border-slate-200 rounded-md p-3 overflow-x-auto text-slate-700 leading-relaxed">
                {STORAGE_SETUP_SQL}
              </pre>
            </div>
          )}
        </div>
      )}

      {notice && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-800 flex items-start gap-2.5">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{notice}</span>
        </div>
      )}

      {/* TAB 1: UPLOAD & IMPORT */}
      {activeTab === 'import' && (
        <div className="space-y-6">
          {/* Upload Dropzone */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  1. Upload Excel Workbook (.xlsx or .xls)
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  The original file is preserved in Supabase Storage. Expected exact
                  columns: {EXCEL_COLUMNS.join(', ')}.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  onChange={(e) =>
                    void handleFileSelected(e.target.files?.[0] || null)
                  }
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Upload className="w-4 h-4" />
                  <span>{uploading ? 'Uploading...' : 'Select Excel File'}</span>
                </button>
              </div>
            </div>

            {uploadedWorkbooks.length > 0 && !activeWorkbook && (
              <div className="mt-5 pt-5 border-t border-slate-100">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
                  Or Re-open an Uploaded Workbook for Preview & Import
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {uploadedWorkbooks.slice(0, 6).map((wb) => (
                    <button
                      key={wb.id}
                      type="button"
                      onClick={() => void handleOpenPreview(wb)}
                      className="text-left p-3.5 border border-slate-200 rounded-lg hover:border-slate-400 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2 text-sm font-medium text-slate-900 truncate">
                        <FileSpreadsheet className="w-4 h-4 text-slate-500 shrink-0" />
                        <span className="truncate">{wb.fileName}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500 font-mono">
                        {wb.importedCount} imported · {formatBytes(wb.fileSize)}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Active Workbook Preview & Column Verification */}
          {activeWorkbook && activePreview && (
            <>
              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-200">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">
                      2. Verify 11-Column Structure & Preview Data
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                      File: <span className="font-medium text-slate-800">{activeWorkbook.fileName}</span>{' '}
                      · {activePreview.rowCount} data row(s) detected on sheet{' '}
                      <span className="font-medium text-slate-800">{activePreview.name}</span>.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    {activeWorkbook.sheetNames.length > 1 && (
                      <div className="flex items-center gap-2">
                        <Layers className="w-4 h-4 text-slate-500" />
                        <select
                          aria-label="Select worksheet"
                          value={selectedSheet}
                          onChange={(e) => handleSheetChange(e.target.value)}
                          className="px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                        >
                          {activeWorkbook.sheetNames.map((name) => (
                            <option key={name} value={name}>
                              Sheet: {name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => setShowMappingEditor((prev) => !prev)}
                      className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer"
                    >
                      {showMappingEditor
                        ? 'Hide Column Overrides'
                        : `Column Matching (${matchedCount}/11)`}
                    </button>

                    <button
                      type="button"
                      disabled={importing || activePreview.rowCount === 0}
                      onClick={() => void handleRunImport()}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <span>
                        {importing
                          ? 'Importing to Supabase...'
                          : `Import ${activePreview.rowCount} Row(s)`}
                      </span>
                    </button>
                  </div>
                </div>

                {/* 11-Column Match Summary */}
                <div className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
                    {EXCEL_COLUMNS.map((col) => {
                      const mappedHeader = columnOverrides[col] ?? null;
                      return (
                        <div
                          key={col}
                          className={`px-3 py-2 rounded-lg border text-xs ${
                            mappedHeader
                              ? 'border-slate-200 bg-slate-50 text-slate-800'
                              : 'border-amber-200 bg-amber-50/60 text-amber-900'
                          }`}
                        >
                          <div className="font-semibold flex items-center justify-between gap-2">
                            <span className="truncate">{col}</span>
                            <span
                              className={
                                mappedHeader
                                  ? 'text-emerald-700 font-medium shrink-0'
                                  : 'text-amber-700 font-medium shrink-0'
                              }
                            >
                              {mappedHeader ? 'Matched' : 'Missing'}
                            </span>
                          </div>
                          {mappedHeader && mappedHeader !== col && (
                            <p className="mt-0.5 text-[11px] text-slate-500 truncate">
                              From: {mappedHeader}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {activePreview.extraColumns.length > 0 && (
                    <p className="text-xs text-slate-500">
                      Additional columns found in sheet (preserved in raw metadata, not
                      added to the 11-column schema):{' '}
                      <span className="font-medium text-slate-700">
                        {activePreview.extraColumns.join(', ')}
                      </span>
                    </p>
                  )}

                  <div className="flex items-start gap-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5">
                    <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                    <span>
                      Every row with a <strong>LOAN</strong> value is imported with its own
                      unique internal database ID. Multiple rows sharing the same LOAN
                      number are preserved without overwriting. <strong>EMI</strong> is
                      stored verbatim and never treated as an amount received.
                    </span>
                  </div>
                </div>

                {/* Optional Column Override Dropdowns */}
                {showMappingEditor && (
                  <div className="pt-4 border-t border-slate-200">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
                      Adjust Column Matching (Optional)
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {EXCEL_COLUMNS.map((expectedCol) => (
                        <div key={expectedCol}>
                          <label className="block text-xs font-medium text-slate-700 mb-1">
                            {expectedCol}
                            {expectedCol === 'LOAN' && (
                              <span className="text-red-600 ml-1">*</span>
                            )}
                          </label>
                          <select
                            value={columnOverrides[expectedCol] ?? ''}
                            onChange={(e) =>
                              setColumnOverrides((prev) => ({
                                ...prev,
                                [expectedCol]: e.target.value || null,
                              }))
                            }
                            className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                          >
                            <option value="">(Not present in sheet)</option>
                            {activePreview.headers.map((header) => (
                              <option key={header} value={header}>
                                {header}
                              </option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Actual Excel Data Preview Table */}
                <div className="pt-2">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Actual Worksheet Preview (Showing up to first 25 rows)
                    </h3>
                    <span className="text-xs text-slate-500 font-mono tabular-nums">
                      {activePreview.previewRows.length} of {activePreview.rowCount} rows
                    </span>
                  </div>

                  {activePreview.previewRows.length === 0 ? (
                    <div className="py-10 text-center text-sm text-slate-500 border border-dashed border-slate-200 rounded-lg">
                      No data rows found in this worksheet.
                    </div>
                  ) : (
                    <div className="overflow-x-auto border border-slate-200 rounded-lg">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200">
                            <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">
                              Row
                            </th>
                            {activePreview.headers.map((header) => (
                              <th
                                key={header}
                                className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-600 whitespace-nowrap"
                              >
                                {header}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-xs">
                          {activePreview.previewRows.map((row) => (
                            <tr key={row.rowNumber} className="hover:bg-slate-50/70">
                              <td className="px-3 py-2 font-mono text-slate-400 tabular-nums whitespace-nowrap">
                                {row.rowNumber}
                              </td>
                              {activePreview.headers.map((header) => {
                                const val = row.values[header];
                                return (
                                  <td
                                    key={header}
                                    className="px-3 py-2 text-slate-800 whitespace-nowrap max-w-[240px] truncate"
                                    title={val === null || val === undefined ? '' : String(val)}
                                  >
                                    {val === null || val === undefined || val === ''
                                      ? '—'
                                      : String(val)}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              {/* Import Results Report */}
              {importReport && (
                <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                  <h2 className="text-base font-semibold text-slate-900">
                    Import Summary
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="p-4 border border-slate-200 rounded-lg">
                      <p className="text-xs font-medium text-slate-500">
                        Records Imported
                      </p>
                      <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-emerald-700">
                        {importReport.inserted}
                      </p>
                    </div>
                    <div className="p-4 border border-slate-200 rounded-lg">
                      <p className="text-xs font-medium text-slate-500">
                        Repeated LOAN Rows Retained
                      </p>
                      <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
                        {importReport.repeatedLoanNumbers.length}
                      </p>
                    </div>
                    <div className="p-4 border border-slate-200 rounded-lg">
                      <p className="text-xs font-medium text-slate-500">
                        Failed Rows
                      </p>
                      <p className="mt-1 text-2xl font-bold font-mono tabular-nums text-red-700">
                        {importReport.errors.length}
                      </p>
                    </div>
                  </div>

                  {importReport.repeatedLoanNumbers.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600 mb-2">
                        Multiple Records with Same LOAN Number (All Preserved with Unique IDs)
                      </h3>
                      <div className="max-h-44 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100 text-xs">
                        {importReport.repeatedLoanNumbers.slice(0, 50).map((item, idx) => (
                          <div
                            key={`${item.rowNumber}-${idx}`}
                            className="px-3.5 py-2 flex items-center justify-between gap-4"
                          >
                            <span className="font-mono text-slate-800">
                              Row {item.rowNumber} · LOAN {item.loan}
                            </span>
                            <span className="text-slate-500">{item.note}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {importReport.errors.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-red-700 mb-2">
                        Failed Rows
                      </h3>
                      <div className="max-h-44 overflow-y-auto border border-red-200 rounded-lg divide-y divide-red-100 text-xs">
                        {importReport.errors.slice(0, 50).map((item, idx) => (
                          <div
                            key={`${item.rowNumber}-${idx}`}
                            className="px-3.5 py-2 flex items-center justify-between gap-4 text-red-700"
                          >
                            <span className="font-mono">Row {item.rowNumber}</span>
                            <span>{item.reason}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* TAB 2: EXPORT EXCEL */}
      {activeTab === 'export' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 max-w-2xl">
          <h2 className="text-base font-semibold text-slate-900">
            Export Updated Records to Excel (.xlsx)
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Exports the latest database records from Supabase using the exact 11-column
            structure ({EXCEL_COLUMNS.join(', ')}), without adding or renaming columns.
          </p>

          <form onSubmit={handleExportSubmit} className="mt-6 space-y-5">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                Records Scope
              </label>
              <select
                value={exportSourceId}
                onChange={(e) => {
                  setExportSourceId(e.target.value);
                  if (!e.target.value) setOverwriteOriginal(false);
                }}
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              >
                <option value="">All Loan Records in Supabase</option>
                {uploadedWorkbooks.map((wb) => (
                  <option key={wb.id} value={String(wb.id)}>
                    Only records from: {wb.fileName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                Export File Name (optional)
              </label>
              <input
                type="text"
                value={exportFileName}
                onChange={(e) => setExportFileName(e.target.value)}
                placeholder="Leave blank to auto-generate timestamped .xlsx name"
                disabled={overwriteOriginal}
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:bg-slate-100 disabled:text-slate-500"
              />
            </div>

            {exportSourceId && (
              <label className="flex items-start gap-2.5 p-3.5 border border-slate-200 rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  checked={overwriteOriginal}
                  onChange={(e) => setOverwriteOriginal(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                />
                <span className="text-xs text-slate-700 leading-relaxed">
                  <strong className="text-slate-900">
                    Overwrite original uploaded file in Supabase Storage
                  </strong>
                  <br />
                  By default, a new exported file is created so your original uploaded
                  workbook stays intact. Checking this will require explicit confirmation.
                </span>
              </label>
            )}

            <button
              type="submit"
              disabled={exporting}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 disabled:opacity-60 transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>{exporting ? 'Generating Excel...' : 'Export & Download .xlsx'}</span>
            </button>
          </form>
        </div>
      )}

      {/* TAB 3: STORED FILES */}
      {activeTab === 'files' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200">
            <h2 className="text-base font-semibold text-slate-900">
              Supabase Storage Workbook Library
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Original uploaded Excel files and exported workbooks stored in Supabase
              Storage.
            </p>
          </div>

          {loading ? (
            <div className="p-8 text-center text-sm text-slate-500">
              Loading stored workbooks...
            </div>
          ) : workbooks.length === 0 ? (
            <div className="p-12 text-center text-sm text-slate-500">
              No Excel workbooks uploaded or exported yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="px-5 py-3">File Name</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Active Sheet</th>
                    <th className="px-4 py-3 text-right">Rows Imported</th>
                    <th className="px-4 py-3 text-right">Size</th>
                    <th className="px-4 py-3">Updated</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {workbooks.map((wb) => (
                    <tr key={wb.id} className="hover:bg-slate-50/70">
                      <td className="px-5 py-3 font-medium text-slate-900">
                        {wb.fileName}
                      </td>
                      <td className="px-4 py-3 text-xs font-semibold text-slate-600 uppercase">
                        {wb.kind}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {wb.activeSheet || wb.sheetNames[0] || '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-800">
                        {wb.importedCount}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-xs text-slate-500">
                        {formatBytes(wb.fileSize)}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                        {formatDateTimeDisplay(wb.updatedAt)}
                      </td>
                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          {wb.kind === 'upload' && (
                            <button
                              type="button"
                              onClick={() => void handleOpenPreview(wb)}
                              className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200 cursor-pointer"
                            >
                              Preview / Import
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void api.downloadWorkbook(wb.id, wb.fileName)}
                            className="p-1.5 text-slate-600 hover:text-slate-900 cursor-pointer"
                            title="Download Excel file"
                            aria-label={`Download ${wb.fileName}`}
                          >
                            <Download className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(wb)}
                            className="p-1.5 text-slate-500 hover:text-red-600 cursor-pointer"
                            title="Remove file from Storage"
                            aria-label={`Delete ${wb.fileName}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Overwrite Confirmation Modal */}
      {showOverwriteConfirm && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-900">
              Confirm Overwrite of Original Workbook
            </h3>
            <p className="text-sm text-slate-600">
              This will replace the original uploaded Excel file in Supabase Storage with
              the latest 11-column exported workbook. This action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowOverwriteConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={exporting}
                onClick={() => void executeExport(true)}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-60 cursor-pointer"
              >
                {exporting ? 'Overwriting...' : 'Confirm Overwrite'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete File Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-900">
              Remove Stored Workbook
            </h3>
            <p className="text-sm text-slate-600">
              Remove <span className="font-medium text-slate-900">{deleteTarget.fileName}</span>{' '}
              from Supabase Storage? Imported loan records in PostgreSQL will remain
              intact.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void handleConfirmDelete()}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-60 cursor-pointer"
              >
                {deleting ? 'Removing...' : 'Remove File'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
