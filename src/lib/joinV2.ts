// join_by_code_v2（0059）的返回值解析，以及申请人轮询 my_join_requests 的判断。纯函数，vitest 直接测。

// already_pending：熔断中，这个账号已经有一条在等的申请（服务端不看码就返回，request_id 是那一条）。
export type JoinStatus = "joined" | "pending" | "already_pending" | "invalid" | "rate_limited" | "requests_full";

export interface JoinResult {
  status: JoinStatus;
  householdId: string | null;
  requestId: string | null;
}

const STATUSES: JoinStatus[] = ["joined", "pending", "already_pending", "invalid", "rate_limited", "requests_full"];

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

// v2 返回 jsonb {status, household_id?, request_id?}。PostgREST 有时把单个 jsonb 包成数组。
export function parseJoinV2Response(data: unknown): JoinResult {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") throw new Error("Unexpected response from join_by_code_v2");
  const record = row as Record<string, unknown>;
  const status = record.status;
  if (typeof status !== "string" || !STATUSES.includes(status as JoinStatus)) {
    throw new Error(`Unexpected join status: ${String(status)}`);
  }
  return {
    status: status as JoinStatus,
    householdId: str(record.household_id),
    requestId: str(record.request_id) ?? str(record.id)
  };
}

// 旧的 join_by_code（0057 之后）：码不存在返回 NULL，成功返回 household_id。
// 只在服务端还没有 v2 时作为兼容回退使用。
export function parseLegacyJoinResponse(data: unknown): JoinResult {
  const householdId = str(data);
  return householdId
    ? { status: "joined", householdId, requestId: null }
    : { status: "invalid", householdId: null, requestId: null };
}

// 加入没有成功、也没有进入等待时（码错、过期、太频繁、申请已满），把码留在 Onboarding 的「加入」页，
// 方便核对或稍后重试；joined / pending 之后这个码就用完了。
// already_pending 时回到原来那条申请的等待页，这次输入的码留着：换码时不用重新输入。
export function keepCodeAfterJoin(status: JoinStatus): boolean {
  return status !== "joined" && status !== "pending";
}

// 每种状态对用户的提示（joined/pending 不弹窗：直接进入家庭或进入等待页）。
// already_pending 提示「已经有一条申请在等」，然后回到那条申请的等待页。
export function joinStatusMessageKey(status: JoinStatus): string | null {
  switch (status) {
    case "invalid":
      return "errors.codeInvalid";
    case "rate_limited":
      return "errors.joinRateLimited";
    case "requests_full":
      return "errors.requestsFull";
    case "already_pending":
      return "errors.requestPendingElsewhere";
    default:
      return null;
  }
}

export type JoinRequestStatus = "pending" | "approved" | "rejected" | "expired";

export interface MyJoinRequest {
  id: string;
  status: JoinRequestStatus;
  householdId: string | null;
  createdAt: string | null;
}

export function parseMyJoinRequests(data: unknown): MyJoinRequest[] {
  if (!Array.isArray(data)) return [];
  const rows: MyJoinRequest[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const id = str(record.id) ?? str(record.request_id);
    const status = record.status;
    if (!id || (status !== "pending" && status !== "approved" && status !== "rejected" && status !== "expired")) {
      continue;
    }
    rows.push({ id, status, householdId: str(record.household_id), createdAt: str(record.created_at) });
  }
  return rows;
}

export const JOIN_REQUEST_TTL_MS = 24 * 60 * 60 * 1000;

export interface PendingJoinRequest {
  userId: string;
  requestId: string | null;
  createdAt: string;
}

// 加入结果之后要不要显示（或回到）等待页，以及等哪一条申请。
export function waitsForRequest(status: JoinStatus): boolean {
  return status === "pending" || status === "already_pending";
}

// 申请人等待页的判断：找到这条申请（有 id 只按 id 找，没有 id 才取最新一条），决定接下来做什么。
// 有 id 却没找到时绝不退回「最新一条」：那可能是以前被拒绝的旧申请，会让人误以为这次也被拒了。
// 查询失败（断网）时调用方不调用本函数，继续等待。
export function resolvePendingJoin(
  pending: PendingJoinRequest,
  rows: MyJoinRequest[],
  now: number
): { outcome: JoinRequestStatus; householdId: string | null } {
  const latest = [...rows].sort((a, b) => Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? ""))[0];
  const match = pending.requestId ? rows.find((row) => row.id === pending.requestId) : latest;
  const createdAt = Date.parse(match?.createdAt ?? pending.createdAt);
  if (!match) {
    // 服务端找不到这条申请：超过有效期就当过期，否则继续等（写入可能还没提交）。
    return { outcome: now - createdAt > JOIN_REQUEST_TTL_MS ? "expired" : "pending", householdId: null };
  }
  if (match.status === "pending" && Number.isFinite(createdAt) && now - createdAt > JOIN_REQUEST_TTL_MS) {
    return { outcome: "expired", householdId: null };
  }
  return { outcome: match.status, householdId: match.householdId };
}

// 等待页拿到 rejected / expired 时弹的提示。approved 直接进入家庭，不弹；pending / none 什么都不做。
// 清状态的顺序：approved 由 AuthContext 先进入家庭再清；rejected / expired 由等待页先弹提示再清
//（AuthContext 抢先清会让等待页在提示之前卸载，提示就永远弹不出来）。
export function pendingOutcomeAlertKey(outcome: JoinRequestStatus | "none"): string | null {
  if (outcome === "rejected") return "join.requestRejected";
  if (outcome === "expired") return "join.requestExpired";
  return null;
}

// 本机记着的加入申请是否已经过时：等待页只在没有家庭时出现，当前账号已经加载到至少一户（例如批准时 app 没开，
// 下次打开就直接进了家庭），这条申请就没用了。留着它，等以后退出最后一个家庭时会闪出等待页，
// 再拿 30 天前「已批准」的 household_id 去切换一个已经不在的家庭。
export function pendingJoinIsStale(knownHouseholdCount: number | null): boolean {
  return (knownHouseholdCount ?? 0) > 0;
}

// 协调人看到的申请：只显示未过期的 pending。
export function isActiveJoinRequest(request: { status: string; createdAt: string }, now: number): boolean {
  if (request.status !== "pending") return false;
  const created = Date.parse(request.createdAt);
  return !Number.isFinite(created) || now - created <= JOIN_REQUEST_TTL_MS;
}
