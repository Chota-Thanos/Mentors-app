'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, ChevronLeft, ChevronRight, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'

interface QuizPlayerProps {
    quizId: string
    backToHref?: string
}

interface QuizQuestion {
    id: number
    question: string
    options: string[]
    correct: number
}

interface QuizRecord {
    id: number
    title: string
}

const FALLBACK_QUESTIONS: QuizQuestion[] = [
    {
        id: 1,
        question: 'Sample Question: What is the capital of India?',
        options: ['Mumbai', 'New Delhi', 'Kolkata', 'Chennai'],
        correct: 1,
    },
    {
        id: 2,
        question: 'Sample Question: Who wrote the Indian Constitution?',
        options: ['Gandhiji', 'B.R. Ambedkar', 'Nehru', 'Patel'],
        correct: 1,
    },
]

const asQuestions = (input: unknown): QuizQuestion[] => {
    if (!Array.isArray(input)) return []
    return input
        .map((row, idx) => {
            if (!row || typeof row !== 'object') return null
            const record = row as Record<string, unknown>
            const question = String(record.question ?? '').trim()
            const options = Array.isArray(record.options)
                ? record.options.map((option) => String(option ?? '').trim()).filter(Boolean)
                : []
            const rawCorrect = Number(record.correct)
            const correct = Number.isFinite(rawCorrect) ? rawCorrect : 0
            if (!question || options.length === 0) return null
            const rawId = Number(record.id)
            const id = Number.isFinite(rawId) ? rawId : idx + 1
            return { id, question, options, correct }
        })
        .filter((row): row is QuizQuestion => row !== null)
}

const optionText = (option: unknown): string => {
    if (typeof option === 'string') return option.trim()
    if (option && typeof option === 'object') {
        const record = option as Record<string, unknown>
        return String(record.text || record.label || '').trim()
    }
    return ''
}

const answerIndex = (answer: unknown, options: string[]): number => {
    const raw = String(answer || '').trim().toUpperCase()
    const labelIndex = ['A', 'B', 'C', 'D', 'E'].indexOf(raw)
    if (labelIndex >= 0) return labelIndex
    const exact = options.findIndex((option) => option.trim().toUpperCase() === raw)
    return exact >= 0 ? exact : 0
}

export default function QuizPlayer({ quizId, backToHref = '/collections' }: QuizPlayerProps) {
    const [quiz, setQuiz] = useState<QuizRecord | null>(null)
    const [questions, setQuestions] = useState<QuizQuestion[]>([])
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
    const [userAnswers, setUserAnswers] = useState<Record<number, number>>({})
    const [isSubmitted, setIsSubmitted] = useState(false)
    const [isLoading, setIsLoading] = useState(true)
    const [timer, setTimer] = useState(0)
    const router = useRouter()
    const supabase = createClient()

    useEffect(() => {
        let interval: ReturnType<typeof setInterval> | undefined
        if (!isSubmitted && !isLoading) {
            interval = setInterval(() => {
                setTimer((prev) => prev + 1)
            }, 1000)
        }
        return () => {
            if (interval) clearInterval(interval)
        }
    }, [isSubmitted, isLoading])

    useEffect(() => {
        async function fetchQuiz() {
            try {
                const { data: quiz, error: quizError } = await supabase
                    .from('quizzes')
                    .select('id,title,question_statement,options,correct_answer')
                    .eq('id', quizId)
                    .maybeSingle()

                if (quizError) throw quizError

                if (quiz) {
                    const options = Array.isArray(quiz.options) ? quiz.options.map(optionText).filter(Boolean) : []
                    setQuiz({ id: Number(quiz.id), title: String(quiz.title || `Quiz #${quiz.id}`) })
                    setQuestions([{
                        id: Number(quiz.id),
                        question: String(quiz.question_statement || ''),
                        options,
                        correct: answerIndex(quiz.correct_answer, options),
                    }])
                    return
                }

                const { data: passage, error: passageError } = await supabase
                    .from('passage_quizzes')
                    .select('id,passage_title,passage_text,passage_questions(id,question_statement,options,correct_answer,display_order)')
                    .eq('id', quizId)
                    .maybeSingle()
                if (passageError) throw passageError
                if (!passage) throw new Error('Quiz not found')

                const passageQuestions = Array.isArray(passage.passage_questions)
                    ? [...passage.passage_questions]
                        .map((row) => row as Record<string, unknown>)
                        .sort((left, right) => Number(left.display_order || 0) - Number(right.display_order || 0))
                        .map((row, index) => {
                            const options = Array.isArray(row.options) ? row.options.map(optionText).filter(Boolean) : []
                            return {
                                id: Number(row.id || index + 1),
                                question: String(row.question_statement || ''),
                                options,
                                correct: answerIndex(row.correct_answer, options),
                            }
                        })
                    : []

                setQuiz({ id: Number(passage.id), title: String(passage.passage_title || 'Passage Quiz') })
                setQuestions(passageQuestions.length > 0 ? passageQuestions : FALLBACK_QUESTIONS)
            } catch (err: unknown) {
                toast.error('Failed to load quiz')
                console.error(err)
                setQuestions(FALLBACK_QUESTIONS)
            } finally {
                setIsLoading(false)
            }
        }

        void fetchQuiz()
    }, [quizId, supabase])

    const handleOptionSelect = (optionIndex: number) => {
        if (isSubmitted) return
        setUserAnswers({
            ...userAnswers,
            [currentQuestionIndex]: optionIndex
        })
    }

    const handleSubmit = () => {
        if (Object.keys(userAnswers).length < questions.length) {
            if (!confirm("You haven't answered all questions. Submit anyway?")) return
        }
        setIsSubmitted(true)
        toast.success('Quiz submitted!')
    }

    if (isLoading) return (
        <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="h-10 w-10 animate-spin text-slate-400" />
            <p className="mt-4 text-slate-500">Loading your test...</p>
        </div>
    )

    if (!quiz) return <div className="text-center py-20">Quiz not found.</div>

    const currentQuestion = questions[currentQuestionIndex]
    const score = Object.entries(userAnswers).reduce((acc, [idx, ans]) => {
        return acc + (ans === questions[parseInt(idx, 10)].correct ? 1 : 0)
    }, 0)

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60)
        const secs = seconds % 60
        return `${mins}:${secs.toString().padStart(2, '0')}`
    }

    return (
        <div className="max-w-3xl mx-auto py-8 px-4">
            <div className="mb-8 flex items-center justify-between border-b pb-6 border-slate-200">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">{quiz.title}</h1>
                    <div className="flex items-center gap-4 text-sm text-slate-500 mt-1">
                        <span>Question {currentQuestionIndex + 1} of {questions.length}</span>
                        <span>|</span>
                        <span className="font-mono bg-slate-100 px-2 py-0.5 rounded text-slate-700">Time: {formatTime(timer)}</span>
                    </div>
                </div>
                {!isSubmitted && (
                    <button
                        onClick={handleSubmit}
                        className="bg-green-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-green-700 transition shadow-sm flex items-center gap-2"
                    >
                        <CheckCircle2 className="h-4 w-4" />
                        Finish Test
                    </button>
                )}
            </div>

            {isSubmitted ? (
                <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
                    <div className="bg-slate-900 text-white p-8 text-center">
                        <h2 className="text-3xl font-bold">Quiz Results</h2>
                        <div className="mt-6 flex justify-center items-baseline gap-2">
                            <span className="text-6xl font-extrabold">{score}</span>
                            <span className="text-2xl text-slate-400">/ {questions.length}</span>
                        </div>
                        <div className="mt-4 flex flex-col items-center gap-2">
                            <p className="text-slate-400 font-medium">Score: {Math.round((score / questions.length) * 100)}%</p>
                            <p className="text-xs text-slate-500">Time taken: {formatTime(timer)}</p>
                        </div>
                    </div>

                    <div className="p-8 space-y-8">
                        {questions.map((q, idx) => (
                            <div key={idx} className={`p-6 rounded-xl border-2 ${userAnswers[idx] === q.correct ? 'border-green-100 bg-green-50/30' : 'border-red-100 bg-red-50/30'}`}>
                                <p className="font-bold text-slate-900 text-lg mb-4">{idx + 1}. {q.question}</p>
                                <div className="grid gap-3">
                                    {q.options.map((opt, optIdx) => {
                                        const isUserPick = userAnswers[idx] === optIdx
                                        const isCorrect = q.correct === optIdx
                                        return (
                                            <div
                                                key={optIdx}
                                                className={`p-3 rounded-lg border flex items-center justify-between ${isCorrect ? 'bg-green-100 border-green-500 text-green-900 font-semibold' :
                                                    isUserPick ? 'bg-red-100 border-red-500 text-red-900' : 'bg-white border-slate-200 text-slate-600'
                                                    }`}
                                            >
                                                {opt}
                                                {isCorrect && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        ))}

                        <button
                            onClick={() => router.push(backToHref)}
                            className="w-full bg-slate-900 text-white py-4 rounded-xl font-bold text-lg hover:bg-slate-800 transition"
                        >
                            {backToHref === '/collections' ? 'Back to Tests' : 'Back to Test'}
                        </button>
                    </div>
                </div>
            ) : (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
                        <h2 className="text-xl font-bold text-slate-900 leading-relaxed mb-8">
                            {currentQuestion.question}
                        </h2>

                        <div className="space-y-4">
                            {currentQuestion.options.map((option, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => handleOptionSelect(idx)}
                                    className={`w-full text-left p-4 rounded-xl border-2 transition-all flex items-center justify-between group ${userAnswers[currentQuestionIndex] === idx
                                        ? 'border-indigo-600 bg-indigo-50 text-indigo-900 shadow-sm font-medium'
                                        : 'border-slate-100 hover:border-slate-300 hover:bg-slate-50 text-slate-700'
                                        }`}
                                >
                                    <div className="flex items-center gap-4">
                                        <span className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold border-2 ${userAnswers[currentQuestionIndex] === idx
                                            ? 'bg-indigo-600 border-indigo-600 text-white'
                                            : 'bg-white border-slate-200 text-slate-400 group-hover:border-slate-400 group-hover:text-slate-600'
                                            }`}>
                                            {String.fromCharCode(65 + idx)}
                                        </span>
                                        {option}
                                    </div>
                                    <div className={`h-5 w-5 rounded-full border-2 ${userAnswers[currentQuestionIndex] === idx
                                        ? 'border-indigo-600 bg-indigo-600 flex items-center justify-center'
                                        : 'border-slate-200'
                                        }`}>
                                        {userAnswers[currentQuestionIndex] === idx && (
                                            <div className="h-2 w-2 rounded-full bg-white" />
                                        )}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex items-center justify-between">
                        <button
                            onClick={() => setCurrentQuestionIndex((prev) => Math.max(0, prev - 1))}
                            disabled={currentQuestionIndex === 0}
                            className="flex items-center gap-2 text-slate-600 hover:text-slate-900 disabled:opacity-30 disabled:cursor-not-allowed font-semibold p-2"
                        >
                            <ChevronLeft className="h-5 w-5" />
                            Previous
                        </button>
                        <div className="flex gap-2">
                            {questions.length > 0 && Array.from({ length: questions.length }).map((_, i) => (
                                <div key={i} className={`h-1.5 w-8 rounded-full transition-all ${i === currentQuestionIndex ? 'bg-indigo-600' :
                                    userAnswers[i] !== undefined ? 'bg-slate-800' : 'bg-slate-200'
                                    }`} />
                            ))}
                        </div>
                        <button
                            onClick={() => setCurrentQuestionIndex((prev) => Math.min(questions.length - 1, prev + 1))}
                            disabled={currentQuestionIndex === questions.length - 1}
                            className="flex items-center gap-2 text-slate-600 hover:text-slate-900 disabled:opacity-30 disabled:cursor-not-allowed font-semibold p-2"
                        >
                            Next
                            <ChevronRight className="h-5 w-5" />
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
