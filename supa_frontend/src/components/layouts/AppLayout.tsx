
import { SiteHeader } from "@/components/layouts/Header"
import AdminSidebar from "@/components/layouts/AdminSidebar"

export default function AppLayout({
    children,
    adminNav = false,
    hideAdminLinks = false,
}: Readonly<{
    children: React.ReactNode;
    adminNav?: boolean;
    hideAdminLinks?: boolean;
}>) {
    return (
        <div className="app-shell relative flex min-h-screen flex-col">
            <SiteHeader hideAdminLinks={hideAdminLinks} />
            <div className="mx-auto w-full max-w-7xl flex-1">
                {adminNav ? (
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
                        <AdminSidebar />
                        <main className="min-w-0 flex-1">{children}</main>
                    </div>
                ) : (
                    children
                )}
            </div>
        </div>
    );
}
