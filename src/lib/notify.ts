// 通知投递决策纯模块（R5，IOS_SUBMISSION_DEV_SPEC）：静默时段抑制 + 摘要累积。
// 服务端不会下发"投递时间"——客户端在收到通知时用当前时间决策（AC5-3/AC5-4）。

export interface NotificationPref {
  quietHoursStart: string; // "HH:MM" 24h
  quietHoursEnd: string; // "HH:MM" 24h
  taskDigest: boolean;
}

export const DEFAULT_PREF: NotificationPref = {
  quietHoursStart: "22:00",
  quietHoursEnd: "07:00",
  taskDigest: true
};

// 将 HH:MM 转为当日分钟数（00:00 = 0, 23:59 = 1439）
export function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h * 60 + m) % (24 * 60);
}

// 是否处于静默时段；支持跨零点区间（如 22:00–07:00）。
// 边界语义：静默时段含 start、不含 end（[start, end)），与常见"静默到 07:00 为止"一致。
export function isWithinQuietHours(now: Date, pref: NotificationPref): boolean {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const start = minutesOfDay(pref.quietHoursStart);
  const end = minutesOfDay(pref.quietHoursEnd);
  if (start === end) return false; // 00:00–00:00 = 无静默
  if (start < end) {
    return nowMin >= start && nowMin < end;
  }
  // 跨零点：现在 ≥ start 或 < end
  return nowMin >= start || nowMin < end;
}

// 是否应即时投递（而非抑制/累积）。
// critical：始终投递；非 critical：静默时段抑制；taskDigest 打开时非 critical 一律累积。
export function shouldDeliverNow(severity: "critical" | "info", pref: NotificationPref, now: Date): boolean {
  if (severity === "critical") return true;
  if (pref.taskDigest) return false; // 摘要模式：非 critical 累积
  return !isWithinQuietHours(now, pref);
}
