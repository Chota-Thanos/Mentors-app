"use client";

import Link from "next/link";
import { ChevronDown, Menu, X } from "lucide-react";
import { useMemo, useState } from "react";

import { UserNav } from "@/components/layouts/UserNav";
import { useAuth } from "@/context/AuthContext";
import { useExamContext } from "@/context/ExamContext";
import { useProfile } from "@/context/ProfileContext";
import { flattenRoleWorkspaceSections, getMainsMentorWorkspaceSections, getQuizMasterWorkspaceSections } from "@/components/layouts/roleWorkspaceLinks";
import {
  canAccessMainsAuthoring,
  canAccessStandaloneManualQuizBuilder,
  canManageMainsSeries,
  canManageMentorshipLegacy,
  canManagePrelimsSeries,
  roleIsAdmin,
  roleIsMainsExpert,
  roleIsModerator,
  roleIsPrelimsExpert,
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
        className="app-topbar-link inline-flex items-center gap-1 px-3 py-2 text-sm font-semibold"
      >
        {label}
        <ChevronDown className="h-4 w-4" />
      </button>
      <div className="app-dropdown-panel invisible absolute left-0 top-full z-50 mt-2 w-64 p-2 opacity-0 transition-all duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
        {links.map((link) => (
          <Link
            key={`${label}-${link.href}-${link.label}`}
            href={link.href}
            className="app-topbar-link block rounded-2xl px-3 py-2 text-sm"
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
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--app-text-soft)]">{title}</p>
      <div className="grid gap-1">
        {links.map((link) => (
          <Link
            key={`${title}-${link.href}-${link.label}`}
            href={link.href}
            onClick={onNavigate}
            className="app-btn-secondary rounded-2xl px-3 py-2 text-sm font-medium"
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
  const { role } = useProfile();
  const { exams, globalExamId, globalExamName, setGlobalExamId, showOnboarding } = useExamContext();
  const [mobileOpen, setMobileOpen] = useState(false);

  const currentUserId = String(user?.id || "").trim();
  const adminLike = roleIsAdmin(role);
  const moderatorLike = roleIsModerator(role);
  const quizMasterLike = roleIsPrelimsExpert(role);
  const mainsMentorLike = roleIsMainsExpert(role);
  const canPrelimsAuthor = canManagePrelimsSeries({ role });
  const canMainsAuthor = canManageMainsSeries({ role });
  const canMentorshipActions = canManageMentorshipLegacy({ role });
  const canQuizBuilder = canAccessStandaloneManualQuizBuilder({ role });
  const canMainsRepository = canAccessMainsAuthoring({ role });
  const canEditProfessionalProfile = adminLike || moderatorLike || quizMasterLike || mainsMentorLike;
  const learnerLike = !adminLike && !moderatorLike && !quizMasterLike && !mainsMentorLike;
  const dashboardLabel = learnerLike ? "Performance Evaluation" : "Dashboard";

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
        { href: "/programs/prelims", label: "Prelims Programs" },
        { href: "/programs/mains", label: "Mains Programs" },
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
    }

    if (adminLike && (canPrelimsAuthor || canMainsAuthor)) {
      links.push({ href: "/programs", label: "Series Console" });
    }
    if ((adminLike || moderatorLike) && canMentorshipActions) {
      links.push({ href: "/mentorship/manage", label: "Mentorship Queue" });
    }
    if (adminLike || moderatorLike) {
      links.push({ href: "/onboarding/review", label: "Onboarding Queue" });
    }
    if (quizMasterLike) {
      links.push(...flattenRoleWorkspaceSections(getQuizMasterWorkspaceSections(currentUserId)));
    }
    if (mainsMentorLike) {
      links.push(...flattenRoleWorkspaceSections(getMainsMentorWorkspaceSections(currentUserId)));
    }

    return dedupeLinks(links);
  }, [
    adminLike,
    canMainsAuthor,
    canMentorshipActions,
    canPrelimsAuthor,
    hideAdminLinks,
    currentUserId,
    mainsMentorLike,
    moderatorLike,
    quizMasterLike,
  ]);

  const accountLinks = useMemo(() => {
    const links: NavLink[] = [
      { href: "/my-results", label: "My Results" },
      { href: "/my-purchases", label: "Purchases & Requests" },
      { href: "/subscriptions", label: "Subscriptions" },
      { href: "/auth/reset-password", label: "Update Password" },
    ];
    if (canEditProfessionalProfile) {
      links.push({ href: "/profile/professional", label: "Professional Profile" });
    } else {
      links.push({ href: professionalStatusLink.href, label: professionalStatusLink.label });
    }
    return dedupeLinks(links);
  }, [canEditProfessionalProfile, professionalStatusLink.href, professionalStatusLink.label]);

  const closeMobile = () => setMobileOpen(false);

  return (
    <header className="app-topbar sticky top-0 z-50 w-full">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-2 px-4">
        <Link href="/" className="mr-1 inline-flex items-center rounded-full px-2 py-1 text-base font-bold text-[var(--app-text)]">
          UPSC AI Prep
        </Link>

        <nav className="hidden flex-1 items-center gap-1 lg:flex">
          <Link
            href="/"
            className="app-topbar-link px-3 py-2 text-sm font-semibold"
          >
            Home
          </Link>
          <Link
            href="/dashboard"
            className="app-topbar-link px-3 py-2 text-sm font-semibold"
          >
            {dashboardLabel}
          </Link>
          <DesktopDropdown label="AI Tools" links={aiLinks} />
          <DesktopDropdown label="Programs" links={seriesLinks} />
          {workspaceLinks.length > 0 ? <DesktopDropdown label="Workspace" links={workspaceLinks} /> : null}
          <DesktopDropdown label="Account" links={accountLinks} />
        </nav>

        <button
          type="button"
          onClick={() => setMobileOpen((prev) => !prev)}
          className="app-btn-secondary inline-flex items-center justify-center rounded-2xl p-2 lg:hidden"
          aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden sm:block">
            <select
              value={globalExamId ?? "all"}
              onChange={(e) => setGlobalExamId(e.target.value === "all" ? null : Number(e.target.value))}
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              <option value="all">All Exams</option>
              {exams.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.name}
                </option>
              ))}
            </select>
          </div>
          <UserNav />
        </div>
      </div>

      {mobileOpen ? (
        <div className="app-mobile-panel lg:hidden">
          <nav className="mx-auto w-full max-w-7xl space-y-4 px-4 py-4">
            <section className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--app-text-soft)]">Exam Scope</p>
              <select
                value={globalExamId ?? "all"}
                onChange={(e) => setGlobalExamId(e.target.value === "all" ? null : Number(e.target.value))}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700"
              >
                <option value="all">All Exams</option>
                {exams.map((ex) => (
                  <option key={ex.id} value={ex.id}>
                    {ex.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-[var(--app-text-soft)]">
                {globalExamName ? `Currently showing ${globalExamName}.` : "Currently showing all exams."}
              </p>
            </section>
            <MobileSection
              title="Primary"
              onNavigate={closeMobile}
              links={[
                { href: "/", label: "Home" },
                { href: "/dashboard", label: dashboardLabel },
              ]}
            />
            <MobileSection title="AI Tools" links={aiLinks} onNavigate={closeMobile} />
            <MobileSection title="Programs" links={seriesLinks} onNavigate={closeMobile} />
            <MobileSection title="Workspace" links={workspaceLinks} onNavigate={closeMobile} />
            <MobileSection title="Account" links={accountLinks} onNavigate={closeMobile} />
          </nav>
        </div>
      ) : null}

      {showOnboarding && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-[24px] bg-white p-6 shadow-xl">
            <h2 className="mb-2 text-xl font-bold text-slate-800">Select Exam Preference</h2>
            <p className="mb-6 text-sm text-slate-600">
              Personalize your content feed by selecting an exam context, or choose to see everything.
            </p>
            <div className="space-y-2">
              <button
                onClick={() => setGlobalExamId(null)}
                className="w-full rounded-2xl border border-slate-300 p-3 text-left transition hover:bg-slate-50"
              >
                <div className="font-semibold text-slate-800">All Exams</div>
                <div className="text-xs text-slate-500">View content for all exams combined</div>
              </button>
              {exams.map((ex) => (
                <button
                  key={ex.id}
                  onClick={() => setGlobalExamId(ex.id)}
                  className="w-full rounded-2xl border border-slate-300 p-3 text-left transition hover:bg-slate-50"
                >
                  <div className="font-semibold text-slate-800">{ex.name}</div>
                  <div className="text-xs text-slate-500">Only show content tagged for {ex.name}</div>
                </button>
              ))}
            </div>
            {globalExamId !== null && (
              <div className="mt-4 flex justify-end">
                <button onClick={() => setGlobalExamId(globalExamId)} className="app-btn-primary rounded-xl px-4 py-2 text-sm font-semibold">Done</button>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
