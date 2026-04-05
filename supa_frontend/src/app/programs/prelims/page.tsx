import AppLayout from "@/components/layouts/AppLayout";
import TestSeriesCatalogView from "@/components/premium/TestSeriesCatalogView";

export default function PrelimsSeriesCatalogPage() {
  return (
    <AppLayout>
      <div className="mx-auto max-w-7xl p-4 md:p-6">
        <TestSeriesCatalogView
          testKind="prelims"
          title="Prelims Programs"
          description="Browse published prelims programs. Open a series to see how many tests it contains, review the description, and start any free or accessible test from the series detail page."
          listingMode="series"
        />
      </div>
    </AppLayout>
  );
}
