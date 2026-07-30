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
