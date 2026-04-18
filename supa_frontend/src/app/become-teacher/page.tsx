"use client";

import { ArrowRight, BookOpen, CheckCircle, GraduationCap, LayoutPanelLeft, ShieldCheck, UserCheck } from "lucide-react";
import Link from "next/link";
import AppLayout from "@/components/layouts/AppLayout";

export default function BecomeTeacherPage() {
  return (
    <AppLayout>
      <div className="min-h-screen bg-[#f8fafc] pb-20">
        {/* Hero Section */}
        <header className="relative overflow-hidden bg-[linear-gradient(135deg,#0f172a_0%,#1e293b_100%)] py-20 text-white">
          <div className="absolute left-1/2 top-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/10 blur-[120px]" />
          <div className="container relative mx-auto max-w-6xl px-6 text-center">
            <h1 className="text-4xl font-extrabold tracking-tight sm:text-6xl">
              Become a <span className="text-blue-400">Teacher</span> at Mentors App
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-300">
              Join our elite network of UPSC experts. Share your expertise, mentor serious aspirants, and build your own learning community.
            </p>
          </div>
        </header>

        {/* Roles Selection */}
        <main className="container mx-auto -mt-16 max-w-6xl px-6">
          <div className="grid gap-8 md:grid-cols-2">
            
            {/* Prelims Expert / Quiz Master */}
            <section className="group rounded-[32px] border border-slate-200 bg-white p-8 shadow-xl transition-all hover:shadow-2xl hover:-translate-y-1">
              <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 transition-colors group-hover:bg-amber-100">
                <BookOpen className="h-8 w-8" />
              </div>
              <h2 className="text-3xl font-bold text-slate-900">Prelims Expert</h2>
              <p className="mt-2 text-sm font-medium text-amber-600 uppercase tracking-wider">Formerly Quiz Master</p>
              
              <div className="mt-8 space-y-6">
                <div>
                  <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-800">
                    <CheckCircle className="h-5 w-5 text-emerald-500" />
                    Provisions
                  </h3>
                  <ul className="mt-3 space-y-2 text-slate-600">
                    <li className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-slate-300 shrink-0" />
                      Create and sell UPSC Prelims Programs
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-slate-300 shrink-0" />
                      Frame and publish high-signal MCQs
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-slate-300 shrink-0" />
                      Build your brand as a content creator
                    </li>
                  </ul>
                </div>

                <div>
                  <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-800">
                    <ShieldCheck className="h-5 w-5 text-blue-500" />
                    Eligibility
                  </h3>
                  <ul className="mt-3 space-y-2 text-slate-600">
                    <li className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-slate-300 shrink-0" />
                      Must have cleared UPSC Prelims
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-slate-300 shrink-0" />
                      Roll Number & Verification Score Required
                    </li>
                  </ul>
                </div>
              </div>

              <Link 
                href="/profile/apply?role=creator"
                className="mt-10 flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-600 py-4 text-center font-bold text-white transition-colors hover:bg-amber-700"
              >
                Apply as Prelims Expert
                <ArrowRight className="h-5 w-5" />
              </Link>
            </section>

            {/* Mains Expert / Mentor */}
            <section className="group rounded-[32px] border border-slate-200 bg-white p-8 shadow-xl transition-all hover:shadow-2xl hover:-translate-y-1">
              <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 transition-colors group-hover:bg-blue-100">
                <GraduationCap className="h-8 w-8" />
              </div>
              <h2 className="text-3xl font-bold text-slate-900">Mains Expert</h2>
              <p className="mt-2 text-sm font-medium text-blue-600 uppercase tracking-wider">Formerly Mains Mentor</p>
              
              <div className="mt-8 space-y-6">
                <div>
                  <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-800">
                    <CheckCircle className="h-5 w-5 text-emerald-500" />
                    Provisions
                  </h3>
                  <ul className="mt-3 space-y-2 text-slate-600">
                    <li className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-slate-300 shrink-0" />
                      Create and sell UPSC Mains Programs
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-slate-300 shrink-0" />
                      Answer/Copy Evaluation work
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-slate-300 shrink-0" />
                      Provide 1-on-1 and Group Mentorship
                    </li>
                  </ul>
                </div>

                <div>
                  <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-800">
                    <ShieldCheck className="h-5 w-5 text-blue-500" />
                    Eligibility
                  </h3>
                  <ul className="mt-3 space-y-2 text-slate-600">
                    <li className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-slate-300 shrink-0" />
                      Must have cleared UPSC Mains or faced Interview
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-slate-300 shrink-0" />
                      Marksheet & Interview Proof Required
                    </li>
                  </ul>
                </div>
              </div>

              <Link 
                href="/profile/apply?role=mentor"
                className="mt-10 flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 py-4 text-center font-bold text-white transition-colors hover:bg-blue-700"
              >
                Apply as Mains Expert
                <ArrowRight className="h-5 w-5" />
              </Link>
            </section>

          </div>

          {/* Additional Info Section */}
          <div className="mt-16 rounded-[40px] bg-slate-900 px-8 py-12 text-white">
            <div className="grid gap-12 lg:grid-cols-3">
              <div className="space-y-4">
                <div className="h-12 w-12 rounded-xl bg-white/10 p-3">
                  <UserCheck className="h-full w-full text-blue-400" />
                </div>
                <h3 className="text-xl font-bold">Rigorous Verification</h3>
                <p className="text-slate-400">All applications are reviewed by our admin team. Verification tokens and credentials must be valid before activation.</p>
              </div>
              <div className="space-y-4">
                <div className="h-12 w-12 rounded-xl bg-white/10 p-3">
                  <LayoutPanelLeft className="h-full w-full text-amber-400" />
                </div>
                <h3 className="text-xl font-bold">Dynamic Workspace</h3>
                <p className="text-slate-400">Approved experts get access to a dedicated workspace with program builders, student management, and revenue tracking.</p>
              </div>
              <div className="space-y-4">
                <div className="h-12 w-12 rounded-xl bg-white/10 p-3">
                  <span className="flex h-full w-full items-center justify-center text-2xl font-bold text-emerald-400">₹</span>
                </div>
                <h3 className="text-xl font-bold">Fair Compensation</h3>
                <p className="text-slate-400">Earn from your programs and evaluations. We ensure transparent payouts and flexible pricing models for all teachers.</p>
              </div>
            </div>
          </div>
        </main>
      </div>
    </AppLayout>
  );
}
