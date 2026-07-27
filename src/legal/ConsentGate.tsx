import { useEffect, useMemo, useState, type ReactNode } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getConsent, setConsent, openLegal } from "./consent";
import { makeTranslator, type Language } from "../i18n";
import { initStoredLanguage, setStoredLanguage } from "../lib/language";

// 首次启动同意门：未同意前阻断使用 app；同意后渲染 children。
// Privacy / Terms 链接打开部署在 GitHub Pages 的公开页面。
export function ConsentGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<"loading" | "needed" | "granted">("loading");
  const [language, setLanguage] = useState<Language>("en");
  const t = useMemo(() => makeTranslator(language), [language]);

  useEffect(() => {
    void initStoredLanguage().then((lng) => setLanguage(lng));
    void getConsent().then((ok) => setStatus(ok ? "granted" : "needed"));
  }, []);

  const agree = async () => {
    await setConsent();
    setStatus("granted");
  };

  const decline = () => {
    Alert.alert(t("consent.declinedTitle"), t("consent.declinedBody"));
  };

  const switchLanguage = (lng: Language) => {
    setLanguage(lng);
    void setStoredLanguage(lng);
  };

  if (status === "loading") {
    return (
      <View style={s.center}>
        <Text>TaskKin Care</Text>
      </View>
    );
  }

  if (status === "granted") {
    return <>{children}</>;
  }

  return (
    <ScrollView contentContainerStyle={s.container}>
      <View style={s.brand}>
        <Ionicons name="shield-checkmark-outline" size={40} color="#0f766e" />
      </View>
      <Text style={s.title}>{t("consent.title")}</Text>
      <Text style={s.body}>{t("consent.body")}</Text>
      <View style={s.languageRow}>
        {(["en", "zh", "es"] as Language[]).map((lng) => (
          <TouchableOpacity
            key={lng}
            style={[s.langBtn, language === lng && s.langBtnActive]}
            onPress={() => switchLanguage(lng)}
          >
            <Text style={language === lng ? s.langTextActive : s.langText}>{lng.toUpperCase()}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity style={s.link} onPress={() => void openLegal("privacy", language)}>
        <Ionicons name="shield-outline" size={16} color="#0f766e" />
        <Text style={s.linkText}>{t("consent.privacy")}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.link} onPress={() => void openLegal("terms", language)}>
        <Ionicons name="document-text-outline" size={16} color="#0f766e" />
        <Text style={s.linkText}>{t("consent.terms")}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.agreeBtn} onPress={agree}>
        <Text style={s.agreeText}>{t("consent.agree")}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={decline}>
        <Text style={s.declineText}>{t("consent.decline")}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#f7faf7" },
  container: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 28,
    backgroundColor: "#f7faf7"
  },
  brand: {
    width: 72,
    height: 72,
    borderRadius: 16,
    backgroundColor: "#e5f3ef",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18
  },
  title: { fontSize: 24, fontWeight: "800", color: "#0f766e", marginBottom: 12, textAlign: "center" },
  body: { fontSize: 14, color: "#334155", lineHeight: 20, textAlign: "center", marginBottom: 20 },
  languageRow: { flexDirection: "row", gap: 8, marginBottom: 18 },
  langBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#fff"
  },
  langBtnActive: { backgroundColor: "#0f766e", borderColor: "#0f766e" },
  langText: { color: "#475569", fontWeight: "700" },
  langTextActive: { color: "#fff", fontWeight: "700" },
  link: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8 },
  linkText: { color: "#0f766e", fontSize: 14, fontWeight: "600" },
  agreeBtn: {
    backgroundColor: "#0f766e",
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 10,
    marginTop: 14,
    width: "100%",
    alignItems: "center"
  },
  agreeText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  declineText: { color: "#64748b", marginTop: 14, fontSize: 14 }
});
