"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Upload,
  Receipt,
  Plane,
  BarChart3,
  Settings,
  ChevronUp,
} from "lucide-react";
import { useSidebarContext } from "./sidebar-context";
import { BrandLogo } from "@/components/ui/Brand";

const menuItems = [
  {
    section: "Main",
    items: [
      { title: "Dashboard", icon: LayoutDashboard, url: "/dashboard" },
      { title: "Import", icon: Upload, url: "/import" },
      { title: "Transactions", icon: Receipt, url: "/transactions" },
      { title: "Trips", icon: Plane, url: "/trips" },
      { title: "Analytics", icon: BarChart3, url: "/analytics" },
    ],
  },
  {
    section: "Other",
    items: [{ title: "Settings", icon: Settings, url: "/settings" }],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { setIsOpen, isOpen, isMobile, toggleSidebar } = useSidebarContext();

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
            {menuItems.map((section) => (
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
                            onClick={() => isMobile && toggleSidebar()}
                            className={cn(
                              "group relative flex items-center gap-3 rounded-lg px-4 py-3 font-medium transition-colors",
                              isActive
                                ? "bg-gray-2 text-primary dark:bg-dark-2 dark:text-primary"
                                : "text-dark-5 hover:bg-gray-2 hover:text-dark dark:text-dark-6 dark:hover:bg-dark-2 dark:hover:text-white",
                            )}
                          >
                            <Icon
                              className="size-6 shrink-0"
                              aria-hidden="true"
                            />
                            <span>{item.title}</span>
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
