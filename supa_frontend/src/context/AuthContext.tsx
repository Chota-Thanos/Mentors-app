"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

export type AuthUser = Record<string, unknown> &
  Partial<User> & {
    role?: string;
    app_metadata?: Record<string, unknown>;
    user_metadata?: Record<string, unknown>;
  };

interface AuthContextType {
    user: AuthUser | null;
    loading: boolean;
    isAuthenticated: boolean;
    showLoginModal: () => void;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    loading: true,
    isAuthenticated: false,
    showLoginModal: () => { },
    signOut: async () => { },
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [loading, setLoading] = useState(true);
    const supabase = createClient();

    useEffect(() => {
        const initAuth = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            setUser((session?.user as AuthUser | null) ?? null);
            setLoading(false);
        };

        initAuth();

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setUser((session?.user as AuthUser | null) ?? null);
            setLoading(false);
        });

        return () => {
            subscription.unsubscribe();
        };
    }, [supabase]);

    const signOut = async () => {
        await supabase.auth.signOut();
    };

    const showLoginModal = () => {
        // For now, redirect to login
        window.location.href = "/login";
    };

    return (
        <AuthContext.Provider
            value={{
                user,
                loading,
                isAuthenticated: !!user,
                showLoginModal,
                signOut,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
