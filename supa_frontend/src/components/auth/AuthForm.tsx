'use client'

import { createClient } from '@/lib/supabase/client'
import {
    useState,
    type ButtonHTMLAttributes,
    type ChangeEvent,
    type FormEvent,
    type InputHTMLAttributes,
    type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
    children: ReactNode
    isLoading?: boolean
    variant?: 'outline' | 'default'
}

const Button = ({ children, isLoading = false, variant = 'default', className = '', ...props }: ButtonProps) => {
    const variantClass = variant === 'outline'
        ? 'bg-white text-slate-900 border border-slate-200 hover:bg-slate-100'
        : 'bg-slate-900 text-white hover:bg-slate-900/90'

    return (
        <button
            {...props}
            className={`inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 h-10 px-4 py-2 w-full ${variantClass} ${className}`.trim()}
            disabled={isLoading || props.disabled}
        >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {children}
        </button>
    )
}

const Input = (props: InputHTMLAttributes<HTMLInputElement>) => (
    <input
        {...props}
        className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
    />
)

const Label = ({ children, htmlFor }: { children: ReactNode, htmlFor: string }) => (
    <label htmlFor={htmlFor} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 mb-2 block">
        {children}
    </label>
)

export default function AuthForm({ view }: { view: 'sign_in' | 'sign_up' }) {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const router = useRouter()
    const supabase = createClient()

    const handleAuth = async (e: FormEvent) => {
        e.preventDefault()
        setIsLoading(true)
        setError(null)

        try {
            if (view === 'sign_in') {
                const { error } = await supabase.auth.signInWithPassword({
                    email,
                    password,
                })
                if (error) throw error
                router.refresh()
                router.push('/')
            } else {
                const { error } = await supabase.auth.signUp({
                    email,
                    password,
                    options: {
                        emailRedirectTo: `${location.origin}/auth/callback`,
                    },
                })
                if (error) throw error
                toast.message('Verification email sent', {
                    description: 'Check your email to confirm your account.'
                })
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Authentication failed. Please try again.'
            setError(message)
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <div className="grid gap-6">
            <form onSubmit={handleAuth}>
                <div className="grid gap-2">
                    <div className="grid gap-1">
                        <Label htmlFor="email">Email</Label>
                        <Input
                            id="email"
                            placeholder="name@example.com"
                            type="email"
                            autoCapitalize="none"
                            autoComplete="email"
                            autoCorrect="off"
                            disabled={isLoading}
                            value={email}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                        />
                    </div>
                    <div className="grid gap-1">
                        <Label htmlFor="password">Password</Label>
                        <Input
                            id="password"
                            placeholder="********"
                            type="password"
                            autoCapitalize="none"
                            autoComplete="current-password"
                            disabled={isLoading}
                            value={password}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                        />
                    </div>
                    {error && (
                        <div className="text-red-500 text-sm p-2 bg-red-50 rounded border border-red-200">
                            {error}
                        </div>
                    )}
                    <Button isLoading={isLoading}>
                        {view === 'sign_in' ? 'Sign In with Email' : 'Sign Up with Email'}
                    </Button>
                </div>
            </form>
            <div className="relative">
                <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-slate-200" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-white px-2 text-slate-500">
                        Or continue with
                    </span>
                </div>
            </div>
            <div className='flex flex-col gap-2'>
                <Button variant="outline" type="button" disabled={isLoading}
                    onClick={() => {
                        toast.message('Google Auth not configured yet', {
                            description: 'We are configuring Google Auth provider.'
                        })
                    }}
                    className="bg-white text-slate-900 border border-slate-200 hover:bg-slate-100"
                >
                    <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                        <path
                            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                            fill="#4285F4"
                        />
                        <path
                            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                            fill="#34A853"
                        />
                        <path
                            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                            fill="#FBBC05"
                        />
                        <path
                            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                            fill="#EA4335"
                        />
                        <path d="M1 1h22v22H1z" fill="none" />
                    </svg>
                    Google
                </Button>
            </div>
        </div>
    )
}
