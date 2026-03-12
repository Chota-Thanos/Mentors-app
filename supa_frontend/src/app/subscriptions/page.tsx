import AppLayout from "@/components/layouts/AppLayout";
import SubscriptionPlansView from "@/components/premium/SubscriptionPlansView";

export default function SubscriptionsPage() {
  return (
    <AppLayout>
      <div className="mx-auto max-w-7xl p-4 md:p-6">
        <SubscriptionPlansView />
      </div>
    </AppLayout>
  );
}
