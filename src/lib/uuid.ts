// 幂等请求 id。
// 崩溃教训（2026-08-04）：
//  1) WebCrypto（Hermes 不提供）曾在调用处 throw → 创建即崩（已弃用）。
//  2) expo-crypto 的 JS 模块在 import 时顶层 requireNativeModule('ExpoCrypto') → 若原生模块未编入
//     二进制（pod install 未跑/构建未同步）→ import 即抛 → **整个 bundle 求值失败 → 启动白屏**。
// 因此这里用**运行时动态 require + try/catch**：原生模块缺失时降级为非加密 UUID（仅构建未同步的
// 临时状态，console.warn 提示重新构建）；正确构建后自动走 expo-crypto CSPRNG。
// 降级风险已评估：幂等键仍有 RLS 强制 requested_by_id = current_member_id()（跨用户预占需先
// 知道他人 uid，uid 本身不可预测）；且正确构建后此分支永不执行。

type CryptoLike = { randomUUID?: () => string };
let cached: CryptoLike | null | undefined;

function loadCrypto(): CryptoLike | null {
  if (cached !== undefined) return cached;
  try {
    // 动态 require：expo-crypto JS 模块顶层 requireNativeModule 在原生缺失时抛错 → 捕获降级。
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require("expo-crypto") as CryptoLike;
  } catch (e) {
    console.warn("ExpoCrypto native module unavailable (build not synced?), falling back to non-crypto UUID:", e);
    cached = null;
  }
  return cached;
}

export function newClientRequestId(): string {
  const c = loadCrypto();
  if (c?.randomUUID) {
    try {
      return c.randomUUID();
    } catch (e) {
      console.warn("ExpoCrypto.randomUUID failed, falling back:", e);
    }
  }
  // 降级：RFC4122 v4 形状（非加密随机，仅构建未同步时出现；正确构建后不执行）。
  const hex = (n: number) => [...Array(n)].map(() => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${"89ab"[Math.floor(Math.random() * 4)]}${hex(3)}-${hex(12)}`;
}
