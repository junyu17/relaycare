// Sign in with Apple（原生）。
// nonce：原始值交给 Supabase（signInWithIdToken / linkIdentity），SHA-256 十六进制值交给 Apple；
// GoTrue 会对原始值做 SHA-256 再和 id_token 里的 nonce 比对（skip_nonce_check 保持 false）。
// requestedScopes 为空：不向 Apple 要邮箱和姓名（服务端开了 email_optional）。
// 原生模块按 lib/uuid.ts 的做法运行时动态 require，二进制里没有时不会让 bundle 白屏。
import { Platform } from "react-native";
import type * as AppleAuthenticationModule from "expo-apple-authentication";
import { isAppleCancelError } from "./guards";

type CryptoLike = {
  randomUUID: () => string;
  digestStringAsync: (algorithm: string, data: string) => Promise<string>;
  CryptoDigestAlgorithm: { SHA256: string };
};

export interface AppleCredential {
  identityToken: string;
  rawNonce: string;
  authorizationCode: string | null;
}

let appleModule: typeof AppleAuthenticationModule | null | undefined;
let cryptoModule: CryptoLike | null | undefined;

export function loadAppleAuthentication(): typeof AppleAuthenticationModule | null {
  if (appleModule !== undefined) return appleModule;
  if (Platform.OS !== "ios") {
    appleModule = null;
    return appleModule;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    appleModule = require("expo-apple-authentication") as typeof AppleAuthenticationModule;
  } catch (e) {
    console.warn("expo-apple-authentication unavailable (build not synced?):", e);
    appleModule = null;
  }
  return appleModule;
}

function loadCrypto(): CryptoLike | null {
  if (cryptoModule !== undefined) return cryptoModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cryptoModule = require("expo-crypto") as CryptoLike;
  } catch (e) {
    console.warn("expo-crypto unavailable; Sign in with Apple disabled:", e);
    cryptoModule = null;
  }
  return cryptoModule;
}

// Android，或者 iOS 上 isAvailableAsync() 为 false：欢迎页只显示「我有家庭码」和「用邮箱登录」。
export async function isAppleAvailable(): Promise<boolean> {
  const apple = loadAppleAuthentication();
  if (!apple || !loadCrypto()) return false;
  try {
    return await apple.isAvailableAsync();
  } catch {
    return false;
  }
}

// 弹出 Apple 授权。用户取消返回 null（静默）；其他失败抛错。
export async function getAppleCredential(): Promise<AppleCredential | null> {
  const apple = loadAppleAuthentication();
  const crypto = loadCrypto();
  if (!apple || !crypto) throw new Error("Sign in with Apple is not available on this device.");
  const rawNonce = crypto.randomUUID();
  const hashedNonce = await crypto.digestStringAsync(crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
  try {
    const credential = await apple.signInAsync({ requestedScopes: [], nonce: hashedNonce });
    if (!credential.identityToken) throw new Error("Apple did not return an identity token.");
    return {
      identityToken: credential.identityToken,
      rawNonce,
      authorizationCode: credential.authorizationCode ?? null
    };
  } catch (e) {
    if (isAppleCancelError(e)) return null;
    throw e;
  }
}
