// 统一提取错误信息：Supabase/PostgREST 错误是普通对象（非 Error 实例），
// 直接 String(e) 会得到 "[object Object]"。这里优先取 .message。
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const msg = (e as { message?: unknown }).message;
    if (typeof msg === "string" && msg) return msg;
    // PostgREST 有时把详情放 error 里
    const inner = (e as { error?: unknown }).error;
    if (typeof inner === "string" && inner) return inner;
  }
  return String(e);
}

// 服务端 RAISE 保留原英文 message（给 1.9 看），另带稳定的 hint 码（0057–0060）；
// 1.10 按 hint 显示 6 种语言文案。join_by_code_v2 的状态值也走同一张表。
const HINT_KEYS: Record<string, string> = {
  join_rate_limited: "errors.joinRateLimited",
  rate_limited: "errors.joinRateLimited",
  join_code_expired: "errors.codeInvalid",
  invalid: "errors.codeInvalid",
  account_binding_required: "errors.bindingRequired",
  target_not_bound: "errors.targetNotBound",
  requests_full: "errors.requestsFull",
  already_pending: "errors.requestPendingElsewhere",
  join_already_member: "errors.alreadyMember",
  join_member_limit: "errors.memberLimit",
  join_request_closed: "errors.requestClosed",
  join_request_expired: "errors.requestClosed",
  join_request_not_found: "errors.requestClosed",
  anonymous_signup_blocked: "errors.anonymousSignUp",
  // 客户端自己抛的（AuthContext）：本机的匿名账号这次没能找回；账号在服务端已不存在。
  restore_retry: "errors.restoreRetry",
  account_gone: "auth.accountGone"
};

export function errorHintKey(e: unknown): string | null {
  if (!e || typeof e !== "object") return null;
  const hint = (e as { hint?: unknown }).hint;
  if (typeof hint !== "string" || !hint) return null;
  return HINT_KEYS[hint.trim()] ?? null;
}

export function hintKey(hint: string): string | null {
  return HINT_KEYS[hint] ?? null;
}

// 有 hint 时显示本地化文案，没有 hint 时退回原来的 message。
export function localizedErrorMessage(e: unknown, t: (key: string) => string): string {
  const key = errorHintKey(e);
  return key ? t(key) : errorMessage(e);
}
