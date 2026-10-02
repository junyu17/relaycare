// Keychain 里的两样东西（都是 AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY，不随备份或快速开始迁移）：
//  ① 安装标记：首次启动写入。备份迁移来的新设备上它不存在，用来识别「换了手机」。
//  ② 匿名锚点 {userId, refreshToken}：只在匿名期间保存，删 app 重装后用它恢复会话；
//     绑定 Apple、主动退出、删号时清除。
// expo-secure-store 在 import 时就 requireNativeModule：原生模块没编进二进制时会让整个 bundle 白屏，
// 所以和 lib/uuid.ts 一样运行时动态 require + try/catch；不可用时所有操作都安全降级为空操作。
import type * as SecureStoreModule from "expo-secure-store";

export interface AnonymousAnchor {
  userId: string;
  refreshToken: string;
}

const INSTALL_MARKER_KEY = "taskkin-care.install-marker";
const ANCHOR_KEY = "taskkin-care.anonymous-anchor";

let cached: typeof SecureStoreModule | null | undefined;

function loadSecureStore(): typeof SecureStoreModule | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require("expo-secure-store") as typeof SecureStoreModule;
  } catch (e) {
    console.warn("expo-secure-store unavailable (build not synced?); anonymous recovery disabled:", e);
    cached = null;
  }
  return cached;
}

function options(store: typeof SecureStoreModule): SecureStoreModule.SecureStoreOptions {
  return { keychainAccessible: store.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
}

// 读不到 Keychain（模块缺失或读失败）时返回 null，调用方据此不做「新设备」判断。
export async function readInstallMarker(): Promise<boolean | null> {
  const store = loadSecureStore();
  if (!store) return null;
  try {
    return (await store.getItemAsync(INSTALL_MARKER_KEY, options(store))) != null;
  } catch {
    return null;
  }
}

export async function writeInstallMarker(): Promise<void> {
  const store = loadSecureStore();
  if (!store) return;
  try {
    await store.setItemAsync(INSTALL_MARKER_KEY, new Date().toISOString(), options(store));
  } catch {
    // best-effort
  }
}

export async function readAnonymousAnchor(): Promise<AnonymousAnchor | null> {
  const store = loadSecureStore();
  if (!store) return null;
  try {
    return parseAnchor(await store.getItemAsync(ANCHOR_KEY, options(store)));
  } catch {
    return null;
  }
}

export async function saveAnonymousAnchor(anchor: AnonymousAnchor): Promise<void> {
  const store = loadSecureStore();
  if (!store || !anchor.userId || !anchor.refreshToken) return;
  try {
    await store.setItemAsync(ANCHOR_KEY, JSON.stringify(anchor), options(store));
  } catch {
    // best-effort：写失败只影响重装后的自动恢复
  }
}

export async function clearAnonymousAnchor(): Promise<void> {
  const store = loadSecureStore();
  if (!store) return;
  try {
    await store.deleteItemAsync(ANCHOR_KEY, options(store));
  } catch {
    // best-effort
  }
}

export function parseAnchor(raw: string | null | undefined): AnonymousAnchor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AnonymousAnchor>;
    if (typeof parsed.userId === "string" && parsed.userId && typeof parsed.refreshToken === "string") {
      return parsed.refreshToken ? { userId: parsed.userId, refreshToken: parsed.refreshToken } : null;
    }
  } catch {
    // 损坏的值按没有处理
  }
  return null;
}

// 启动时：本地（AsyncStorage）没有会话、Keychain 里有匿名锚点 → 用锚点恢复（删 app 重装的情况）。
export function decideStartupRestore(hasSession: boolean, anchor: AnonymousAnchor | null): "restore" | "none" {
  if (hasSession) return "none";
  return anchor?.refreshToken ? "restore" : "none";
}

// 新设备判断。
// storageFlag 写在 AsyncStorage（会随备份迁移），keychainMarker 是 THIS_DEVICE_ONLY（不会迁移）。
// 两者同时为真才是「同一台设备」；AsyncStorage 有标志而 Keychain 没有标记 = 数据是从别的设备迁移来的。
// 两者都没有 = 全新安装，或从 1.9 升级（1.9 从没写过这两个标记），不能误判成新设备。
// keychainMarker 为 null 表示读不到 Keychain，不做判断。
export function detectMigratedDevice(args: {
  keychainMarker: boolean | null;
  storageFlag: boolean;
  sessionIsAnonymous: boolean;
}): boolean {
  if (args.keychainMarker === null) return false;
  return args.storageFlag && !args.keychainMarker && args.sessionIsAnonymous;
}
