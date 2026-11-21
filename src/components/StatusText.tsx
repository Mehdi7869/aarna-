interface StatusTextProps {
  status: string;
}

export function StatusText({ status }: StatusTextProps) {
  const normalized = status.toLowerCase();
  let colorClass = 'text-slate-600';
  if (normalized === 'paid' || normalized === 'payments logged') {
    colorClass = 'text-emerald-700';
  } else if (normalized === 'partial') {
    colorClass = 'text-amber-700';
  } else if (normalized === 'overpaid') {
    colorClass = 'text-red-700';
  } else if (normalized === 'unpaid' || normalized === 'recorded') {
    colorClass = 'text-slate-700';
  }

  return <span className={`text-xs font-semibold ${colorClass}`}>{status}</span>;
}
