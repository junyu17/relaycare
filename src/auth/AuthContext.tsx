import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState as RNAppState } from "react-native";
import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import {
  createHousehold as rpcCreateHousehold,
  acceptInvite as rpcAcceptInvite,
  joinByCodeV2 as rpcJoinByCodeV2,
  listMyHouseholds,
  myJoinRequests,
  setActiveHousehold as rpcSetActiveHousehold,
  deleteAccount as rpcDeleteAccount,
  deleteAccountWithToken,
  resolveAppleConflict,
  type HouseholdSummary
} from "../lib/db";
import * as Linking from "expo-linking";
import { clearHouseholdCaches } from "../lib/db";
import { getAppleCredential, isAppleAvailable, type AppleCredential } from "./apple";
import {
  clearAnonymousAnchor,
  decideStartupRestore,
  detectMigratedDevice,
  readAnonymousAnchor,
  readInstallMarker,
  saveAnonymousAnchor,
  writeInstallMarker
} from "./anonymousAnchor";
import {
  classifyUserChange,
  hasAppleIdentity as userHasAppleIdentity,
  isAccountGoneError,
  isAnonymousUser,
  isIdentityAlreadyExistsError,
  mayCreateNewIdentity,
  pickActiveHouseholdId,
  shouldDropAnchorAfterRestoreError,
  signOutDecision,
  type AnchorRestoreOutcome,
  type SignOutOptions
} from "./guards";
import {
  keepCodeAfterJoin,
  pendingJoinIsStale,
  resolvePendingJoin,
  waitsForRequest,
  type JoinResult,
  type JoinStatus,
  type PendingJoinRequest
} from "../lib/joinV2";

export interface CreateHouseholdArgs {
  householdName: string;
  timezone: string;
  careRecipientLabel: string;
  memberName: string;
  memberRelation: string;
  memberTimezone: string;
}

// linked：本机账号绑定了 Apple（uid 不变）；switched：切到了这个 Apple ID 已有的账号（本机空账号随后删除）；
// both_have_data：两边都有数据，什么都不删也不切换；cancelled：用户取消了 Apple 授权。
export type BindResult = "linked" | "switched" | "both_have_data" | "cancelled";
export type SignOutResult = "signed_out" | "needs_confirmation";
// none：本机已经没有在等的申请（例如刚被处理掉），等待页什么都不用做。
export type PendingJoinCheck = "pending" | "approved" | "rejected" | "expired" | "none";
export type BindPromptReason = "afterCreate";

interface AuthState {
  user: User | null;
  householdId: string | null;
  households: HouseholdSummary[];
  householdsError: boolean;
  loading: boolean;
  configured: boolean;
  isAnonymous: boolean;
  hasAppleIdentity: boolean;
  appleAvailable: boolean;
  isMigratedDevice: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ signedIn: boolean }>;
  resetPassword: (email: string) => Promise<void>;
  startAnonymously: () => Promise<void>;
  continueWithApple: () => Promise<"signed_in" | "cancelled">;
  bindApple: () => Promise<BindResult>;
  requestSignOut: () => Promise<SignOutResult>;
  signOut: (options?: SignOutOptions) => Promise<SignOutResult>;
  deleteAccount: () => Promise<"deleted" | "cancelled">;
  refreshHouseholds: (preferredId?: string) => Promise<void>;
  retryHouseholds: () => Promise<void>;
  recoverFromMembershipLoss: () => Promise<void>;
  createHousehold: (args: CreateHouseholdArgs) => Promise<void>;
  switchHousehold: (householdId: string) => Promise<void>;
  acceptInvite: (memberId: string, displayName?: string) => Promise<void>;
  joinByCode: (code: string, displayName?: string) => Promise<JoinStatus>;
  pendingJoinRequest: PendingJoinRequest | null;
  checkPendingJoinRequest: () => Promise<PendingJoinCheck>;
  dismissPendingJoinRequest: () => void;
  accountGone: boolean;
  clearAccountGone: () => void;
  bindPrompt: BindPromptReason | null;
  clearBindPrompt: () => void;
  dismissMigratedDevicePrompt: () => void;
  pendingInviteToken: string | null;
  pendingJoinCode: string | null;
  clearPendingInvite: () => void;
  clearPendingJoinCode: () => void;
}

// AsyncStorage（会随备份迁移）里的安装标志：和 Keychain 安装标记一起判断「是否迁移来的新设备」。
const INSTALL_FLAG_KEY = "taskkin-care:install-flag";
// 检测到新设备后一直提示，直到绑定或退出。
const MIGRATED_DEVICE_KEY = "taskkin-care:migrated-device";
// 熔断期的加入申请（pending）：等待页每 5 秒、每次回到前台查询一次。
const PENDING_JOIN_KEY = "taskkin-care:join-request";
const RESTORE_TIMEOUT_MS = 10_000;
// 回到前台时检查账号是否还存在，最多每分钟一次。
const ACCOUNT_CHECK_INTERVAL_MS = 60_000;

const AuthContext = createContext<AuthState | null>(null);

function anonymousSignUpError(): Error {
  // hint 让界面按 i18n 显示（lib/error.ts）。
  return Object.assign(new Error("Already using TaskKin without an account. Sign in with Apple to keep it."), {
    hint: "anonymous_signup_blocked"
  });
}

// 本机有一个未绑定的匿名账号（Keychain 锚点），但这次没能连上服务器把它找回来：先别新建身份。
function restoreRetryError(): Error {
  return Object.assign(new Error("Couldn't reach TaskKin to restore your family on this phone. Try again."), {
    hint: "restore_retry"
  });
}

// 账号在服务端已经不存在，已登出回到欢迎页（欢迎页会说明原因，调用方不必再弹错误）。
export const ACCOUNT_GONE_HINT = "account_gone";
function accountGoneError(): Error {
  return Object.assign(new Error("This account no longer exists. You have been signed out."), {
    hint: ACCOUNT_GONE_HINT
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [households, setHouseholds] = useState<HouseholdSummary[]>([]);
  const [householdsError, setHouseholdsError] = useState(false);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [isMigratedDevice, setIsMigratedDevice] = useState(false);
  const [pendingInviteToken, setPendingInviteToken] = useState<string | null>(null);
  const [pendingJoinCode, setPendingJoinCode] = useState<string | null>(null);
  const [pendingJoinRequest, setPendingJoinRequest] = useState<PendingJoinRequest | null>(null);
  const [bindPrompt, setBindPrompt] = useState<BindPromptReason | null>(null);
  const [accountGone, setAccountGone] = useState(false);
  const authUserIdRef = useRef<string | null | undefined>(undefined);
  const userRef = useRef<User | null>(null);
  const pendingJoinRef = useRef<PendingJoinRequest | null>(null);
  const bootingRef = useRef(true);
  const anchorMaybePresentRef = useRef(true);
  const authRefreshSeq = useRef(0);
  const householdRefreshSeq = useRef(0);
  // 当前账号最近一次成功加载到的家庭数（null = 还没加载过）。用来丢弃已经过时的 pending 加入申请。
  const knownHouseholdCountRef = useRef<number | null>(null);
  const lastAccountCheckRef = useRef(0);

  // Deep link: taskkin-care://invite?token=<token> 或 taskkin-care://join?code=<6位码>
  // I8: invite token 解析后暂未被消费（加入流程走 join code/QR）；保留解析供后续接入。
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

  const updatePendingJoin = (next: PendingJoinRequest | null) => {
    pendingJoinRef.current = next;
    setPendingJoinRequest(next);
  };

  const clearPersistedPendingJoin = async () => {
    updatePendingJoin(null);
    try {
      await AsyncStorage.removeItem(PENDING_JOIN_KEY);
    } catch {
      // best-effort
    }
  };

  async function refreshHouseholds(preferredId?: string, expectedAuthSeq?: number): Promise<void> {
    const requestSeq = ++householdRefreshSeq.current;
    const next = await listMyHouseholds();
    if (requestSeq !== householdRefreshSeq.current) return;
    if (expectedAuthSeq !== undefined && expectedAuthSeq !== authRefreshSeq.current) return;
    setHouseholds(next);
    setHouseholdsError(false);
    knownHouseholdCountRef.current = next.length;
    // 只切到列表里真的有的家庭（调用方传来的 id 可能已经过时）。
    setHouseholdId(pickActiveHouseholdId(next, preferredId));
    // 已经有家庭：本机记着的加入申请已经过时（批准时 app 没开、之后直接进了家庭），丢掉。
    // （直接用 ref 和 setter，不调用 clearPersistedPendingJoin：启动 effect 也调用这个函数。）
    if (pendingJoinIsStale(next.length) && pendingJoinRef.current) {
      pendingJoinRef.current = null;
      setPendingJoinRequest(null);
      void AsyncStorage.removeItem(PENDING_JOIN_KEY).catch(() => undefined);
    }
  }

  // Keychain 匿名锚点：匿名会话每次 SIGNED_IN / TOKEN_REFRESHED 都写入最新 refresh token；
  // 一旦是已绑定（或邮箱）账号就清除，Keychain 里绝不留非匿名账号的 token。
  const syncAnchor = (event: AuthChangeEvent, session: Session | null) => {
    const sessionUser = session?.user ?? null;
    if (!sessionUser) return; // SIGNED_OUT 由 signOut() 显式清除
    if (isAnonymousUser(sessionUser)) {
      if (session?.refresh_token && event !== "PASSWORD_RECOVERY") {
        anchorMaybePresentRef.current = true;
        void saveAnonymousAnchor({ userId: sessionUser.id, refreshToken: session.refresh_token });
      }
      return;
    }
    if (anchorMaybePresentRef.current) {
      anchorMaybePresentRef.current = false;
      void clearAnonymousAnchor();
      void AsyncStorage.removeItem(MIGRATED_DEVICE_KEY).catch(() => undefined);
    }
  };

  // 用 Keychain 锚点找回本机那个未绑定的匿名账号。成功时 refreshSession 触发 TOKEN_REFRESHED，
  // onAuthStateChange 把会话交给界面。只有服务端明确拒绝（token 失效、被吊销）才丢弃锚点；
  // 断网、5xx、429、超时都返回 retry_later，锚点保留。
  async function restoreFromAnchor(timeoutMs?: number): Promise<AnchorRestoreOutcome> {
    const anchor = await readAnonymousAnchor();
    if (decideStartupRestore(false, anchor) !== "restore" || !anchor) return "none";
    try {
      const attempt = supabase.auth.refreshSession({ refresh_token: anchor.refreshToken });
      const restored = timeoutMs
        ? await Promise.race([attempt, new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))])
        : await attempt;
      if (!restored) return "retry_later";
      if (restored.error) {
        if (!shouldDropAnchorAfterRestoreError(restored.error)) return "retry_later";
        await clearAnonymousAnchor();
        return "none";
      }
      return restored.data.session ? "restored" : "retry_later";
    } catch {
      return "retry_later";
    }
  }

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let active = true;

    const loadPendingJoin = async (userId: string) => {
      try {
        const raw = await AsyncStorage.getItem(PENDING_JOIN_KEY);
        if (!raw || !active) return;
        const parsed = JSON.parse(raw) as PendingJoinRequest;
        if (authUserIdRef.current !== userId) return;
        // 家庭列表已经加载到至少一户：这条申请已经过时（见 refreshHouseholds），直接丢掉。
        if (pendingJoinIsStale(knownHouseholdCountRef.current)) {
          if (!pendingJoinRef.current) await AsyncStorage.removeItem(PENDING_JOIN_KEY);
          return;
        }
        // 只恢复属于当前账号的申请；读到旧值时绝不用 null 覆盖刚写入的新申请。
        if (parsed?.userId === userId) updatePendingJoin(parsed);
      } catch {
        // best-effort
      }
    };

    const applySessionUser = (nextUser: User | null) => {
      const nextUserId = nextUser?.id ?? null;
      if (authUserIdRef.current === nextUserId) {
        // TOKEN_REFRESHED 和重复的 INITIAL_SESSION 不能重置当前家庭。
        // 但 linkIdentity 之后的 USER_UPDATED（id 不变，is_anonymous / identities 变了）要刷新 user，
        // 同样不清空家庭。
        if (nextUser && classifyUserChange(userRef.current, nextUser) === "refresh") {
          userRef.current = nextUser;
          setUser(nextUser);
        }
        return;
      }
      authUserIdRef.current = nextUserId;
      userRef.current = nextUser;
      knownHouseholdCountRef.current = null;
      const seq = ++authRefreshSeq.current;
      householdRefreshSeq.current += 1;

      // Clear the previous account scope in the same render as the user change. Otherwise CloudApp
      // can briefly render the old household for the new user and show the removed-member guard.
      setUser(nextUser);
      setHouseholdId(null);
      setHouseholds([]);
      setHouseholdsError(false);
      setBindPrompt(null);
      updatePendingJoin(null);
      if (!nextUser) {
        setLoading(false);
        return;
      }

      setLoading(true);
      void loadPendingJoin(nextUser.id);
      void refreshHouseholds(undefined, seq)
        .catch(() => {
          if (!active || seq !== authRefreshSeq.current) return;
          setHouseholdId(null);
          setHouseholds([]);
          // 加载失败不等于没有家庭：Onboarding 显示「重试」，而不是让人再建一个。
          setHouseholdsError(true);
        })
        .finally(() => {
          if (active && seq === authRefreshSeq.current) setLoading(false);
        });
    };

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      syncAnchor(event, session);
      // 启动恢复期间不应用中间状态（例如 INITIAL_SESSION 的 null），避免重装恢复时闪出欢迎页。
      if (bootingRef.current) return;
      applySessionUser(session?.user ?? null);
    });

    const boot = async (): Promise<Session | null> => {
      let session = (await supabase.auth.getSession()).data.session;
      const [appleOk, installMarker, installFlag, migratedFlag] = await Promise.all([
        isAppleAvailable(),
        readInstallMarker(),
        AsyncStorage.getItem(INSTALL_FLAG_KEY).catch(() => null),
        AsyncStorage.getItem(MIGRATED_DEVICE_KEY).catch(() => null)
      ]);
      // 启动页结束前就确定 Apple 登录是否可用：欢迎页第一次渲染就是最终的按钮组合，不会先两个再变四个。
      if (active) setAppleAvailable(appleOk);
      const migratedNow = detectMigratedDevice({
        keychainMarker: installMarker,
        storageFlag: installFlag != null,
        sessionIsAnonymous: isAnonymousUser(session?.user)
      });
      if (installMarker === false) await writeInstallMarker();
      if (installFlag == null) await AsyncStorage.setItem(INSTALL_FLAG_KEY, "1").catch(() => undefined);
      if (migratedNow) await AsyncStorage.setItem(MIGRATED_DEVICE_KEY, "1").catch(() => undefined);

      // 删 app 重装：AsyncStorage 被清空，Keychain 里的匿名 refresh token 还在（iOS 的实际行为，尽力而为）。
      // 弱网时不让启动页一直转圈：10 秒没结果就先显示欢迎页；恢复稍后成功时 TOKEN_REFRESHED 会把会话带回来，
      // 欢迎页上的「开始使用」「我有家庭码」「用 Apple 继续」也都会先再试一次锚点，不会悄悄换成新身份。
      if (!session && (await restoreFromAnchor(RESTORE_TIMEOUT_MS)) === "restored") {
        session = (await supabase.auth.getSession()).data.session;
      }
      if (active) {
        setIsMigratedDevice((migratedNow || migratedFlag === "1") && isAnonymousUser(session?.user));
      }
      return session;
    };

    void boot()
      .catch(async (e) => {
        console.warn("auth boot failed", e);
        return (await supabase.auth.getSession()).data.session;
      })
      .then((session) => {
        if (!active) return;
        bootingRef.current = false;
        applySessionUser(session?.user ?? null);
      });

    return () => {
      active = false;
      authRefreshSeq.current += 1;
      householdRefreshSeq.current += 1;
      sub.subscription.unsubscribe();
    };
  }, []);

  const currentSessionUser = async (): Promise<User | null> => {
    const { data } = await supabase.auth.getSession();
    return data.session?.user ?? userRef.current;
  };

  // 本机没有会话时，任何会新建身份的入口都先走这里：能找回锚点里的账号就找回；
  // 找不回但可能只是暂时连不上时报错，不新建身份（否则新身份的 token 会覆盖锚点，原来的家庭就回不来了）。
  const restoreBeforeNewIdentity = async (): Promise<"restored" | "none"> => {
    const outcome = await restoreFromAnchor();
    if (outcome === "restored") return "restored";
    if (!mayCreateNewIdentity(outcome)) throw restoreRetryError();
    return "none";
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };
  const signUp = async (email: string, password: string) => {
    // 持有匿名会话时绝不 signUp：那样会丢掉匿名账号和它的家庭。绑定只走 linkIdentity。
    if (isAnonymousUser(await currentSessionUser())) throw anonymousSignUpError();
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    return { signedIn: Boolean(data.session) };
  };
  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) throw error;
  };

  // 决策 1A：只有点「开始使用」时才创建匿名身份，打开 app 时不创建。
  // 本机有未绑定的匿名账号（Keychain 锚点）时先把它找回来，而不是换一个新身份。
  const startAnonymously = async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) return;
    if ((await restoreBeforeNewIdentity()) === "restored") return;
    const { error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
  };

  const markBound = async () => {
    anchorMaybePresentRef.current = false;
    await clearAnonymousAnchor();
    await AsyncStorage.removeItem(MIGRATED_DEVICE_KEY).catch(() => undefined);
    setIsMigratedDevice(false);
  };

  const linkWith = (credential: AppleCredential) =>
    supabase.auth.linkIdentity({ provider: "apple", token: credential.identityToken, nonce: credential.rawNonce });

  const signInWith = (credential: AppleCredential) =>
    supabase.auth.signInWithIdToken({ provider: "apple", token: credential.identityToken, nonce: credential.rawNonce });

  // 绑定 Apple：linkIdentity，user id 不变。冲突时（这个 Apple ID 已有账号 X）交给 apple-identity-conflict：
  //  freed        X 是空账号，服务端已删掉 X → 用同一个 token 重新 link（失效时再做一次 Face ID）。
  //  caller_empty 本机账号 U 是空的 → 先保存 U 的 token，登录 X 成功之后才删 U；登录失败时 U 原样保留。
  //  both_have_data 两边都有数据 → 什么都不删，也不切换。
  const bindApple = async (): Promise<BindResult> => {
    const credential = await getAppleCredential();
    if (!credential) return "cancelled";
    const first = await linkWith(credential);
    if (!first.error) {
      await markBound();
      return "linked";
    }
    if (!isIdentityAlreadyExistsError(first.error)) throw first.error;

    const conflict = await resolveAppleConflict({ idToken: credential.identityToken, rawNonce: credential.rawNonce });
    if (conflict === "freed" || conflict === "no_conflict") {
      const retry = await linkWith(credential);
      if (!retry.error) {
        await markBound();
        return "linked";
      }
      if (conflict === "no_conflict") {
        // 这个 Apple ID 其实已经在本账号上：刷新会话拿最新的 identities。
        const refreshed = await supabase.auth.refreshSession();
        if (userHasAppleIdentity(refreshed.data.user)) {
          await markBound();
          return "linked";
        }
      }
      const again = await getAppleCredential();
      if (!again) return "cancelled";
      const third = await linkWith(again);
      if (third.error) throw third.error;
      await markBound();
      return "linked";
    }
    if (conflict === "caller_empty") {
      const { data } = await supabase.auth.getSession();
      const callerAccessToken = data.session?.access_token ?? null;
      const signedIn = await signInWith(credential);
      if (signedIn.error) throw signedIn.error;
      await markBound();
      if (callerAccessToken) {
        // 删除失败也没关系：空的匿名账号会被 0061 在 30 天后清理。
        await deleteAccountWithToken(callerAccessToken).catch((e) =>
          console.warn("delete empty anonymous account failed", e)
        );
      }
      return "switched";
    }
    return "both_have_data";
  };

  // 欢迎页「用 Apple 继续」：signInWithIdToken，按 Apple sub 找回同一个 uid（换机、重装）。
  // 本机有未绑定的匿名账号（锚点）时先找回它，再把 Apple 绑到它上面：家庭留在原来的账号里。
  const continueWithApple = async (): Promise<"signed_in" | "cancelled"> => {
    let current = await currentSessionUser();
    if (!current && (await restoreBeforeNewIdentity()) === "restored") current = await currentSessionUser();
    if (isAnonymousUser(current)) {
      return (await bindApple()) === "cancelled" ? "cancelled" : "signed_in";
    }
    const credential = await getAppleCredential();
    if (!credential) return "cancelled";
    const { error } = await signInWith(credential);
    if (error) throw error;
    return "signed_in";
  };

  // 退出的唯一出口。匿名会话返回 needs_confirmation，由界面弹出三选项警告；
  // signOut({ confirmedAnonymousLoss: true }) 或 signOut({ reason: "account_deleted" }) 才真正登出。
  const signOut = async (options: SignOutOptions = {}): Promise<SignOutResult> => {
    const current = await currentSessionUser();
    if (signOutDecision({ isAnonymous: isAnonymousUser(current), ...options }) === "needs_confirmation") {
      return "needs_confirmation";
    }
    anchorMaybePresentRef.current = false;
    await clearAnonymousAnchor();
    await AsyncStorage.multiRemove([MIGRATED_DEVICE_KEY, PENDING_JOIN_KEY]).catch(() => undefined);
    // 删号之后账号已经不存在，只清本地会话。
    const { error } = await supabase.auth.signOut(
      options.reason === "account_deleted" ? { scope: "local" } : undefined
    );
    if (error) await supabase.auth.signOut({ scope: "local" });
    authUserIdRef.current = null;
    userRef.current = null;
    knownHouseholdCountRef.current = null;
    authRefreshSeq.current += 1;
    householdRefreshSeq.current += 1;
    // I6: 登出清理全部家庭缓存（OCR 原文/审计细节等明文数据不留设备）。
    void clearHouseholdCaches();
    setUser(null);
    setHouseholdId(null);
    setHouseholds([]);
    setHouseholdsError(false);
    setBindPrompt(null);
    setIsMigratedDevice(false);
    updatePendingJoin(null);
    setLoading(false);
    return "signed_out";
  };
  const requestSignOut = () => signOut();

  // 另一台设备绑定同一个 Apple ID 时，服务端会删掉这边的空账号（4a 的 freed）；删号也可能发生在别的设备上。
  // 这台设备的 JWT 在过期前（最长约 1 小时）仍然有效，所以回到前台、建家庭、凭码加入之前问一次服务端：
  // 账号已不存在就登出回到欢迎页，欢迎页说明原因。断网等其他错误一律当作账号还在。
  const ensureAccountStillExists = async (): Promise<boolean> => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return true;
    let gone = false;
    try {
      const { error } = await supabase.auth.getUser();
      gone = isAccountGoneError(error);
    } catch {
      return true;
    }
    if (!gone) return true;
    await signOut({ reason: "account_deleted" });
    setAccountGone(true);
    return false;
  };
  const ensureAccountRef = useRef(ensureAccountStillExists);
  useEffect(() => {
    ensureAccountRef.current = ensureAccountStillExists;
  });

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const sub = RNAppState.addEventListener("change", (next) => {
      if (next !== "active" || !userRef.current) return;
      const now = Date.now();
      if (now - lastAccountCheckRef.current < ACCOUNT_CHECK_INTERVAL_MS) return;
      lastAccountCheckRef.current = now;
      void ensureAccountRef.current().catch(() => undefined);
    });
    return () => sub.remove();
  }, []);

  // 删除账号（设置页和 Onboarding 页）。决策 3A：绑定了 Apple 的账号先重新授权一次，
  // 把 authorizationCode 交给 delete-account 撤销 Apple 授权；授权失败（不是取消）也照样删除。
  const deleteAccount = async (): Promise<"deleted" | "cancelled"> => {
    let appleCode: string | null = null;
    if (userHasAppleIdentity(await currentSessionUser())) {
      try {
        const credential = await getAppleCredential();
        if (!credential) return "cancelled";
        appleCode = credential.authorizationCode;
      } catch (e) {
        console.warn("Apple re-authorization failed; deleting without revoking", e);
      }
    }
    await rpcDeleteAccount(appleCode);
    await signOut({ reason: "account_deleted" });
    return "deleted";
  };

  const retryHouseholds = async () => {
    await refreshHouseholds().catch(() => {
      setHouseholdsError(true);
    });
  };

  // 退出家庭、解散家庭、被移除之后：不登出，刷新家庭列表（还有家庭就切过去，没有就停在 Onboarding）。
  const recoverFromMembershipLoss = async () => {
    await clearHouseholdCaches();
    try {
      await refreshHouseholds();
    } catch {
      // 刷新失败也绝不能停在已失效的家庭上：清空当前家庭，Onboarding 提供「重试」。
      householdRefreshSeq.current += 1;
      setHouseholds([]);
      setHouseholdId(null);
      setHouseholdsError(true);
    }
  };

  const createHousehold = async (args: CreateHouseholdArgs) => {
    if (!user) throw new Error("Not authenticated");
    if (!(await ensureAccountStillExists())) throw accountGoneError();
    const hid = await rpcCreateHousehold(args);
    await refreshHouseholds(hid);
    // 建好后弹一次不强制的「用 Apple 登录，保存你的家庭」。
    if (isAnonymousUser(userRef.current)) setBindPrompt("afterCreate");
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
  // 凭 6 位码加入（普通成员无需邮箱；没有会话时匿名签到）。走 join_by_code_v2：
  // joined 直接进入家庭；pending 记下申请，等待页轮询；
  // invalid / rate_limited / requests_full 和出错时，把码回填到 Onboarding 的「加入」页，方便核对或稍后重试。
  const joinByCode = async (code: string, displayName?: string): Promise<JoinStatus> => {
    const { data } = await supabase.auth.getSession();
    let userId = data.session?.user.id ?? null;
    if (!data.session) {
      // 从欢迎页「我有家庭码」进来：先让界面停在「加入」页并带上码（出错时也留着，方便重试）。
      setPendingJoinCode(code);
      if ((await restoreBeforeNewIdentity()) === "restored") {
        // 找回了本机原来的匿名账号：用它加入，不新建身份。
        userId = (await supabase.auth.getSession()).data.session?.user.id ?? null;
      } else {
        const signedIn = await supabase.auth.signInAnonymously();
        if (signedIn.error) throw signedIn.error;
        userId = signedIn.data.user?.id ?? null;
      }
    } else if (!(await ensureAccountStillExists())) {
      throw accountGoneError();
    }
    let result: JoinResult;
    try {
      result = await rpcJoinByCodeV2(code, displayName);
    } catch (e) {
      setPendingJoinCode(code);
      throw e;
    }
    setPendingJoinCode(keepCodeAfterJoin(result.status) ? code : null);
    if (result.status === "joined") {
      await refreshHouseholds(result.householdId ?? undefined);
    } else if (waitsForRequest(result.status) && userId) {
      // pending：新申请；already_pending：回到这个账号原来那条申请的等待页（服务端没看这次的码）。
      const pending: PendingJoinRequest = {
        userId,
        requestId: result.requestId,
        createdAt: new Date().toISOString()
      };
      updatePendingJoin(pending);
      await AsyncStorage.setItem(PENDING_JOIN_KEY, JSON.stringify(pending)).catch(() => undefined);
    }
    return result.status;
  };

  const checkPendingJoinRequest = async (): Promise<PendingJoinCheck> => {
    const pending = pendingJoinRef.current;
    if (!pending) return "none";
    let rows;
    try {
      rows = await myJoinRequests();
    } catch {
      return "pending"; // 断网等：继续等
    }
    if (pendingJoinRef.current !== pending) return "none"; // 等待期间被取消或换成了新申请
    const { outcome, householdId: approvedHouseholdId } = resolvePendingJoin(pending, rows, Date.now());
    if (outcome === "approved") {
      // 先进入家庭，再清掉等待状态（refreshHouseholds 只会切到列表里真的有的家庭）。
      try {
        await refreshHouseholds(approvedHouseholdId ?? undefined);
      } catch {
        setHouseholdsError(true);
      }
      await clearPersistedPendingJoin();
    }
    // rejected / expired 不在这里清：等待页先弹提示，再调用 dismissPendingJoinRequest。
    // 先清状态会让等待页在提示之前就卸载，提示永远弹不出来（评审 minor）。
    return outcome;
  };

  const clearPendingInvite = () => setPendingInviteToken(null);
  const clearPendingJoinCode = () => setPendingJoinCode(null);

  return (
    <AuthContext.Provider
      value={{
        user,
        householdId,
        households,
        householdsError,
        loading,
        configured: isSupabaseConfigured,
        isAnonymous: isAnonymousUser(user),
        hasAppleIdentity: userHasAppleIdentity(user),
        appleAvailable,
        isMigratedDevice,
        signIn,
        signUp,
        resetPassword,
        startAnonymously,
        continueWithApple,
        bindApple,
        requestSignOut,
        signOut,
        deleteAccount,
        refreshHouseholds: (preferredId?: string) => refreshHouseholds(preferredId),
        retryHouseholds,
        recoverFromMembershipLoss,
        createHousehold,
        switchHousehold,
        acceptInvite,
        joinByCode,
        pendingJoinRequest,
        checkPendingJoinRequest,
        dismissPendingJoinRequest: () => void clearPersistedPendingJoin(),
        accountGone,
        clearAccountGone: () => setAccountGone(false),
        bindPrompt,
        clearBindPrompt: () => setBindPrompt(null),
        dismissMigratedDevicePrompt: () => setIsMigratedDevice(false),
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
