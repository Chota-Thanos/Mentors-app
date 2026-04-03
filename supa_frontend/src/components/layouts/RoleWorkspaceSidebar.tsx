"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { RoleWorkspaceSection } from "@/components/layouts/roleWorkspaceLinks";

function normalizeHrefPath(href: string): string {
  return String(href || "").split("?")[0]?.split("#")[0] || "";
}

function linkClass(pathname: string, href: string): string {
  const active = pathname === normalizeHrefPath(href);
  const base = "block rounded-2xl border px-3 py-2.5 transition-colors";
  if (active) {
    return `${base} border-slate-900 bg-slate-900 text-white shadow-sm`;
  }
  return `${base} border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50`;
}

export default function RoleWorkspaceSidebar({
  title,
  subtitle,
  sections,
  className = "",
}: {
  title: string;
  subtitle: string;
  sections: RoleWorkspaceSection[];
  className?: string;
}) {
  const pathname = usePathname() || "";

  return (
    <aside className={`shrink-0 ${className}`.trim()}>
      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-24 lg:w-72">
        <div className="rounded-2xl bg-slate-900 px-4 py-4 text-white">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">Workspace</p>
          <h2 className="mt-2 text-lg font-bold">{title}</h2>
          <p className="mt-1 text-sm text-slate-300">{subtitle}</p>
        </div>

        <nav className="mt-4 space-y-4">
          {sections.map((section) => (
            <div key={section.title}>
              <p className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{section.title}</p>
              <div className="space-y-2">
                {section.links.map((link) => {
                  return (
                    <Link key={`${section.title}-${link.href}`} href={link.href} className={linkClass(pathname, link.href)}>
                      <p className="text-sm font-semibold">{link.label}</p>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </div>
    </aside>
  );
}
