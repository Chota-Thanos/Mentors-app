
// app/signup/page.tsx
import { Metadata } from 'next'
import Link from 'next/link'
import AuthForm from '@/components/auth/AuthForm'

export const metadata: Metadata = {
    title: 'Sign Up - UPSC AI Prep',
    description: 'Create an account to access premium UPSC preparation tools.',
}

export default function SignupPage() {
    return (
        <div className="container relative min-h-screen flex-col items-center justify-center grid lg:max-w-none lg:grid-cols-2 lg:px-0">
            <Link
                href="/login"
                className="absolute right-4 top-4 md:right-8 md:top-8 text-sm font-medium hover:underline"
            >
                Sign in
            </Link>
            <div className="relative hidden h-full flex-col bg-slate-100 dark:border-r lg:flex">
                <div className="absolute inset-0 bg-slate-100" />
                <div className="relative z-20 flex items-center text-lg font-medium p-8">
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="mr-2 h-6 w-6"
                    >
                        <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
                    </svg>
                    UPSC AI Prep
                </div>
                <div className="relative z-20 m-auto">
                    <div className="text-center space-y-4">
                        <h2 className="text-3xl font-bold">Join the AI Revolution in UPSC Prep</h2>
                        <p className="text-slate-600 max-w-sm mx-auto">Create specialized quizzes, generate mains answers, and organize your study material with the power of AI.</p>
                    </div>
                </div>
            </div>
            <div className="lg:p-8">
                <div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
                    <div className="flex flex-col space-y-2 text-center">
                        <h1 className="text-2xl font-semibold tracking-tight">
                            Create an account
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            Enter your email below to create your account
                        </p>
                    </div>
                    <AuthForm view="sign_up" />
                    <p className="px-8 text-center text-sm text-muted-foreground">
                        By clicking continue, you agree to our{' '}
                        <Link href="/terms" className="underline underline-offset-4 hover:text-primary">
                            Terms of Service
                        </Link>{' '}
                        and{' '}
                        <Link href="/privacy" className="underline underline-offset-4 hover:text-primary">
                            Privacy Policy
                        </Link>
                        .
                    </p>
                </div>
            </div>
        </div>
    )
}
