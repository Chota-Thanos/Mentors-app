"use client";

/**
 * ProfileContext — resolves auth.users session → public.profiles row.
 *
 * This is the V2 replacement for the old pattern of using auth.uid() directly
 * as user_id. In the new schema, every user_id FK is profiles.id (bigint),
 * not the UUID from auth.users.
 *
 * Provides:
 *   - profile: Profile | null        → typed row from public.profiles
 *   - profileId: number | null       → profile.id (bigint) — use for ALL DB queries
 *   - role: UserRole                 → typed role string
 *   - isAdmin / isModerator / isCreator etc — role helpers
 *   - refreshProfile()               → force re-fetch
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile, UserRole } from "@/types/db";

// ── Context shape ─────────────────────────────────────────────────────────────

interface ProfileContextType {
  profile: Profile | null;
  profileId: number | null;
  role: UserRole;
  loading: boolean;

  // Role shortcuts
  isAdmin: boolean;
  isModerator: boolean;
  isPrelimsExpert: boolean;
  isMainsExpert: boolean;
  isCreator: boolean;   // any of the above creator roles

  refreshProfile: () => Promise<void>;
}

const ProfileContext = createContext<ProfileContextType>({
  profile: null,
  profileId: null,
  role: "user",
  loading: true,
  isAdmin: false,
  isModerator: false,
  isPrelimsExpert: false,
  isMainsExpert: false,
  isCreator: false,
  refreshProfile: async () => {},
});

// ── Provider ──────────────────────────────────────────────────────────────────

export const ProfileProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const fetchProfile = useCallback(
    async (authUserId: string) => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("auth_user_id", authUserId)
        .single();

      if (error || !data) {
        setProfile(null);
      } else {
        setProfile(data as Profile);
      }
      setLoading(false);
    },
    [supabase],
  );

  const refreshProfile = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.id) {
      setLoading(true);
      await fetchProfile(session.user.id);
    }
  }, [supabase, fetchProfile]);

  useEffect(() => {
    // Initial load
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.id) {
        fetchProfile(session.user.id);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session?.user?.id) {
          fetchProfile(session.user.id);
        } else {
          setProfile(null);
          setLoading(false);
        }
      },
    );

    return () => subscription.unsubscribe();
  }, [supabase, fetchProfile]);

  // ── Role derivations ─────────────────────────────────────────────────────
  const role: UserRole = profile?.role ?? "user";
  const isAdmin = role === "admin";
  const isModerator = role === "admin" || role === "moderator";
  const isPrelimsExpert = role === "admin" || role === "prelims_expert";
  const isMainsExpert = role === "admin" || role === "mains_expert";
  const isCreator =
    role === "admin" ||
    role === "moderator" ||
    role === "prelims_expert" ||
    role === "mains_expert";

  return (
    <ProfileContext.Provider
      value={{
        profile,
        profileId: profile?.id ?? null,
        role,
        loading,
        isAdmin,
        isModerator,
        isPrelimsExpert,
        isMainsExpert,
        isCreator,
        refreshProfile,
      }}
    >
      {children}
    </ProfileContext.Provider>
  );
};

// ── Hook ─────────────────────────────────────────────────────────────────────

export const useProfile = () => useContext(ProfileContext);
