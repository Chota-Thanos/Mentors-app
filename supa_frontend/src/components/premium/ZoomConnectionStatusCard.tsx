"use client";

import { useState, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { premiumApi } from "@/lib/premiumApi";
import { toast } from "sonner";
import { Plus, Unplug } from "lucide-react";

export function ZoomConnectionStatusCard() {
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const fetchStatus = async () => {
        try {
            const res = await premiumApi.get("/mentorship/integrations/zoom/status");
            setData(res.data);
        } catch (e: any) {
            if (e.response?.status !== 401 && e.response?.status !== 404) {
                toast.error("Failed to load zoom status", { description: e.message });
            }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStatus();
    }, []);

    const handleConnect = async () => {
        try {
            const currentUrl = `${pathname || "/"}${searchParams?.toString() ? `?${searchParams.toString()}` : ""}`;
            sessionStorage.setItem("zoom-connect-return-to", currentUrl);
            const redirectOverride = `${window.location.origin}/zoom/connect/callback`;
            const res = await premiumApi.post("/mentorship/integrations/zoom/connect", {
                redirect_override: redirectOverride,
            });
            if (res.data?.authorize_url) {
                window.location.href = res.data.authorize_url;
            }
        } catch (e: any) {
            toast.error("Failed to start zoom connect", { description: e.message });
        }
    };

    const handleDisconnect = async () => {
        try {
            await premiumApi.post("/mentorship/integrations/zoom/disconnect");
            toast.success("Zoom account disconnected");
            fetchStatus();
        } catch (e: any) {
            toast.error("Failed to disconnect", { description: e.message });
        }
    };

    if (loading) return null;

    return (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-sm bg-blue-600 font-bold text-white text-xs">
                            Z
                        </span>
                        Zoom Integration
                    </h3>
                    {data?.connected ? (
                        <p className="mt-1 text-xs text-slate-500">
                            Connected as <span className="font-medium text-slate-800">{data.display_name}</span> ({data.email})
                            {data.requires_reconnect && <span className="text-rose-600 block mt-0.5">Reconnect required. Authorization expired or revoked.</span>}
                        </p>
                    ) : (
                        <p className="mt-1 text-xs text-slate-500">
                            Connect your Zoom account to let the system automatically generate meeting links for live discussion classes and mentorship sessions.
                        </p>
                    )}
                </div>
                <div>
                    {data?.connected ? (
                        <div className="flex flex-col items-end gap-2">
                            {data.requires_reconnect && (
                                <button
                                    onClick={handleConnect}
                                    className="rounded border border-blue-600 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700"
                                >
                                    Reconnect
                                </button>
                            )}
                            <button
                                onClick={handleDisconnect}
                                className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-slate-500 hover:text-slate-900"
                            >
                                <Unplug className="h-3 w-3" />
                                Disconnect
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={handleConnect}
                            className="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                        >
                            <Plus className="h-3.5 w-3.5" />
                            Connect Zoom
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
