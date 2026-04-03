"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import AppLayout from "@/components/layouts/AppLayout";
import { premiumApi } from "@/lib/premiumApi";

export default function ZoomConnectCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const code = useMemo(() => String(searchParams.get("code") || "").trim(), [searchParams]);
  const error = useMemo(() => String(searchParams.get("error") || "").trim(), [searchParams]);
  const [message, setMessage] = useState("Completing Zoom connection...");

  useEffect(() => {
    const redirectToOrigin = async () => {
      const storedReturnTo = sessionStorage.getItem("zoom-connect-return-to") || "/dashboard";
      sessionStorage.removeItem("zoom-connect-return-to");
      router.replace(storedReturnTo);
    };

    if (error) {
      setMessage(`Zoom connection failed: ${error}`);
      return;
    }
    if (!code) {
      setMessage("Zoom connection code is missing.");
      return;
    }

    const redirectUri = `${window.location.origin}/zoom/connect/callback`;
    premiumApi
      .post("/mentorship/integrations/zoom/exchange", {
        code,
        redirect_uri: redirectUri,
      })
      .then(() => {
        setMessage("Zoom connected. Redirecting...");
        window.setTimeout(() => {
          void redirectToOrigin();
        }, 900);
      })
      .catch((requestError: any) => {
        const detail = requestError?.response?.data?.detail;
        setMessage(typeof detail === "string" && detail.trim() ? detail : "Zoom connection failed.");
      });
  }, [code, error, router]);

  return (
    <AppLayout>
      <div className="mx-auto max-w-xl p-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <h1 className="text-xl font-bold text-slate-900">Zoom Connection</h1>
          <p className="mt-2 text-sm text-slate-600">{message}</p>
        </div>
      </div>
    </AppLayout>
  );
}
