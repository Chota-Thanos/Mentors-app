
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AppLayout from '@/components/layouts/AppLayout'
import UserCollectionBuilder from '@/components/premium/UserCollectionBuilder'

interface CreateCollectionPageProps {
    searchParams?: Promise<{ test_kind?: string }>
}

export default async function CreateCollectionPage({ searchParams }: CreateCollectionPageProps) {
    const supabase = await createClient()
    const params: { test_kind?: string } = (await searchParams) || {}
    const requestedKind = String(params?.test_kind || "").trim().toLowerCase()

    // 1. Check if Admin
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return redirect('/login')
    if (requestedKind === "mains") {
        return redirect('/mains/evaluate')
    }

    // Simple role check (assuming app_metadata store roles)
    // For now, let's just allow users to create if they are logged in, or check 'admin'
    // Ideally: if (user.app_metadata.role !== 'admin') redirect('/')

    return (
        <AppLayout>
            <UserCollectionBuilder />
        </AppLayout>
    )
}
