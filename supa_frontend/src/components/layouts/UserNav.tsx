"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

import { useAuth } from "@/context/AuthContext";
import { useProfile } from "@/context/ProfileContext";
import { getRoleLabel } from "@/lib/accessControl";

export function UserNav() {
  const router = useRouter();
  const { user, loading: authLoading, signOut } = useAuth();
  const { profile, role, loading: profileLoading } = useProfile();
  const roleText = getRoleLabel(role);

  const handleSignOut = async () => {
    await signOut();
    router.refresh();
    router.push("/login");
  };

  if (authLoading || (user && profileLoading)) {
    return <div className="h-8 w-28 rounded-full bg-[var(--app-surface-soft)]" />;
  }

  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <Link
          href="/login"
          className="app-btn-secondary hidden px-3 py-1.5 text-xs font-semibold sm:inline-flex"
        >
          Login
        </Link>
        <Link
          href="/signup"
          className="app-btn-primary inline-flex px-3 py-1.5 text-xs font-semibold"
        >
          Register
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex max-w-[170px] truncate rounded-full border border-[var(--app-border-strong)] bg-[var(--app-secondary-soft)] px-2 py-1 text-[10px] font-semibold text-[var(--app-secondary)] sm:max-w-[220px]">
        {roleText}
      </span>
      <span className="hidden max-w-[180px] truncate text-xs text-[var(--app-text-muted)] xl:inline-block">
        {user.email}
      </span>
      <button
        type="button"
        onClick={() => void handleSignOut()}
        className="app-btn-secondary px-3 py-1.5 text-xs font-semibold"
      >
        Sign out
      </button>
    </div>
  );
}
