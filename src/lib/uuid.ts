// 幂等请求 id：优先原生 crypto.randomUUID（Hermes 支持），fallback RFC4122 v4 随机。
export function newClientRequestId(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (c?.randomUUID) return c.randomUUID();
  const hex = (n: number) => [...Array(n)].map(() => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${"89ab"[Math.floor(Math.random() * 4)]}${hex(3)}-${hex(12)}`;
}
