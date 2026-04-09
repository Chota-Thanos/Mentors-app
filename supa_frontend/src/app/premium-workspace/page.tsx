import Link from "next/link";

import AdminOnly from "@/components/auth/AdminOnly";
import AppLayout from "@/components/layouts/AppLayout";
import CategoryAISourceManager from "@/components/premium/CategoryAISourceManager";
import MainsCategorySourceManager from "@/components/premium/MainsCategorySourceManager";

export default function PremiumWorkspacePage() {
  return (
    <AdminOnly>
      <AppLayout adminNav>
        <div className="mx-auto max-w-5xl space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Premium Workspace</h1>
            <p className="mt-2 text-sm text-slate-500">
              End-to-end control for premium tests, categories, quiz posting, and AI quiz systems.
            </p>
          </div>

          <div id="premium-links" className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-2 lg:grid-cols-3">
            <Link href="/collections/create" className="rounded border border-slate-200 px-4 py-3 text-sm font-medium hover:bg-slate-50">
              Create Prelims Test
            </Link>
            <Link href="/programs" className="rounded border border-slate-200 px-4 py-3 text-sm font-medium hover:bg-slate-50">
              Programs Console
            </Link>
            <Link href="/mentorship/manage" className="rounded border border-slate-200 px-4 py-3 text-sm font-medium hover:bg-slate-50">
              Mentorship Management
            </Link>
            <Link href="/mains/evaluate" className="rounded border border-slate-200 px-4 py-3 text-sm font-medium hover:bg-slate-50">
              Create Mains Test
            </Link>
            <Link href="/mains/questions" className="rounded border border-slate-200 px-4 py-3 text-sm font-medium hover:bg-slate-50">
              Mains Question Repository
            </Link>
            <Link href="/collections" className="rounded border border-slate-200 px-4 py-3 text-sm font-medium hover:bg-slate-50">
              Manage tests and add content
            </Link>
            <Link href="/ai-quiz-generator/gk" className="rounded border border-slate-200 px-4 py-3 text-sm font-medium hover:bg-slate-50">
              AI quiz generator
            </Link>
            <Link href="/admin/prelims-categories" className="rounded border border-slate-200 px-4 py-3 text-sm font-medium hover:bg-slate-50">
              Prelims category manager
            </Link>
            <Link href="#category-ai-sources" className="rounded border border-slate-200 px-4 py-3 text-sm font-medium hover:bg-slate-50">
              Quiz category source manager
            </Link>
            <Link href="#mains-ai-taxonomy" className="rounded border border-slate-200 px-4 py-3 text-sm font-medium hover:bg-slate-50">
              Mains taxonomy + source manager
            </Link>
          </div>

          <div id="taxonomy" className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-semibold text-slate-900">Prelims taxonomy moved</h2>
            <p className="mt-2 text-sm text-slate-500">
              Prelims category creation, bulk create, and bulk delete now live on a dedicated page.
            </p>
            <Link
              href="/admin/prelims-categories"
              className="mt-4 inline-flex rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Open prelims category manager
            </Link>
          </div>

          <div id="category-ai-sources">
            <CategoryAISourceManager />
          </div>

          <div id="mains-ai-taxonomy">
            <MainsCategorySourceManager />
          </div>
        </div>
      </AppLayout>
    </AdminOnly>
  );
}
