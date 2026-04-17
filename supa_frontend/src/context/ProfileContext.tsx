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
import { profilesApi } from "@/lib/backendServices";
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

function areSameProfile(left: Profile | null, right: Profile | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.id === right.id &&
    left.updated_at === right.updated_at &&
    left.role === right.role &&
    left.display_name === right.display_name
  );
}

// ── Provider ──────────────────────────────────────────────────────────────────

export const ProfileProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const fetchProfile = useCallback(
    async (force = false) => {
      try {
        const data = await profilesApi.me(force ? { force: true } : undefined);
        const nextProfile = data as Profile;
        setProfile((current) => (areSameProfile(current, nextProfile) ? current : nextProfile));
      } catch {
        setProfile((current) => (current === null ? current : null));
        profilesApi.clearCache();
      }
      setLoading(false);
    },
    [],
  );

  const refreshProfile = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.id) {
      setLoading(true);
      await fetchProfile(true);
    }
  }, [supabase, fetchProfile]);

  useEffect(() => {
    // Initial load
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.id) {
        fetchProfile();
      } else {
        setProfile(null);
        profilesApi.clearCache();
        setLoading(false);
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session?.user?.id) {
          fetchProfile();
        } else {
          setProfile(null);
          profilesApi.clearCache();
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
