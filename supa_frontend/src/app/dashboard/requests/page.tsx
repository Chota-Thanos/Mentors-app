import AppLayout from "@/components/layouts/AppLayout";
import LearnerMentorshipOrdersSection from "@/components/account/LearnerMentorshipOrdersSection";

export default function DashboardRequestsPage() {
  return (
    <AppLayout>
      <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Learner Requests</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900">Mentorship requests</h1>
          <p className="mt-2 text-sm text-slate-600">Open the full request list here: chat, payment, evaluation, slot booking, and session handoff.</p>
        </section>
        <LearnerMentorshipOrdersSection />
      </div>
    </AppLayout>
  );
}
