"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { profilesApi } from "@/lib/backendServices";

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

function areSameAuthUser(left: AuthUser | null, right: AuthUser | null): boolean {
    if (left === right) return true;
    if (!left || !right) return false;
    return (
        String(left.id || "") === String(right.id || "") &&
        String(left.role || "") === String(right.role || "") &&
        String(left.email || "") === String(right.email || "")
    );
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [loading, setLoading] = useState(true);
    const supabase = createClient();

    const enrichUserWithProfileRole = async (nextUser: AuthUser | null): Promise<AuthUser | null> => {
        if (!nextUser?.id) return nextUser;
        try {
            const profile = await profilesApi.me();
            if (!profile?.role) return nextUser;
            return {
                ...nextUser,
                role: String(profile.role),
            };
        } catch {
            return nextUser;
        }
    };

    useEffect(() => {
        const initAuth = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            const nextUser = await enrichUserWithProfileRole((session?.user as AuthUser | null) ?? null);
            if (!nextUser) {
                profilesApi.clearCache();
            }
            setUser((current) => (areSameAuthUser(current, nextUser) ? current : nextUser));
            setLoading(false);
        };

        initAuth();

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            void (async () => {
                const nextUser = await enrichUserWithProfileRole((session?.user as AuthUser | null) ?? null);
                if (!nextUser) {
                    profilesApi.clearCache();
                }
                setUser((current) => (areSameAuthUser(current, nextUser) ? current : nextUser));
                setLoading(false);
            })();
        });

        return () => {
            subscription.unsubscribe();
        };
    }, [supabase]);

    const signOut = async () => {
        profilesApi.clearCache();
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
