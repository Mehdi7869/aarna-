-- ============================================================================
-- AARNA ENTERPRISES — Supabase PostgreSQL Schema, RLS Policies & Storage Setup
-- Exact 11-Column Excel Structure:
--   1. LOAN
--   2. EMI
--   3. Customer Name
--   4. FOS NAME
--   5. BKT
--   6. Banking Remarks
--   7. Receipt Date
--   8. Receipt Mode
--   9. Received Date
--  10. Received Remarks
--  11. Product
--
-- Run this entire script in your Supabase Dashboard -> SQL Editor.
-- Safe to re-run (idempotent).
-- ============================================================================

-- 1. Excel Workbooks (metadata + Supabase Storage path for original uploads & exports)
CREATE TABLE IF NOT EXISTS public.excel_workbooks (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('upload', 'export')),
  storage_path TEXT NOT NULL,
  sheet_names JSONB NOT NULL DEFAULT '[]'::jsonb,
  active_sheet TEXT,
  column_headers JSONB NOT NULL DEFAULT '[]'::jsonb,
  column_mapping JSONB,
  source_workbook_id BIGINT REFERENCES public.excel_workbooks(id) ON DELETE SET NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  import_report JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS excel_workbooks_user_idx ON public.excel_workbooks(user_id);

-- 2. Loans (every imported or created row has a unique internal id;
--    multiple records with the same LOAN number are fully supported)
CREATE TABLE IF NOT EXISTS public.loans (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workbook_id BIGINT REFERENCES public.excel_workbooks(id) ON DELETE SET NULL,
  sheet_name TEXT,
  source_row_number INTEGER,

  -- Exact 11 Excel columns (original values & formatting preserved)
  loan TEXT NOT NULL,
  emi TEXT,
  emi_numeric NUMERIC(18, 2),
  customer_name TEXT,
  fos_name TEXT,
  bkt TEXT,
  banking_remarks TEXT,
  receipt_date TEXT,
  receipt_mode TEXT,
  received_date TEXT,
  received_remarks TEXT,
  product TEXT,

  -- Optional separate ledger tracking (never assumes EMI is received amount)
  payment_status TEXT NOT NULL DEFAULT 'Recorded',
  column_order JSONB NOT NULL DEFAULT '["LOAN","EMI","Customer Name","FOS NAME","BKT","Banking Remarks","Receipt Date","Receipt Mode","Received Date","Received Remarks","Product"]'::jsonb,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Upgrade path if an older version of public.loans already existed:
-- Drop previous unique constraint and legacy NOT NULL constraint on loan_identifier
-- so duplicate LOAN numbers and the exact 11-column structure work seamlessly.
DROP INDEX IF EXISTS public.loans_user_unique_identifier_idx;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'loans'
      AND column_name = 'loan_identifier'
  ) THEN
    ALTER TABLE public.loans ALTER COLUMN loan_identifier DROP NOT NULL;
  END IF;
END $$;

ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS loan TEXT;
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS emi TEXT;
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS emi_numeric NUMERIC(18, 2);
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS fos_name TEXT;
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS bkt TEXT;
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS banking_remarks TEXT;
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS receipt_date TEXT;
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS receipt_mode TEXT;
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS received_date TEXT;
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS received_remarks TEXT;
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS product TEXT;

-- Non-unique indexes to support fast search & filtering across multiple records per LOAN
CREATE INDEX IF NOT EXISTS loans_user_idx ON public.loans(user_id);
CREATE INDEX IF NOT EXISTS loans_user_loan_idx ON public.loans(user_id, loan);
CREATE INDEX IF NOT EXISTS loans_user_customer_idx ON public.loans(user_id, customer_name);
CREATE INDEX IF NOT EXISTS loans_user_product_idx ON public.loans(user_id, product);
CREATE INDEX IF NOT EXISTS loans_user_fos_idx ON public.loans(user_id, fos_name);
CREATE INDEX IF NOT EXISTS loans_user_bkt_idx ON public.loans(user_id, bkt);
CREATE INDEX IF NOT EXISTS loans_user_receipt_mode_idx ON public.loans(user_id, receipt_mode);

-- 3. Loan Payments (separate immutable payment transactions logged explicitly by user;
--    never populated automatically from EMI)
CREATE TABLE IF NOT EXISTS public.loan_payments (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  loan_id BIGINT NOT NULL REFERENCES public.loans(id) ON DELETE CASCADE,
  amount NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
  payment_date TEXT NOT NULL,
  payment_method TEXT,
  reference_number TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS loan_payments_user_idx ON public.loan_payments(user_id);
CREATE INDEX IF NOT EXISTS loan_payments_loan_idx ON public.loan_payments(loan_id);
CREATE INDEX IF NOT EXISTS loan_payments_date_idx ON public.loan_payments(payment_date);

-- 4. Funding Transactions (strictly segregated from client loan repayments)
CREATE TABLE IF NOT EXISTS public.funding_transactions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  funding_source TEXT NOT NULL,
  amount NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
  funding_date TEXT NOT NULL,
  reference_details TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS funding_transactions_user_idx ON public.funding_transactions(user_id);
CREATE INDEX IF NOT EXISTS funding_transactions_date_idx ON public.funding_transactions(funding_date);

-- ============================================================================
-- Row Level Security (RLS) Policies
-- ============================================================================
ALTER TABLE public.excel_workbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funding_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own workbooks" ON public.excel_workbooks;
CREATE POLICY "Users manage own workbooks"
  ON public.excel_workbooks FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own loans" ON public.loans;
CREATE POLICY "Users manage own loans"
  ON public.loans FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own loan payments" ON public.loan_payments;
CREATE POLICY "Users manage own loan payments"
  ON public.loan_payments FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own funding transactions" ON public.funding_transactions;
CREATE POLICY "Users manage own funding transactions"
  ON public.funding_transactions FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- Private Storage Bucket for Original Uploaded & Exported Excel Workbooks
-- ============================================================================
INSERT INTO storage.buckets (id, name, public)
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
  );

-- Ensure authenticated role has full table & sequence privileges under RLS
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.excel_workbooks,
  public.loans,
  public.loan_payments,
  public.funding_transactions
TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Refresh PostgREST schema cache immediately so new columns/tables are available right away
NOTIFY pgrst, 'reload schema';
