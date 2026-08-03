import type { AppState, Household, Plan } from "../types";

// ============ 套餐配额（与后端 0008_paywall.sql 保持一致）============
// 存储不做按家庭配额（Supabase 计划额度兜底），仅限单文件 25MB。
export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

export interface PlanLimits {
  households: number;
  members: number;
  inProgressTasks: number; // Infinity for Plus
  ocrPerMonth: number;
  auditRetentionDays: number;
  weeklyReportAuto: boolean;
  exportEnabled: boolean;
  advancedNotifications: boolean; // 摘要 + 静默时段 + 自动周报
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    households: 1,
    members: 3,
    inProgressTasks: 10,
    ocrPerMonth: 1,
    auditRetentionDays: 30,
    weeklyReportAuto: false,
    exportEnabled: false,
    advancedNotifications: false
  },
  monthly: {
    households: 3,
    members: 12,
    inProgressTasks: Number.POSITIVE_INFINITY,
    ocrPerMonth: 50,
    auditRetentionDays: 1095,
    weeklyReportAuto: true,
    exportEnabled: true,
    advancedNotifications: true
  },
  yearly: {
    households: 3,
    members: 12,
    inProgressTasks: Number.POSITIVE_INFINITY,
    ocrPerMonth: 50,
    auditRetentionDays: 1095,
    weeklyReportAuto: true,
    exportEnabled: true,
    advancedNotifications: true
  }
};

export function isPlusPlan(plan: Plan): boolean {
  return plan === "monthly" || plan === "yearly";
}

// R8（IOS_SUBMISSION_DEV_SPEC）：统一套餐门禁入口——"该计划是否可用某能力"。
// 服务端 RPC/Edge 仍会二次校验 effective_plan()（C3：服务端是权威）。
export type FeatureKey =
  | "export"
  | "weeklyReportAuto"
  | "advancedNotifications"
  | "households3"
  | "members12"
  | "tasksUnlimited"
  | "ocr50"
  | "auditRetention1095";

// 付费墙对照表由 PLAN_LIMITS 派生（backedBy），保证 UI 不虚标。
export const PLAN_FEATURES: Record<FeatureKey, { free: boolean; plus: boolean; labelKey: string }> = {
  export: { free: PLAN_LIMITS.free.exportEnabled, plus: true, labelKey: "paywall.exportReports" },
  weeklyReportAuto: { free: PLAN_LIMITS.free.weeklyReportAuto, plus: true, labelKey: "paywall.autoWeeklyReport" },
  advancedNotifications: {
    free: PLAN_LIMITS.free.advancedNotifications,
    plus: true,
    labelKey: "paywall.advancedNotifications"
  },
  households3: { free: PLAN_LIMITS.free.households >= 3, plus: true, labelKey: "paywall.upTo3Households" },
  members12: { free: PLAN_LIMITS.free.members >= 12, plus: true, labelKey: "paywall.upTo12Members" },
  tasksUnlimited: {
    free: PLAN_LIMITS.free.inProgressTasks === Number.POSITIVE_INFINITY,
    plus: true,
    labelKey: "paywall.unlimitedTasks"
  },
  ocr50: { free: PLAN_LIMITS.free.ocrPerMonth >= 50, plus: true, labelKey: "paywall.ocr50PerMonth" },
  auditRetention1095: {
    free: PLAN_LIMITS.free.auditRetentionDays >= 1095,
    plus: true,
    labelKey: "paywall.auditRetention3Years"
  }
};

export function canUse(feature: FeatureKey, plan: Plan): boolean {
  return PLAN_FEATURES[feature][isPlusPlan(plan) ? "plus" : "free"];
}

// 有效套餐：Plus 已过期则回退 free。
export function effectivePlan(household: Household): Plan {
  if (isPlusPlan(household.plusPlan) && household.plusUntil) {
    return new Date(household.plusUntil) >= new Date() ? household.plusPlan : "free";
  }
  return "free";
}

export function planLimits(household: Household): PlanLimits {
  return PLAN_LIMITS[effectivePlan(household)];
}

export function planLabel(plan: Plan): string {
  return plan === "free" ? "Free" : "Family Plus";
}

// ============ 配额校验（客户端 UX 预检；服务端 RPC 为最终权威）============

export function inProgressTaskCount(state: AppState): number {
  return state.tasks.filter((task) => task.status !== "completed").length;
}

export function ocrCountThisMonth(state: AppState): number {
  const now = new Date();
  return state.documents.filter((doc) => {
    if (doc.source !== "manual_upload") return false;
    const d = new Date(doc.uploadedAt);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;
}

export function memberCount(state: AppState): number {
  return state.members.length;
}

export interface QuotaCheck {
  ok: boolean;
  limit: number;
  used: number;
  plan: Plan;
}

export function checkTaskQuota(state: AppState): QuotaCheck {
  const plan = effectivePlan(state.household);
  const limit = PLAN_LIMITS[plan].inProgressTasks;
  const used = inProgressTaskCount(state);
  return { ok: used < limit, limit, used, plan };
}

export function checkMemberQuota(state: AppState): QuotaCheck {
  const plan = effectivePlan(state.household);
  const limit = PLAN_LIMITS[plan].members;
  const used = memberCount(state);
  return { ok: used < limit, limit, used, plan };
}

export function checkOcrQuota(state: AppState): QuotaCheck {
  const plan = effectivePlan(state.household);
  const limit = PLAN_LIMITS[plan].ocrPerMonth;
  const used = ocrCountThisMonth(state);
  return { ok: used < limit, limit, used, plan };
}

export function checkFileSize(sizeBytes: number): boolean {
  return sizeBytes <= MAX_FILE_SIZE_BYTES;
}
