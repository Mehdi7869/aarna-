import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import { requireAuth, type AuthRequest } from './middleware/auth.ts';
import {
  getSupabaseAuthClient,
  getSupabaseConfigStatus,
  runWithSupabaseAccessToken,
} from './lib/supabase.ts';
import {
  addLoanPaymentTransaction,
  createFundingTransaction,
  createManualLoan,
  createUploadedWorkbook,
  deleteFundingTransaction,
  deleteLoanPaymentTransaction,
  deleteLoanRecord,
  deleteWorkbookById,
  DomainError,
  getDashboardAnalytics,
  getLoanByIdWithPayments,
  getWorkbookBinary,
  getWorkbookWithPreview,
  importWorkbookSheet,
  listFundingTransactions,
  listLoans,
  listWorkbooks,
  saveExportedWorkbook,
  searchLoansByLoanOrCustomer,
  updateFundingTransaction,
  updateLoanRecord,
} from './db/supabase-repositories.ts';
import { buildExportWorkbookBuffer } from './lib/excel.ts';

function toProxySafeStatus(status: number): number {
  // Hosting proxies (such as AI Studio nginx) intercept 403/502/503/504 and
  // replace JSON API responses with HTML pages.
  if (status === 403) return 422;
  if (status === 502 || status === 503 || status === 504) return 500;
  return status;
}

function handleRouteError(res: Response, error: unknown, fallbackMessage: string) {
  if (error instanceof DomainError) {
    res.status(toProxySafeStatus(error.statusCode)).json({
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
    });
    return;
  }
  const message =
    error instanceof Error && error.message ? error.message : fallbackMessage;
  res.status(500).json({ error: message });
}

export function createApiApp() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    next();
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 25 * 1024 * 1024, // 25 MB max workbook
    },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (ext === '.xlsx' || ext === '.xls') {
        cb(null, true);
      } else {
        cb(new Error('Only .xlsx and .xls Excel files are supported.'));
      }
    },
  });

  // Health check
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // Public configuration check (exposes only missing env var names, never secret values)
  app.get('/api/config/status', (_req: Request, res: Response) => {
    const status = getSupabaseConfigStatus();
    res.json({
      configured: status.configured,
      missingKeys: status.missingKeys,
    });
  });

  // ============================================================================
  // SUPABASE AUTHENTICATION PROXY ROUTES
  // ============================================================================
  app.post('/api/auth/signup', async (req: Request, res: Response) => {
    const config = getSupabaseConfigStatus();
    if (!config.configured) {
      res.status(422).json({
        error: `Supabase is not configured. Add ${config.missingKeys.join(', ')} in your environment variables.`,
      });
      return;
    }

    try {
      const { email, password, fullName } = req.body || {};
      const trimmedEmail = typeof email === 'string' ? email.trim() : '';
      const pwd = typeof password === 'string' ? password : '';
      const cleanName = typeof fullName === 'string' ? fullName.trim() : '';

      if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
        res.status(400).json({ error: 'Please enter a valid email address.' });
        return;
      }
      if (pwd.length < 6) {
        res
          .status(400)
          .json({ error: 'Password must be at least 6 characters long.' });
        return;
      }

      const authClient = getSupabaseAuthClient();
      const { data, error } = await authClient.auth.signUp({
        email: trimmedEmail,
        password: pwd,
        options: cleanName ? { data: { full_name: cleanName } } : undefined,
      });

      if (error) {
        res.status(400).json({ error: error.message });
        return;
      }

      if (!data.session || !data.user) {
        res.status(201).json({
          needsEmailConfirmation: true,
          message:
            'Account created. Check your inbox to confirm your email address, then sign in.',
        });
        return;
      }

      res.status(201).json({
        needsEmailConfirmation: false,
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at ?? null,
        user: {
          id: data.user.id,
          email: data.user.email || trimmedEmail,
          displayName:
            (data.user.user_metadata?.full_name as string | undefined) ||
            cleanName ||
            null,
        },
      });
    } catch (error) {
      handleRouteError(res, error, 'Unable to create account.');
    }
  });

  app.post('/api/auth/login', async (req: Request, res: Response) => {
    const config = getSupabaseConfigStatus();
    if (!config.configured) {
      res.status(422).json({
        error: `Supabase is not configured. Add ${config.missingKeys.join(', ')} in your environment variables.`,
      });
      return;
    }

    try {
      const { email, password } = req.body || {};
      const trimmedEmail = typeof email === 'string' ? email.trim() : '';
      const pwd = typeof password === 'string' ? password : '';

      if (!trimmedEmail || !pwd) {
        res.status(400).json({ error: 'Email and password are required.' });
        return;
      }

      const authClient = getSupabaseAuthClient();
      const { data, error } = await authClient.auth.signInWithPassword({
        email: trimmedEmail,
        password: pwd,
      });

      if (error || !data.session || !data.user) {
        res
          .status(401)
          .json({ error: error?.message || 'Invalid email or password.' });
        return;
      }

      const meta = data.user.user_metadata || {};
      res.json({
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at ?? null,
        user: {
          id: data.user.id,
          email: data.user.email || trimmedEmail,
          displayName:
            typeof meta.full_name === 'string' && meta.full_name.trim()
              ? meta.full_name.trim()
              : typeof meta.name === 'string' && meta.name.trim()
                ? meta.name.trim()
                : null,
        },
      });
    } catch (error) {
      handleRouteError(res, error, 'Unable to sign in.');
    }
  });

  app.post('/api/auth/refresh', async (req: Request, res: Response) => {
    const config = getSupabaseConfigStatus();
    if (!config.configured) {
      res.status(422).json({ error: 'Supabase is not configured.' });
      return;
    }

    try {
      const { refreshToken } = req.body || {};
      if (typeof refreshToken !== 'string' || !refreshToken.trim()) {
        res.status(400).json({ error: 'Refresh token is required.' });
        return;
      }

      const authClient = getSupabaseAuthClient();
      const { data, error } = await authClient.auth.refreshSession({
        refresh_token: refreshToken,
      });

      if (error || !data.session || !data.user) {
        res.status(401).json({ error: 'Session expired. Please sign in again.' });
        return;
      }

      const meta = data.user.user_metadata || {};
      res.json({
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at ?? null,
        user: {
          id: data.user.id,
          email: data.user.email || '',
          displayName:
            typeof meta.full_name === 'string' && meta.full_name.trim()
              ? meta.full_name.trim()
              : null,
        },
      });
    } catch (error) {
      handleRouteError(res, error, 'Unable to refresh session.');
    }
  });

  app.get('/api/auth/me', requireAuth, (req: AuthRequest, res: Response) => {
    res.json({ user: req.authUser });
  });

  // ============================================================================
  // DASHBOARD
  // ============================================================================
  app.get('/api/dashboard', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const startDate =
        typeof req.query.startDate === 'string' ? req.query.startDate : undefined;
      const endDate =
        typeof req.query.endDate === 'string' ? req.query.endDate : undefined;
      const data = await getDashboardAnalytics(req.authUser!.id, {
        startDate,
        endDate,
      });
      res.json(data);
    } catch (error) {
      handleRouteError(res, error, 'Failed to load dashboard data.');
    }
  });

  // ============================================================================
  // EXCEL MANAGEMENT (EXACT 11-COLUMN UPLOAD, PREVIEW, IMPORT & EXPORT)
  // ============================================================================
  app.get('/api/excel/workbooks', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const workbooks = await listWorkbooks(req.authUser!.id);
      res.json({ workbooks });
    } catch (error) {
      handleRouteError(res, error, 'Failed to load Excel workbooks.');
    }
  });

  app.post('/api/excel/upload', requireAuth, async (req: AuthRequest, res: Response) => {
    const runUpload = async (originalName: string, buffer: Buffer) => {
      const ext = path.extname(originalName).toLowerCase();
      if (ext !== '.xlsx' && ext !== '.xls') {
        res
          .status(400)
          .json({ error: 'Only .xlsx and .xls Excel files are supported.' });
        return;
      }
      if (buffer.length === 0) {
        res.status(400).json({ error: 'The selected Excel file is empty.' });
        return;
      }
      if (buffer.length > 25 * 1024 * 1024) {
        res
          .status(400)
          .json({ error: 'Excel file exceeds the 25 MB maximum size limit.' });
        return;
      }

      const normalizedMime =
        ext === '.xls'
          ? 'application/vnd.ms-excel'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

      const executeUpload = async () => {
        try {
          const result = await createUploadedWorkbook({
            userId: req.authUser!.id,
            fileName: originalName,
            mimeType: normalizedMime,
            fileSize: buffer.length,
            buffer,
          });
          res.status(201).json(result);
        } catch (error) {
          handleRouteError(res, error, 'Failed to upload and parse Excel file.');
        }
      };

      if (req.accessToken) {
        await runWithSupabaseAccessToken(req.accessToken, executeUpload);
      } else {
        await executeUpload();
      }
    };

    // Primary JSON base64 upload path
    if (req.is('application/json') && req.body && typeof req.body === 'object') {
      const { fileName, fileDataBase64 } = req.body as {
        fileName?: unknown;
        fileDataBase64?: unknown;
      };
      if (typeof fileName !== 'string' || !fileName.trim()) {
        res.status(400).json({ error: 'Missing Excel file name.' });
        return;
      }
      if (typeof fileDataBase64 !== 'string' || !fileDataBase64.trim()) {
        res.status(400).json({ error: 'Missing Excel file content.' });
        return;
      }
      const decoded = Buffer.from(fileDataBase64, 'base64');
      await runUpload(fileName.trim(), decoded);
      return;
    }

    // Fallback multipart/form-data upload path
    upload.single('file')(req, res, async (uploadErr) => {
      if (uploadErr) {
        res.status(400).json({ error: uploadErr.message || 'File upload failed.' });
        return;
      }
      if (!req.file) {
        res
          .status(400)
          .json({ error: 'Please select an Excel (.xlsx or .xls) file.' });
        return;
      }
      await runUpload(req.file.originalname, req.file.buffer);
    });
  });

  app.get(
    '/api/excel/workbooks/:id/preview',
    requireAuth,
    async (req: AuthRequest, res: Response) => {
      try {
        const workbookId = Number(req.params.id);
        if (!Number.isInteger(workbookId) || workbookId <= 0) {
          res.status(400).json({ error: 'Invalid workbook ID.' });
          return;
        }
        const result = await getWorkbookWithPreview(req.authUser!.id, workbookId);
        res.json(result);
      } catch (error) {
        handleRouteError(res, error, 'Failed to load workbook preview.');
      }
    }
  );

  app.post(
    '/api/excel/workbooks/:id/import',
    requireAuth,
    async (req: AuthRequest, res: Response) => {
      try {
        const workbookId = Number(req.params.id);
        if (!Number.isInteger(workbookId) || workbookId <= 0) {
          res.status(400).json({ error: 'Invalid workbook ID.' });
          return;
        }
        const { sheetName, columnOverrides } = req.body || {};
        if (!sheetName || typeof sheetName !== 'string') {
          res.status(400).json({ error: 'Please select a worksheet to import.' });
          return;
        }

        const report = await importWorkbookSheet({
          userId: req.authUser!.id,
          workbookId,
          sheetName,
          columnOverrides:
            columnOverrides && typeof columnOverrides === 'object'
              ? columnOverrides
              : undefined,
        });
        res.json({ report });
      } catch (error) {
        handleRouteError(res, error, 'Failed to import worksheet records.');
      }
    }
  );

  app.post('/api/excel/export', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const {
        sourceWorkbookId,
        fileName,
        overwriteOriginal = false,
        confirmOverwrite = false,
      } = req.body || {};

      if (overwriteOriginal && !confirmOverwrite) {
        res.status(400).json({
          error:
            'Explicit confirmation is required before overwriting an original uploaded workbook.',
        });
        return;
      }

      const userId = req.authUser!.id;
      const parsedSourceId =
        sourceWorkbookId !== null &&
        sourceWorkbookId !== undefined &&
        sourceWorkbookId !== ''
          ? Number(sourceWorkbookId)
          : null;

      let sourceWb: Awaited<ReturnType<typeof getWorkbookBinary>> | null = null;
      if (parsedSourceId && Number.isInteger(parsedSourceId) && parsedSourceId > 0) {
        sourceWb = await getWorkbookBinary(userId, parsedSourceId);
      }

      const { loans: allLoans } = await listLoans(
        userId,
        sourceWb ? { workbookId: sourceWb.id } : undefined
      );

      if (allLoans.length === 0) {
        res.status(400).json({
          error: 'There are no saved loan records in Supabase to export yet.',
        });
        return;
      }

      const exportBuild = buildExportWorkbookBuffer({
        loans: allLoans,
        sourceWorkbook: sourceWb
          ? {
              fileDataBase64: sourceWb.fileDataBase64,
              activeSheet: sourceWb.activeSheet,
              sheetNames: sourceWb.sheetNames,
            }
          : null,
      });

      const timestamp = new Date().toISOString().slice(0, 10);
      const defaultName = sourceWb
        ? `${path.parse(sourceWb.fileName).name}_updated_${timestamp}.xlsx`
        : `aarna_enterprises_loans_${timestamp}.xlsx`;

      const cleanFileName =
        typeof fileName === 'string' && fileName.trim()
          ? fileName.trim().endsWith('.xlsx')
            ? fileName.trim()
            : `${fileName.trim()}.xlsx`
          : defaultName;

      const saved = await saveExportedWorkbook({
        userId,
        fileName: cleanFileName,
        buffer: exportBuild.buffer,
        sheetNames: exportBuild.sheetNames,
        activeSheet: exportBuild.primarySheetName,
        columnHeaders: exportBuild.columnHeaders,
        rowCount: exportBuild.rowCount,
        sourceWorkbookId: sourceWb ? sourceWb.id : null,
        overwriteSourceWorkbook: Boolean(
          overwriteOriginal && confirmOverwrite && sourceWb
        ),
      });

      res.status(201).json({ workbook: saved });
    } catch (error) {
      handleRouteError(res, error, 'Failed to generate Excel export.');
    }
  });

  app.get(
    '/api/excel/workbooks/:id/download',
    requireAuth,
    async (req: AuthRequest, res: Response) => {
      try {
        const workbookId = Number(req.params.id);
        if (!Number.isInteger(workbookId) || workbookId <= 0) {
          res.status(400).json({ error: 'Invalid workbook ID.' });
          return;
        }
        const wb = await getWorkbookBinary(req.authUser!.id, workbookId);
        res.setHeader(
          'Content-Type',
          wb.mimeType ||
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${encodeURIComponent(wb.fileName)}"`
        );
        res.setHeader('Content-Length', String(wb.buffer.length));
        res.send(wb.buffer);
      } catch (error) {
        handleRouteError(res, error, 'Failed to download workbook.');
      }
    }
  );

  app.delete(
    '/api/excel/workbooks/:id',
    requireAuth,
    async (req: AuthRequest, res: Response) => {
      try {
        const workbookId = Number(req.params.id);
        if (!Number.isInteger(workbookId) || workbookId <= 0) {
          res.status(400).json({ error: 'Invalid workbook ID.' });
          return;
        }
        const result = await deleteWorkbookById(req.authUser!.id, workbookId);
        res.json(result);
      } catch (error) {
        handleRouteError(res, error, 'Failed to delete workbook.');
      }
    }
  );

  // ============================================================================
  // LOANS, FILTERING, SEARCH & PAYMENTS
  // ============================================================================
  app.get('/api/loans', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const qStr = (key: string) =>
        typeof req.query[key] === 'string' && String(req.query[key]).trim()
          ? String(req.query[key]).trim()
          : undefined;

      const wbParam = qStr('workbookId');
      const workbookId = wbParam ? Number(wbParam) : undefined;

      const result = await listLoans(req.authUser!.id, {
        workbookId: Number.isInteger(workbookId) ? workbookId : undefined,
        product: qStr('product'),
        fosName: qStr('fosName'),
        bkt: qStr('bkt'),
        receiptMode: qStr('receiptMode'),
        receiptDateFrom: qStr('receiptDateFrom'),
        receiptDateTo: qStr('receiptDateTo'),
        receivedDateFrom: qStr('receivedDateFrom'),
        receivedDateTo: qStr('receivedDateTo'),
        search: qStr('search'),
      });
      res.json(result);
    } catch (error) {
      handleRouteError(res, error, 'Failed to load loans.');
    }
  });

  app.get('/api/loans/search', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const mode = req.query.mode === 'exact' ? 'exact' : 'partial';
      const field =
        req.query.field === 'loan' || req.query.field === 'customerName'
          ? req.query.field
          : 'all';

      const results = await searchLoansByLoanOrCustomer({
        userId: req.authUser!.id,
        query: q,
        mode,
        field,
      });
      res.json({ loans: results, query: q, mode, field });
    } catch (error) {
      handleRouteError(res, error, 'Failed to search loans.');
    }
  });

  app.post('/api/loans', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const b = req.body || {};
      const parsedWbId =
        b.workbookId !== null && b.workbookId !== undefined && b.workbookId !== ''
          ? Number(b.workbookId)
          : null;
      const result = await createManualLoan(req.authUser!.id, {
        loan: String(b.loan || ''),
        emi: b.emi ?? null,
        customerName: b.customerName ?? null,
        fosName: b.fosName ?? null,
        bkt: b.bkt ?? null,
        bankingRemarks: b.bankingRemarks ?? null,
        receiptDate: b.receiptDate ?? null,
        receiptMode: b.receiptMode ?? null,
        receivedDate: b.receivedDate ?? null,
        receivedRemarks: b.receivedRemarks ?? null,
        product: b.product ?? null,
        workbookId: parsedWbId && Number.isInteger(parsedWbId) ? parsedWbId : null,
      });
      res.status(201).json(result);
    } catch (error) {
      handleRouteError(res, error, 'Failed to create loan record.');
    }
  });

  app.get('/api/loans/:id', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid record ID.' });
        return;
      }
      const detail = await getLoanByIdWithPayments(req.authUser!.id, id);
      res.json(detail);
    } catch (error) {
      handleRouteError(res, error, 'Failed to load loan details.');
    }
  });

  app.patch('/api/loans/:id', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid record ID.' });
        return;
      }
      const b = req.body || {};
      const result = await updateLoanRecord(req.authUser!.id, id, {
        loan: b.loan,
        emi: b.emi,
        customerName: b.customerName,
        fosName: b.fosName,
        bkt: b.bkt,
        bankingRemarks: b.bankingRemarks,
        receiptDate: b.receiptDate,
        receiptMode: b.receiptMode,
        receivedDate: b.receivedDate,
        receivedRemarks: b.receivedRemarks,
        product: b.product,
      });
      res.json(result);
    } catch (error) {
      handleRouteError(res, error, 'Failed to update loan record.');
    }
  });

  app.delete('/api/loans/:id', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid record ID.' });
        return;
      }
      const result = await deleteLoanRecord(req.authUser!.id, id);
      res.json(result);
    } catch (error) {
      handleRouteError(res, error, 'Failed to delete loan record.');
    }
  });

  app.post(
    '/api/loans/:id/payments',
    requireAuth,
    async (req: AuthRequest, res: Response) => {
      try {
        const loanRecordId = Number(req.params.id);
        if (!Number.isInteger(loanRecordId) || loanRecordId <= 0) {
          res.status(400).json({ error: 'Invalid record ID.' });
          return;
        }
        const { amount, paymentDate, paymentMethod, referenceNumber, notes } =
          req.body || {};

        const result = await addLoanPaymentTransaction({
          userId: req.authUser!.id,
          loanRecordId,
          amount: Number(amount),
          paymentDate: String(paymentDate || ''),
          paymentMethod: paymentMethod ?? null,
          referenceNumber: referenceNumber ?? null,
          notes: notes ?? null,
        });
        res.status(201).json(result);
      } catch (error) {
        handleRouteError(res, error, 'Failed to record payment transaction.');
      }
    }
  );

  app.delete(
    '/api/loans/:id/payments/:paymentId',
    requireAuth,
    async (req: AuthRequest, res: Response) => {
      try {
        const loanRecordId = Number(req.params.id);
        const paymentId = Number(req.params.paymentId);
        if (
          !Number.isInteger(loanRecordId) ||
          loanRecordId <= 0 ||
          !Number.isInteger(paymentId) ||
          paymentId <= 0
        ) {
          res.status(400).json({ error: 'Invalid record or payment ID.' });
          return;
        }
        const result = await deleteLoanPaymentTransaction(
          req.authUser!.id,
          loanRecordId,
          paymentId
        );
        res.json(result);
      } catch (error) {
        handleRouteError(res, error, 'Failed to delete payment transaction.');
      }
    }
  );

  // ============================================================================
  // FUNDING MANAGEMENT (SEPARATE FROM LOAN REPAYMENTS)
  // ============================================================================
  app.get('/api/funding', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const startDate =
        typeof req.query.startDate === 'string' ? req.query.startDate : undefined;
      const endDate =
        typeof req.query.endDate === 'string' ? req.query.endDate : undefined;
      const search =
        typeof req.query.search === 'string' ? req.query.search : undefined;

      const data = await listFundingTransactions(req.authUser!.id, {
        startDate,
        endDate,
        search,
      });
      res.json(data);
    } catch (error) {
      handleRouteError(res, error, 'Failed to load funding transactions.');
    }
  });

  app.post('/api/funding', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const { fundingSource, amount, fundingDate, referenceDetails, notes } =
        req.body || {};
      const created = await createFundingTransaction(req.authUser!.id, {
        fundingSource: String(fundingSource || ''),
        amount: Number(amount),
        fundingDate: String(fundingDate || ''),
        referenceDetails: referenceDetails ?? null,
        notes: notes ?? null,
      });
      res.status(201).json({ transaction: created });
    } catch (error) {
      handleRouteError(res, error, 'Failed to record funding transaction.');
    }
  });

  app.patch('/api/funding/:id', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const fundingId = Number(req.params.id);
      if (!Number.isInteger(fundingId) || fundingId <= 0) {
        res.status(400).json({ error: 'Invalid funding transaction ID.' });
        return;
      }
      const { fundingSource, amount, fundingDate, referenceDetails, notes } =
        req.body || {};
      const updated = await updateFundingTransaction(req.authUser!.id, fundingId, {
        fundingSource: String(fundingSource || ''),
        amount: Number(amount),
        fundingDate: String(fundingDate || ''),
        referenceDetails: referenceDetails ?? null,
        notes: notes ?? null,
      });
      res.json({ transaction: updated });
    } catch (error) {
      handleRouteError(res, error, 'Failed to update funding transaction.');
    }
  });

  app.delete(
    '/api/funding/:id',
    requireAuth,
    async (req: AuthRequest, res: Response) => {
      try {
        const fundingId = Number(req.params.id);
        if (!Number.isInteger(fundingId) || fundingId <= 0) {
          res.status(400).json({ error: 'Invalid funding transaction ID.' });
          return;
        }
        const result = await deleteFundingTransaction(req.authUser!.id, fundingId);
        res.json(result);
      } catch (error) {
        handleRouteError(res, error, 'Failed to delete funding transaction.');
      }
    }
  );

  // Ensure unmatched /api/* routes always return JSON instead of HTML
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  // Ensure Express middleware errors (e.g. invalid JSON, payload limit) on /api/* return JSON
  app.use(
    '/api',
    (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
      const rawStatus =
        typeof (err as { status?: unknown })?.status === 'number'
          ? (err as { status: number }).status
          : 500;
      const status = toProxySafeStatus(rawStatus);
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Unexpected server error.';
      res.status(status).json({ error: message });
    }
  );

  return app;
}
