import Link from "next/link";

import AdminOnly from "@/components/auth/AdminOnly";
import AppLayout from "@/components/layouts/AppLayout";
import { ADMIN_SECTIONS } from "@/components/layouts/adminLinks";

export const metadata = {
  title: "Admin Panel - UPSC Prep",
  description: "Admin panel for premium content, tests, quizzes, and tools.",
};

export default function AdminPanelPage() {
  return (
    <AdminOnly>
      <AppLayout adminNav>
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Admin Panel</h1>
            <p className="mt-2 text-sm text-slate-500">
              Quick links to all currently available admin routes.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {ADMIN_SECTIONS.map((section) => (
              <section key={section.title} className="rounded-xl border border-slate-200 bg-white p-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{section.title}</h2>
                <div className="mt-3 space-y-2">
                  {section.links.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className="block rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50"
                    >
                      <p className="text-sm font-medium text-slate-900">{link.label}</p>
                      {link.description ? <p className="text-xs text-slate-500">{link.description}</p> : null}
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </AppLayout>
    </AdminOnly>
  );
}
