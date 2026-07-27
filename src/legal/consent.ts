import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Linking from "expo-linking";
import type { Language } from "../i18n";

// ============ 同意状态持久化 ============
// 首次启动需同意隐私政策 + 服务条款后才可使用；版本号便于将来政策重大变更后重新征求同意。
const CONSENT_KEY = "taskkin-care:consent:v1";

export async function getConsent(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(CONSENT_KEY)) === "true";
  } catch {
    return false;
  }
}

export async function setConsent(): Promise<void> {
  await AsyncStorage.setItem(CONSENT_KEY, "true");
}

// ============ 公开法律页 URL ============
// 部署在 GitHub Pages（见 .github/workflows/deploy-pages.yml）。
const PUBLIC_SITE_BASE = "https://junyu17.github.io/relaycare";

const languageFileSuffix: Record<Language, string> = {
  en: "",
  zh: "-zh",
  es: "-es"
};

export function legalUrl(kind: "privacy" | "terms", language: Language): string {
  const base = kind === "privacy" ? "privacy" : "terms";
  return `${PUBLIC_SITE_BASE}/${base}${languageFileSuffix[language]}.html`;
}

export async function openLegal(kind: "privacy" | "terms", language: Language): Promise<void> {
  const url = legalUrl(kind, language);
  try {
    await Linking.openURL(url);
  } catch {
    // 设备无可用浏览器时静默失败；UI 已提供 URL 文本回退。
  }
}
