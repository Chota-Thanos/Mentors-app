import AppLayout from "@/components/layouts/AppLayout";
import MainsCollectionTestResult from "@/components/mains/MainsCollectionTestResult";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function MainsCollectionTestResultPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Mains Test Result</h1>
          <p className="mt-2 text-sm text-slate-500">
            Review AI-evaluated scores and feedback for each mains answer you submitted.
          </p>
        </div>
        <MainsCollectionTestResult collectionId={id} />
      </div>
    </AppLayout>
  );
}
