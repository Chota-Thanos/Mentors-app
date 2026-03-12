"use client";
import { useEffect, useState } from "react";
import { premiumApi } from "@/lib/premiumApi";
import { Target, ArrowRight } from "lucide-react";
import Link from "next/link";
// Removing skeleton import as it doesn't exist

interface WeakArea {
    id: number;
    name: string;
    type: string;
    count: number;
}

export default function FocusAreasWidget() {
    const [areas, setAreas] = useState<WeakArea[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        premiumApi.get("/user/weak-areas")
            .then(res => setAreas(res.data))
            .catch(err => console.error("Failed to fetch weak areas", err))
            .finally(() => setLoading(false));
    }, []);

    if (loading) return (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
            <div className="h-6 w-32 bg-slate-100 rounded animate-pulse" />
            <div className="space-y-3">
                {[1, 2, 3].map(i => <div key={i} className="h-16 w-full bg-slate-50 rounded-xl animate-pulse" />)}
            </div>
        </div>
    );

    if (areas.length === 0) return (
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <h2 className="font-bold text-slate-900 mb-2">Focus Areas</h2>
            <p className="text-sm text-slate-500">Great job! No specific weak areas detected recently. Keep practicing to maintain your streak!</p>
        </div>
    );

    return (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <h2 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
                <Target className="h-5 w-5 text-red-500" />
                Focus Areas
            </h2>
            <p className="text-sm text-slate-500 mb-4">
                Based on your recent performance, we recommend focusing on these topics:
            </p>
            <div className="space-y-3">
                {areas.slice(0, 5).map(area => (
                    <div key={area.id} className="flex items-center justify-between p-3 bg-red-50 border border-red-100 rounded-xl">
                        <div>
                            <p className="font-bold text-slate-900">{area.name}</p>
                            <p className="text-xs text-red-600 font-medium">{area.count} mistakes recently</p>
                        </div>
                        <Link
                            href={`/quiz/start?category_id=${area.id}`}
                            className="px-3 py-1.5 bg-white text-xs font-bold text-indigo-600 rounded-lg shadow-sm hover:shadow-md transition-all flex items-center gap-1"
                        >
                            Practice <ArrowRight className="h-3 w-3" />
                        </Link>
                    </div>
                ))}
            </div>
        </div>
    );
}
