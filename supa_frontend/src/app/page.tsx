import Link from "next/link";
import { BookOpen, GraduationCap, Sparkles, Zap } from "lucide-react";

import { SiteHeader } from "@/components/layouts/Header";

export default function Home() {
  return (
    <div className="relative min-h-screen bg-slate-50">
      <SiteHeader />

      <main className="relative isolate pt-10">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-24 lg:px-8">
          <div className="text-center">
            <div className="mb-8 flex justify-center">
              <div className="flex items-center gap-2 rounded-full bg-indigo-50/50 px-3 py-1 text-sm font-medium leading-6 text-indigo-600 ring-1 ring-indigo-600/10 hover:ring-indigo-600/20">
                <Zap className="h-4 w-4" />
                <span>New AI Studio 2.0 is live</span>
              </div>
            </div>
            <h1 className="text-balance text-3xl font-extrabold tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
              Master UPSC Preparation with <span className="text-indigo-600">AI Intelligence</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-base leading-8 text-slate-600 sm:text-lg">
              Synthesize high-quality mock tests, browse Prelims and Mains test sets, and track your progress with our all-in-one
              preparation platform.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-x-6">
              <Link
                href="/dashboard"
                className="w-full rounded-xl bg-slate-900 px-8 py-4 text-center text-sm font-bold text-white shadow-lg transition-all hover:scale-[1.01] hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 sm:w-auto"
              >
                Go to Dashboard
              </Link>
              <Link href="/collections" className="group flex items-center gap-2 text-sm font-bold leading-6 text-slate-900">
                Browse Tests <span className="transition-transform group-hover:translate-x-1">-&gt;</span>
              </Link>
            </div>
          </div>
        </div>
      </main>

      <section className="border-y border-slate-100 bg-slate-50 py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto grid max-w-2xl grid-cols-1 gap-x-8 gap-y-8 lg:mx-0 lg:max-w-none lg:grid-cols-3">
            <div className="flex flex-col items-start rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <div className="mb-6 rounded-lg bg-indigo-50 p-3">
                <Sparkles className="h-6 w-6 text-indigo-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">AI Quiz Generation</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                Paste any article or notes and get UPSC-standard multiple choice questions in seconds.
              </p>
            </div>

            <div className="flex flex-col items-start rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <div className="mb-6 rounded-lg bg-amber-50 p-3">
                <BookOpen className="h-6 w-6 text-amber-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Premium Test Banks</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                Access curated Prelims and Mains test-ready content designed for IAS aspirants.
              </p>
            </div>

            <div className="flex flex-col items-start rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <div className="mb-6 rounded-lg bg-green-50 p-3">
                <GraduationCap className="h-6 w-6 text-green-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Test Runner</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                Experience a real exam environment with a distraction-free quiz player and instant analytics.
              </p>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-100 px-6 py-12">
        <div className="mx-auto max-w-7xl text-center text-sm text-slate-400">
          <p>(c) 2026 UPSC AI Prep. Built for the future of education.</p>
        </div>
      </footer>
    </div>
  );
}
