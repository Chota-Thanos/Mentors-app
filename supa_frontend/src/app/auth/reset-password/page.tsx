'use client'

import { createClient } from '@/lib/supabase/client'
import { useState, useEffect, type FormEvent, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

export default function ResetPasswordPage() {
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [isVerifying, setIsVerifying] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const router = useRouter()
    const supabase = createClient()

    useEffect(() => {
        const checkSession = async () => {
            const { data: { session } } = await supabase.auth.getSession()
            if (!session) {
                toast.error('Session expired or invalid. Please request a new reset link.')
                router.push('/login')
            } else {
                setIsVerifying(false)
            }
        }
        checkSession()
    }, [router, supabase.auth])

    const handleReset = async (e: FormEvent) => {
        e.preventDefault()
        if (password !== confirmPassword) {
            setError('Passwords do not match')
            return
        }
        if (password.length < 6) {
            setError('Password must be at least 6 characters')
            return
        }

        setIsLoading(true)
        setError(null)

        try {
            const { error } = await supabase.auth.updateUser({
                password: password,
            })
            if (error) throw error
            
            toast.success('Password updated successfully')
            router.push('/login')
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to update password. Please try again.'
            setError(message)
        } finally {
            setIsLoading(false)
        }
    }

    if (isVerifying) {
        return (
            <div className="flex h-screen w-screen items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-slate-900" />
                <span className="ml-2 text-sm font-medium">Verifying your reset link...</span>
            </div>
        )
    }

    return (
        <div className="container relative min-h-screen flex-col items-center justify-center grid lg:max-w-none lg:grid-cols-2 lg:px-0">
            <div className="relative hidden h-full flex-col bg-slate-900 p-10 text-white dark:border-r lg:flex">
                <div className="absolute inset-0 bg-slate-900" />
                <div className="relative z-20 flex items-center text-lg font-medium">
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
                <div className="relative z-20 mt-auto">
                    <blockquote className="space-y-2">
                        <p className="text-lg">
                            &ldquo;Security is not a product, but a process.&rdquo;
                        </p>
                        <footer className="text-sm">Bruce Schneier</footer>
                    </blockquote>
                </div>
            </div>
            <div className="lg:p-8">
                <div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
                    <div className="flex flex-col space-y-2 text-center">
                        <h1 className="text-2xl font-semibold tracking-tight">
                            Reset your password
                        </h1>
                        <p className="text-sm text-slate-500">
                            Enter your new password below
                        </p>
                    </div>

                    <form onSubmit={handleReset} className="grid gap-4">
                        <div className="grid gap-1">
                            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 mb-2 block" htmlFor="password">
                                New Password
                            </label>
                            <input
                                id="password"
                                placeholder="********"
                                type="password"
                                autoCapitalize="none"
                                autoComplete="new-password"
                                disabled={isLoading}
                                className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                value={password}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                                required
                            />
                        </div>
                        <div className="grid gap-1">
                            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 mb-2 block" htmlFor="confirm-password">
                                Confirm New Password
                            </label>
                            <input
                                id="confirm-password"
                                placeholder="********"
                                type="password"
                                autoCapitalize="none"
                                autoComplete="new-password"
                                disabled={isLoading}
                                className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                value={confirmPassword}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => setConfirmPassword(e.target.value)}
                                required
                            />
                        </div>
                        {error && (
                            <div className="text-red-500 text-sm p-2 bg-red-50 rounded border border-red-200">
                                {error}
                            </div>
                        )}
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 h-10 px-4 py-2 w-full bg-slate-900 text-white hover:bg-slate-900/90"
                        >
                            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Update Password
                        </button>
                    </form>
                </div>
            </div>
        </div>
    )
}
