"use client";

import { Sidebar } from "@/components/Layouts/Sidebar";
import { Header } from "@/components/Layouts/Header";
import { SidebarProvider } from "@/components/Layouts/sidebar-context";
import { HeaderProvider } from "@/components/Layouts/header-context";
import { usePathname } from "next/navigation";

const pageConfig: Record<
  string,
  { title: string; subtitle: string; showBack?: boolean; backHref?: string }
> = {
  "/dashboard": {
    title: "Dashboard",
    subtitle: "Personal Finance Management",
  },
  "/import": {
    title: "Import Transactions",
    subtitle:
      "Upload your bank statements to automatically extract transactions",
  },
  "/transactions": {
    title: "Transactions",
    subtitle: "View and manage your transactions",
  },
  "/trips": {
    title: "Trips",
    subtitle: "Create and manage your trip spending workspaces",
  },
  "/analytics": {
    title: "Analytics",
    subtitle: "Reports and insights from imported statements",
  },
  "/categories": {
    title: "Categories",
    subtitle: "Organize your spending categories",
  },
  "/settings": {
    title: "Settings",
    subtitle: "Manage your account settings",
  },
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const config =
    pageConfig[pathname] ||
    (pathname.startsWith("/trips/")
      ? {
          title: "Trip",
          subtitle: "Manage funding, wallets, and trip transactions",
          showBack: true,
          backHref: "/trips",
        }
      : pageConfig["/dashboard"]);

  return (
    <SidebarProvider>
      <HeaderProvider>
        <div className="flex h-screen overflow-hidden">
          <Sidebar />

          <div className="flex-1 flex flex-col overflow-hidden bg-gray-2 dark:bg-dark-bg">
            <Header
              title={config.title}
              subtitle={config.subtitle}
              showBack={config.showBack}
              backHref={config.backHref}
            />

            <main className="flex-1 overflow-y-auto overflow-x-hidden">
              <div className="h-full w-full p-4 md:p-5 2xl:p-6">{children}</div>
            </main>
          </div>
        </div>
      </HeaderProvider>
    </SidebarProvider>
  );
}
