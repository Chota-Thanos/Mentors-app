'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Loader2, Edit, Trash2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import axios from 'axios'

import AppLayout from '@/components/layouts/AppLayout'
import ExamCategorySelector from '@/components/premium/ExamCategorySelector'
import { useAuth } from '@/context/AuthContext'
import { canAccessManualQuizBuilder, hasQuizMasterGenerationSubscription } from '@/lib/accessControl'
import { legacyPremiumAiApi } from '@/lib/legacyPremiumAiApi'
import { OUTPUT_LANGUAGE_OPTIONS, persistOutputLanguage, readOutputLanguage, type OutputLanguage } from '@/lib/outputLanguage'
import { premiumApi } from '@/lib/premiumApi'
import type { PremiumAIContentType, PremiumPreviewResponse, QuizKind } from '@/types/premium'

type PendingBase = {
  client_id: number
  question_statement: string
  supp_question_statement: string
  statements_facts: string
  question_prompt: string
  option_a: string
  option_b: string
  option_c: string
  option_d: string
  option_e: string
  correct_answer: string
  explanation: string
  source_reference: string
  alpha_cat_ids_csv: string
}

type PendingPassageQuestion = {
  client_id: number
  question_statement: string
  supp_question_statement: string
  statements_facts: string
  question_prompt: string
  option_a: string
  option_b: string
  option_c: string
  option_d: string
  option_e: string
  correct_answer: string
  explanation: string
}

type ActionFeedbackTone = 'info' | 'success' | 'error'

type ActionFeedback = {
  tone: ActionFeedbackTone
  message: string
  at: string
}

type OptionShape = {
  label: string
  text: string
  is_correct?: boolean
}

const CONTENT_TYPE_MAP: Record<QuizKind, PremiumAIContentType> = {
  gk: 'premium_gk_quiz',
  maths: 'premium_maths_quiz',
  passage: 'premium_passage_quiz',
}

const EMPTY_DRAFT: Omit<PendingBase, 'client_id'> = {
  question_statement: '',
  supp_question_statement: '',
  statements_facts: '',
  question_prompt: '',
  option_a: '',
  option_b: '',
  option_c: '',
  option_d: '',
  option_e: '',
  correct_answer: 'A',
  explanation: '',
  source_reference: '',
  alpha_cat_ids_csv: '',
}

const EMPTY_PASSAGE_DRAFT: Omit<PendingPassageQuestion, 'client_id'> = {
  question_statement: '',
  supp_question_statement: '',
  statements_facts: '',
  question_prompt: '',
  option_a: '',
  option_b: '',
  option_c: '',
  option_d: '',
  option_e: '',
  correct_answer: 'A',
  explanation: '',
}

function toError(error: unknown): string {
  if (!axios.isAxiosError(error)) {
    if (error instanceof Error && error.message) return error.message
    return 'Unknown error'
  }
  if (typeof error.response?.data?.detail === 'string') return error.response.data.detail
  return error.message
}

function parseIdsCsv(input: string): number[] {
  return input.split(',').map((part) => Number(part.trim())).filter((value) => Number.isFinite(value) && value > 0)
}

function parseFacts(input: string): string[] {
  return input.split('\n').map((line) => line.trim()).filter(Boolean)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function parseStatements(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item || '').trim()).filter(Boolean)
  }
  if (typeof raw === 'string') {
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  }
  return []
}

function normalizeOptions(raw: unknown, correctAnswer?: string | null): OptionShape[] {
  const desired = (correctAnswer || '').toUpperCase()

  if (Array.isArray(raw)) {
    const normalized = raw.map((opt, idx) => {
      const fallbackLabel = String.fromCharCode(65 + idx)
      if (typeof opt === 'string') {
        return { label: fallbackLabel, text: opt, is_correct: desired === fallbackLabel }
      }
      const map = asRecord(opt)
      if (!map) {
        return { label: fallbackLabel, text: '', is_correct: false }
      }
      let label = String(map.label ?? fallbackLabel).trim().toUpperCase()
      if (label.startsWith('OPTION ')) label = label.replace('OPTION ', '').trim()
      if (['1', '2', '3', '4', '5'].includes(label)) {
        label = String.fromCharCode(64 + Number(label))
      }
      if (!['A', 'B', 'C', 'D', 'E'].includes(label)) {
        label = fallbackLabel
      }
      const text = String(map.text ?? map.value ?? '')
      const isCorrect = Boolean(map.is_correct) || desired === label
      return { label, text, is_correct: isCorrect }
    })
    return normalized
      .filter((option) => option.text.trim())
      .slice(0, 5)
  }

  const map = asRecord(raw)
  if (!map) return []

  const pairs = Object.entries(map)
    .map<OptionShape | null>(([key, value]) => {
      let label = String(key || '').trim().toUpperCase()
      if (label.startsWith('OPTION ')) label = label.replace('OPTION ', '').trim()
      if (['1', '2', '3', '4', '5'].includes(label)) {
        label = String.fromCharCode(64 + Number(label))
      }
      if (!['A', 'B', 'C', 'D', 'E'].includes(label)) return null

      const text = typeof value === 'string'
        ? value
        : asRecord(value)
          ? String(asRecord(value)?.text ?? asRecord(value)?.value ?? '')
          : ''
      return { label, text, is_correct: desired === label }
    })
    .filter((item): item is OptionShape => item !== null)
    .sort((a, b) => a.label.localeCompare(b.label))

  return pairs.filter((option) => option.text.trim()).slice(0, 5)
}

function normalizeCorrectAnswer(answer: unknown, options: OptionShape[]): string {
  const direct = String(answer || '').trim().toUpperCase()
  if (['A', 'B', 'C', 'D', 'E'].includes(direct)) return direct
  if (direct.startsWith('OPTION ')) {
    const trimmed = direct.replace('OPTION ', '').trim()
    if (['A', 'B', 'C', 'D', 'E'].includes(trimmed)) return trimmed
  }

  if (direct) {
    const asNumber = Number(direct)
    if (Number.isFinite(asNumber) && asNumber >= 1 && asNumber <= options.length) {
      return String.fromCharCode(64 + asNumber)
    }
  }

  const optionMarked = options.find((option) => option.is_correct)
  if (optionMarked && ['A', 'B', 'C', 'D', 'E'].includes(optionMarked.label)) {
    return optionMarked.label
  }
  return 'A'
}

function extractRegularQuestionRows(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) {
    return parsed.map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => Boolean(item))
  }
  const root = asRecord(parsed)
  if (!root) return []
  const nested = root.questions
  if (Array.isArray(nested)) {
    const rows = nested.map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => Boolean(item))
    if (rows.length > 0) return rows
  }
  return [root]
}

function extractPassageRows(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) {
    return parsed.map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => Boolean(item))
  }
  const root = asRecord(parsed)
  if (!root) return []
  const passages = root.passages
  if (Array.isArray(passages)) {
    const rows = passages.map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => Boolean(item))
    if (rows.length > 0) return rows
  }
  return [root]
}

function mapToPendingBase(question: Record<string, unknown>): Omit<PendingBase, 'client_id'> | null {
  const questionStatement = String(question.question_statement || question.question || '').trim()
  if (!questionStatement) return null

  const options = normalizeOptions(question.options, String(question.correct_answer || question.answer || ''))
  const optionMap: Record<'A' | 'B' | 'C' | 'D' | 'E', string> = { A: '', B: '', C: '', D: '', E: '' }
  options.forEach((option) => {
    if (optionMap[option.label as keyof typeof optionMap] !== undefined) {
      optionMap[option.label as keyof typeof optionMap] = option.text.trim()
    }
  })

  if (!optionMap.A) optionMap.A = 'Option 1'
  if (!optionMap.B) optionMap.B = 'Option 2'
  if (!optionMap.C) optionMap.C = 'Option 3'
  if (!optionMap.D) optionMap.D = 'Option 4'

  const statements = parseStatements(question.statements_facts ?? question.statement_facts)
  const correctAnswer = normalizeCorrectAnswer(question.correct_answer ?? question.answer, options)

  return {
    question_statement: questionStatement,
    supp_question_statement: String(question.supp_question_statement || question.supplementary_statement || '').trim(),
    statements_facts: statements.join('\n'),
    question_prompt: String(question.question_prompt || question.prompt || '').trim(),
    option_a: optionMap.A,
    option_b: optionMap.B,
    option_c: optionMap.C,
    option_d: optionMap.D,
    option_e: optionMap.E,
    correct_answer: correctAnswer,
    explanation: String(question.explanation || question.explanation_text || '').trim(),
    source_reference: String(question.source_reference || question.source || '').trim(),
    alpha_cat_ids_csv: '',
  }
}

function mapToPendingPassageQuestion(question: Record<string, unknown>): Omit<PendingPassageQuestion, 'client_id'> | null {
  const questionStatement = String(question.question_statement || question.question || '').trim()
  if (!questionStatement) return null

  const options = normalizeOptions(question.options, String(question.correct_answer || question.answer || ''))
  const optionMap: Record<'A' | 'B' | 'C' | 'D' | 'E', string> = { A: '', B: '', C: '', D: '', E: '' }
  options.forEach((option) => {
    if (optionMap[option.label as keyof typeof optionMap] !== undefined) {
      optionMap[option.label as keyof typeof optionMap] = option.text.trim()
    }
  })

  if (!optionMap.A) optionMap.A = 'Option 1'
  if (!optionMap.B) optionMap.B = 'Option 2'
  if (!optionMap.C) optionMap.C = 'Option 3'
  if (!optionMap.D) optionMap.D = 'Option 4'

  const statements = parseStatements(question.statements_facts ?? question.statement_facts)
  const correctAnswer = normalizeCorrectAnswer(question.correct_answer ?? question.answer, options)

  return {
    question_statement: questionStatement,
    supp_question_statement: String(question.supp_question_statement || question.supplementary_statement || '').trim(),
    statements_facts: statements.join('\n'),
    question_prompt: String(question.question_prompt || question.prompt || '').trim(),
    option_a: optionMap.A,
    option_b: optionMap.B,
    option_c: optionMap.C,
    option_d: optionMap.D,
    option_e: optionMap.E,
    correct_answer: correctAnswer,
    explanation: String(question.explanation || question.explanation_text || '').trim(),
  }
}

function CreatePremiumQuizPageContent() {
  const searchParams = useSearchParams()
  const { user, loading: authLoading, isAuthenticated } = useAuth()
  const canAccessManualBuilder = useMemo(() => canAccessManualQuizBuilder(user), [user])
  const hasAiParsingAccess = useMemo(() => hasQuizMasterGenerationSubscription(user), [user])
  const targetCollectionId = useMemo(() => {
    const raw = searchParams.get('collection_id') || searchParams.get('test_id') || ''
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed <= 0) return null
    return Math.floor(parsed)
  }, [searchParams])

  const [quizKind, setQuizKind] = useState<QuizKind>('gk')
  const [selectedExamId, setSelectedExamId] = useState<number | null>(null)
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([])

  const [draft, setDraft] = useState<Omit<PendingBase, 'client_id'>>(EMPTY_DRAFT)
  const [pendingQuestions, setPendingQuestions] = useState<PendingBase[]>([])
  const [editingClientId, setEditingClientId] = useState<number | null>(null)

  const [passageTitle, setPassageTitle] = useState('')
  const [passageText, setPassageText] = useState('')
  const [passageSource, setPassageSource] = useState('')
  const [passageAlphaCatIdsCsv, setPassageAlphaCatIdsCsv] = useState('')
  const [passageDraft, setPassageDraft] = useState<Omit<PendingPassageQuestion, 'client_id'>>(EMPTY_PASSAGE_DRAFT)
  const [pendingPassageQuestions, setPendingPassageQuestions] = useState<PendingPassageQuestion[]>([])
  const [editingPassageClientId, setEditingPassageClientId] = useState<number | null>(null)

  const [titlePrefix, setTitlePrefix] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [nextClientId, setNextClientId] = useState(1)
  const [isParsingAi, setIsParsingAi] = useState(false)
  const [aiRawInput, setAiRawInput] = useState('')
  const [aiInstructions, setAiInstructions] = useState('')
  const [aiDesiredQuestionCount, setAiDesiredQuestionCount] = useState('5')
  const [outputLanguage, setOutputLanguage] = useState<OutputLanguage>('en')
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback | null>(null)

  const isPassage = quizKind === 'passage'
  useEffect(() => {
    setOutputLanguage(readOutputLanguage())
  }, [])

  const heading = useMemo(() => {
    if (quizKind === 'gk') return 'Create New Premium GK Quiz'
    if (quizKind === 'maths') return 'Create New Premium Maths Quiz'
    return 'Create New Premium Passage Quiz'
  }, [quizKind])

  if (authLoading) {
    return (
      <AppLayout>
        <div className="mx-auto max-w-3xl rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-600">
          Loading permissions...
        </div>
      </AppLayout>
    )
  }

  if (!isAuthenticated) {
    return (
      <AppLayout>
        <div className="mx-auto max-w-3xl space-y-4 rounded-xl border border-amber-200 bg-amber-50 p-8">
          <h1 className="text-2xl font-bold text-amber-900">Sign in required</h1>
          <p className="text-sm text-amber-800">
            Manual prelims quiz creation is available for Quiz Master and admin roles. Please sign in first.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/login" className="rounded-md border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-900">
              Go to Login
            </Link>
            <Link href="/ai-quiz-generator/gk" className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
              Open AI Quiz Generator
            </Link>
          </div>
        </div>
      </AppLayout>
    )
  }

  if (!canAccessManualBuilder) {
    return (
      <AppLayout>
        <div className="mx-auto max-w-3xl space-y-4 rounded-xl border border-amber-200 bg-amber-50 p-8">
          <h1 className="text-2xl font-bold text-amber-900">Manual quiz creation is restricted</h1>
          <p className="text-sm text-amber-800">
            User role can use all AI pages, but manual prelims quiz creation pages are limited to Quiz Master and admin workflows.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/ai-quiz-generator/gk" className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
              AI Quiz Generator
            </Link>
            <Link href="/mains/evaluate" className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
              Mains AI
            </Link>
            <Link href="/collections/create" className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
              Create a Test Collection
            </Link>
          </div>
        </div>
      </AppLayout>
    )
  }

  const setFeedback = (tone: ActionFeedbackTone, message: string) => {
    setActionFeedback({
      tone,
      message,
      at: new Date().toLocaleTimeString(),
    })
  }

  const appendParsedQuestions = (items: Array<Omit<PendingBase, 'client_id'>>) => {
    if (items.length === 0) return 0
    const startId = nextClientId
    const withIds = items.map((item, index) => ({ client_id: startId + index, ...item }))
    setPendingQuestions((prev) => [...prev, ...withIds])
    setNextClientId(startId + withIds.length)
    return withIds.length
  }

  const appendParsedPassageQuestions = (items: Array<Omit<PendingPassageQuestion, 'client_id'>>) => {
    if (items.length === 0) return 0
    const startId = nextClientId
    const withIds = items.map((item, index) => ({ client_id: startId + index, ...item }))
    setPendingPassageQuestions((prev) => [...prev, ...withIds])
    setNextClientId(startId + withIds.length)
    return withIds.length
  }

  const resetDraft = () => {
    setDraft(EMPTY_DRAFT)
    setEditingClientId(null)
  }

  const resetPassageDraft = () => {
    setPassageDraft(EMPTY_PASSAGE_DRAFT)
    setEditingPassageClientId(null)
  }

  const requireCommonSelection = () => {
    if (!selectedExamId) {
      toast.error('Please select an exam first.')
      setFeedback('error', 'Select an exam before adding or submitting questions.')
      return false
    }
    if (selectedCategoryIds.length === 0) {
      toast.error('Please select at least one category.')
      setFeedback('error', 'Select at least one category before adding or submitting questions.')
      return false
    }
    return true
  }

  const addOrUpdatePendingQuestion = () => {
    if (!requireCommonSelection()) return
    if (!draft.question_statement.trim()) {
      toast.error('Question statement is required.')
      setFeedback('error', 'Question statement is required.')
      return
    }
    if (!draft.option_a.trim() || !draft.option_b.trim() || !draft.option_c.trim() || !draft.option_d.trim()) {
      toast.error('Options A to D are required.')
      setFeedback('error', 'Options A to D are required.')
      return
    }

    if (editingClientId !== null) {
      setPendingQuestions((prev) => prev.map((item) => (item.client_id === editingClientId ? { ...item, ...draft } : item)))
      toast.success('Question updated in pending list.')
      setFeedback('success', `Updated pending question #${editingClientId}.`)
    } else {
      setPendingQuestions((prev) => [...prev, { client_id: nextClientId, ...draft }])
      setNextClientId((value) => value + 1)
      toast.success('Question added to pending list.')
      setFeedback('success', 'Question added to pending list.')
    }

    resetDraft()
  }

  const editPendingQuestion = (clientId: number) => {
    const item = pendingQuestions.find((row) => row.client_id === clientId)
    if (!item) return
    setDraft({
      question_statement: item.question_statement,
      supp_question_statement: item.supp_question_statement,
      statements_facts: item.statements_facts,
      question_prompt: item.question_prompt,
      option_a: item.option_a,
      option_b: item.option_b,
      option_c: item.option_c,
      option_d: item.option_d,
      option_e: item.option_e,
      correct_answer: item.correct_answer,
      explanation: item.explanation,
      source_reference: item.source_reference,
      alpha_cat_ids_csv: item.alpha_cat_ids_csv,
    })
    setEditingClientId(clientId)
    setFeedback('info', `Editing pending question #${clientId}.`)
  }

  const removePendingQuestion = (clientId: number) => {
    setPendingQuestions((prev) => prev.filter((item) => item.client_id !== clientId))
    if (editingClientId === clientId) resetDraft()
    setFeedback('success', `Removed pending question #${clientId}.`)
  }

  const addOrUpdatePassageQuestion = () => {
    if (!requireCommonSelection()) return
    if (!passageDraft.question_statement.trim()) {
      toast.error('Question statement is required.')
      setFeedback('error', 'Question statement is required.')
      return
    }
    if (!passageDraft.option_a.trim() || !passageDraft.option_b.trim() || !passageDraft.option_c.trim() || !passageDraft.option_d.trim()) {
      toast.error('Options A to D are required.')
      setFeedback('error', 'Options A to D are required.')
      return
    }

    if (editingPassageClientId !== null) {
      setPendingPassageQuestions((prev) => prev.map((item) => (item.client_id === editingPassageClientId ? { ...item, ...passageDraft } : item)))
      toast.success('Passage question updated.')
      setFeedback('success', `Updated pending passage question #${editingPassageClientId}.`)
    } else {
      setPendingPassageQuestions((prev) => [...prev, { client_id: nextClientId, ...passageDraft }])
      setNextClientId((value) => value + 1)
      toast.success('Passage question added to pending list.')
      setFeedback('success', 'Passage question added to pending list.')
    }

    resetPassageDraft()
  }

  const editPassageQuestion = (clientId: number) => {
    const item = pendingPassageQuestions.find((row) => row.client_id === clientId)
    if (!item) return
    setPassageDraft({
      question_statement: item.question_statement,
      supp_question_statement: item.supp_question_statement,
      statements_facts: item.statements_facts,
      question_prompt: item.question_prompt,
      option_a: item.option_a,
      option_b: item.option_b,
      option_c: item.option_c,
      option_d: item.option_d,
      option_e: item.option_e,
      correct_answer: item.correct_answer,
      explanation: item.explanation,
    })
    setEditingPassageClientId(clientId)
    setFeedback('info', `Editing pending passage question #${clientId}.`)
  }

  const removePassageQuestion = (clientId: number) => {
    setPendingPassageQuestions((prev) => prev.filter((item) => item.client_id !== clientId))
    if (editingPassageClientId === clientId) resetPassageDraft()
    setFeedback('success', `Removed pending passage question #${clientId}.`)
  }

  const parseWithAi = async () => {
    if (!hasAiParsingAccess) {
      toast.error('Active Quiz Master AI subscription required for AI parsing.')
      setFeedback('error', 'AI parsing is locked. Activate Quiz Master AI subscription to continue.')
      return
    }
    const content = aiRawInput.trim()
    if (!content) {
      toast.error('Paste source content before AI parsing.')
      setFeedback('error', 'AI parsing needs source content.')
      return
    }

    const desiredCount = Math.max(1, Math.min(100, Number(aiDesiredQuestionCount || '5') || 5))
    setIsParsingAi(true)
    setFeedback('info', `Parsing ${quizKind.toUpperCase()} content with AI...`)

    try {
      const payload = {
        content,
        content_type: CONTENT_TYPE_MAP[quizKind],
        desired_question_count: desiredCount,
        user_instructions: aiInstructions.trim() || undefined,
        output_language: outputLanguage,
      }
      const response = await legacyPremiumAiApi.post<PremiumPreviewResponse>(`/premium-ai-quizzes/preview/${quizKind}`, payload)
      const parsedData = response.data?.parsed_quiz_data

      if (!isPassage) {
        const rawQuestions = extractRegularQuestionRows(parsedData)
        const mappedQuestions = rawQuestions
          .map((question) => mapToPendingBase(question))
          .filter((question): question is Omit<PendingBase, 'client_id'> => Boolean(question))
          .slice(0, desiredCount)

        if (mappedQuestions.length === 0) {
          throw new Error('AI output did not include parseable questions.')
        }

        const addedCount = appendParsedQuestions(mappedQuestions)
        toast.success(`AI parsed ${addedCount} question(s) into pending list.`)
        setFeedback('success', `AI parsed ${addedCount} ${quizKind.toUpperCase()} question(s).`)
        return
      }

      const passages = extractPassageRows(parsedData)
      const mappedPassageQuestions: Array<Omit<PendingPassageQuestion, 'client_id'>> = []
      let parsedPassageTitle = ''
      let parsedPassageText = ''
      let parsedPassageSource = ''

      for (const passage of passages) {
        if (!parsedPassageTitle) parsedPassageTitle = String(passage.passage_title || '').trim()
        if (!parsedPassageText) parsedPassageText = String(passage.passage_text || passage.passage || '').trim()
        if (!parsedPassageSource) parsedPassageSource = String(passage.source_reference || passage.source || '').trim()

        const nestedQuestions = Array.isArray(passage.questions)
          ? passage.questions
            .map((candidate) => asRecord(candidate))
            .filter((candidate): candidate is Record<string, unknown> => Boolean(candidate))
          : []

        const questionRows = nestedQuestions.length > 0 ? nestedQuestions : [passage]
        for (const question of questionRows) {
          const mapped = mapToPendingPassageQuestion(question)
          if (mapped) mappedPassageQuestions.push(mapped)
        }
      }

      const limitedQuestions = mappedPassageQuestions.slice(0, desiredCount)
      if (limitedQuestions.length === 0) {
        throw new Error('AI output did not include parseable passage questions.')
      }

      const addedCount = appendParsedPassageQuestions(limitedQuestions)
      if (!passageTitle.trim() && parsedPassageTitle) setPassageTitle(parsedPassageTitle)
      if (!passageText.trim() && parsedPassageText) setPassageText(parsedPassageText)
      if (!passageText.trim() && !parsedPassageText) setPassageText(content)
      if (!passageSource.trim() && parsedPassageSource) setPassageSource(parsedPassageSource)

      toast.success(`AI parsed ${addedCount} passage question(s) into pending list.`)
      setFeedback('success', `AI parsed ${addedCount} passage question(s).`)
    } catch (error: unknown) {
      const message = toError(error)
      toast.error('AI parsing failed.', { description: message })
      setFeedback('error', `AI parsing failed: ${message}`)
    } finally {
      setIsParsingAi(false)
    }
  }

  const submitGkOrMaths = async () => {
    if (!requireCommonSelection()) return
    if (pendingQuestions.length === 0) {
      toast.error('Add at least one pending question before submitting.')
      setFeedback('error', 'Add at least one pending question before submit.')
      return
    }

    setIsSubmitting(true)
    setFeedback('info', `Submitting ${pendingQuestions.length} ${quizKind.toUpperCase()} question(s)...`)
    try {
      const payload = {
        title_prefix: titlePrefix.trim() || `${quizKind.toUpperCase()} Quiz`,
        exam_id: selectedExamId,
        ...(targetCollectionId ? { collection_id: targetCollectionId } : {}),
        items: pendingQuestions.map((item) => ({
          question_statement: item.question_statement,
          supp_question_statement: item.supp_question_statement || null,
          supplementary_statement: item.supp_question_statement || null,
          statements_facts: parseFacts(item.statements_facts),
          question_prompt: item.question_prompt || null,
          option_a: item.option_a,
          option_b: item.option_b,
          option_c: item.option_c,
          option_d: item.option_d,
          option_e: item.option_e || null,
          correct_answer: item.correct_answer,
          answer: item.correct_answer,
          explanation: item.explanation || null,
          explanation_text: item.explanation || null,
          source_reference: item.source_reference || null,
          source: item.source_reference || null,
          category_ids: selectedCategoryIds,
          premium_gk_category_ids: quizKind === 'gk' ? selectedCategoryIds : [],
          premium_maths_category_ids: quizKind === 'maths' ? selectedCategoryIds : [],
          alpha_cat_ids: parseIdsCsv(item.alpha_cat_ids_csv),
        })),
      }

      const response = await premiumApi.post<{ count: number; items: Array<{ id: number }> }>(`/quizzes/${quizKind}/bulk`, payload)
      const createdCount = response.data?.count || 0
      if (createdCount <= 0) {
        toast.error('No quiz items were created.')
        setFeedback('error', 'Submit completed but no quiz items were created.')
        return
      }

      toast.success(`${createdCount} ${quizKind.toUpperCase()} question(s) created successfully.`)
      setFeedback('success', `${createdCount} ${quizKind.toUpperCase()} question(s) created successfully.`)
      const firstId = response.data.items?.[0]?.id
      setPendingQuestions([])
      resetDraft()
      if (targetCollectionId) {
        window.location.href = `/collections/${targetCollectionId}`
      } else if (firstId) {
        window.location.href = `/quiz/${firstId}`
      }
    } catch (error: unknown) {
      toast.error('Failed to create premium quiz', { description: toError(error) })
      setFeedback('error', `Failed to create ${quizKind.toUpperCase()} quiz questions.`)
    } finally {
      setIsSubmitting(false)
    }
  }

  const submitPassage = async () => {
    if (!requireCommonSelection()) return
    if (!passageText.trim()) {
      toast.error('Passage text is required.')
      setFeedback('error', 'Passage text is required before submit.')
      return
    }
    if (pendingPassageQuestions.length === 0) {
      toast.error('Add at least one passage question.')
      setFeedback('error', 'Add at least one passage question before submit.')
      return
    }

    setIsSubmitting(true)
    setFeedback('info', `Submitting passage quiz with ${pendingPassageQuestions.length} question(s)...`)
    try {
      const payload = {
        passage_title: passageTitle.trim() || null,
        passage_text: passageText,
        source_reference: passageSource.trim() || null,
        category_ids: selectedCategoryIds,
        premium_passage_category_ids: selectedCategoryIds,
        alpha_cat_ids: parseIdsCsv(passageAlphaCatIdsCsv),
        exam_id: selectedExamId,
        ...(targetCollectionId ? { collection_id: targetCollectionId } : {}),
        questions: pendingPassageQuestions.map((item) => ({
          question_statement: item.question_statement,
          supp_question_statement: item.supp_question_statement || null,
          supplementary_statement: item.supp_question_statement || null,
          statements_facts: parseFacts(item.statements_facts),
          question_prompt: item.question_prompt || null,
          options: [
            { label: 'A', text: item.option_a },
            { label: 'B', text: item.option_b },
            { label: 'C', text: item.option_c },
            { label: 'D', text: item.option_d },
            ...(item.option_e.trim() ? [{ label: 'E', text: item.option_e }] : []),
          ],
          correct_answer: item.correct_answer,
          explanation: item.explanation || null,
          explanation_text: item.explanation || null,
        })),
      }

      const response = await premiumApi.post<{ id: number }>('/quizzes/passage', payload)
      toast.success('Passage quiz created successfully.')
      setFeedback('success', 'Passage quiz created successfully.')
      setPendingPassageQuestions([])
      resetPassageDraft()
      setPassageTitle('')
      setPassageText('')
      setPassageSource('')
      setPassageAlphaCatIdsCsv('')

      if (targetCollectionId) {
        window.location.href = `/collections/${targetCollectionId}`
      } else if (response.data?.id) {
        window.location.href = `/quiz/${response.data.id}`
      }
    } catch (error: unknown) {
      toast.error('Failed to create passage quiz', { description: toError(error) })
      setFeedback('error', 'Failed to create passage quiz.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto p-4 md:p-6">
        <h1 className="text-2xl font-semibold mb-6">{heading}</h1>
        {targetCollectionId ? (
          <div className="mb-4 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-800">
            New quizzes from this page will be added directly to Test #{targetCollectionId}.
          </div>
        ) : null}
        {actionFeedback ? (
          <div
            className={`mb-6 rounded border px-3 py-2 text-sm ${
              actionFeedback.tone === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : actionFeedback.tone === 'error'
                  ? 'border-rose-200 bg-rose-50 text-rose-800'
                  : 'border-blue-200 bg-blue-50 text-blue-800'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <span>{actionFeedback.message}</span>
              <span className="whitespace-nowrap text-xs opacity-80">{actionFeedback.at}</span>
            </div>
          </div>
        ) : null}

        <div className="mb-6 p-4 border rounded-md bg-blue-50">
          <p className="text-sm font-semibold text-slate-800 mb-2">1. Select Exam & Category</p>
          <p className="text-sm text-gray-600 mb-4">Choose exam and categories first. These will be used for every question you add in this session.</p>

          <div className="mb-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
            {(['gk', 'maths', 'passage'] as QuizKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => {
                  setQuizKind(kind)
                  setSelectedCategoryIds([])
                  setFeedback('info', `Switched to ${kind.toUpperCase()} mode.`)
                }}
                className={`rounded-md px-3 py-2 text-sm font-semibold ${quizKind === kind ? 'bg-gray-900 text-white' : 'border border-gray-300 bg-white text-gray-700'}`}
                disabled={isSubmitting || isParsingAi}
              >
                {kind.toUpperCase()}
              </button>
            ))}
          </div>

          <ExamCategorySelector
            quizKind={quizKind}
            selectedExamId={selectedExamId}
            selectedCategoryIds={selectedCategoryIds}
            onExamChange={setSelectedExamId}
            onCategoryIdsChange={setSelectedCategoryIds}
          />
        </div>

        <div className="mb-6 rounded-md border bg-indigo-50 p-4">
          <p className="mb-2 text-sm font-semibold text-slate-800">2. AI Parse Content</p>
          <p className="mb-3 text-sm text-slate-600">
            Paste raw quiz content and parse directly into the pending list. Supports GK, Maths, and Passage parsing.
          </p>
          {!hasAiParsingAccess ? (
            <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
              Active Quiz Master AI subscription required for AI parsing.
            </p>
          ) : null}

          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Raw Content *</label>
              <textarea
                rows={8}
                value={aiRawInput}
                onChange={(event) => setAiRawInput(event.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                placeholder="Paste source content for AI parsing..."
                disabled={isSubmitting || isParsingAi}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <label className="text-sm font-medium text-slate-700">AI Instructions (Optional)</label>
                <textarea
                  rows={3}
                  value={aiInstructions}
                  onChange={(event) => setAiInstructions(event.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Any parsing constraints..."
                  disabled={isSubmitting || isParsingAi}
                />
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium text-slate-700">Desired Question Count</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={aiDesiredQuestionCount}
                  onChange={(event) => setAiDesiredQuestionCount(event.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  disabled={isSubmitting || isParsingAi}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-slate-700">Output Language</label>
                <select
                  value={outputLanguage}
                  onChange={(event) => {
                    const next = persistOutputLanguage(event.target.value)
                    setOutputLanguage(next)
                  }}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  disabled={isSubmitting || isParsingAi}
                >
                  {OUTPUT_LANGUAGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={parseWithAi}
                className="inline-flex items-center rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                disabled={isSubmitting || isParsingAi || !hasAiParsingAccess}
              >
                {isParsingAi ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {isParsingAi ? 'Parsing...' : `Parse ${quizKind.toUpperCase()} with AI`}
              </button>
            </div>
          </div>
        </div>

        {!isPassage ? (
          <>
            {pendingQuestions.length > 0 ? (
              <div className="mb-6 p-4 border rounded bg-yellow-50">
                <h3 className="text-lg font-semibold mb-2">Pending Questions ({pendingQuestions.length})</h3>
                <p className="text-sm text-gray-700 mb-3">Review, edit, or remove questions before final submission.</p>
                <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {pendingQuestions.map((item) => (
                    <li key={item.client_id} className="flex items-center justify-between gap-4 p-2 border rounded bg-white">
                      <span className="text-sm truncate">{item.question_statement}</span>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => editPendingQuestion(item.client_id)} className="inline-flex items-center rounded border px-2 py-1 text-xs" disabled={isSubmitting || isParsingAi}>
                          <Edit className="h-3 w-3 mr-1" /> Edit
                        </button>
                        <button type="button" onClick={() => removePendingQuestion(item.client_id)} className="inline-flex items-center rounded border border-red-300 text-red-700 px-2 py-1 text-xs" disabled={isSubmitting || isParsingAi}>
                          <Trash2 className="h-3 w-3 mr-1" /> Remove
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>

                <div className="mt-4 flex justify-end">
                  <button type="button" onClick={submitGkOrMaths} disabled={isSubmitting || isParsingAi || editingClientId !== null} className="inline-flex items-center rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                    {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Submit All {pendingQuestions.length} Questions
                  </button>
                </div>
              </div>
            ) : null}

            <div className="space-y-6 border p-4 rounded-md mb-8 bg-white">
              <h2 className="text-lg font-medium">{editingClientId !== null ? '3. Edit Question' : '3. Add Question Manually'}</h2>

              <div className="space-y-2">
                <label className="text-sm font-medium">Title Prefix (Optional)</label>
                <input value={titlePrefix} onChange={(event) => setTitlePrefix(event.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder={`${quizKind.toUpperCase()} Quiz`} disabled={isSubmitting} />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Question Statement *</label>
                <textarea rows={3} value={draft.question_statement} onChange={(event) => setDraft((prev) => ({ ...prev, question_statement: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" disabled={isSubmitting} />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Supplementary Statement</label>
                <textarea rows={2} value={draft.supp_question_statement} onChange={(event) => setDraft((prev) => ({ ...prev, supp_question_statement: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" disabled={isSubmitting} />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Facts / Statements</label>
                <textarea rows={3} value={draft.statements_facts} onChange={(event) => setDraft((prev) => ({ ...prev, statements_facts: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder="One fact per line" disabled={isSubmitting} />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Question Prompt</label>
                <textarea rows={2} value={draft.question_prompt} onChange={(event) => setDraft((prev) => ({ ...prev, question_prompt: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" disabled={isSubmitting} />
              </div>

              <fieldset className="border p-4 rounded-md">
                <legend className="text-sm font-medium px-1">Options *</legend>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 mt-2">
                  {([
                    ['option_a', 'Option A'],
                    ['option_b', 'Option B'],
                    ['option_c', 'Option C'],
                    ['option_d', 'Option D'],
                    ['option_e', 'Option E (Optional)'],
                  ] as const).map(([field, label]) => (
                    <div key={field} className="space-y-1">
                      <label className="text-xs">{label}</label>
                      <input value={draft[field]} onChange={(event) => setDraft((prev) => ({ ...prev, [field]: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" disabled={isSubmitting} />
                    </div>
                  ))}
                </div>
              </fieldset>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Correct Answer *</label>
                  <select value={draft.correct_answer} onChange={(event) => setDraft((prev) => ({ ...prev, correct_answer: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" disabled={isSubmitting}>
                    <option value="A">A</option>
                    <option value="B">B</option>
                    <option value="C">C</option>
                    <option value="D">D</option>
                    <option value="E">E</option>
                  </select>
                </div>

                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-medium">Source Reference</label>
                  <input value={draft.source_reference} onChange={(event) => setDraft((prev) => ({ ...prev, source_reference: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" disabled={isSubmitting} />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Alpha Category IDs</label>
                <input value={draft.alpha_cat_ids_csv} onChange={(event) => setDraft((prev) => ({ ...prev, alpha_cat_ids_csv: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Comma-separated IDs (optional)" disabled={isSubmitting} />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Explanation</label>
                <textarea rows={4} value={draft.explanation} onChange={(event) => setDraft((prev) => ({ ...prev, explanation: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" disabled={isSubmitting} />
              </div>

              <div className="flex justify-end gap-3">
                {editingClientId !== null ? <button type="button" onClick={resetDraft} className="rounded border border-slate-300 px-4 py-2 text-sm" disabled={isSubmitting || isParsingAi}>Cancel Edit</button> : null}
                <button type="button" onClick={addOrUpdatePendingQuestion} className="inline-flex items-center rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={isSubmitting || isParsingAi}>
                  <Plus className="h-4 w-4 mr-1" />
                  {editingClientId !== null ? 'Update Question' : 'Add Question to List'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="space-y-6 border p-4 rounded-md mb-8 bg-white">
            {pendingPassageQuestions.length > 0 ? (
              <div className="p-4 border rounded bg-yellow-50">
                <h3 className="text-lg font-semibold mb-2">Pending Passage Questions ({pendingPassageQuestions.length})</h3>
                <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {pendingPassageQuestions.map((item, index) => (
                    <li key={item.client_id} className="flex items-center justify-between gap-3 p-2 border rounded bg-white">
                      <span className="text-sm truncate">{index + 1}. {item.question_statement}</span>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => editPassageQuestion(item.client_id)} className="inline-flex items-center rounded border px-2 py-1 text-xs" disabled={isSubmitting || isParsingAi}><Edit className="h-3 w-3 mr-1" /> Edit</button>
                        <button type="button" onClick={() => removePassageQuestion(item.client_id)} className="inline-flex items-center rounded border border-red-300 text-red-700 px-2 py-1 text-xs" disabled={isSubmitting || isParsingAi}><Trash2 className="h-3 w-3 mr-1" /> Remove</button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <h2 className="text-lg font-medium">3. Passage Details</h2>

            <div className="space-y-2">
              <label className="text-sm font-medium">Passage Title</label>
              <input value={passageTitle} onChange={(event) => setPassageTitle(event.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" disabled={isSubmitting} />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Passage Text *</label>
              <textarea rows={7} value={passageText} onChange={(event) => setPassageText(event.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" disabled={isSubmitting} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-sm font-medium">Source Reference</label>
                <input value={passageSource} onChange={(event) => setPassageSource(event.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" disabled={isSubmitting} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Alpha Category IDs</label>
                <input value={passageAlphaCatIdsCsv} onChange={(event) => setPassageAlphaCatIdsCsv(event.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Comma-separated IDs" disabled={isSubmitting} />
              </div>
            </div>

            <h2 className="text-lg font-medium">4. Passage Question Composer</h2>

            <div className="space-y-3 border rounded-md p-3">
              <textarea rows={2} value={passageDraft.question_statement} onChange={(event) => setPassageDraft((prev) => ({ ...prev, question_statement: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder="question_statement" disabled={isSubmitting} />
              <textarea rows={2} value={passageDraft.supp_question_statement} onChange={(event) => setPassageDraft((prev) => ({ ...prev, supp_question_statement: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder="supp_question_statement" disabled={isSubmitting} />
              <textarea rows={2} value={passageDraft.statements_facts} onChange={(event) => setPassageDraft((prev) => ({ ...prev, statements_facts: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder="statements_facts (one per line)" disabled={isSubmitting} />
              <textarea rows={2} value={passageDraft.question_prompt} onChange={(event) => setPassageDraft((prev) => ({ ...prev, question_prompt: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm" placeholder="question_prompt" disabled={isSubmitting} />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {(['option_a', 'option_b', 'option_c', 'option_d', 'option_e'] as const).map((field) => (
                  <input key={field} value={passageDraft[field]} onChange={(event) => setPassageDraft((prev) => ({ ...prev, [field]: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder={field} disabled={isSubmitting} />
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <select value={passageDraft.correct_answer} onChange={(event) => setPassageDraft((prev) => ({ ...prev, correct_answer: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" disabled={isSubmitting}>
                  <option value="A">A</option>
                  <option value="B">B</option>
                  <option value="C">C</option>
                  <option value="D">D</option>
                  <option value="E">E</option>
                </select>
                <input value={passageDraft.explanation} onChange={(event) => setPassageDraft((prev) => ({ ...prev, explanation: event.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder="explanation" disabled={isSubmitting} />
              </div>

              <div className="flex justify-end gap-3">
                {editingPassageClientId !== null ? <button type="button" onClick={resetPassageDraft} className="rounded border border-slate-300 px-4 py-2 text-sm" disabled={isSubmitting || isParsingAi}>Cancel Edit</button> : null}
                <button type="button" onClick={addOrUpdatePassageQuestion} className="inline-flex items-center rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={isSubmitting || isParsingAi}>
                  <Plus className="h-4 w-4 mr-1" />
                  {editingPassageClientId !== null ? 'Update Question' : 'Add Question to List'}
                </button>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button type="button" onClick={submitPassage} className="inline-flex items-center rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={isSubmitting || isParsingAi || pendingPassageQuestions.length === 0}>
                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Create Passage Quiz with Questions
              </button>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  )
}

export default function CreatePremiumQuizPage() {
  return (
    <Suspense
      fallback={
        <AppLayout>
          <div className="mx-auto max-w-5xl px-4 py-8">
            <div className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-600">
              Loading quiz builder...
            </div>
          </div>
        </AppLayout>
      }
    >
      <CreatePremiumQuizPageContent />
    </Suspense>
  )
}

