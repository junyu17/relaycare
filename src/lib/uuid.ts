// 幂等请求 id：CSPRNG via expo-crypto（原生模块，Hermes 可用；WebCrypto 在 Hermes 不存在——
// 曾用 globalThis.crypto 导致真机/模拟器点击创建即崩溃，已改原生实现）。
import * as Crypto from "expo-crypto";

export function newClientRequestId(): string {
  return Crypto.randomUUID();
}
