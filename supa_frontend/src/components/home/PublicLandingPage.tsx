"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BriefcaseBusiness,
  Check,
  LayoutGrid,
  Menu,
  MessageSquareText,
  Sparkles,
  Users,
  X,
} from "lucide-react";

import FeaturedContentRail from "@/components/home/FeaturedContentRail";

const prelimsPoints = [
  "Comprehensive coverage of the General Studies syllabus.",
  "Curated study materials and resources.",
  "Clear tracking of topic completion.",
];

const mainsPoints = [
  "Structured mains subjects",
  "Current affairs integration",
  "Expert strategies",
];

const supportPoints = [
  {
    icon: Users,
    title: "Specialized guidance workflows",
    description: "Pathways tailored to your specific optional subjects and GS strengths.",
  },
  {
    icon: MessageSquareText,
    title: "Direct chats with educators",
    description: "No gatekeepers. Reach experienced UPSC educators when clarity matters.",
  },
  {
    icon: BriefcaseBusiness,
    title: "1-on-1 sessions",
    description: "Scheduled deep-dives into your preparation and recent readiness gaps.",
  },
];

const toolCards = [
  {
    icon: Sparkles,
    title: "AI Quiz Creator",
    description: "Dynamic generation of GK & Prelims questions based on current focus areas.",
    label: "Practice Hub",
    href: "/ai-quiz-generator/gk",
  },
  {
    icon: MessageSquareText,
    title: "AI Mains Evaluator",
    description: "Automated feedback on structure, keywords, and analytical depth for your answers.",
    label: "Evaluation Engine",
    href: "/mains/evaluate",
  },
  {
    icon: LayoutGrid,
    title: "Performance Dashboard",
    description: "Track weak areas and knowledge leakage over time with granular data.",
    label: "Analytics Portal",
    href: "/login",
  },
];

function NavLink({ href, children, active = false }: { href: string; children: React.ReactNode; active?: boolean }) {
  return (
    <Link
      href={href}
      className={`relative text-[13px] font-medium transition ${
        active ? "text-[#1337ad]" : "text-[#60677f] hover:text-[#1337ad]"
      }`}
    >
      {children}
      {active ? <span className="absolute inset-x-0 -bottom-3 h-px bg-[#1337ad]" /> : null}
    </Link>
  );
}

function HeroArtwork() {
  return (
    <div className="relative mx-auto w-full max-w-[500px]">
      <div className="relative ml-auto aspect-[1.02] w-full max-w-[420px] overflow-hidden rounded-[30px] bg-[linear-gradient(140deg,#224d39_0%,#284d3f_36%,#315948_100%)] shadow-[0_24px_70px_rgba(18,40,33,0.22)]">
        <div className="absolute left-[16%] top-[18%] h-12 w-12 rounded-full bg-[radial-gradient(circle_at_35%_35%,rgba(255,255,255,0.95),rgba(173,195,183,0.35)_40%,rgba(0,0,0,0)_72%)] opacity-70 blur-[1px]" />
        <div className="absolute right-[11%] top-[48%] h-16 w-16 rounded-full bg-[radial-gradient(circle_at_35%_35%,rgba(255,255,255,0.9),rgba(169,195,183,0.42)_36%,rgba(0,0,0,0)_72%)] opacity-80" />
        <div className="absolute bottom-[13%] left-[12%] h-[34%] w-[12%] rounded-[6px] bg-[linear-gradient(180deg,#fbf9ef_0%,#d9d1b8_100%)] shadow-[0_16px_28px_rgba(0,0,0,0.2)]" />
        <div className="absolute bottom-[13%] left-[28%] h-[24%] w-[15%] rounded-[6px] bg-[linear-gradient(180deg,#faf7ec_0%,#d4ccb6_100%)] shadow-[0_12px_24px_rgba(0,0,0,0.18)]" />
        <div className="absolute bottom-[11%] left-[33%] z-10 h-[11%] w-[31%] rounded-[999px] bg-[linear-gradient(180deg,#fbf7eb_0%,#ebe2cb_100%)] shadow-[0_16px_25px_rgba(0,0,0,0.22)]" />
        <div className="absolute bottom-[11%] left-[30.5%] h-[10.3%] w-[17%] -rotate-[8deg] rounded-[999px] border border-[#e7dec7] bg-[linear-gradient(180deg,#fffdf8_0%,#f3ecd9_100%)]" />
        <div className="absolute bottom-[11%] left-[46.5%] h-[10.3%] w-[17%] rotate-[8deg] rounded-[999px] border border-[#e7dec7] bg-[linear-gradient(180deg,#fffdf8_0%,#f3ecd9_100%)]" />
        <div className="absolute bottom-[8.5%] right-[2%] h-[34%] w-[36%] skew-x-[-10deg] rounded-[14px] bg-[linear-gradient(180deg,#d1d7d8_0%,#a6b0b3_100%)] shadow-[0_18px_34px_rgba(0,0,0,0.26)]">
          <div className="absolute inset-x-[9%] top-[10%] bottom-[24%] rounded-[9px] bg-[linear-gradient(180deg,#f5f7f7_0%,#dde6e6_100%)]" />
        </div>
      </div>
      <div className="absolute bottom-[6%] left-[4%] rounded-[22px] bg-white px-4 py-3 shadow-[0_18px_40px_rgba(15,23,42,0.12)]">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-full bg-[#eef3ff] p-2 text-[#173aa9]">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-[#22304e]">Expert Verified</p>
            <p className="mt-1 max-w-[150px] text-[10px] leading-[1.45] text-[#77809c]">
              Fully updated curricular aligned with the latest UPSC patterns.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function PrelimsArtwork() {
  return (
    <div className="relative mx-auto w-full max-w-[332px]">
      <div className="absolute inset-x-5 top-4 -z-10 h-[88%] rounded-[28px] bg-[radial-gradient(circle_at_center,rgba(124,146,209,0.14),rgba(124,146,209,0)_72%)] blur-2xl" />
      <Image
        src="/prelims-programs-illustration.svg"
        alt="Prelims programs illustration"
        width={720}
        height={560}
        className="h-auto w-full rounded-[28px] border border-[#dce3fb] shadow-[0_18px_44px_rgba(80,103,170,0.12)]"
        priority={false}
      />
    </div>
  );
}

function MainsArtwork() {
  return (
    <div className="relative mx-auto w-full max-w-[332px]">
      <div className="absolute inset-x-5 top-6 -z-10 h-[84%] rounded-[28px] bg-[radial-gradient(circle_at_center,rgba(38,44,56,0.18),rgba(38,44,56,0)_72%)] blur-2xl" />
      <Image
        src="/mains-programs-illustration.svg"
        alt="Mains programs illustration"
        width={720}
        height={620}
        className="h-auto w-full rounded-[18px] border border-[#21262e] shadow-[0_20px_50px_rgba(15,23,42,0.2)]"
        priority={false}
      />
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item} className="flex items-start gap-3">
          <div className="mt-0.5 rounded-[6px] bg-[#1639ac] p-1 text-white">
            <Check className="h-3 w-3" />
          </div>
          <p className="text-[12px] leading-6 text-[#4f5771]">{item}</p>
        </div>
      ))}
    </div>
  );
}

export default function PublicLandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#f6f8ff] text-[#192133]">
      <header className="sticky top-0 z-40 border-b border-[rgba(22,32,67,0.05)] bg-[rgba(246,248,255,0.92)] backdrop-blur-md">
        <div className="mx-auto flex min-h-[68px] w-full max-w-[1240px] items-center justify-between gap-3 px-4 py-3 sm:h-[74px] sm:px-6 lg:px-8">
          <div className="flex items-center gap-8 lg:gap-12">
            <Link href="/" className="text-[13px] font-semibold tracking-[-0.03em] text-[#17328f]">
              EliteIAS AI
            </Link>
            <nav className="hidden items-center gap-7 lg:flex">
              <NavLink href="#programs" active>
                Programs
              </NavLink>
              <NavLink href="#support">Mentorship</NavLink>
              <NavLink href="#tools">AI Tools</NavLink>
              <NavLink href="#resources">Resources</NavLink>
            </nav>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <Link href="/login" className="hidden text-[13px] font-medium text-[#5e6885] transition hover:text-[#17328f] sm:inline-flex">
              Sign in
            </Link>
            <Link
              href="/signup"
              className="inline-flex items-center rounded-full bg-[#173aa9] px-4 py-2 text-[12px] font-semibold text-white shadow-[0_12px_25px_rgba(23,58,169,0.24)] transition hover:bg-[#14328f]"
            >
              Start Learning
            </Link>
            <button
              type="button"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#d7def4] bg-white text-[#17328f] shadow-[0_10px_20px_rgba(21,31,76,0.08)] lg:hidden"
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            >
              {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>
        {mobileMenuOpen ? (
          <div className="border-t border-[rgba(22,32,67,0.06)] bg-white/95 lg:hidden">
            <nav className="mx-auto grid w-full max-w-[1240px] gap-2 px-4 py-4 sm:px-6">
              <Link href="#programs" onClick={() => setMobileMenuOpen(false)} className="rounded-2xl border border-[#dce3fb] bg-[#f8faff] px-4 py-3 text-sm font-semibold text-[#17328f]">
                Programs
              </Link>
              <Link href="#support" onClick={() => setMobileMenuOpen(false)} className="rounded-2xl border border-[#dce3fb] bg-[#f8faff] px-4 py-3 text-sm font-semibold text-[#17328f]">
                Mentorship
              </Link>
              <Link href="#tools" onClick={() => setMobileMenuOpen(false)} className="rounded-2xl border border-[#dce3fb] bg-[#f8faff] px-4 py-3 text-sm font-semibold text-[#17328f]">
                AI Tools
              </Link>
              <Link href="#resources" onClick={() => setMobileMenuOpen(false)} className="rounded-2xl border border-[#dce3fb] bg-[#f8faff] px-4 py-3 text-sm font-semibold text-[#17328f]">
                Resources
              </Link>
              <Link href="/login" onClick={() => setMobileMenuOpen(false)} className="rounded-2xl border border-[#dce3fb] bg-white px-4 py-3 text-sm font-semibold text-[#5e6885]">
                Sign in
              </Link>
            </nav>
          </div>
        ) : null}
      </header>

      <main className="mx-auto w-full max-w-[1240px] px-4 pb-10 pt-8 sm:px-6 sm:pt-12 lg:px-8 lg:pt-16">
        <section className="grid items-center gap-8 sm:gap-10 lg:grid-cols-[minmax(0,1.02fr)_minmax(420px,0.98fr)] lg:gap-12">
          <div className="max-w-[560px]">
            <h1 className="max-w-[520px] font-sans text-[34px] font-extrabold leading-[0.98] tracking-[-0.06em] text-[#1235ae] sm:text-[48px] lg:text-[70px]">
              Master the UPSC Exam with Expert Guidance.
            </h1>
            <p className="mt-5 max-w-[470px] text-[14px] leading-6 text-[#6d7690] sm:mt-6 sm:text-[16px] sm:leading-7">
              Access structured Prelims and Mains programs. Connect with experienced mentors. Supplement your strategy
              with AI-powered practice.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:mt-8 sm:flex-row sm:flex-wrap sm:gap-4">
              <Link
                href="/programs/prelims"
                className="inline-flex items-center justify-center rounded-full bg-[#173aa9] px-5 py-3 text-[13px] font-semibold text-white shadow-[0_15px_28px_rgba(23,58,169,0.24)] transition hover:bg-[#15328f]"
              >
                Browse Expert Programs
              </Link>
              <Link
                href="/mentors/discover"
                className="inline-flex items-center justify-center rounded-full bg-white px-5 py-3 text-[13px] font-semibold text-[#17328f] shadow-[0_14px_28px_rgba(21,31,76,0.08)] transition hover:bg-[#f2f5ff]"
              >
                Meet Our Mentors
              </Link>
            </div>
          </div>
          <HeroArtwork />
        </section>

        <section
          id="programs"
          className="mt-14 rounded-[28px] bg-[linear-gradient(180deg,#f1f4ff_0%,#edf1ff_100%)] px-5 py-7 sm:mt-16 sm:px-8 sm:py-10 lg:mt-24 lg:rounded-[34px] lg:px-10 lg:py-12"
        >
          <div className="grid items-center gap-8 sm:gap-10 lg:grid-cols-[minmax(0,1fr)_332px] lg:gap-16">
            <div className="max-w-[474px] lg:order-1">
              <h2 className="font-sans text-[28px] font-semibold leading-[1.08] tracking-[-0.04em] text-[#141b2d] sm:text-[40px]">
                Build a Strong Foundation for Prelims.
              </h2>
              <p className="mt-4 text-[14px] leading-7 text-[#636b86]">
                Follow structured study paths designed by subject experts. Cover the complete syllabus systematically.
                Move through topics without losing context.
              </p>
              <div className="mt-6">
                <BulletList items={prelimsPoints} />
              </div>
              <Link
                href="/programs/prelims"
                className="mt-8 inline-flex items-center gap-2 rounded-full bg-[#173aa9] px-5 py-3 text-[12px] font-semibold text-white shadow-[0_14px_28px_rgba(23,58,169,0.22)]"
              >
                Explore Prelims Programs
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="justify-self-center lg:order-2 lg:justify-self-end">
              <PrelimsArtwork />
            </div>
          </div>
        </section>

        <FeaturedContentRail
          mode="prelims"
          title="Featured Prelims Programs"
          subtitle="Explore curated objective-prep programs directly below the prelims section."
          browseHref="/programs/prelims"
          className="mt-8"
        />

        <section
          className="mt-12 px-2 py-6 sm:mt-14 sm:px-6 sm:py-8 lg:mt-16 lg:px-10 lg:py-12"
        >
          <div className="grid items-center gap-8 sm:gap-10 lg:grid-cols-[332px_minmax(0,1fr)] lg:gap-16">
            <div className="justify-self-center lg:justify-self-start">
              <MainsArtwork />
            </div>
            <div className="max-w-[474px] lg:justify-self-end">
              <h2 className="font-sans text-[28px] font-semibold leading-[1.08] tracking-[-0.04em] text-[#141b2d] sm:text-[40px]">
                Master Mains Answer Writing.
              </h2>
              <p className="mt-4 text-[14px] leading-7 text-[#636b86]">
                Engage with specialized content for the Mains examination. Develop in-depth analytical skills. Keep your
                preparation focused and relevant to the actual exam demand.
              </p>
              <div className="mt-6">
                <BulletList items={mainsPoints} />
              </div>
              <Link
                href="/programs/mains"
                className="mt-8 inline-flex items-center gap-2 rounded-full bg-[#173aa9] px-5 py-3 text-[12px] font-semibold text-white shadow-[0_14px_28px_rgba(23,58,169,0.22)]"
              >
                Explore Mains Programs
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>

        <FeaturedContentRail
          mode="mains"
          title="Featured Mains Programs"
          subtitle="Structured answer-writing and mains preparation tracks currently highlighted."
          browseHref="/programs/mains"
          className="mt-2"
        />

        <section
          id="support"
          className="mt-12 overflow-hidden rounded-[28px] bg-[#171b23] px-5 py-7 text-white sm:mt-14 sm:px-7 sm:py-9 lg:mt-16 lg:rounded-[32px] lg:px-8 lg:py-10"
        >
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_330px] lg:items-center">
            <div className="max-w-[560px]">
              <h2 className="max-w-[450px] font-sans text-[28px] font-semibold leading-[1.08] tracking-[-0.04em] text-white sm:text-[40px]">
                Real Human Support When You Need It.
              </h2>
              <p className="mt-5 max-w-[510px] text-[13px] leading-7 text-[#a0a7b8]">
                Shift smoothly from self-study to guided mentorship. Connect directly with experienced Mains Mentors.
                Resolve doubts and build review cycles around strategy.
              </p>
              <div className="mt-8 grid gap-5">
                {supportPoints.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.title} className="flex items-start gap-4">
                      <div className="mt-1 rounded-[10px] bg-[rgba(255,255,255,0.08)] p-2.5 text-white">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-[14px] font-semibold text-white">{item.title}</p>
                        <p className="mt-1 max-w-[390px] text-[12px] leading-6 text-[#8e96ab]">{item.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mx-auto w-full max-w-[320px] rounded-[18px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.06)] p-4 shadow-[0_20px_50px_rgba(0,0,0,0.22)]">
              <div className="flex items-center gap-3 rounded-[14px] bg-[rgba(255,255,255,0.04)] p-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[linear-gradient(135deg,#d9b27c_0%,#f7e2bd_100%)] text-[13px] font-bold text-[#172033]">
                  AS
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-white">Dr. Aditya Sharma</p>
                  <p className="mt-0.5 text-[10px] text-[#8d97af]">Experienced UPSC Mentor</p>
                </div>
              </div>
              <div className="mt-4 rounded-[14px] bg-[rgba(255,255,255,0.04)] px-4 py-4 text-[12px] leading-6 text-[#97a0b4]">
                {'"Preparation is also managing weak zones strategically, not studying everything at once."'}
              </div>
              <Link
                href="/mentors/discover"
                className="mt-4 inline-flex w-full items-center justify-center rounded-full bg-white px-4 py-3 text-[12px] font-medium text-[#1f2534] transition hover:bg-[#eff2fb]"
              >
                Find Your Mentor
              </Link>
            </div>
          </div>
        </section>

        <FeaturedContentRail
          mode="mentors"
          title="Featured Mentors"
          subtitle="Verified mentors available for mentorship and guided review."
          browseHref="/mentors/discover"
          className="mt-8"
        />

        <section id="tools" className="mt-14 text-center lg:mt-20">
          <h2 className="font-sans text-[28px] font-semibold leading-[1.1] tracking-[-0.04em] text-[#1737af] sm:text-[40px]">
            Smart Tools to Supplement Your Study.
          </h2>
          <p className="mx-auto mt-4 max-w-[620px] text-[14px] leading-7 text-[#6d7690]">
            Generate fresh practice content quickly. Test your knowledge using our AI-driven systems.
          </p>

          <div className="mt-10 grid gap-4 text-left md:grid-cols-3">
            {toolCards.map((card) => {
              const Icon = card.icon;
              return (
                <Link
                  key={card.title}
                  href={card.href}
                  className="rounded-[18px] bg-[#eef2ff] px-5 py-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] transition hover:bg-[#e8eeff]"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-white text-[#1739ac] shadow-[0_10px_20px_rgba(19,55,173,0.08)]">
                    <Icon className="h-4 w-4" />
                  </div>
                  <h3 className="mt-5 text-[16px] font-semibold tracking-[-0.03em] text-[#182033]">{card.title}</h3>
                  <p className="mt-3 text-[12px] leading-6 text-[#6c7590]">{card.description}</p>
                  <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7b86a4]">{card.label}</p>
                </Link>
              );
            })}
          </div>
        </section>

        <section
          id="resources"
          className="relative mt-14 overflow-hidden rounded-[24px] bg-[linear-gradient(135deg,#173bad_0%,#274bb9_65%,#2f57cc_100%)] px-5 py-8 text-center text-white sm:px-6 sm:py-10 lg:mt-20 lg:rounded-[28px]"
        >
          <div className="absolute -left-16 bottom-[-72px] h-44 w-44 rounded-full bg-[rgba(255,255,255,0.08)]" />
          <div className="absolute -right-8 top-[-34px] h-28 w-28 rounded-full bg-[rgba(255,255,255,0.08)]" />
          <div className="relative">
            <h2 className="font-sans text-[30px] font-semibold leading-[0.96] tracking-[-0.04em] text-white sm:text-[44px]">
              Join Our Expert Panel.
            </h2>
            <p className="mx-auto mt-4 max-w-[540px] text-[14px] leading-7 text-[#dae4ff]">
              Are you an experienced UPSC educator? Apply to become a Quiz Master or a Mains Mentor.
            </p>
            <Link
              href="/onboarding"
              className="mt-7 inline-flex items-center justify-center rounded-full bg-white px-6 py-3 text-[13px] font-semibold text-[#1738aa] shadow-[0_14px_28px_rgba(0,0,0,0.14)] transition hover:bg-[#edf2ff]"
            >
              Apply as Educator
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-[rgba(22,32,67,0.06)] bg-[rgba(255,255,255,0.42)]">
        <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-4 px-4 py-7 text-[11px] text-[#8088a0] sm:px-6 lg:flex-row lg:items-end lg:justify-between lg:px-8">
          <div>
            <p className="text-[12px] font-semibold text-[#17328f]">EliteIAS AI</p>
            <p className="mt-2 max-w-[250px] leading-5">Copyright 2026 EliteIAS AI. The digital campus for focused UPSC aspirants.</p>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/onboarding" className="transition hover:text-[#17328f]">
              Apply as Educator
            </Link>
            <Link href="/login" className="transition hover:text-[#17328f]">
              Privacy Policy
            </Link>
            <Link href="/signup" className="transition hover:text-[#17328f]">
              Terms of Service
            </Link>
            <Link href="/mentors/discover" className="transition hover:text-[#17328f]">
              Contact Us
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
