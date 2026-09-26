import AsyncStorage from "@react-native-async-storage/async-storage";
import * as StoreReview from "expo-store-review";
import Constants from "expo-constants";

// App Store / Play 评分请求的时机控制。
//
// 系统自己有硬性节流（iOS 每 365 天最多真正展示 3 次），我们能控制的只是
// "什么时候开口问"。原则：只在用户刚完成一次有价值的操作之后问，绝不在启动时、
// 引导流程中或一次失败之后问。
const COUNT_KEY = "taskkin-care:review-value-moments";
const VERSION_KEY = "taskkin-care:review-prompted-version";

// 累计多少次价值时刻后才第一次开口。
//
// 1，不是 3。3 适合已经有用户的 App —— 稀缺的是系统每年 3 次的配额；
// 在这个装机量下几乎没有人累计到 3 次，于是弹窗基本没出现过。
// 第一次完成一件照护任务，就是这个 App 的承诺兑现的那一刻。
const MOMENTS_BEFORE_ASKING = 1;

function currentVersion(): string {
  return Constants.expoConfig?.version ?? "0";
}

/**
 * 记一次价值时刻，并在达到阈值、当前版本还没问过、且系统允许时请求评分。
 *
 * 永远不抛错：评分请求失败不该影响用户正在做的事。
 */
export async function recordValueMoment(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(COUNT_KEY);
    const count = (Number.parseInt(raw ?? "0", 10) || 0) + 1;
    await AsyncStorage.setItem(COUNT_KEY, String(count));
    if (count < MOMENTS_BEFORE_ASKING) return;

    const version = currentVersion();
    // 按版本去重：同一个版本只问一次，升级后重新有机会。
    if ((await AsyncStorage.getItem(VERSION_KEY)) === version) return;

    if (!(await StoreReview.hasAction())) return;
    await AsyncStorage.setItem(VERSION_KEY, version);
    await StoreReview.requestReview();
  } catch {
    // 忽略：评分请求是锦上添花，不能影响主流程。
  }
}

/** 供测试与"删除账号 / 清除数据"复位使用。 */
export async function resetReviewPrompter(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([COUNT_KEY, VERSION_KEY]);
  } catch {
    // 忽略
  }
}
