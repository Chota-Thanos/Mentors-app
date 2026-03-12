import AppLayout from "@/components/layouts/AppLayout";
import MainsCollectionTestRunner from "@/components/mains/MainsCollectionTestRunner";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function MainsCollectionTestPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Mains Writing Desk</h1>
          <p className="mt-2 text-sm text-slate-500">
            Read the paper, submit a full PDF or question-wise answer photos, and review mentor marks from the same desk.
          </p>
        </div>
        <MainsCollectionTestRunner collectionId={id} />
      </div>
    </AppLayout>
  );
}
