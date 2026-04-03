"use client";

import axios from "axios";
import {
  ArrowRight,
  BookOpenCheck,
  CalendarCheck2,
  MessageSquareQuote,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { premiumApi } from "@/lib/premiumApi";
import type { ProfessionalProfile } from "@/types/premium";

function toErrorMessage(error: unknown): string {
  if (!axios.isAxiosError(error)) return "Unknown error";
  const detail = error.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : error.message;
}

function initialsFromLabel(label: string): string {
  const tokens = label.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (tokens.length === 0) return "MM";
  return tokens.map((token) => token.charAt(0).toUpperCase()).join("");
}

function snippet(value?: string | null, fallback = "Verified mentor for structured mains guidance and request-led sessions."): string {
  const clean = String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return fallback;
  return clean.length > 140 ? `${clean.slice(0, 137)}...` : clean;
}

function priceLabel(profile: ProfessionalProfile): string | null {
  const meta = (profile.meta || {}) as Record<string, unknown>;
  const amount = Number(meta.mentorship_price || 0);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const currency = String(meta.currency || "INR").trim().toUpperCase() || "INR";
  return `${currency} ${amount.toLocaleString()}`;
}

function reviewMeta(profile: ProfessionalProfile): { average: number; total: number } {
  const meta = (profile.meta || {}) as Record<string, unknown>;
  const reviewSummary = (meta.review_summary || {}) as Record<string, unknown>;
  const average = Number(reviewSummary.average_rating || 0);
  const total = Number(reviewSummary.total_reviews || 0);
  return {
    average: Number.isFinite(average) ? average : 0,
    total: Number.isFinite(total) ? total : 0,
  };
}

function copyEvaluationEnabled(profile: ProfessionalProfile): boolean {
  return Boolean((profile.meta || {})?.copy_evaluation_enabled);
}

function FeaturedMentorCard({ mentor }: { mentor: ProfessionalProfile }) {
  const review = reviewMeta(mentor);
  const badge = mentor.credentials[0] || mentor.highlights[0] || mentor.specialization_tags[0] || "Verified Mentor";

  return (
    <article className="group rounded-[1.75rem] bg-white p-5 shadow-[0_12px_36px_rgba(25,28,30,0.06)] transition-transform duration-300 hover:-translate-y-1">
      <div className="relative overflow-hidden rounded-[1.35rem] bg-[#edf1f4]">
        {mentor.profile_image_url ? (
          <Image
            src={mentor.profile_image_url}
            alt={mentor.display_name}
            width={520}
            height={420}
            unoptimized
            className="h-64 w-full object-cover transition duration-500 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-64 w-full items-center justify-center bg-gradient-to-br from-[#e0e0ff] to-[#8df5e4] text-4xl font-black text-[#000666]">
            {initialsFromLabel(mentor.display_name)}
          </div>
        )}
        <div className="absolute right-4 top-4 rounded-full bg-[#8df5e4] px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#00201c]">
          {badge}
        </div>
      </div>

      <div className="mt-5 flex items-start justify-between gap-4">
        <div>
          <h3 className="font-sans text-2xl font-extrabold tracking-tight text-[#000666]">{mentor.display_name}</h3>
          <p className="mt-1 text-sm font-semibold text-[#006b5f]">{mentor.headline || "Mains Mentor"}</p>
        </div>
        {review.total > 0 ? (
          <div className="inline-flex items-center gap-1 rounded-full bg-[#ffdeac] px-3 py-1 text-xs font-bold text-[#604100]">
            <Star className="h-3.5 w-3.5 fill-current" />
            {review.average.toFixed(1)}
          </div>
        ) : null}
      </div>

      <p className="mt-4 text-sm leading-6 text-[#454652]">{snippet(mentor.bio)}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {mentor.specialization_tags.slice(0, 2).map((tag) => (
          <span key={`${mentor.user_id}-${tag}`} className="rounded-full bg-[#8df5e4] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#005048]">
            {tag}
          </span>
        ))}
        {copyEvaluationEnabled(mentor) ? (
          <span className="rounded-full bg-[#eef2f5] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#454652]">
            Copy Evaluation
          </span>
        ) : null}
      </div>

      <div className="mt-5 flex items-center justify-between">
        <p className="text-sm font-semibold text-[#767683]">{priceLabel(mentor) ? `Starts ${priceLabel(mentor)}` : "Request first, pay after acceptance"}</p>
        <Link
          href={`/profiles/${mentor.user_id}`}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#000666] to-[#1a237e] px-5 py-3 text-sm font-bold text-white shadow-[0_12px_24px_rgba(0,6,102,0.18)] transition-transform hover:scale-[1.02]"
        >
          View Profile
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </article>
  );
}

export default function MentorshipLandingView() {
  const [mentors, setMentors] = useState<ProfessionalProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    premiumApi
      .get<ProfessionalProfile[]>("/mentors/public", { params: { only_verified: true, limit: 6 } })
      .then((response) => {
        if (!active) return;
        setMentors(Array.isArray(response.data) ? response.data : []);
        setError(null);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setMentors([]);
        setError(toErrorMessage(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const heroMentor = mentors[0] || null;
  const featuredMentors = useMemo(() => mentors.slice(0, 3), [mentors]);

  return (
    <main className="bg-[#f8f9fb]">
      <section className="relative overflow-hidden">
        <div className="absolute -right-10 top-10 h-64 w-64 rounded-full bg-[#8df5e4]/35 blur-3xl" />
        <div className="absolute bottom-0 left-0 h-72 w-72 rounded-full bg-[#e0e0ff]/60 blur-3xl" />
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[minmax(0,1.05fr)_420px] lg:px-8 lg:py-20">
          <div className="relative z-10 max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-[#8df5e4] px-4 py-2 text-xs font-bold uppercase tracking-[0.22em] text-[#005048]">
              <ShieldCheck className="h-4 w-4" />
              Verified Mentor Network
            </div>
            <h1 className="mt-6 max-w-xl font-sans text-4xl font-extrabold tracking-tight text-[#000666] sm:text-6xl">
              Elevate your prep with structured mentorship.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-8 text-[#454652] sm:text-lg">
              Discover verified mains mentors, send a request with your problem statement, chat first, then pay only after acceptance.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/mentors"
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#000666] to-[#1a237e] px-6 py-4 text-sm font-bold text-white shadow-[0_14px_30px_rgba(0,6,102,0.2)] transition-transform hover:scale-[1.02]"
              >
                Find a Mentor
              </Link>
              <Link
                href="/my-purchases"
                className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-4 text-sm font-bold text-[#191c1e] shadow-[0_12px_30px_rgba(25,28,30,0.06)]"
              >
                Open Requests
              </Link>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {[
                { label: "Request-led", value: "Chat before payment" },
                { label: "Two paths", value: "Mentorship or copy review" },
                { label: "Final step", value: "Book slot after approval" },
              ].map((item) => (
                <div key={item.label} className="rounded-[1.4rem] bg-white/90 p-4 shadow-[0_12px_24px_rgba(25,28,30,0.05)] backdrop-blur">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#767683]">{item.label}</p>
                  <p className="mt-2 text-sm font-semibold text-[#191c1e]">{item.value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative z-10 lg:justify-self-end">
            <div className="rounded-[2rem] bg-white p-5 shadow-[0_24px_60px_rgba(25,28,30,0.08)]">
              <div className="rounded-[1.6rem] bg-[#191c1e] p-4 text-white">
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#8df5e4]">Featured Mentor</p>
                <div className="mt-4 overflow-hidden rounded-[1.35rem] bg-[#0f1228]">
                  {heroMentor?.profile_image_url ? (
                    <Image
                      src={heroMentor.profile_image_url}
                      alt={heroMentor.display_name}
                      width={520}
                      height={640}
                      unoptimized
                      className="h-[320px] w-full object-cover opacity-90"
                    />
                  ) : (
                    <div className="flex h-[320px] w-full items-center justify-center bg-gradient-to-br from-[#1a237e] to-[#00201c] text-5xl font-black">
                      {initialsFromLabel(heroMentor?.display_name || "Mentor")}
                    </div>
                  )}
                </div>
                <div className="mt-4 rounded-[1.2rem] bg-white/10 p-4">
                  <p className="font-sans text-xl font-extrabold">{heroMentor?.display_name || "Verified Mentor"}</p>
                  <p className="mt-1 text-sm text-slate-200">{heroMentor?.headline || "One-to-one strategy and copy review"}</p>
                </div>
              </div>

              <div className="mt-4 rounded-[1.5rem] bg-[#eef2f5] p-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#767683]">Flow</p>
                <div className="mt-3 space-y-2 text-sm font-semibold text-[#191c1e]">
                  <div className="flex items-center gap-2"><Search className="h-4 w-4 text-[#000666]" /> Discover mentor</div>
                  <div className="flex items-center gap-2"><MessageSquareQuote className="h-4 w-4 text-[#000666]" /> Request and chat</div>
                  <div className="flex items-center gap-2"><BookOpenCheck className="h-4 w-4 text-[#000666]" /> Mentor accepts</div>
                  <div className="flex items-center gap-2"><CalendarCheck2 className="h-4 w-4 text-[#000666]" /> Pay and book slot</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#f2f4f6] py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#767683]">Featured Mentors</p>
              <h2 className="mt-2 font-sans text-3xl font-extrabold tracking-tight text-[#000666]">Mentors with proof, reviews, and clear service paths.</h2>
            </div>
            <Link href="/mentors" className="hidden items-center gap-2 text-sm font-bold text-[#000666] md:inline-flex">
              Browse all
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {loading ? <div className="mt-8 rounded-[1.75rem] bg-white p-6 text-sm text-[#454652]">Loading mentors...</div> : null}
          {!loading && error ? <div className="mt-8 rounded-[1.75rem] bg-white p-6 text-sm text-[#ba1a1a]">{error}</div> : null}

          {!loading && !error ? (
            <div className="mt-8 grid gap-6 lg:grid-cols-3">
              {featuredMentors.length > 0 ? featuredMentors.map((mentor) => <FeaturedMentorCard key={mentor.user_id} mentor={mentor} />) : (
                <div className="rounded-[1.75rem] bg-white p-6 text-sm text-[#454652]">No mentors are public yet.</div>
              )}
            </div>
          ) : null}
        </div>
      </section>

      <section className="py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#767683]">Choose Your Path</p>
            <h2 className="mt-2 font-sans text-3xl font-extrabold tracking-tight text-[#000666]">Mentorship only or evaluation plus mentorship.</h2>
          </div>

          <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
            <div className="rounded-[2rem] bg-gradient-to-br from-[#000666] to-[#1a237e] p-8 text-white shadow-[0_18px_42px_rgba(0,6,102,0.16)]">
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#bdc2ff]">Path One</p>
              <h3 className="mt-4 font-sans text-3xl font-extrabold">Mentorship Only</h3>
              <p className="mt-4 max-w-lg text-sm leading-7 text-[#dfe2ff]">Request guidance, clarify your problem in chat, then lock the session after mentor acceptance.</p>
              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                {["Problem review", "Strategy session", "Chat support"].map((item) => (
                  <div key={item} className="rounded-[1.2rem] bg-white/10 px-4 py-3 text-sm font-semibold text-white">
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4">
              <div className="rounded-[1.75rem] bg-[#8df5e4] p-6 shadow-[0_12px_36px_rgba(25,28,30,0.06)]">
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#005048]">Path Two</p>
                <h3 className="mt-3 font-sans text-2xl font-extrabold tracking-tight text-[#00201c]">Copy Evaluation + Mentorship</h3>
                <p className="mt-3 text-sm leading-7 text-[#005048]">Share your answer copy, get mentor feedback, then move into the follow-up session.</p>
              </div>
              <div className="rounded-[1.75rem] bg-[#ffdeac] p-6 shadow-[0_12px_36px_rgba(25,28,30,0.06)]">
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#604100]">Request Rules</p>
                <p className="mt-3 text-sm font-semibold leading-7 text-[#281900]">No payment before acceptance. Chat opens after request. Slot booking happens after approval or evaluation.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="pb-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-[2rem] bg-gradient-to-br from-[#000666] to-[#1a237e] px-6 py-10 text-center text-white shadow-[0_20px_48px_rgba(0,6,102,0.2)] sm:px-10">
            <Sparkles className="mx-auto h-6 w-6 text-[#8df5e4]" />
            <h2 className="mt-4 font-sans text-3xl font-extrabold tracking-tight">Ready to move from confusion to a clear mentor workflow?</h2>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-[#dfe2ff]">Start with discovery. Send a request only when the fit is right.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/mentors" className="rounded-xl bg-white px-6 py-3 text-sm font-bold text-[#000666]">
                Start Exploring
              </Link>
              <Link href="/dashboard" className="rounded-xl bg-white/10 px-6 py-3 text-sm font-bold text-white">
                Open Dashboard
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
