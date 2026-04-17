"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/context/AuthContext";
import { useProfile } from "@/context/ProfileContext";
import { roleIsAdmin } from "@/lib/accessControl";

type AdminOnlyProps = {
  children: React.ReactNode;
  redirectTo?: string;
};

export default function AdminOnly({ children, redirectTo = "/ai-quiz-generator/gk" }: AdminOnlyProps) {
  const router = useRouter();
  const { user, loading, isAuthenticated } = useAuth();
  const { role, loading: profileLoading } = useProfile();
  const allowed = roleIsAdmin(role);

  useEffect(() => {
    if (loading || (user && profileLoading)) return;
    if (!isAuthenticated || !allowed) {
      router.replace(redirectTo);
    }
  }, [allowed, isAuthenticated, loading, profileLoading, redirectTo, router, user]);

  if (loading || (user && profileLoading)) {
    return <div className="p-6 text-sm text-slate-500">Checking access...</div>;
  }

  if (!isAuthenticated || !allowed) {
    return null;
  }

  return <>{children}</>;
}
