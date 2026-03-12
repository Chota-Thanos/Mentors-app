import AppLayout from "@/components/layouts/AppLayout";
import ChallengeTestRunner from "@/components/premium/ChallengeTestRunner";

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function ChallengePage({ params }: PageProps) {
  const { token } = await params;
  return (
    <AppLayout hideAdminLinks>
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Challenge Test</h1>
          <p className="mt-2 text-sm text-slate-500">
            Attempt the challenge, submit once, and compare your rank on the leaderboard.
          </p>
        </div>
        <ChallengeTestRunner token={token} />
      </div>
    </AppLayout>
  );
}
