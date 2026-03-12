import AppLayout from "@/components/layouts/AppLayout";
import ChallengeTestResult from "@/components/premium/ChallengeTestResult";

interface PageProps {
  params: Promise<{ token: string; attemptId: string }>;
}

export default async function ChallengeResultPage({ params }: PageProps) {
  const { token, attemptId } = await params;
  return (
    <AppLayout hideAdminLinks>
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Challenge Attempted</h1>
          <p className="mt-2 text-sm text-slate-500">
            View your challenge score, percentile, and leaderboard rank.
          </p>
        </div>
        <ChallengeTestResult token={token} attemptId={attemptId} />
      </div>
    </AppLayout>
  );
}
