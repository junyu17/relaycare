import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { createHousehold as rpcCreateHousehold, acceptInvite as rpcAcceptInvite } from "../lib/db";
import * as Linking from "expo-linking";

interface CreateHouseholdArgs {
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
  loading: boolean;
  configured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  createHousehold: (args: CreateHouseholdArgs) => Promise<void>;
  acceptInvite: (memberId: string, displayName?: string) => Promise<void>;
  pendingInviteToken: string | null;
  clearPendingInvite: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [pendingInviteToken, setPendingInviteToken] = useState<string | null>(null);

  // Deep link: taskkin-care://invite?token=<token> -> 捕获邀请 token，登录/注册后加入
  useEffect(() => {
    const handleUrl = (url: string | null) => {
      if (!url) return;
      try {
        const parsed = Linking.parse(url);
        const token = parsed.queryParams?.token;
        if (typeof token === "string" && token) setPendingInviteToken(token);
      } catch {
        // ignore malformed URLs
      }
    };
    Linking.getInitialURL().then(handleUrl);
    const sub = Linking.addEventListener("url", ({ url }) => handleUrl(url));
    return () => sub.remove();
  }, []);

  // 查当前用户所属家庭的 household_id（登录后调用）
  async function fetchHouseholdId(uid: string): Promise<string | null> {
    const { data, error } = await supabase
      .from("members")
      .select("household_id")
      .eq("user_id", uid)
      .eq("invite_status", "active")
      .maybeSingle();
    if (error) return null;
    return data?.household_id ?? null;
  }

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      const u = data.session?.user ?? null;
      setUser(u);
      if (u) {
        fetchHouseholdId(u.id).then((hid) => active && (setHouseholdId(hid), setLoading(false)));
      } else {
        setLoading(false);
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) {
        fetchHouseholdId(u.id).then(setHouseholdId);
      } else {
        setHouseholdId(null);
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
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
  };
  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) throw error;
  };
  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setHouseholdId(null);
  };
  const createHousehold = async (args: CreateHouseholdArgs) => {
    if (!user) throw new Error("Not authenticated");
    const hid = await rpcCreateHousehold(args);
    setHouseholdId(hid);
  };
  const acceptInvite = async (token: string, displayName?: string) => {
    if (!user) throw new Error("Not authenticated");
    const hid = await rpcAcceptInvite(token, displayName);
    setHouseholdId(hid);
  };
  const clearPendingInvite = () => setPendingInviteToken(null);

  return (
    <AuthContext.Provider
      value={{
        user,
        householdId,
        loading,
        configured: isSupabaseConfigured,
        signIn,
        signUp,
        resetPassword,
        signOut,
        createHousehold,
        acceptInvite,
        pendingInviteToken,
        clearPendingInvite
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
