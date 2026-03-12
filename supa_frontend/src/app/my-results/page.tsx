import AppLayout from "@/components/layouts/AppLayout";
import MyResultsView from "@/components/account/MyResultsView";

export default function MyResultsPage() {
  return (
    <AppLayout>
      <div className="mx-auto w-full max-w-7xl p-0">
        <MyResultsView />
      </div>
    </AppLayout>
  );
}
