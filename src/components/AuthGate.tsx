import React, { useState } from 'react';
import {
  ShieldCheck,
  FileSpreadsheet,
  Landmark,
  Search,
  Database,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';

export function AuthGate() {
  const {
    signIn,
    signUp,
    authError,
    authNotice,
    configStatus,
    refreshConfigStatus,
    clearMessages,
  } = useAuth();

  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await signIn(email, password);
      } else {
        await signUp(email, password, fullName);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const isConfigured = configStatus?.configured ?? true;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center px-6 py-12">
      <div className="mx-auto w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 border border-slate-200 bg-white rounded-xl overflow-hidden">
        {/* Left institutional context panel */}
        <div className="lg:col-span-6 bg-slate-900 text-white p-8 lg:p-10 flex flex-col justify-between">
          <div>
            <p className="text-sm font-medium text-slate-400">
              AARNA ENTERPRISES
            </p>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight leading-tight text-balance">
              Loan portfolio accounting and funding control.
            </h1>
            <p className="mt-4 text-sm text-slate-300 leading-relaxed max-w-md">
              Import workbooks directly from Excel without rigid templates, track every client
              repayment as an individual transaction, and monitor incoming capital separately in Supabase.
            </p>
          </div>

          <div className="mt-10 pt-8 border-t border-slate-800 space-y-4">
            <div className="flex items-start gap-3">
              <FileSpreadsheet className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
              <div className="text-xs text-slate-300 leading-relaxed">
                <span className="font-medium text-white">Supabase Storage Sync</span>
                <span className="mx-1.5 text-slate-500">·</span>
                Stores original uploaded .xlsx/.xls files and synchronized exports safely in Supabase Storage.
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Search className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
              <div className="text-xs text-slate-300 leading-relaxed">
                <span className="font-medium text-white">Exact &amp; Partial Loan Lookup</span>
                <span className="mx-1.5 text-slate-500">·</span>
                Inspect every imported Excel column and log separate payment transactions.
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Landmark className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
              <div className="text-xs text-slate-300 leading-relaxed">
                <span className="font-medium text-white">Segregated Funding Ledger</span>
                <span className="mx-1.5 text-slate-500">·</span>
                Incoming funding is recorded and reported independently from loan repayments.
              </div>
            </div>
          </div>
        </div>

        {/* Right authentication or setup checklist panel */}
        <div className="lg:col-span-6 p-8 lg:p-10 flex flex-col justify-center">
          {!isConfigured ? (
            <div>
              <div className="flex items-center gap-2 text-slate-900">
                <Database className="w-5 h-5 text-slate-700" />
                <h2 className="text-lg font-semibold tracking-tight">
                  Connect Your Supabase Project
                </h2>
              </div>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                Add your Supabase project credentials in{' '}
                <strong className="font-semibold text-slate-900">
                  Vercel Environment Variables
                </strong>{' '}
                (Project Settings → Environment Variables, then{' '}
                <strong className="font-semibold text-slate-900">Redeploy</strong>) or the
                AI Studio{' '}
                <strong className="font-semibold text-slate-900">Secrets</strong> panel so
                keys remain securely on the server:
              </p>

              {configStatus?.diagnosticError && (
                <div
                  role="alert"
                  className="mt-4 p-3.5 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-900 leading-relaxed"
                >
                  <strong className="font-semibold">API Check Detail: </strong>
                  {configStatus.diagnosticError}
                </div>
              )}

              <ul className="mt-4 space-y-2 border border-slate-200 rounded-lg p-4 bg-slate-50 text-xs font-mono text-slate-800">
                {(
                  configStatus?.missingKeys ?? [
                    'SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)',
                    'SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)',
                  ]
                ).map((keyName) => (
                  <li key={keyName} className="flex items-center justify-between gap-2">
                    <span className="break-all">{keyName}</span>
                    <span className="text-amber-700 font-sans font-medium shrink-0">
                      Required
                    </span>
                  </li>
                ))}
              </ul>

              <p className="mt-4 text-xs text-slate-600 leading-relaxed">
                Only your Supabase URL and Publishable Key are needed (no service role key required). Then run{' '}
                <code className="font-mono text-slate-900">supabase/schema.sql</code>{' '}
                once in your Supabase SQL Editor to create the tables, Row Level Security policies, and the private{' '}
                <code className="font-mono text-slate-900">excel-workbooks</code>{' '}
                storage bucket.
              </p>

              <button
                type="button"
                onClick={refreshConfigStatus}
                className="mt-6 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Recheck Connection</span>
              </button>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-slate-900">
                  <ShieldCheck className="w-5 h-5 text-slate-700" />
                  <h2 className="text-lg font-semibold tracking-tight">
                    {mode === 'login' ? 'Sign in to workspace' : 'Create account'}
                  </h2>
                </div>
              </div>

              <div className="mt-4 inline-flex p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    clearMessages();
                  }}
                  className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                    mode === 'login'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('signup');
                    clearMessages();
                  }}
                  className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                    mode === 'signup'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Create Account
                </button>
              </div>

              {authError && (
                <div
                  role="alert"
                  className="mt-4 p-3.5 rounded-lg border border-red-200 bg-red-50 text-xs text-red-700 leading-relaxed"
                >
                  {authError}
                </div>
              )}

              {authNotice && (
                <div className="mt-4 p-3.5 rounded-lg border border-emerald-200 bg-emerald-50 text-xs text-emerald-800 leading-relaxed">
                  {authNotice}
                </div>
              )}

              <form onSubmit={handleSubmit} className="mt-5 space-y-4">
                {mode === 'signup' && (
                  <div>
                    <label
                      htmlFor="auth-name"
                      className="block text-xs font-medium text-slate-700 mb-1"
                    >
                      Full Name
                    </label>
                    <input
                      id="auth-name"
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      autoComplete="name"
                      className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                  </div>
                )}

                <div>
                  <label
                    htmlFor="auth-email"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Email Address
                  </label>
                  <input
                    id="auth-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>

                <div>
                  <label
                    htmlFor="auth-password"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Password
                  </label>
                  <input
                    id="auth-password"
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={
                      mode === 'login' ? 'current-password' : 'new-password'
                    }
                    className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 px-4 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 transition-colors disabled:opacity-60 cursor-pointer"
                >
                  {submitting
                    ? mode === 'login'
                      ? 'Signing in...'
                      : 'Creating account...'
                    : mode === 'login'
                      ? 'Sign In with Supabase'
                      : 'Create Supabase Account'}
                </button>
              </form>

              <p className="mt-5 text-xs text-slate-500 leading-relaxed">
                All loan records, payments, funding transactions, and Excel workbooks are stored in your connected Supabase database and Storage bucket.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
