import Link from "next/link";
import { BarChart3, Zap, FileText } from "lucide-react";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { BrandLogo } from "@/components/ui/Brand";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gray-1 dark:bg-dark-bg">
      {/* Header */}
      <header className="border-b border-stroke bg-white dark:border-stroke-dark dark:bg-dark-bg">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <BrandLogo />
            <div className="flex items-center gap-4">
              <ThemeToggle />
              <Link
                href="/login"
                className="text-sm font-semibold text-primary hover:opacity-90"
              >
                Sign In
              </Link>
              <Link
                href="/register"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary/95"
              >
                Sign Up
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="mx-auto max-w-7xl px-4 pt-20">
        <div className="text-center">
          <h1 className="text-5xl font-bold text-dark dark:text-white sm:text-6xl">
            Take Control of Your <span className="text-primary">Finances</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-dark-5 dark:text-dark-6">
            Import statements, review transactions, and track spending with one consistent workflow.
          </p>
          <div className="mt-10 flex items-center justify-center gap-4">
            <Link
              href="/register"
              className="rounded-lg bg-primary px-6 py-3 text-base font-bold text-white hover:bg-primary/95"
            >
              Sign Up
            </Link>
            <Link
              href="/login"
              className="rounded-lg border border-primary/60 bg-white px-6 py-3 text-base font-bold text-primary hover:bg-gray-2 dark:bg-dark-2 dark:text-primary dark:hover:bg-dark-3"
            >
              Sign In
            </Link>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="mx-auto max-w-4xl px-4 py-10">
        <div className="grid gap-6 sm:grid-cols-1 lg:grid-cols-3">
          {/* Feature 1 */}
          <div className="rounded-lg border border-stroke bg-white p-6 shadow-card-1 dark:border-stroke-dark dark:bg-dark-2">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              <h3 className="text-lg font-bold text-dark dark:text-white">
                Easy Import
              </h3>
            </div>
            <p className="mt-2 text-sm text-dark-5 dark:text-dark-6">
              Upload bank statements from CSV or PDF files and automatically
              parse transactions.
            </p>
          </div>

          {/* Feature 2 */}
          <div className="rounded-lg border border-stroke bg-white p-6 shadow-card-1 dark:border-stroke-dark dark:bg-dark-2">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-green" />
              <h3 className="text-lg font-bold text-dark dark:text-white">
                Smart Analytics
              </h3>
            </div>
            <p className="mt-2 text-sm text-dark-5 dark:text-dark-6">
              Visualize your spending patterns with interactive charts and
              detailed breakdowns.
            </p>
          </div>

          {/* Feature 3 */}
          <div className="rounded-lg border border-stroke bg-white p-6 shadow-card-1 dark:border-stroke-dark dark:bg-dark-2">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-red" />
              <h3 className="text-lg font-bold text-dark dark:text-white">
                Auto Categorization
              </h3>
            </div>
            <p className="mt-2 text-sm text-dark-5 dark:text-dark-6">
              Automatically categorize transactions and detect duplicates to
              keep your data clean.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
