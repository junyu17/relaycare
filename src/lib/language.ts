import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import type { Language } from "../i18n";

// Module-level cache so the cloud push notification handler can read the current
// language synchronously via getStoredLanguage(); LocalApp keeps it in sync via
// setStoredLanguage on every switch and seeds it from AsyncStorage on mount.
let currentLanguage: Language = "en";
const LANGUAGE_STORAGE_KEY = "taskkin-care.language";

/**
 * First launch has no stored choice. Falling back to English meant a user who
 * found the app through the Chinese or Spanish App Store listing opened it in
 * English and had to hunt for the language switch — so follow the device
 * instead, and only for that first launch.
 */
function deviceLanguage(): Language {
  try {
    for (const locale of getLocales()) {
      const code = (locale.languageCode ?? "").toLowerCase();
      if (code === "zh") return "zh";
      if (code === "es") return "es";
      if (code === "ja") return "ja";
      if (code === "en") return "en";
    }
  } catch {
    // best-effort
  }
  return "en";
}

export async function initStoredLanguage(): Promise<Language> {
  try {
    const stored = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === "en" || stored === "zh" || stored === "es" || stored === "ja") {
      currentLanguage = stored;
      return currentLanguage;
    }
    currentLanguage = deviceLanguage();
  } catch {
    // best-effort
  }
  return currentLanguage;
}

export function getStoredLanguage(): Language {
  return currentLanguage;
}

export async function setStoredLanguage(language: Language): Promise<void> {
  currentLanguage = language;
  try {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // best-effort
  }
}
