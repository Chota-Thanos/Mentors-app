"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

import { useAuth } from "@/context/AuthContext";
import { getAccountRoleLabels } from "@/lib/accessControl";

export function UserNav() {
  const router = useRouter();
  const { user, loading, signOut } = useAuth();
  const roleLabels = useMemo(() => getAccountRoleLabels(user), [user]);
  const roleText = roleLabels.join(" + ");

  const handleSignOut = async () => {
    await signOut();
    router.refresh();
    router.push("/login");
  };

  if (loading) {
    return <div className="h-8 w-28 rounded bg-slate-100" />;
  }

  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <Link
          href="/login"
          className="hidden rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 sm:inline-flex"
        >
          Login
        </Link>
        <Link
          href="/signup"
          className="inline-flex rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800"
        >
          Get Started
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex max-w-[170px] truncate rounded-full border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-semibold text-indigo-700 sm:max-w-[220px]">
        {roleText}
      </span>
      <span className="hidden max-w-[180px] truncate text-xs text-slate-500 xl:inline-block">
        {user.email}
      </span>
      <button
        type="button"
        onClick={() => void handleSignOut()}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-rose-300 hover:text-rose-700"
      >
        Sign out
      </button>
    </div>
  );
}
