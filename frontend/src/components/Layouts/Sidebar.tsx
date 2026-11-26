"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard,
  Upload,
  Receipt,
  Plane,
  BarChart3,
  Settings,
  MessageSquare,
  ChevronUp,
  ListChecks,
} from "lucide-react";
import { getWorkflowPreference } from "@/app/actions/user";
import { getReviewQueue } from "@/app/actions/review";
import { SIDEBAR_ORDER, isWorkflowMode, type WorkflowMode } from "@/lib/workflow";
import { useSidebarContext } from "./sidebar-context";
import { BrandLogo } from "@/components/ui/Brand";

const menuItems = [
  {
    section: "Main",
    items: [
      { title: "Dashboard", icon: LayoutDashboard, url: "/dashboard" },
      { title: "Imports", icon: Upload, url: "/imports" },
      { title: "Transactions", icon: Receipt, url: "/transactions" },
      { title: "To review", icon: ListChecks, url: "/review" },
      { title: "Trips", icon: Plane, url: "/trips" },
      { title: "Analytics", icon: BarChart3, url: "/analytics" },
      { title: "Chat", icon: MessageSquare, url: "/chat" },
    ],
  },
  {
    section: "Other",
    items: [{ title: "Settings", icon: Settings, url: "/settings" }],
  },
];

const MODE_KEY = "fortuna:workflowMode";

export function Sidebar() {
  const pathname = usePathname();
  const { setIsOpen, isOpen, isMobile, toggleSidebar } = useSidebarContext();
  const [mode, setMode] = useState<WorkflowMode>("statements");
  const [reviewCount, setReviewCount] = useState(0);

  // The workflow preference orders the menu; the last one seen is cached so
  // the menu doesn't reorder on every page load.
  useEffect(() => {
    try {
      const cached = window.localStorage.getItem(MODE_KEY);
      if (isWorkflowMode(cached)) setMode(cached);
    } catch {}
    getWorkflowPreference()
      .then((preference) => {
        setMode(preference.mode);
        try {
          window.localStorage.setItem(MODE_KEY, preference.mode);
        } catch {}
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    getReviewQueue({ limit: 1 })
      .then((queue) => setReviewCount(queue.total))
      .catch(() => {});
  }, [pathname]);

  const sections = useMemo(() => {
    const order = SIDEBAR_ORDER[mode];
    const rank = (url: string) => {
      const index = order.indexOf(url);
      return index === -1 ? order.length : index;
    };
    return menuItems.map((section) => ({
      ...section,
      items: [...section.items].sort((a, b) => rank(a.url) - rank(b.url)),
    }));
  }, [mode]);

  return (
    <>
      {/* Mobile Overlay */}
      {isMobile && isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 transition-opacity duration-300"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "max-w-[290px] overflow-hidden border-r border-stroke bg-white transition-[width] duration-200 ease-linear dark:border-stroke-dark dark:bg-gray-dark",
          isMobile ? "fixed bottom-0 top-0 z-50" : "sticky top-0 h-screen",
          isOpen ? "w-full" : "w-0",
        )}
        aria-label="Main navigation"
      >
        <div className="flex h-full flex-col py-10 pl-[25px] pr-[7px]">
          <div className="relative pr-4.5">
            <Link
              href={"/dashboard"}
              onClick={() => isMobile && toggleSidebar()}
              className="flex items-center gap-3 px-0 py-2.5"
            >
              <BrandLogo />
            </Link>
          </div>

          {/* Navigation */}
          <div className="custom-scrollbar mt-6 flex-1 overflow-y-auto pr-3 min-[850px]:mt-10">
            {sections.map((section) => (
              <div key={section.section} className="mb-6">
                <h2 className="mb-5 text-sm font-medium text-dark-4 dark:text-dark-6">
                  {section.section}
                </h2>

                <nav role="navigation" aria-label={section.section}>
                  <ul className="space-y-2">
                    {section.items.map((item) => {
                      const Icon = item.icon;
                      const isActive = pathname === item.url;

                      return (
                        <li key={item.title}>
                          <Link
                            href={item.url}
                            style={
                              isActive && item.url === "/chat"
                                ? { color: "#fff" }
                                : undefined
                            }
                            onClick={() => isMobile && toggleSidebar()}
                            className={cn(
                              "group relative flex items-center gap-3 rounded-lg px-4 py-3 font-medium transition-colors",
                              isActive
                                ? item.url === "/chat"
                                  ? "bg-primary text-white"
                                  : "bg-gray-2 text-primary dark:bg-dark-2 dark:text-primary"
                                : "text-dark-5 hover:bg-gray-2 hover:text-dark dark:text-dark-6 dark:hover:bg-dark-2 dark:hover:text-white",
                            )}
                          >
                            <Icon
                              className="size-6 shrink-0"
                              aria-hidden="true"
                            />
                            <span>{item.title}</span>
                            {item.url === "/review" && reviewCount > 0 ? (
                              <span className="ml-auto mr-2 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold tabular-nums text-white">
                                {reviewCount > 99 ? "99+" : reviewCount}
                              </span>
                            ) : null}
                            {isActive && (
                              <span className="absolute right-0 top-0 h-full w-1 rounded-l-lg bg-primary" />
                            )}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </nav>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </>
  );
}
