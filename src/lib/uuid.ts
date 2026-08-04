// 幂等请求 id：CSPRNG（crypto.getRandomValues，Hermes/expo 运行时均可用）；
// 避免 Math.random（可预测，理论上可预占他人任务 id——security_review 残留已清零）。
export function newClientRequestId(): string {
  const c = globalThis.crypto as { randomUUID?: () => string; getRandomValues?: (arr: Uint8Array) => Uint8Array };
  if (c?.randomUUID) return c.randomUUID();
  if (c?.getRandomValues) {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // 无 WebCrypto 的环境（Expo/Hermes 均提供）属于配置错误：显式失败，绝不回退非加密随机。
  throw new Error("WebCrypto unavailable: cannot generate secure request id");
}
