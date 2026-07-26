import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Language } from "../i18n";

// Module-level cache so the cloud push notification handler can read the current
// language synchronously via getStoredLanguage(); LocalApp keeps it in sync via
// setStoredLanguage on every switch and seeds it from AsyncStorage on mount.
let currentLanguage: Language = "en";
const LANGUAGE_STORAGE_KEY = "taskkin-care.language";

export async function initStoredLanguage(): Promise<Language> {
  try {
    const stored = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === "en" || stored === "zh" || stored === "es") {
      currentLanguage = stored;
    }
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
