import AppLayout from "@/components/layouts/AppLayout";
import CollectionTestRunner from "@/components/premium/CollectionTestRunner";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CollectionTestPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Prelims Test Runner</h1>
          <p className="mt-2 text-sm text-slate-500">
            Attempt this Prelims Test as a full quiz and get scored instantly.
          </p>
        </div>
        <CollectionTestRunner collectionId={id} />
      </div>
    </AppLayout>
  );
}

