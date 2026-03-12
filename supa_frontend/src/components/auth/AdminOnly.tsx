"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/context/AuthContext";
import { isAdminLike } from "@/lib/accessControl";

type AdminOnlyProps = {
  children: React.ReactNode;
  redirectTo?: string;
};

export default function AdminOnly({ children, redirectTo = "/ai-quiz-generator/gk" }: AdminOnlyProps) {
  const router = useRouter();
  const { user, loading, isAuthenticated } = useAuth();
  const allowed = isAdminLike(user);

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated || !allowed) {
      router.replace(redirectTo);
    }
  }, [allowed, isAuthenticated, loading, redirectTo, router]);

  if (loading) {
    return <div className="p-6 text-sm text-slate-500">Checking access...</div>;
  }

  if (!isAuthenticated || !allowed) {
    return null;
  }

  return <>{children}</>;
}
