// 认证与账号状态的纯函数（不引入 react-native，vitest 可直接测试）。
// 客户端判断只决定界面显示；「已绑定」的权威判断在服务端 is_bound_user（0058/0060）。

export interface UserLike {
  id: string;
  is_anonymous?: boolean | null;
  email?: string | null;
  identities?: { provider: string }[] | null;
  app_metadata?: { provider?: string; providers?: string[] } | null;
}

function providerSet(user: UserLike | null | undefined): string[] {
  if (!user) return [];
  const fromIdentities = (user.identities ?? []).map((identity) => identity.provider);
  const fromMetadata = user.app_metadata?.providers ?? [];
  return [...new Set([...fromIdentities, ...fromMetadata])].sort();
}

export function hasProviderIdentity(user: UserLike | null | undefined, provider: string): boolean {
  return providerSet(user).includes(provider);
}

export function hasAppleIdentity(user: UserLike | null | undefined): boolean {
  return hasProviderIdentity(user, "apple");
}

// 匿名 = GoTrue 标记 is_anonymous，且还没有 Apple 身份。
// 即使 linkIdentity 之后 is_anonymous 没有翻转（方案 risks 第 1 条的设计前提），有 Apple 身份也按已绑定处理。
export function isAnonymousUser(user: UserLike | null | undefined): boolean {
  return Boolean(user && user.is_anonymous === true && !hasAppleIdentity(user));
}

export type UserChange = "same" | "refresh" | "switch";

// L93 的修正：只比较 id 会漏掉 linkIdentity 之后的 USER_UPDATED（id 不变，is_anonymous / identities 变了）。
// switch：换了账号，必须清空家庭；refresh：同一账号，只更新 user，不动家庭；same：什么都不做。
export function classifyUserChange(prev: UserLike | null | undefined, next: UserLike | null | undefined): UserChange {
  const prevId = prev?.id ?? null;
  const nextId = next?.id ?? null;
  if (prevId !== nextId) return "switch";
  if (!prev || !next) return "same";
  if (Boolean(prev.is_anonymous) !== Boolean(next.is_anonymous)) return "refresh";
  if (providerSet(prev).join(",") !== providerSet(next).join(",")) return "refresh";
  if ((prev.email ?? null) !== (next.email ?? null)) return "refresh";
  return "same";
}

export function shouldRefreshUser(prev: UserLike | null | undefined, next: UserLike | null | undefined): boolean {
  return classifyUserChange(prev, next) === "refresh";
}

// 生成或查看加入码：只有协调人，并且已绑定（匿名协调人先绑定，0060 在服务端兜底）。
export function canInvite(args: { isAnonymous: boolean; role: string | null | undefined }): boolean {
  return args.role === "coordinator" && !args.isAnonymous;
}

// 订阅与恢复购买：匿名用户先绑定，再打开 StoreKit（appAccountToken 仍等于同一个 uid）。
export function canPurchase(args: { isAnonymous: boolean }): boolean {
  return !args.isAnonymous;
}

export interface SignOutOptions {
  confirmedAnonymousLoss?: boolean;
  reason?: "account_deleted";
}

export type SignOutDecision = "needs_confirmation" | "sign_out";

// 退出唯一出口的判断：匿名会话必须经用户确认，删号成功后由程序强制登出。
export function signOutDecision(args: { isAnonymous: boolean } & SignOutOptions): SignOutDecision {
  if (args.reason === "account_deleted") return "sign_out";
  if (args.isAnonymous && !args.confirmedAnonymousLoss) return "needs_confirmation";
  return "sign_out";
}

export type MembershipLossReason = "left" | "dissolved" | "removed";

export interface MembershipLossAction {
  kind: "refresh_households";
  clearCaches: boolean;
  warnSubscription: boolean;
}

// 退出家庭、解散家庭、被移除之后：不登出，清掉本机家庭缓存并刷新家庭列表；
// 还有家庭就切过去，没有就停在 Onboarding，会话保留。
// 付款人的扣费提示：主动退出和解散在操作前确认时已提示；被移除是事后知道的，这里补一次。
export function postMembershipLossAction(args: {
  reason: MembershipLossReason;
  isPayer: boolean;
}): MembershipLossAction {
  return {
    kind: "refresh_households",
    clearCaches: true,
    warnSubscription: args.reason === "removed" && args.isPayer
  };
}

// 刷新家庭列表后切到哪一户：调用方指定的 id 只有在列表里才用（它可能已经过时，例如很久以前批准、后来又退出的
// 那一户；选中一个不在列表里的家庭，首次加载会一直失败），否则用服务端记的当前家庭，再否则第一户。
export function pickActiveHouseholdId(
  households: { id: string; isActive?: boolean }[],
  preferredId?: string | null
): string | null {
  if (preferredId && households.some((household) => household.id === preferredId)) return preferredId;
  return households.find((household) => household.isActive)?.id ?? households[0]?.id ?? null;
}

// 账号编号：uid 前 8 位，用户申请删除数据时提供。
export function accountIdLabel(userId: string | null | undefined): string {
  return (userId ?? "").replace(/-/g, "").slice(0, 8).toUpperCase();
}

// expo-apple-authentication 在用户取消时 reject ERR_REQUEST_CANCELED：映射成静默取消。
export function isAppleCancelError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "ERR_REQUEST_CANCELED" || code === "ERR_CANCELED";
}

// linkIdentity 遇到「这个 Apple ID 已属于别的 TaskKin 账号」。
export function isIdentityAlreadyExistsError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  if (code === "identity_already_exists") return true;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && /identity is already linked/i.test(message);
}

// 用 Keychain 里的 refresh token 恢复失败时：只有服务端明确拒绝（token 失效、被吊销）才丢弃锚点；
// 断网、5xx、限流（429）、超时（408）都可以重试，保留锚点，下次再试。
export function shouldDropAnchorAfterRestoreError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: unknown }).name;
  if (name === "AuthRetryableFetchError") return false;
  const status = (error as { status?: unknown }).status;
  if (status === 408 || status === 429) return false;
  return typeof status === "number" && status >= 400 && status < 500;
}

// 锚点恢复的结果：restored 已回到原来的匿名账号；none 没有锚点（或服务端明确拒绝、已丢弃）；
// retry_later 网络等可重试的失败，锚点保留。
export type AnchorRestoreOutcome = "restored" | "none" | "retry_later";

// 本机没有会话时，任何会新建身份的入口（开始使用、凭码加入、用 Apple 继续）先用锚点恢复：
// 只有 none 才允许新建；retry_later 时新建会让锚点里那个未绑定的账号和它的家庭永远回不来（评审 minor）。
export function mayCreateNewIdentity(outcome: AnchorRestoreOutcome): boolean {
  return outcome === "none";
}

// GoTrue /user 对已删除账号的 JWT 返回 403 user_not_found（例如另一台设备绑定同一个 Apple ID 时把这个空账号删了）。
// 其他错误（断网、限流、token 过期）都不算：不能因为网络问题把人登出。
export function isAccountGoneError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { code?: unknown }).code === "user_not_found";
}

export type AppleConflictResult = "no_conflict" | "freed" | "caller_empty" | "both_have_data";

export function parseAppleConflictResult(data: unknown): AppleConflictResult {
  const raw =
    data && typeof data === "object"
      ? ((data as { result?: unknown; status?: unknown }).result ?? (data as { status?: unknown }).status)
      : data;
  if (raw === "no_conflict" || raw === "freed" || raw === "caller_empty" || raw === "both_have_data") return raw;
  throw new Error("Unexpected response from apple-identity-conflict");
}
