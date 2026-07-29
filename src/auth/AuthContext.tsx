import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import {
  createHousehold as rpcCreateHousehold,
  acceptInvite as rpcAcceptInvite,
  joinByCode as rpcJoinByCode,
  listMyHouseholds,
  setActiveHousehold as rpcSetActiveHousehold,
  type HouseholdSummary
} from "../lib/db";
import * as Linking from "expo-linking";

export interface CreateHouseholdArgs {
  householdName: string;
  timezone: string;
  careRecipientLabel: string;
  memberName: string;
  memberRelation: string;
  memberTimezone: string;
}

interface AuthState {
  user: User | null;
  householdId: string | null;
  households: HouseholdSummary[];
  loading: boolean;
  configured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ signedIn: boolean }>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  createHousehold: (args: CreateHouseholdArgs) => Promise<void>;
  switchHousehold: (householdId: string) => Promise<void>;
  acceptInvite: (memberId: string, displayName?: string) => Promise<void>;
  joinByCode: (code: string, displayName?: string) => Promise<void>;
  pendingInviteToken: string | null;
  pendingJoinCode: string | null;
  clearPendingInvite: () => void;
  clearPendingJoinCode: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [households, setHouseholds] = useState<HouseholdSummary[]>([]);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [pendingInviteToken, setPendingInviteToken] = useState<string | null>(null);
  const [pendingJoinCode, setPendingJoinCode] = useState<string | null>(null);

  // Deep link: taskkin-care://invite?token=<token> 或 taskkin-care://join?code=<6位码>
  useEffect(() => {
    const handleUrl = (url: string | null) => {
      if (!url) return;
      try {
        const parsed = Linking.parse(url);
        const token = parsed.queryParams?.token;
        if (typeof token === "string" && token) setPendingInviteToken(token);
        const code = parsed.queryParams?.code;
        if (typeof code === "string" && /^\d{6}$/.test(code)) setPendingJoinCode(code);
      } catch {
        // ignore malformed URLs
      }
    };
    Linking.getInitialURL().then(handleUrl);
    const sub = Linking.addEventListener("url", ({ url }) => handleUrl(url));
    return () => sub.remove();
  }, []);

  async function refreshHouseholds(preferredId?: string): Promise<void> {
    const next = await listMyHouseholds();
    setHouseholds(next);
    const activeId = preferredId ?? next.find((household) => household.isActive)?.id ?? next[0]?.id ?? null;
    setHouseholdId(activeId);
  }

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      const u = data.session?.user ?? null;
      setUser(u);
      if (u) {
        refreshHouseholds()
          .catch(() => active && setHouseholds([]))
          .finally(() => active && setLoading(false));
      } else {
        setLoading(false);
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) {
        void refreshHouseholds();
      } else {
        setHouseholdId(null);
        setHouseholds([]);
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };
  const signUp = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    return { signedIn: Boolean(data.session) };
  };
  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) throw error;
  };
  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setHouseholdId(null);
    setHouseholds([]);
  };
  const createHousehold = async (args: CreateHouseholdArgs) => {
    if (!user) throw new Error("Not authenticated");
    const hid = await rpcCreateHousehold(args);
    await refreshHouseholds(hid);
  };
  const switchHousehold = async (nextHouseholdId: string) => {
    if (!user) throw new Error("Not authenticated");
    await rpcSetActiveHousehold(nextHouseholdId);
    await refreshHouseholds(nextHouseholdId);
  };
  const acceptInvite = async (token: string, displayName?: string) => {
    if (!user) throw new Error("Not authenticated");
    const hid = await rpcAcceptInvite(token, displayName);
    await refreshHouseholds(hid);
  };
  // 匿名签到 + 凭 6 位码加入（普通成员无需邮箱）。
  const joinByCode = async (code: string, displayName?: string) => {
    if (!user) {
      const { error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
    }
    const hid = await rpcJoinByCode(code, displayName);
    await refreshHouseholds(hid);
  };
  const clearPendingInvite = () => setPendingInviteToken(null);
  const clearPendingJoinCode = () => setPendingJoinCode(null);

  return (
    <AuthContext.Provider
      value={{
        user,
        householdId,
        households,
        loading,
        configured: isSupabaseConfigured,
        signIn,
        signUp,
        resetPassword,
        signOut,
        createHousehold,
        switchHousehold,
        acceptInvite,
        joinByCode,
        pendingInviteToken,
        pendingJoinCode,
        clearPendingInvite,
        clearPendingJoinCode
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
