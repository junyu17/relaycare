// R2（B4，IOS_SUBMISSION_REVIEW_R2）：摘要通知队列——静默/摘要模式下累积非 critical 通知，
// 静默结束后一次性投递汇总（AsyncStorage，key taskkin-care:digest-queue）。
import AsyncStorage from "@react-native-async-storage/async-storage";
import { isWithinQuietHours, type NotificationPref } from "./notify";

const QUEUE_KEY = "taskkin-care:digest-queue";

export interface QueuedDigest {
  title: string;
  body: string;
  queuedAt: string;
}

export async function enqueueDigestNotification(item: { title: string; body: string }): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const list: QueuedDigest[] = raw ? (JSON.parse(raw) as QueuedDigest[]) : [];
    list.push({ ...item, queuedAt: new Date().toISOString() });
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(list));
  } catch {
    // best-effort
  }
}

// 若当前不处于静默时段则冲刷队列（返回是否投递了汇总）；处于静默时段则保留。
export async function flushDigestQueue(
  pref: NotificationPref,
  now: Date
): Promise<{ delivered: boolean; count: number } | null> {
  try {
    if (isWithinQuietHours(now, pref)) return null; // 仍在静默，保留
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return { delivered: false, count: 0 };
    const list: QueuedDigest[] = JSON.parse(raw) as QueuedDigest[];
    if (list.length === 0) return { delivered: false, count: 0 };
    await AsyncStorage.setItem(QUEUE_KEY, "[]");
    return { delivered: true, count: list.length };
  } catch {
    return null;
  }
}

export async function getDigestQueueCount(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedDigest[]).length : 0;
  } catch {
    return 0;
  }
}
