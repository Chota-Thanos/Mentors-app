import AppLayout from "@/components/layouts/AppLayout";
import MentorDirectoryView from "@/components/premium/MentorDirectoryView";

export default function MentorsPage() {
  return (
    <AppLayout>
      <div className="mx-auto max-w-7xl p-4 md:p-6">
        <MentorDirectoryView />
      </div>
    </AppLayout>
  );
}
