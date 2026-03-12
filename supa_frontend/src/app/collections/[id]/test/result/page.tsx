import AppLayout from "@/components/layouts/AppLayout";
import CollectionTestResult from "@/components/premium/CollectionTestResult";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CollectionTestResultPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Prelims Test Result</h1>
          <p className="mt-2 text-sm text-slate-500">
            Review your total score, category-wise performance, and each question outcome.
          </p>
        </div>
        <CollectionTestResult collectionId={id} />
      </div>
    </AppLayout>
  );
}


