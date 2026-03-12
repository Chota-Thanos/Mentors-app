import AppLayout from "@/components/layouts/AppLayout";
import TestSeriesCatalogView from "@/components/premium/TestSeriesCatalogView";

export default function MainsSeriesCatalogPage() {
  return (
    <AppLayout>
      <div className="mx-auto max-w-7xl p-4 md:p-6">
        <TestSeriesCatalogView
          testKind="mains"
          title="Mains Test Series"
          description="Browse published mains test series. Open a series to see all tests, submission flow, evaluation status, and mentorship unlocks."
          listingMode="series"
        />
      </div>
    </AppLayout>
  );
}
