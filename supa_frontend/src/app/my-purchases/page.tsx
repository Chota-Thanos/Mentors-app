import AppLayout from "@/components/layouts/AppLayout";
import MyPurchasesView from "@/components/account/MyPurchasesView";

export default function MyPurchasesPage() {
  return (
    <AppLayout>
      <div className="mx-auto w-full max-w-7xl p-0">
        <MyPurchasesView />
      </div>
    </AppLayout>
  );
}
