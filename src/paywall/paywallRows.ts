// 付费墙对照表（抽纯模块供一致性测试；与 entitlement.PLAN_FEATURES 双向绑定）
import type { FeatureKey } from "../lib/entitlement";

export interface Row {
  labelKey: string;
  free: string;
  plus: string;
  backedBy?: FeatureKey;
}

export const ROWS: Row[] = [
  { labelKey: "paywall.row.households", free: "1", plus: "3", backedBy: "households3" },
  { labelKey: "paywall.row.members", free: "3", plus: "12", backedBy: "members12" },
  { labelKey: "paywall.row.tasks", free: "10", plus: "∞", backedBy: "tasksUnlimited" },
  { labelKey: "paywall.row.storage", free: "25 MB", plus: "25 MB" },
  { labelKey: "paywall.row.report", free: "reportManual", plus: "reportAuto", backedBy: "weeklyReportAuto" },
  { labelKey: "paywall.row.ocr", free: "1", plus: "50", backedBy: "ocr50" },
  { labelKey: "paywall.row.audit", free: "30 days", plus: "3 years", backedBy: "auditRetention1095" },
  { labelKey: "paywall.row.export", free: "none", plus: "PDF/CSV", backedBy: "export" },
  { labelKey: "paywall.row.notifications", free: "none", plus: "✓", backedBy: "advancedNotifications" }
];

export function rowValue(value: string, t: (key: string) => string): string {
  if (value === "reportManual") return t("paywall.value.reportManual");
  if (value === "reportAuto") return t("paywall.value.reportAuto");
  if (value === "none") return t("paywall.value.none");
  return value;
}
