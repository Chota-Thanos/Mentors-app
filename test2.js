const fs = require('fs');
const path = require('path');
const file = path.resolve('supa_frontend/src/app/page.tsx');
let content = fs.readFileSync(file, 'utf8');

const returnRegex = /  return \([\s\S]*?(?=function MinimalCreatorHome)/;
const match = content.match(returnRegex);
if (!match) process.exit(1);

let originalReturn = match[0];

// The user is asking us to reorganize it. I will write a completely customized piece of code for the return statement, keeping the existing sections but reordering and wrapping them.

let newReturn =   const isNewUser = activeSeries.length === 0 && latestAttempts.length === 0 && overviewItems.length === 0;

  return (
    <div className="space-y-8 pb-8">
      {/* 1. Hero / CTA Section */}
      <section className="relative overflow-hidden rounded-[28px] border border-[#d7def4] bg-[linear-gradient(135deg,#ffffff_0%,#f6f8ff_54%,#edf8f5_100%)] px-5 py-6 shadow-[0_22px_55px_rgba(9,26,74,0.08)] sm:px-8 sm:py-8 lg:rounded-[34px]">
        <div className="absolute right-[-7rem] top-[-6rem] h-56 w-56 rounded-full bg-[#dce7ff]/70 blur-3xl" />
        <div className="absolute bottom-[-8rem] left-[-4rem] h-56 w-56 rounded-full bg-[#d8f3ec]/75 blur-3xl" />
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#c9d6fb] bg-white/85 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-[#304a92]">
            <Sparkles className="h-4 w-4" />
            Learner Workspace
          </div>
          <div className="mt-5">
            <h1 className="max-w-3xl font-sans text-[34px] font-extrabold leading-[0.98] tracking-[-0.06em] text-[#1235ae] sm:text-[46px] lg:text-[54px]">
              Welcome back, {firstName}.
            </h1>
            {isNewUser ? (
              <p className="mt-4 max-w-2xl text-[14px] leading-7 text-[#636b86] sm:text-[16px] sm:leading-8">
                Your preparation journey starts here. Explore our expert-led Prelims and Mains programs to build a structured foundation, or test the waters immediately with our AI Quiz systems.
              </p>
            ) : (
              <p className="mt-4 max-w-2xl text-[14px] leading-7 text-[#636b86] sm:text-[16px] sm:leading-8">
                Track your ongoing programs, pick up exactly where you left off, and jump into your scheduled tasks.
              </p>
            )}
          </div>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            {isNewUser ? (
              <>
                <Link href="/programs" className="inline-flex items-center justify-center gap-2 rounded-full bg-[#173aa9] px-6 py-3 text-[14px] font-semibold text-white shadow-[0_15px_28px_rgba(23,58,169,0.24)] transition hover:bg-[#15328f]">
                  Browse Study Programs
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link href="/ai-quiz-generator/gk" className="inline-flex items-center justify-center gap-2 rounded-full border border-[#c9d6fb] bg-white px-6 py-3 text-[14px] font-semibold text-[#17328f] shadow-[0_14px_28px_rgba(21,31,76,0.08)] transition hover:bg-[#f2f5ff]">
                  Take an AI Practice Quiz
                </Link>
              </>
            ) : (
              <>
                <Link href={featuredSeries ? \\\/programs/\\\\\\ : "/dashboard"} className="inline-flex items-center justify-center gap-2 rounded-full bg-[#173aa9] px-6 py-3 text-[14px] font-semibold text-white shadow-[0_15px_28px_rgba(23,58,169,0.24)] transition hover:bg-[#15328f]">
                  {featuredSeries ? "Continue active program" : "Open performance evaluation"}
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link href="/my-purchases" className="inline-flex items-center justify-center gap-2 rounded-full border border-[#c9d6fb] bg-white px-6 py-3 text-[14px] font-semibold text-[#17328f] shadow-[0_14px_28px_rgba(21,31,76,0.08)] transition hover:bg-[#f2f5ff]">
                  View purchases
                </Link>
              </>
            )}
          </div>
          
          {!isNewUser && (
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <div className="rounded-[22px] border border-white/70 bg-white/80 p-4 backdrop-blur">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Active Programs</p>
                <p className="mt-2 font-sans text-3xl font-extrabold tracking-[-0.04em] text-[#141b2d]">{activeSeries.length}</p>
              </div>
              <div className="rounded-[22px] border border-white/70 bg-white/80 p-4 backdrop-blur">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Pending Requests</p>
                <p className="mt-2 font-sans text-3xl font-extrabold tracking-[-0.04em] text-[#141b2d]">{requestSummary.pending}</p>
              </div>
              <div className="rounded-[22px] border border-white/70 bg-white/80 p-4 backdrop-blur">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Questions This Year</p>
                <p className="mt-2 font-sans text-3xl font-extrabold tracking-[-0.04em] text-[#141b2d]">
                  {yearlyRows.reduce((sum, row) => sum + row.total_questions, 0)}
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      {error ? (
        <section className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <AlertCircle className="mt-0.5 h-4 w-4" />
          <p>{error}</p>
        </section>
      ) : null}

      {/* 2. Primary Ongoing Activities (Shown if they exist) */}
      {!isNewUser && (
        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="rounded-[30px] border border-[#dce3fb] bg-white p-5 shadow-[0_16px_36px_rgba(15,23,42,0.05)]">
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Programs</p>
                <h2 className="mt-1 font-sans text-[26px] font-semibold leading-[1.08] tracking-[-0.04em] text-[#141b2d] sm:text-[32px]">Resume Active Programs</h2>
              </div>
              <Link href="/my-purchases" className="text-[13px] font-semibold text-[#173aa9] transition hover:text-[#122c84]">
                Open purchases
              </Link>
            </div>
            <div className="mt-5 space-y-4">
              {activeSeries.slice(0, 3).map((series) => (
                <Link
                  key={series.enrollment_id}
                  href={/programs/}
                  className="flex flex-col items-start gap-4 rounded-[26px] border border-[#dce3fb] bg-[linear-gradient(180deg,#ffffff_0%,#f8faff_100%)] p-4 transition hover:-translate-y-0.5 hover:shadow-[0_16px_32px_rgba(15,23,42,0.06)] sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className={mb-2 h-1.5 w-16 rounded-full \} />
                    <p className="truncate text-[18px] font-bold tracking-[-0.02em] text-[#141b2d]">{series.title}</p>
                    <p className="mt-1 text-[13px] leading-6 text-[#6c7590]">
                      {String(series.series_kind || "").toUpperCase()} | {String(series.access_type || "").toLowerCase()}
                    </p>
                  </div>
                  <div className="shrink-0 inline-flex items-center gap-2 rounded-full bg-[#eef4ff] px-4 py-2 text-[12px] font-semibold text-[#1739ac]">
                    <ArrowRight className="h-3.5 w-3.5" />
                    Continue
                  </div>
                </Link>
              ))}
              {!loading && activeSeries.length === 0 ? (
                <div className="rounded-[22px] border border-dashed border-[#cdd8f4] bg-[#f8faff] px-4 py-10 text-center text-sm text-[#6d7690]">
                  No active programs yet.
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-[30px] border border-[#dce3fb] bg-white p-5 shadow-[0_16px_36px_rgba(15,23,42,0.05)]">
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Attempts</p>
                <h2 className="mt-1 font-sans text-[26px] font-semibold leading-[1.08] tracking-[-0.04em] text-[#141b2d] sm:text-[32px]">Ongoing and recent attempts</h2>
              </div>
              <Link href="/dashboard" className="text-[13px] font-semibold text-[#173aa9] transition hover:text-[#122c84]">
                Detailed evaluation
              </Link>
            </div>
            <div className="mt-5 space-y-3">
              {latestAttempts.slice(0, 4).map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  className="flex flex-col items-start gap-3 rounded-[22px] border border-[#dce3fb] bg-[linear-gradient(180deg,#ffffff_0%,#f8faff_100%)] px-4 py-4 transition hover:border-[#bdd1ff] sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold tracking-[-0.02em] text-[#182033]">{item.title}</p>
                    <p className="mt-1 text-[12px] leading-6 text-[#6c7590]">{item.subtitle}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[14px] font-semibold text-[#1739ac]">{item.scoreText}</p>
                  </div>
                </Link>
              ))}
              {!loading && latestAttempts.length === 0 ? (
                <div className="rounded-[22px] border border-dashed border-[#cdd8f4] bg-[#f8faff] px-4 py-12 text-center text-sm text-[#6d7690]">
                  No attempts recorded yet.
                </div>
              ) : null}
            </div>
          </div>
        </section>
      )}

      {/* 3. AI Tools and Support Links */}
      <section className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="rounded-[30px] border border-[#dce3fb] bg-white p-5 shadow-[0_16px_36px_rgba(15,23,42,0.05)]">
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Quick Links</p>
              <h2 className="mt-1 font-sans text-[24px] font-semibold leading-[1.08] tracking-[-0.04em] text-[#141b2d] sm:text-[28px]">Daily actions</h2>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            {quickLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-start gap-3 rounded-[22px] border border-[#dce3fb] bg-[linear-gradient(180deg,#ffffff_0%,#f8faff_100%)] px-4 py-4 transition hover:border-[#bdd1ff]"
              >
                <div className="inline-flex rounded-[14px] bg-[#eef4ff] p-3 text-[#1739ac]">
                  <item.icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold tracking-[-0.02em] text-[#182033]">{item.label}</p>
                  <p className="mt-1 text-[12px] leading-6 text-[#6c7590]">{item.note}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-[30px] bg-[linear-gradient(140deg,#0a1a54_0%,#163fa4_62%,#1f56cf_100%)] p-5 text-white shadow-[0_22px_46px_rgba(9,26,74,0.18)]">
          <div className="relative overflow-hidden rounded-[26px] border border-white/10 bg-white/6 px-5 py-5">
            <div className="absolute right-[-2rem] top-[-2rem] h-28 w-28 rounded-full bg-white/10" />
            <div className="absolute bottom-[-3rem] left-[-2rem] h-28 w-28 rounded-full bg-white/10" />
            <div className="relative flex flex-col items-start gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
              <div className="max-w-xl">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">AI Workspace</p>
                <h2 className="mt-2 font-sans text-[28px] font-semibold leading-[1.08] tracking-[-0.04em] text-white sm:text-[34px]">AI Based Generation and evaluation systems</h2>
                <p className="mt-3 text-[14px] leading-7 text-[#dae4ff]">
                  Move between GK, Maths, Passage, and Mains AI tools from one surface and continue wherever you left off.
                </p>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full bg-white/12 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/80">
                <Sparkles className="h-3.5 w-3.5" />
                Active AI Systems
              </div>
            </div>
            <div className="relative mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {aiSystems.map((system) => (
                <Link
                  key={system.href + system.label}
                  href={system.href}
                  className="rounded-[22px] border border-white/12 bg-white/8 px-4 py-4 transition hover:bg-white/12"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="inline-flex rounded-[14px] bg-white/12 p-3 text-white">
                      <system.icon className="h-4 w-4" />
                    </div>
                    <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/85">
                      {system.status}
                    </span>
                  </div>
                  <p className="mt-4 text-[15px] font-semibold tracking-[-0.02em] text-white">{system.label}</p>
                  <p className="mt-1 text-[12px] leading-6 text-white/72">{system.note}</p>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 4. Mentorship Overview and Yearly Summary */}
      {!isNewUser && (
        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="rounded-[30px] border border-[#dce3fb] bg-[linear-gradient(180deg,#f3f6ff_0%,#eef3ff_100%)] p-5 shadow-[0_16px_36px_rgba(15,23,42,0.05)]">
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Mentorship Status</p>
                <h2 className="mt-1 font-sans text-[26px] font-semibold leading-[1.08] tracking-[-0.04em] text-[#141b2d] sm:text-[32px]">Ongoing Mentorship and Requests</h2>
              </div>
              <div className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#1739ac]">
                Live
              </div>
            </div>
            <div className="mt-5 space-y-3">
              {overviewItems.map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  className="flex flex-col items-start gap-3 rounded-[22px] border border-[#dce3fb] bg-white px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_32px_rgba(15,23,42,0.08)] sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold tracking-[-0.02em] text-[#182033]">{item.title}</p>
                    <p className="mt-1 text-[12px] leading-6 text-[#6c7590]">{item.meta}</p>
                  </div>
                  <span className={\shrink-0 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] \\}>
                    {item.status}
                  </span>
                </Link>
              ))}

              {!loading && overviewItems.length === 0 ? (
                <div className="rounded-[22px] border border-dashed border-[#cdd8f4] bg-white px-4 py-10 text-center text-sm text-[#6d7690]">
                  No active mentorship or program flow yet.
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-[30px] border border-[#dce3fb] bg-white p-5 shadow-[0_16px_36px_rgba(15,23,42,0.05)]">
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Yearly Overview</p>
                <h2 className="mt-1 font-sans text-[26px] font-semibold leading-[1.08] tracking-[-0.04em] text-[#141b2d] sm:text-[32px]">Questions and marks this year</h2>
              </div>
              <div className="rounded-full bg-[#eef4ff] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#1739ac]">
                {yearlySummary?.year || new Date().getFullYear()}
              </div>
            </div>
            <div className="mt-5 overflow-x-auto rounded-[24px] border border-[#d8e1fb] bg-[linear-gradient(180deg,#ffffff_0%,#f8faff_100%)]">
              <div className="min-w-[400px]">
                <div className="grid grid-cols-[1.2fr_1fr_1fr] gap-3 border-b border-[#e5ebfb] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5f7aa9]">
                  <span>Content</span>
                  <span>Questions</span>
                  <span>Scored</span>
                </div>
                <div className="divide-y divide-[#e5ebfb]">
                  {yearlyRows.map((row) => (
                    <div key={row.content_type} className="grid grid-cols-[1.2fr_1fr_1fr] gap-3 px-4 py-4 text-[14px] text-[#182033]">
                      <span className="font-semibold">{row.label}</span>
                      <span>{row.total_questions}</span>
                      <span className="font-semibold text-[#1739ac]">{row.marks_obtained}/{row.total_marks}</span>
                    </div>
                  ))}
                  {!loading && yearlyRows.length === 0 ? (
                    <div className="px-4 py-12 text-center text-sm text-[#6d7690]">No yearly summary available yet.</div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 5. Recommended Programs & Discovery Phase */}
      <section className="rounded-[30px] border border-[#dce3fb] bg-white p-5 shadow-[0_16px_36px_rgba(15,23,42,0.05)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{isNewUser ? "Discovery" : "Suggested Next Step"}</p>
            <h2 className="mt-1 font-sans text-[26px] font-semibold leading-[1.08] tracking-[-0.04em] text-[#141b2d] sm:text-[32px]">{isNewUser ? "Featured recommended tracks" : "Programs based on your current prep"}</h2>
            <p className="mt-3 max-w-2xl text-[14px] leading-7 text-[#636b86]">
              {isNewUser ? "Join tracked programs to maintain consistency and evaluate yourself." : "These suggestions are positioned for your ongoing programs, recent attempts, and visible weak areas."}
            </p>
          </div>
          {!isNewUser && (
            <Link href="/dashboard" className="inline-flex items-center gap-2 rounded-full bg-[#eef4ff] px-4 py-2 text-[12px] font-semibold text-[#1739ac]">
              View detailed evaluation
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(suggestedPrograms.length > 0 ? suggestedPrograms : fallbackSuggestions).map((item, index) => {
            const href = "href" in item ? item.href : dashboardRecommendationHref(item);
            const title = item.title;
            const description = item.description || "Targeted suggestion based on your current progress.";
            const cta = "cta" in item ? item.cta : "Open suggestion";
            return (
              <Link
                key={\\-\\}
                href={href}
                className="rounded-[24px] border border-[#dce3fb] bg-[linear-gradient(180deg,#ffffff_0%,#f7f9ff_100%)] p-5 transition hover:-translate-y-0.5 hover:border-[#bdd1ff] hover:shadow-[0_16px_30px_rgba(15,23,42,0.06)]"
              >
                <div className="inline-flex items-center gap-2 rounded-full bg-[#eef4ff] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#1739ac]">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Recommended
                </div>
                <p className="mt-4 text-[20px] font-bold tracking-[-0.03em] text-[#141b2d]">{title}</p>
                <p className="mt-2 text-[13px] leading-6 text-[#6c7590]">{description}</p>
                <div className="mt-5 inline-flex items-center gap-2 text-[13px] font-semibold text-[#1739ac]">
                  {cta}
                  <ArrowRight className="h-3.5 w-3.5" />
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {isNewUser && (
        <FeaturedMixedRail
          title="Featured Extracurricular Resources"
          subtitle="One row with current prelims tracks, mains tracks, and mentors chosen from the featured catalog."
        />
      )}

    </div>
  );
;

const updatedContent = content.replace(returnRegex, newReturn);
fs.writeFileSync(file, updatedContent, 'utf8');
console.log("Updated success");
