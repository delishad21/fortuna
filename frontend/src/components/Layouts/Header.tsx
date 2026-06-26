"use client";

import { Menu, Bell, User, ArrowLeft } from "lucide-react";
import { useSidebarContext } from "./sidebar-context";
import { useThemeStore } from "@/lib/stores/themeStore";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useHeaderConfig } from "./header-context";

interface HeaderProps {
  title?: string;
  subtitle?: string;
  showBack?: boolean;
  backHref?: string;
}

export function Header({
  title = "Dashboard",
  subtitle = "Personal Finance Management",
  showBack = false,
  backHref = "/dashboard",
}: HeaderProps) {
  const { toggleSidebar, isMobile } = useSidebarContext();
  const { theme, toggleTheme } = useThemeStore();
  const { data: session } = useSession();
  const router = useRouter();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const { headerConfig } = useHeaderConfig();

  const resolvedTitle = headerConfig?.title ?? title;
  const resolvedSubtitle = headerConfig?.subtitle ?? subtitle;
  const resolvedShowBack = headerConfig?.showBack ?? showBack;
  const resolvedBackHref = headerConfig?.backHref ?? backHref;

  const handleLogout = async () => {
    await signOut({ redirect: false });
    router.push("/login");
  };

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-stroke bg-white px-4 py-5 shadow-1 dark:border-stroke-dark dark:bg-gray-dark md:px-5 2xl:px-10">
      <div className="flex items-center gap-4">
        <button
          onClick={toggleSidebar}
          className="rounded-lg border border-stroke px-1.5 py-1 dark:border-stroke-dark dark:bg-dark-bg hover:dark:bg-white-10 lg:hidden"
        >
          <Menu className="size-6" />
          <span className="sr-only">Toggle Sidebar</span>
        </button>

        <div className="max-xl:hidden">
          <div className="flex items-center gap-3">
            {resolvedShowBack && (
              <button
                onClick={() => router.push(resolvedBackHref)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-stroke text-dark-5 hover:text-dark hover:border-primary dark:border-stroke-dark dark:text-dark-6 dark:hover:text-white dark:hover:border-primary"
                aria-label="Go back"
                title="Back"
              >
                <ArrowLeft className="size-4" />
              </button>
            )}
            <div>
              <h1 className="mb-0.5 font-display text-heading-5 font-bold text-dark dark:text-white">
                {resolvedTitle}
              </h1>
              <p className="font-medium text-dark-5 dark:text-dark-6">
                {resolvedSubtitle}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-end gap-2 min-[375px]:gap-4">
        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="flex items-center justify-center rounded-full p-2 hover:bg-gray-2 dark:hover:bg-dark-2"
          aria-label="Toggle theme"
        >
          {theme === "dark" ? (
            <svg
              className="size-6 text-dark-5 dark:text-dark-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
              />
            </svg>
          ) : (
            <svg
              className="size-6 text-dark-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
              />
            </svg>
          )}
        </button>

        {/* Notifications */}
        <button
          className="relative flex items-center justify-center rounded-full p-2 hover:bg-gray-2 dark:hover:bg-dark-2"
          aria-label="Notifications"
        >
          <Bell className="size-6 text-dark-5 dark:text-dark-6" />
          <span className="absolute right-1 top-1 flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75"></span>
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary"></span>
          </span>
        </button>

        {/* User Menu */}
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-gray-2 dark:hover:bg-dark-2"
          >
            <div className="flex size-10 items-center justify-center rounded-full bg-primary text-white">
              <User className="size-5" />
            </div>
            <div className="hidden text-left sm:block">
              <p className="text-sm font-medium text-dark dark:text-white">
                {session?.user?.name || "User"}
              </p>
              <p className="text-xs text-dark-5 dark:text-dark-6">
                {session?.user?.email}
              </p>
            </div>
          </button>

          {showUserMenu && (
            <div className="absolute right-0 top-full mt-2 w-48 rounded-lg border border-stroke bg-white p-2 shadow-dropdown dark:border-stroke-dark dark:bg-gray-dark">
              <button
                onClick={() => {
                  setShowUserMenu(false);
                  router.push("/settings");
                }}
                className="flex w-full items-center gap-2 rounded-lg px-4 py-2 text-sm text-dark hover:bg-gray-2 dark:text-white dark:hover:bg-dark-2"
              >
                <User className="size-4" />
                <span>Settings</span>
              </button>
              <button
                onClick={() => {
                  setShowUserMenu(false);
                  handleLogout();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-4 py-2 text-sm text-red hover:bg-gray-2 dark:hover:bg-dark-2"
              >
                <svg
                  className="size-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                  />
                </svg>
                <span>Logout</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
