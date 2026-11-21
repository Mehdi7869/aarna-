import { relations } from 'drizzle-orm';
import {
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

export interface ColumnMapping {
  uniqueIdentifierCol: string;
  loanIdCol?: string | null;
  loanNumberCol?: string | null;
  borrowerCol?: string | null;
  loanAmountCol?: string | null;
  disbursementDateCol?: string | null;
}

export interface ImportReport {
  inserted: number;
  duplicates: Array<{
    rowNumber: number;
    identifier: string;
    reason: string;
  }>;
  errors: Array<{
    rowNumber: number;
    reason: string;
  }>;
}

export type ExcelCellValue = string | number | boolean | null;

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const excelWorkbooks = pgTable(
  'excel_workbooks',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    fileSize: integer('file_size').notNull(),
    kind: text('kind').notNull(), // 'upload' | 'export'
    sheetNames: jsonb('sheet_names').$type<string[]>().notNull(),
    activeSheet: text('active_sheet'),
    columnHeaders: jsonb('column_headers').$type<string[]>().notNull(),
    columnMapping: jsonb('column_mapping').$type<ColumnMapping | null>(),
    fileDataBase64: text('file_data_base64').notNull(),
    sourceWorkbookId: integer('source_workbook_id'),
    rowCount: integer('row_count').default(0).notNull(),
    importedCount: integer('imported_count').default(0).notNull(),
    duplicateCount: integer('duplicate_count').default(0).notNull(),
    failedCount: integer('failed_count').default(0).notNull(),
    importReport: jsonb('import_report').$type<ImportReport | null>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('excel_workbooks_user_idx').on(table.userId)]
);

export const loans = pgTable(
  'loans',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workbookId: integer('workbook_id').references(() => excelWorkbooks.id, {
      onDelete: 'set null',
    }),
    sheetName: text('sheet_name'),
    sourceRowNumber: integer('source_row_number'),
    uniqueIdentifier: text('unique_identifier').notNull(),
    loanId: text('loan_id'),
    loanNumber: text('loan_number'),
    borrowerName: text('borrower_name'),
    loanAmount: numeric('loan_amount', { precision: 18, scale: 2 })
      .default('0.00')
      .notNull(),
    paymentStatus: text('payment_status').default('Unpaid').notNull(),
    columnOrder: jsonb('column_order').$type<string[]>().notNull(),
    rawData: jsonb('raw_data').$type<Record<string, ExcelCellValue>>().notNull(),
    columnMapping: jsonb('column_mapping').$type<ColumnMapping | null>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('loans_user_unique_identifier_idx').on(
      table.userId,
      table.uniqueIdentifier
    ),
    index('loans_user_idx').on(table.userId),
    index('loans_loan_id_idx').on(table.loanId),
    index('loans_loan_number_idx').on(table.loanNumber),
  ]
);

export const loanPayments = pgTable(
  'loan_payments',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    loanId: integer('loan_id')
      .references(() => loans.id, { onDelete: 'cascade' })
      .notNull(),
    amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
    paymentDate: text('payment_date').notNull(), // YYYY-MM-DD
    paymentMethod: text('payment_method'),
    referenceNumber: text('reference_number'),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('loan_payments_user_idx').on(table.userId),
    index('loan_payments_loan_idx').on(table.loanId),
    index('loan_payments_date_idx').on(table.paymentDate),
  ]
);

export const fundingTransactions = pgTable(
  'funding_transactions',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    fundingSource: text('funding_source').notNull(),
    amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
    fundingDate: text('funding_date').notNull(), // YYYY-MM-DD
    referenceDetails: text('reference_details'),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('funding_transactions_user_idx').on(table.userId),
    index('funding_transactions_date_idx').on(table.fundingDate),
  ]
);

export const usersRelations = relations(users, ({ many }) => ({
  workbooks: many(excelWorkbooks),
  loans: many(loans),
  payments: many(loanPayments),
  funding: many(fundingTransactions),
}));

export const excelWorkbooksRelations = relations(
  excelWorkbooks,
  ({ one, many }) => ({
    owner: one(users, {
      fields: [excelWorkbooks.userId],
      references: [users.id],
    }),
    loans: many(loans),
  })
);

export const loansRelations = relations(loans, ({ one, many }) => ({
  owner: one(users, {
    fields: [loans.userId],
    references: [users.id],
  }),
  workbook: one(excelWorkbooks, {
    fields: [loans.workbookId],
    references: [excelWorkbooks.id],
  }),
  payments: many(loanPayments),
}));

export const loanPaymentsRelations = relations(loanPayments, ({ one }) => ({
  owner: one(users, {
    fields: [loanPayments.userId],
    references: [users.id],
  }),
  loan: one(loans, {
    fields: [loanPayments.loanId],
    references: [loans.id],
  }),
}));

export const fundingTransactionsRelations = relations(
  fundingTransactions,
  ({ one }) => ({
    owner: one(users, {
      fields: [fundingTransactions.userId],
      references: [users.id],
    }),
  })
);
