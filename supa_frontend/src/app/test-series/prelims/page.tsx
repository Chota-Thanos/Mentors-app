import AppLayout from "@/components/layouts/AppLayout";
import TestSeriesCatalogView from "@/components/premium/TestSeriesCatalogView";

export default function PrelimsSeriesCatalogPage() {
  return (
    <AppLayout>
      <div className="mx-auto max-w-7xl p-4 md:p-6">
        <TestSeriesCatalogView
          testKind="prelims"
          title="Prelims Test Series"
          description="Browse provider-published prelims tests with filters for category, access type, and price."
        />
      </div>
    </AppLayout>
  );
}
