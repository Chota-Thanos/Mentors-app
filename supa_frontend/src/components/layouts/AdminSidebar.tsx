"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_SECTIONS } from "@/components/layouts/adminLinks";

function linkClass(pathname: string | null, href: string): string {
  const baseHref = href.split("#")[0];
  const active = pathname === baseHref || (pathname?.startsWith(baseHref) && baseHref !== "/premium-workspace");
  const base = "block rounded-md px-3 py-2 text-sm transition-colors";
  if (active) {
    return `${base} bg-slate-900 text-white`;
  }
  return `${base} text-slate-600 hover:bg-slate-100 hover:text-slate-900`;
}

export default function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 md:block">
      <div className="sticky top-24 rounded-xl border border-slate-200 bg-white p-3">
        <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Admin Premium</p>
        <nav className="space-y-3">
          {ADMIN_SECTIONS.map((section) => (
            <div key={section.title}>
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{section.title}</p>
              <div className="space-y-1">
                {section.links.map((link) => (
                  <Link key={link.href} href={link.href} className={linkClass(pathname, link.href)}>
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </div>
    </aside>
  );
}
