import Link from "next/link";
import {
  ArrowRight,
  FileUp,
  ListChecks,
  MessageSquare,
  Plane,
  Receipt,
  Smartphone,
} from "lucide-react";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { BrandLogo } from "@/components/ui/Brand";

const banks = ["DBS / POSB", "PayLah!", "OCBC Frank", "Revolut", "YouTrip", "Any CSV"];

const features = [
  {
    icon: FileUp,
    title: "Statement imports",
    body: "Drop in PDF or CSV statements. Each bank has its own parser, and your import rules label and categorise rows as they come in.",
    tone: "text-primary bg-primary/10",
  },
  {
    icon: ListChecks,
    title: "Review before saving",
    body: "Imports are staged first. Tab through the table, type a category's first letters, fix what's wrong, then commit.",
    tone: "text-green bg-green/10",
  },
  {
    icon: Receipt,
    title: "Reimbursements",
    body: "Link a PayNow back to the dinner it covered, split across several expenses, and keep the leftover in its own category.",
    tone: "text-[#E040FB] bg-[#E040FB]/10",
  },
  {
    icon: Plane,
    title: "Trips",
    body: "Fund wallets in any currency, track spending at the rate you actually paid, and share a trip to settle who owes whom.",
    tone: "text-[#0EA5E9] bg-[#0EA5E9]/10",
  },
  {
    icon: MessageSquare,
    title: "Chat",
    body: "Ask where the money went this month, or have it draft changes that you approve before anything is saved.",
    tone: "text-[#F59E0B] bg-[#F59E0B]/10",
  },
  {
    icon: Smartphone,
    title: "On your phone",
    body: "The same accounts, imports and trips in the mobile app, against the same server.",
    tone: "text-red bg-red/10",
  },
];

const previewRows = [
  { label: "NTUC FairPrice", category: "Groceries", dot: "#22AD5C", edge: "#3B82F6", amount: "-SGD 63.40", out: true },
  { label: "PayNow from Sam", category: "Reimbursement", dot: "#E040FB", edge: "#3B82F6", amount: "+SGD 30.00", out: false, note: "Pays back Dinner with Sam" },
  { label: "Singtel", category: "Telco", dot: "#0EA5E9", edge: "#F59E0B", amount: "-SGD 45.00", out: true },
];

function ProductPreview() {
  return (
    <div className="relative mx-auto w-full max-w-4xl">
      <div
        aria-hidden="true"
        className="absolute -inset-x-10 -inset-y-8 rounded-[2rem] bg-gradient-to-r from-[#F02BF5]/30 via-[#7C3AED]/30 to-primary/30 blur-3xl"
      />
      <div className="relative overflow-hidden rounded-xl border border-white/10 bg-white shadow-2xl shadow-black/40 dark:bg-dark-2">
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
      <section className="landing-sky relative isolate overflow-hidden bg-[#05030F] text-white">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -left-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-[#F02BF5]/25 blur-[120px]" />
          <div className="absolute -right-32 top-10 h-[30rem] w-[30rem] rounded-full bg-[#6D28FF]/30 blur-[120px]" />
          <div className="absolute bottom-0 left-1/2 h-72 w-[48rem] -translate-x-1/2 rounded-full bg-primary/25 blur-[120px]" />
          <svg
            className="landing-orbit absolute left-1/2 top-[18rem] h-[42rem] w-[78rem] -translate-x-1/2 opacity-40"
            viewBox="0 0 1200 600"
            fill="none"
          >
            <ellipse cx="600" cy="300" rx="590" ry="150" stroke="url(#landing-ring)" strokeWidth="1.5" transform="rotate(-8 600 300)" />
            <ellipse cx="600" cy="300" rx="430" ry="105" stroke="url(#landing-ring)" strokeWidth="1" transform="rotate(-8 600 300)" />
            <defs>
              <linearGradient id="landing-ring" x1="0" x2="1">
                <stop offset="0" stopColor="#F02BF5" stopOpacity="0" />
                <stop offset="0.5" stopColor="#C4B5FD" />
                <stop offset="1" stopColor="#5750F1" stopOpacity="0" />
              </linearGradient>
            </defs>
          </svg>
        </div>

        <header className="mx-auto flex max-w-7xl items-center justify-between px-4 py-5 sm:px-6 lg:px-8">
          <BrandLogo markClassName="h-9 w-9 sm:h-11 sm:w-11" textClassName="text-xl sm:text-2xl text-white dark:text-white" />
          <div className="flex items-center gap-2 whitespace-nowrap sm:gap-4">
            <div className="[&_svg]:text-white/70! [&>button:hover]:bg-white/10!">
              <ThemeToggle />
            </div>
            <Link href="/login" className="group hidden text-sm font-semibold sm:inline">
              <span className="text-white/80 transition group-hover:text-white">Sign in</span>
            </Link>
            <Link
              href="/register"
              className="rounded-lg bg-white px-4 py-2 text-sm font-bold transition hover:bg-white/90"
            >
              <span className="text-[#1B1340]">Sign up</span>
            </Link>
          </div>
        </header>

        <div className="mx-auto max-w-7xl px-4 pb-20 pt-14 text-center sm:px-6 sm:pt-20 lg:px-8">
          <p className="mx-auto inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-white/80 backdrop-blur">
            <span className="landing-twinkle text-[#F5D0FE]">✦</span>
            Personal finance, from statement to insight
          </p>
          <h1 className="mx-auto mt-6 max-w-4xl font-display text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
            Every transaction,{" "}
            <span className="bg-gradient-to-r from-[#F472FF] via-[#C084FC] to-[#8B85FF] bg-clip-text text-transparent">
              accounted for.
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base text-white/70 sm:text-lg">
            Import your bank statements, review every row before it&apos;s saved, link the money friends pay back,
            and keep trips in any currency in the same ledger.
          </p>
          <div className="mx-auto mt-9 flex max-w-xs flex-col items-stretch justify-center gap-3 sm:max-w-none sm:flex-row sm:items-center">
            <Link
              href="/login"
              className="group inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#D946EF] via-[#8B5CF6] to-primary px-6 py-3 text-base font-bold text-white shadow-lg shadow-[#8B5CF6]/30 transition hover:brightness-110"
            >
              Sign in
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/register"
              className="rounded-lg border border-white/20 bg-white/5 px-6 py-3 text-center text-base font-bold text-white backdrop-blur transition hover:bg-white/10"
            >
              Create an account
            </Link>
          </div>

          <div className="mt-16 text-left sm:mt-20">
            <ProductPreview />
          </div>
        </div>
      </section>

      <section className="border-b border-stroke bg-white dark:border-stroke-dark dark:bg-dark-2">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-4 py-6 sm:px-6 lg:px-8">
          <span className="text-xs font-semibold uppercase tracking-wider text-dark-5 dark:text-dark-6">
            Reads statements from
          </span>
          {banks.map((bank) => (
            <span key={bank} className="text-sm font-semibold text-dark dark:text-white">
              {bank}
            </span>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <h2 className="font-display text-3xl font-extrabold text-dark dark:text-white sm:text-4xl">
            Everything in one ledger
          </h2>
          <p className="mt-3 text-dark-5 dark:text-dark-6">
            Bank accounts, wallets, trips and reimbursements all land in the same place, so the numbers add up.
          </p>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, body, tone }) => (
            <div
              key={title}
              className="group rounded-lg border border-stroke bg-white p-6 shadow-card-1 transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg dark:border-stroke-dark dark:bg-dark-2"
            >
              <span className={`inline-flex h-10 w-10 items-center justify-center rounded-lg ${tone}`}>
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 text-lg font-bold text-dark dark:text-white">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-dark-5 dark:text-dark-6">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="px-4 pb-20 sm:px-6 lg:px-8">
        <div className="relative mx-auto max-w-7xl overflow-hidden rounded-xl bg-[#05030F] px-6 py-14 text-center text-white sm:px-12">
          <div aria-hidden="true" className="absolute -left-20 -top-24 h-72 w-72 rounded-full bg-[#F02BF5]/30 blur-[100px]" />
          <div aria-hidden="true" className="absolute -bottom-24 -right-16 h-72 w-72 rounded-full bg-primary/40 blur-[100px]" />
          <h2 className="relative font-display text-3xl font-extrabold sm:text-4xl">Pick up where you left off</h2>
          <p className="relative mx-auto mt-3 max-w-xl text-white/70">
            Your staged imports, trips and links are waiting.
          </p>
          <div className="relative mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-base font-bold transition hover:bg-white/90"
            >
              <span className="inline-flex items-center gap-2 text-[#1B1340]">
                Sign in <ArrowRight className="h-4 w-4" />
              </span>
            </Link>
            <Link
              href="/register"
              className="rounded-lg border border-white/20 px-6 py-3 text-base font-bold text-white transition hover:bg-white/10"
            >
              Create an account
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-stroke py-8 dark:border-stroke-dark">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 text-sm text-dark-5 sm:px-6 lg:px-8 dark:text-dark-6">
          <BrandLogo markClassName="h-7 w-7" textClassName="text-base" />
          <span>© {new Date().getFullYear()} Fortuna</span>
        </div>
      </footer>
    </div>
  );
}
