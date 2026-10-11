import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { BrandLogo } from "@/components/ui/Brand";

const previewRows = [
  { label: "NTUC FairPrice", category: "Groceries", dot: "#22AD5C", edge: "#3B82F6", amount: "-SGD 63.40", out: true },
  { label: "PayNow from Sam", category: "Reimbursement", dot: "#E040FB", edge: "#3B82F6", amount: "+SGD 30.00", out: false, note: "Pays back Dinner with Sam" },
  { label: "Singtel", category: "Telco", dot: "#0EA5E9", edge: "#F59E0B", amount: "-SGD 45.00", out: true },
];

function ProductPreview() {
  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="overflow-hidden rounded-lg border border-stroke bg-white shadow-card-1 dark:border-stroke-dark dark:bg-dark-2">
        <div className="flex items-center gap-1.5 border-b border-stroke px-4 py-3 dark:border-stroke-dark">
          <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
          <span className="ml-3 text-xs text-dark-5 dark:text-dark-6">Dashboard · October 2026</span>
        </div>
        <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[1.1fr_1fr]">
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              {[
                ["Income", "SGD 5,230", "text-green"],
                ["Spending", "SGD 1,912", "text-red"],
                ["Net flow", "SGD 3,318", "text-primary"],
              ].map(([label, value, tone]) => (
                <div key={label} className="rounded-lg border border-stroke p-3 dark:border-stroke-dark">
                  <p className="text-[11px] text-dark-5 dark:text-dark-6">{label}</p>
                  <p className={`mt-1 text-sm font-bold tabular-nums sm:text-base ${tone}`}>{value}</p>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-stroke p-3 dark:border-stroke-dark">
              <p className="text-xs font-semibold text-dark dark:text-white">Spending and Income Trend</p>
              <svg viewBox="0 0 320 110" preserveAspectRatio="none" className="mt-2 h-32 w-full" aria-hidden="true">
                <defs>
                  <linearGradient id="landing-in" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0" stopColor="#22AD5C" stopOpacity="0.25" />
                    <stop offset="1" stopColor="#22AD5C" stopOpacity="0" />
                  </linearGradient>
                  <linearGradient id="landing-out" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0" stopColor="#F23030" stopOpacity="0.2" />
                    <stop offset="1" stopColor="#F23030" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {[25, 55, 85].map((y) => (
                  <line key={y} x1="0" x2="320" y1={y} y2={y} className="stroke-stroke dark:stroke-stroke-dark" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
                ))}
                <path d="M0 30 C40 28 60 22 100 26 S170 18 210 22 S280 14 320 16 L320 110 L0 110 Z" fill="url(#landing-in)" />
                <path d="M0 30 C40 28 60 22 100 26 S170 18 210 22 S280 14 320 16" fill="none" stroke="#22AD5C" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
                <path d="M0 78 C30 70 60 86 100 72 S160 60 200 74 S270 58 320 66 L320 110 L0 110 Z" fill="url(#landing-out)" />
                <path d="M0 78 C30 70 60 86 100 72 S160 60 200 74 S270 58 320 66" fill="none" stroke="#F23030" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
              </svg>
            </div>
          </div>
          <div className="space-y-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-dark-5 dark:text-dark-6">
              Recent transactions
            </p>
            {previewRows.map((row) => (
              <div
                key={row.label}
                className="flex items-start justify-between gap-3 rounded-lg border border-stroke bg-white py-2.5 pl-3 pr-3 dark:border-stroke-dark dark:bg-dark-2"
                style={{ borderLeft: `3px solid ${row.edge}` }}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-dark dark:text-white">{row.label}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-dark-5 dark:text-dark-6">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: row.dot }} />
                    {row.category}
                  </p>
                  {row.note ? <p className="mt-1 text-[11px] text-primary">{row.note}</p> : null}
                </div>
                <p className={`shrink-0 text-sm font-bold tabular-nums ${row.out ? "text-red" : "text-green"}`}>
                  {row.amount}
                </p>
              </div>
            ))}
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 py-2 text-xs text-dark dark:text-white">
              <span className="rounded bg-primary px-1.5 py-0.5 font-mono text-[11px] text-white">tel</span>
              <ArrowRight className="h-3.5 w-3.5 text-primary" />
              <span className="h-2 w-2 rounded-full bg-[#0EA5E9]" />
              Telco
              <span className="ml-auto text-dark-5 dark:text-dark-6">type to categorise</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gray-1 dark:bg-dark-bg">
      <header className="border-b border-stroke bg-white dark:border-stroke-dark dark:bg-dark-2">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <BrandLogo markClassName="h-9 w-9 sm:h-11 sm:w-11" textClassName="text-xl sm:text-2xl" />
          <div className="flex items-center gap-2 whitespace-nowrap sm:gap-4">
            <ThemeToggle />
            <Link href="/login" className="hidden text-sm font-semibold sm:inline">
              <span className="text-primary hover:opacity-90">Sign in</span>
            </Link>
            <Link
              href="/register"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-bold hover:bg-primary/95"
            >
              <span className="text-white">Sign up</span>
            </Link>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-4 pb-20 pt-14 text-center sm:px-6 sm:pt-20 lg:px-8">
        <h1 className="mx-auto max-w-4xl font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-dark sm:text-6xl lg:text-7xl dark:text-white">
          Every transaction, <span className="text-primary">accounted for.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-base text-dark-5 sm:text-lg dark:text-dark-6">
          Import your bank statements, review every row before it&apos;s saved, link the money friends pay back,
          and keep trips in any currency in the same ledger.
        </p>
        <div className="mx-auto mt-9 flex max-w-xs flex-col items-stretch justify-center gap-3 sm:max-w-none sm:flex-row sm:items-center">
          <Link
            href="/login"
            className="group inline-flex items-center justify-center rounded-lg bg-primary px-6 py-3 text-base font-bold hover:bg-primary/95"
          >
            <span className="inline-flex items-center gap-2 text-white">
              Sign in
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </span>
          </Link>
          <Link
            href="/register"
            className="rounded-lg border border-stroke bg-white px-6 py-3 text-center text-base font-bold hover:bg-gray-2 dark:border-stroke-dark dark:bg-dark-2 dark:hover:bg-dark-3"
          >
            <span className="text-dark dark:text-white">Create an account</span>
          </Link>
        </div>

        <div className="mt-16 text-left sm:mt-20">
          <ProductPreview />
        </div>
      </section>
    </div>
  );
}
