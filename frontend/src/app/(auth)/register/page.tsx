"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { getCurrencyOptions } from "@/lib/currencies";
import { registerUser } from "@/app/actions/auth";
import { BrandLogo } from "@/components/ui/Brand";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [baseCurrency, setBaseCurrency] = useState("SGD");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const currencyOptions = getCurrencyOptions();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setLoading(true);

    try {
      await registerUser({ name, username, password, baseCurrency });

      router.push("/login?registered=true");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "An error occurred. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-1 p-4 dark:bg-dark-bg">
      {/* Theme Toggle - Top Right */}
      <div className="fixed right-4 top-4">
        <ThemeToggle />
      </div>

      <div className="flex min-h-screen items-center justify-center">
        <div className="w-full max-w-md">
          {/* Logo */}
          <div className="mb-8 flex justify-center">
            <BrandLogo
              markClassName="h-16 w-16"
              iconClassName="size-9"
              textClassName="text-4xl"
            />
          </div>

          {/* Card */}
          <div className="rounded-xl border border-stroke bg-white p-8 shadow-lg dark:border-stroke-dark dark:bg-dark-2">
            <h1 className="mb-2 text-center text-3xl font-bold text-dark dark:text-white">
              Sign Up
            </h1>
            <p className="mb-6 text-center text-sm text-dark-5 dark:text-dark-6">
              Create your Fortuna account
            </p>

            {error && (
              <div className="mb-4 rounded-lg border border-red bg-red/10 p-3 text-sm text-red dark:border-red/50">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="name"
                  className="mb-2 block text-sm font-medium text-dark dark:text-white"
                >
                  Full Name
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                  className="w-full rounded-lg border border-stroke bg-gray-2 px-4 py-3 text-dark outline-none transition-colors focus:border-primary dark:border-dark-3 dark:bg-dark-2 dark:text-white dark:focus:border-primary"
                  placeholder="Enter your full name"
                />
              </div>

              <div>
                <label
                  htmlFor="username"
                  className="mb-2 block text-sm font-medium text-dark dark:text-white"
                >
                  Username
                </label>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoComplete="username"
                  className="w-full rounded-lg border border-stroke bg-gray-2 px-4 py-3 text-dark outline-none transition-colors focus:border-primary dark:border-dark-3 dark:bg-dark-2 dark:text-white dark:focus:border-primary"
                  placeholder="Choose a username"
                />
              </div>

              <div>
                <label
                  htmlFor="baseCurrency"
                  className="mb-2 block text-sm font-medium text-dark dark:text-white"
                >
                  Base Currency
                </label>
                <select
                  id="baseCurrency"
                  value={baseCurrency}
                  onChange={(e) => setBaseCurrency(e.target.value)}
                  className="w-full rounded-lg border border-stroke bg-gray-2 px-4 py-3 text-dark outline-none transition-colors focus:border-primary dark:border-dark-3 dark:bg-dark-2 dark:text-white dark:focus:border-primary"
                >
                  {currencyOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="mb-2 block text-sm font-medium text-dark dark:text-white"
                >
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  className="w-full rounded-lg border border-stroke bg-gray-2 px-4 py-3 text-dark outline-none transition-colors focus:border-primary dark:border-dark-3 dark:bg-dark-2 dark:text-white dark:focus:border-primary"
                  placeholder="Create a password"
                />
              </div>

              <div>
                <label
                  htmlFor="confirmPassword"
                  className="mb-2 block text-sm font-medium text-dark dark:text-white"
                >
                  Confirm Password
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  className="w-full rounded-lg border border-stroke bg-gray-2 px-4 py-3 text-dark outline-none transition-colors focus:border-primary dark:border-dark-3 dark:bg-dark-2 dark:text-white dark:focus:border-primary"
                  placeholder="Confirm your password"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-primary px-4 py-3 font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {loading ? "Creating account..." : "Sign Up"}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-dark-5 dark:text-dark-6">
              Already have an account?{" "}
              <Link
                href="/login"
                className="font-medium text-primary hover:underline"
              >
                Sign In
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
