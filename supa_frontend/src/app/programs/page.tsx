import AppLayout from "@/components/layouts/AppLayout";
import TestSeriesConsole from "@/components/premium/TestSeriesConsole";

export default function TestSeriesPage() {
  return (
    <AppLayout>
      <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
        <TestSeriesConsole />
      </div>
    </AppLayout>
  );
}
