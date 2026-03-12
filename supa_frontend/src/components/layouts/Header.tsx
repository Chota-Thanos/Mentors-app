"use client";

import Link from "next/link";
import { ChevronDown, Menu, X } from "lucide-react";
import { useMemo, useState } from "react";

import { UserNav } from "@/components/layouts/UserNav";
import { useAuth } from "@/context/AuthContext";
import {
  canAccessMainsAuthoring,
  canAccessManualQuizBuilder,
  canManageMainsSeries,
  canManageMentorship,
  canManagePrelimsSeries,
  isAdminLike,
  isMainsMentorLike,
  isModeratorLike,
  isQuizMasterLike,
} from "@/lib/accessControl";

type NavLink = {
  href: string;
  label: string;
};

function dedupeLinks(links: NavLink[]): NavLink[] {
  const seen = new Set<string>();
  const output: NavLink[] = [];
  for (const link of links) {
    const href = String(link.href || "").trim();
    const label = String(link.label || "").trim();
    if (!href || !label) continue;
    const key = `${href}::${label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({ href, label });
  }
  return output;
}

function DesktopDropdown({ label, links }: { label: string; links: NavLink[] }) {
  if (links.length === 0) return null;

  return (
    <div className="group relative">
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
      >
        {label}
        <ChevronDown className="h-4 w-4" />
      </button>
      <div className="invisible absolute left-0 top-full z-50 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-2 opacity-0 shadow-xl transition-all duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
        {links.map((link) => (
          <Link
            key={`${label}-${link.href}-${link.label}`}
            href={link.href}
            className="block rounded-lg px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100 hover:text-slate-900"
          >
            {link.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

function MobileSection({
  title,
  links,
  onNavigate,
}: {
  title: string;
  links: NavLink[];
  onNavigate: () => void;
}) {
  if (links.length === 0) return null;

  return (
    <section className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <div className="grid gap-1">
        {links.map((link) => (
          <Link
            key={`${title}-${link.href}-${link.label}`}
            href={link.href}
            onClick={onNavigate}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
          >
            {link.label}
          </Link>
        ))}
      </div>
    </section>
  );
}

export function SiteHeader({ hideAdminLinks = false }: { hideAdminLinks?: boolean } = {}) {
  const { user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const adminLike = isAdminLike(user);
  const moderatorLike = isModeratorLike(user);
  const quizMasterLike = isQuizMasterLike(user);
  const mainsMentorLike = isMainsMentorLike(user);
  const canPrelimsAuthor = canManagePrelimsSeries(user);
  const canMainsAuthor = canManageMainsSeries(user);
  const canMentorshipActions = canManageMentorship(user);
  const canQuizBuilder = canAccessManualQuizBuilder(user);
  const canMainsRepository = canAccessMainsAuthoring(user);
  const canEditProfessionalProfile = adminLike || moderatorLike || quizMasterLike || mainsMentorLike;

  const professionalStatusLink = useMemo(() => {
    if (mainsMentorLike && quizMasterLike) {
      return { href: "/profile/professional", label: "Quiz Master + Mains Mentor Access" };
    }
    if (mainsMentorLike) {
      return { href: "/profile/professional", label: "Mains Mentor Access Active" };
    }
    if (quizMasterLike) {
      return { href: "/profile/professional", label: "Quiz Master Access Active" };
    }
    return { href: "/onboarding", label: "Apply: Quiz Master / Mains Mentor" };
  }, [mainsMentorLike, quizMasterLike]);

  const aiLinks = useMemo(() => {
    const links: NavLink[] = [
      { href: quizMasterLike ? "/quiz-master/ai-quiz/gk" : "/ai-quiz-generator/gk", label: "AI Quiz Parser + Creator" },
      { href: mainsMentorLike ? "/mains-mentor/ai-mains" : "/mains/evaluate", label: "AI Mains Generator + Evaluator" },
    ];
    if (canQuizBuilder) {
      links.push({ href: "/quiz/create", label: "Manual Prelims Builder" });
    }
    if (canMainsRepository) {
      links.push({ href: "/mains/questions", label: "Mains Repository" });
    }
    return dedupeLinks(links);
  }, [canMainsRepository, canQuizBuilder, mainsMentorLike, quizMasterLike]);

  const seriesLinks = useMemo(
    () =>
      dedupeLinks([
        { href: "/test-series/prelims", label: "Prelims Test Series" },
        { href: "/test-series/mains", label: "Mains Test Series" },
        { href: "/mentors", label: "Mains Mentors" },
        { href: "/collections", label: "My Tests" },
      ]),
    [],
  );

  const workspaceLinks = useMemo(() => {
    const links: NavLink[] = [];
    if (hideAdminLinks) return links;

    if (adminLike) {
      links.push({ href: "/premium-workspace", label: "Admin Workspace" });
      links.push({ href: "/admin", label: "Admin Panel" });
      links.push({ href: "/admin/user-roles", label: "Role Management" });
    } else if (moderatorLike) {
      links.push({ href: "/dashboard", label: "Moderation Workspace" });
    } else if (mainsMentorLike) {
      links.push({ href: "/test-series", label: "Mains Mentor Workspace" });
    } else if (quizMasterLike) {
      links.push({ href: "/test-series", label: "Quiz Master Workspace" });
    }

    if (canPrelimsAuthor || canMainsAuthor) {
      links.push({ href: "/test-series", label: "Series Console" });
    }
    if (canMentorshipActions) {
      links.push({ href: "/mentorship/manage", label: "Mentorship Queue" });
    }
    if (adminLike || moderatorLike) {
      links.push({ href: "/onboarding/review", label: "Onboarding Queue" });
    }

    return dedupeLinks(links);
  }, [
    adminLike,
    canMainsAuthor,
    canMentorshipActions,
    canPrelimsAuthor,
    hideAdminLinks,
    mainsMentorLike,
    moderatorLike,
    quizMasterLike,
  ]);

  const accountLinks = useMemo(() => {
    const links: NavLink[] = [{ href: "/my-results", label: "My Results" }, { href: "/my-purchases", label: "My Purchases" }, { href: "/subscriptions", label: "Subscriptions" }];
    if (canEditProfessionalProfile) {
      links.push({ href: "/profile/professional", label: "Professional Profile" });
    } else {
      links.push({ href: professionalStatusLink.href, label: professionalStatusLink.label });
    }
    return dedupeLinks(links);
  }, [canEditProfessionalProfile, professionalStatusLink.href, professionalStatusLink.label]);

  const closeMobile = () => setMobileOpen(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-2 px-4">
        <Link href="/" className="mr-1 inline-flex items-center rounded-md px-1 py-1 text-base font-bold text-slate-900">
          UPSC AI Prep
        </Link>

        <nav className="hidden flex-1 items-center gap-1 lg:flex">
          <Link
            href="/"
            className="rounded-md px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
          >
            Home
          </Link>
          <Link
            href="/dashboard"
            className="rounded-md px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
          >
            Dashboard
          </Link>
          <DesktopDropdown label="AI Tools" links={aiLinks} />
          <DesktopDropdown label="Test Series" links={seriesLinks} />
          {workspaceLinks.length > 0 ? <DesktopDropdown label="Workspace" links={workspaceLinks} /> : null}
          <DesktopDropdown label="Account" links={accountLinks} />
        </nav>

        <button
          type="button"
          onClick={() => setMobileOpen((prev) => !prev)}
          className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white p-2 text-slate-700 lg:hidden"
          aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>

        <div className="ml-auto">
          <UserNav />
        </div>
      </div>

      {mobileOpen ? (
        <div className="border-t border-slate-200 bg-slate-50 lg:hidden">
          <nav className="mx-auto w-full max-w-7xl space-y-4 px-4 py-4">
            <MobileSection
              title="Primary"
              onNavigate={closeMobile}
              links={[
                { href: "/", label: "Home" },
                { href: "/dashboard", label: "Dashboard" },
              ]}
            />
            <MobileSection title="AI Tools" links={aiLinks} onNavigate={closeMobile} />
            <MobileSection title="Test Series" links={seriesLinks} onNavigate={closeMobile} />
            <MobileSection title="Workspace" links={workspaceLinks} onNavigate={closeMobile} />
            <MobileSection title="Account" links={accountLinks} onNavigate={closeMobile} />
          </nav>
        </div>
      ) : null}
    </header>
  );
}
