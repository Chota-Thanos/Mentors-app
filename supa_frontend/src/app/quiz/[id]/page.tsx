import QuizPlayer from '@/components/quiz/QuizPlayer'
import { sanitizeInternalHref } from '@/lib/collectionNavigation'

interface PageProps {
    params: Promise<{
        id: string
    }>
    searchParams: Promise<{
        backTo?: string
    }>
}

export default async function QuizPage({ params, searchParams }: PageProps) {
    const { id } = await params
    const { backTo } = await searchParams
    const backToHref = sanitizeInternalHref(backTo, "/collections")
    return (
        <div className="bg-slate-50 min-h-screen">
            {/* Note: I'm not wrapping in AppLayout here to give the quiz a "distraction-free" feel, 
           simliar to professional test platforms, but I can add it if needed. 
           Let's use a simplified header manually. */}
            <QuizPlayer quizId={id} backToHref={backToHref} />
        </div>
    )
}
