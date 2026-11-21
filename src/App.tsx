import { useMemo, useState } from 'react';
import {
  LayoutDashboard,
  Search,
  Briefcase,
  Landmark,
  FileSpreadsheet,
  Menu,
  X,
  LogOut,
} from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { createApiClient } from './lib/api.ts';
import type { AppPage } from './types/app.ts';
import { AuthGate } from './components/AuthGate.tsx';
import { DashboardView } from './components/DashboardView.tsx';
import { LoanSearchView } from './components/LoanSearchView.tsx';
import { LoanManagementView } from './components/LoanManagementView.tsx';
import { LoanDetailView } from './components/LoanDetailView.tsx';
import { FundingManagementView } from './components/FundingManagementView.tsx';
import { ExcelManagementView } from './components/ExcelManagementView.tsx';

const NAV_ITEMS: Array<{
  id: AppPage;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'loan-search', label: 'Loan Search', icon: Search },
  { id: 'loan-management', label: 'Loan Management', icon: Briefcase },
  { id: 'funding-management', label: 'Funding Management', icon: Landmark },
  { id: 'excel-management', label: 'Excel Management', icon: FileSpreadsheet },
];

const PAGE_LABELS: Record<AppPage, string> = {
  dashboard: 'Dashboard',
  'loan-search': 'Loan Search',
  'loan-management': 'Loan Management',
  'funding-management': 'Funding Management',
  'excel-management': 'Excel Management',
};

function WorkspaceShell() {
  const { user, loading, logout, getIdToken } = useAuth();
  const [activePage, setActivePage] = useState<AppPage>('dashboard');
  const [selectedLoanId, setSelectedLoanId] = useState<number | null>(null);
  const [previousPage, setPreviousPage] = useState<AppPage>('loan-management');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const api = useMemo(() => createApiClient(getIdToken), [getIdToken]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-sm font-medium text-slate-600">Loading workspace...</div>
      </div>
    );
  }

  if (!user) {
    return <AuthGate />;
  }

  const handleNavigate = (page: AppPage) => {
    setActivePage(page);
    setSelectedLoanId(null);
    setMobileMenuOpen(false);
  };

  const handleOpenLoan = (loanId: number) => {
    setPreviousPage(activePage);
    setSelectedLoanId(loanId);
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Desktop Sidebar (256px) */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 bg-white border-r border-slate-200 z-30">
        <div className="h-16 px-6 flex items-center border-b border-slate-200">
          <button
            type="button"
            onClick={() => handleNavigate('dashboard')}
            className="text-base font-bold font-display tracking-tight text-slate-900 whitespace-nowrap cursor-pointer"
          >
            AARNA ENTERPRISES
          </button>
        </div>

        <nav className="flex-1 px-3 py-5 space-y-1" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = selectedLoanId === null && activePage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavigate(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200">
          <div className="px-2 pb-3">
            <p className="text-xs font-medium text-slate-900 truncate">
              {user.displayName || 'Account'}
            </p>
            <p className="text-[11px] text-slate-500 truncate">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Mobile Drawer Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/50"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-72 max-w-[80vw] bg-white h-full flex flex-col border-r border-slate-200 z-10">
            <div className="h-14 px-5 flex items-center justify-between border-b border-slate-200">
              <span className="text-base font-bold font-display tracking-tight text-slate-900">
                AARNA ENTERPRISES
              </span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close navigation menu"
                className="p-2 text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <nav className="flex-1 px-3 py-4 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = selectedLoanId === null && activePage === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNavigate(item.id)}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>

            <div className="p-4 border-t border-slate-200">
              <p className="text-xs font-medium text-slate-900 truncate px-1">
                {user.email}
              </p>
              <button
                type="button"
                onClick={logout}
                className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Viewport */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Top contextual breadcrumb bar */}
        <header className="sticky top-0 z-20 h-14 lg:h-16 bg-white/95 backdrop-blur-xs border-b border-slate-200 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
            <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-400 hidden sm:inline whitespace-nowrap">
                AARNA ENTERPRISES
              </span>
              <span className="text-slate-300 hidden sm:inline">/</span>
              {selectedLoanId !== null ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedLoanId(null);
                      setActivePage(previousPage);
                    }}
                    className="text-slate-500 hover:text-slate-900 truncate cursor-pointer"
                  >
                    {PAGE_LABELS[previousPage]}
                  </button>
                  <span className="text-slate-300">/</span>
                  <span className="font-medium text-slate-900 whitespace-nowrap">
                    Loan Details
                  </span>
                </>
              ) : (
                <span className="font-medium text-slate-900 truncate">
                  {PAGE_LABELS[activePage]}
                </span>
              )}
            </nav>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => handleNavigate('loan-search')}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap cursor-pointer"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Lookup Loan</span>
            </button>
          </div>
        </header>

        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-[1400px] w-full mx-auto">
          {selectedLoanId !== null ? (
            <LoanDetailView
              api={api}
              loanId={selectedLoanId}
              onBack={() => {
                setSelectedLoanId(null);
                setActivePage(previousPage);
              }}
              onDeleted={() => {
                setSelectedLoanId(null);
                setActivePage('loan-management');
              }}
            />
          ) : activePage === 'dashboard' ? (
            <DashboardView
              api={api}
              onOpenLoan={handleOpenLoan}
              onNavigate={handleNavigate}
            />
          ) : activePage === 'loan-search' ? (
            <LoanSearchView api={api} onOpenLoan={handleOpenLoan} />
          ) : activePage === 'loan-management' ? (
            <LoanManagementView
              api={api}
              onOpenLoan={handleOpenLoan}
              onNavigate={handleNavigate}
            />
          ) : activePage === 'funding-management' ? (
            <FundingManagementView api={api} />
          ) : (
            <ExcelManagementView api={api} />
          )}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <WorkspaceShell />
    </AuthProvider>
  );
}
