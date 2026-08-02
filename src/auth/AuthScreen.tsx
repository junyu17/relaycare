import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform
} from "react-native";
import { useAuth } from "./AuthContext";
import { QRScanner } from "../components/QRScanner";
import { initStoredLanguage, setStoredLanguage } from "../lib/language";
import { languageOptions, makeTranslator, type Language } from "../i18n";

// 未登录：登录 / 注册 / 重置 / 用 6 位码加入（匿名）
export function AuthScreen() {
  const { signIn, signUp, resetPassword, joinByCode, pendingJoinCode, clearPendingJoinCode } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup" | "reset" | "join">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [language, setLanguage] = useState<Language>("en");
  const t = makeTranslator(language);

  useEffect(() => {
    void initStoredLanguage().then((lng) => setLanguage(lng));
  }, []);

  useEffect(() => {
    if (!pendingJoinCode) return;
    // Sync join code from deep link (taskkin-care://join?code=XXXXXX).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setJoinCode(pendingJoinCode);
    setMode("join");
  }, [pendingJoinCode]);

  const submit = async () => {
    if (busy) return;
    if (mode === "reset") {
      if (!email) return;
      setBusy(true);
      try {
        await resetPassword(email);
        Alert.alert(t("auth.checkEmail"), t("auth.resetSentMsg"));
        setMode("signin");
      } catch (e) {
        Alert.alert(t("auth.error"), e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (mode === "join") {
      if (!/^\d{6}$/.test(joinCode)) {
        Alert.alert(t("auth.invalidCode"), t("auth.invalidCodeMsg"));
        return;
      }
      if (!displayName.trim()) {
        Alert.alert(t("auth.nameRequired"), t("auth.nameRequiredMsg"));
        return;
      }
      setBusy(true);
      try {
        await joinByCode(joinCode, displayName.trim() || undefined);
        clearPendingJoinCode();
      } catch (e) {
        Alert.alert(t("auth.error"), e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!email || !password) return;
    setBusy(true);
    try {
      if (mode === "signin") {
        await signIn(email, password);
      } else {
        const { signedIn } = await signUp(email, password);
        if (!signedIn) {
          Alert.alert(t("auth.checkEmail"), t("auth.confirmEmailMsg"));
          setMode("signin");
        }
      }
    } catch (e) {
      Alert.alert(t("auth.error"), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitLabel = busy
    ? "..."
    : mode === "signin"
      ? t("auth.tabSignIn")
      : mode === "signup"
        ? t("auth.titleSignUp")
        : mode === "reset"
          ? t("auth.titleReset")
          : t("auth.titleJoin");

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      style={{ flex: 1 }}
    >
      <ScrollView
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={s.container}
      >
        <Text style={s.title}>TaskKin Care</Text>
        <Text style={s.subtitle}>{t("auth.subtitle")}</Text>
        <View style={s.languageRow}>
          {languageOptions.map((opt) => (
            <TouchableOpacity
              key={opt.code}
              style={[s.langBtn, language === opt.code && s.langBtnActive]}
              onPress={() => {
                setLanguage(opt.code);
                void setStoredLanguage(opt.code);
              }}
            >
              <Text style={language === opt.code ? s.langTextActive : s.langText}>{opt.shortLabel}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {mode !== "reset" && mode !== "join" && (
          <View style={s.tabs}>
            <TouchableOpacity style={[s.tab, mode === "signin" && s.tabActive]} onPress={() => setMode("signin")}>
              <Text style={mode === "signin" ? s.tabTextActive : s.tabText}>{t("auth.tabSignIn")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.tab, mode === "signup" && s.tabActive]} onPress={() => setMode("signup")}>
              <Text style={mode === "signup" ? s.tabTextActive : s.tabText}>{t("auth.tabSignUp")}</Text>
            </TouchableOpacity>
          </View>
        )}

        {mode === "join" ? (
          <>
            <Text style={s.hint}>{t("auth.joinHint2")}</Text>
            <TextInput
              style={s.input}
              placeholder={t("auth.codePlaceholder")}
              value={joinCode}
              onChangeText={(v) => setJoinCode(v.replace(/\D/g, "").slice(0, 6))}
              keyboardType="number-pad"
              autoCapitalize="none"
            />
            <TouchableOpacity style={s.scanBtn} onPress={() => setScannerVisible(true)}>
              <Text style={s.scanBtnText}>{t("join.scanQR")}</Text>
            </TouchableOpacity>
            <TextInput
              style={s.input}
              placeholder={t("auth.name")}
              value={displayName}
              onChangeText={setDisplayName}
            />
          </>
        ) : (
          <>
            <TextInput
              style={s.input}
              placeholder={t("auth.email")}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            {mode !== "reset" && (
              <TextInput
                style={s.input}
                placeholder={t("auth.password")}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />
            )}
            {mode === "signup" && <Text style={s.hint}>{t("auth.passwordHint")}</Text>}
          </>
        )}

        <TouchableOpacity style={s.button} onPress={submit} disabled={busy}>
          <Text style={s.buttonText}>{submitLabel}</Text>
        </TouchableOpacity>

        {mode === "signin" && (
          <>
            <TouchableOpacity onPress={() => setMode("reset")}>
              <Text style={s.link}>{t("auth.forgotPassword")}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setMode("join")}>
              <Text style={s.link}>{t("auth.joinFamily")}</Text>
            </TouchableOpacity>
          </>
        )}
        {mode === "reset" && (
          <TouchableOpacity onPress={() => setMode("signin")}>
            <Text style={s.link}>{t("auth.backToSignIn")}</Text>
          </TouchableOpacity>
        )}
        {mode === "join" && (
          <TouchableOpacity onPress={() => setMode("signin")}>
            <Text style={s.link}>{t("auth.coordinatorLink")}</Text>
          </TouchableOpacity>
        )}
        <Text style={s.hint}>
          {mode === "signup"
            ? t("auth.afterSignup")
            : mode === "reset"
              ? t("auth.resetHint")
              : mode === "join"
                ? t("auth.joinHint")
                : ""}
        </Text>
        <QRScanner
          visible={scannerVisible}
          onClose={() => setScannerVisible(false)}
          onCode={(code) => {
            setJoinCode(code);
            setScannerVisible(false);
          }}
          t={t}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// 已登录但还没家庭：创建家庭（协调人）/ 用 6 位码加入
export function OnboardingScreen() {
  const { createHousehold, joinByCode, signOut } = useAuth();
  const [language, setLanguage] = useState<Language>("en");
  const t = makeTranslator(language);
  const [tab, setTab] = useState<"create" | "join">("create");

  useEffect(() => {
    void initStoredLanguage().then((lng) => setLanguage(lng));
  }, []);
  const [householdName, setHouseholdName] = useState("");
  const [memberName, setMemberName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);

  const onCreate = async () => {
    if (!householdName || !memberName) return;
    setBusy(true);
    try {
      await createHousehold({
        householdName,
        timezone: "America/Los_Angeles",
        careRecipientLabel: t("auth.careRecipient"),
        memberName,
        memberRelation: "",
        memberTimezone: "America/Los_Angeles"
      });
    } catch (e) {
      Alert.alert(t("auth.error"), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onJoin = async () => {
    if (!/^\d{6}$/.test(joinCode)) {
      Alert.alert(t("auth.invalidCode"), t("auth.invalidCodeMsg"));
      return;
    }
    if (!memberName.trim()) {
      Alert.alert(t("auth.nameRequired"), t("auth.nameRequiredMsg"));
      return;
    }
    setBusy(true);
    try {
      await joinByCode(joinCode, memberName.trim() || undefined);
    } catch (e) {
      Alert.alert(t("auth.error"), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      style={{ flex: 1 }}
    >
      <ScrollView
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={s.container}
      >
        <Text style={s.title}>{t("auth.onboardingTitle")}</Text>
        <View style={s.tabs}>
          <TouchableOpacity style={[s.tab, tab === "create" && s.tabActive]} onPress={() => setTab("create")}>
            <Text style={tab === "create" ? s.tabTextActive : s.tabText}>{t("auth.tabCreate")}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.tab, tab === "join" && s.tabActive]} onPress={() => setTab("join")}>
            <Text style={tab === "join" ? s.tabTextActive : s.tabText}>{t("auth.tabJoin")}</Text>
          </TouchableOpacity>
        </View>
        <View style={s.languageRow}>
          {languageOptions.map((opt) => (
            <TouchableOpacity
              key={opt.code}
              style={[s.langBtn, language === opt.code && s.langBtnActive]}
              onPress={() => {
                setLanguage(opt.code);
                void setStoredLanguage(opt.code);
              }}
            >
              <Text style={language === opt.code ? s.langTextActive : s.langText}>{opt.shortLabel}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {tab === "create" ? (
          <>
            <TextInput
              style={s.input}
              placeholder={t("households.namePlaceholder")}
              value={householdName}
              onChangeText={setHouseholdName}
            />
            <TextInput style={s.input} placeholder={t("auth.yourName")} value={memberName} onChangeText={setMemberName} />
            <Text style={s.hint}>{t("auth.coordinatorHint")}</Text>
            <TouchableOpacity style={s.button} onPress={onCreate} disabled={busy}>
              <Text style={s.buttonText}>{busy ? "..." : t("households.create")}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={s.hint}>{t("auth.joinHint3")}</Text>
            <TextInput
              style={s.input}
              placeholder={t("auth.codePlaceholder")}
              value={joinCode}
              onChangeText={(v) => setJoinCode(v.replace(/\D/g, "").slice(0, 6))}
              keyboardType="number-pad"
              autoCapitalize="none"
            />
            <TextInput
              style={s.input}
              placeholder={t("auth.name")}
              value={memberName}
              onChangeText={setMemberName}
            />
            <TouchableOpacity style={s.button} onPress={onJoin} disabled={busy}>
              <Text style={s.buttonText}>{busy ? "..." : t("auth.titleJoin")}</Text>
            </TouchableOpacity>
          </>
        )}
        <TouchableOpacity onPress={signOut}>
          <Text style={s.link}>{t("auth.signOut")}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    padding: 20,
    paddingTop: 28,
    paddingBottom: 72,
    justifyContent: "center",
    backgroundColor: "#f7faf7"
  },
  title: { alignSelf: "stretch", flexShrink: 1, fontSize: 30, fontWeight: "700", color: "#0f766e", marginBottom: 4 },
  subtitle: { alignSelf: "stretch", flexShrink: 1, fontSize: 16, color: "#64748b", marginBottom: 18 },
  tabs: {
    alignSelf: "stretch",
    flexDirection: "row",
    marginBottom: 14,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#e2e8f0"
  },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabActive: { backgroundColor: "#0f766e" },
  tabText: { color: "#475569", fontSize: 16 },
  tabTextActive: { color: "#fff", fontWeight: "600", fontSize: 16 },
  input: {
    alignSelf: "stretch",
    width: "100%",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 12,
    fontSize: 17,
    backgroundColor: "#fff"
  },
  button: {
    alignSelf: "stretch",
    width: "100%",
    backgroundColor: "#0f766e",
    paddingVertical: 15,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 6
  },
  buttonText: { color: "#fff", fontWeight: "600", fontSize: 17 },
  hint: { fontSize: 13, color: "#64748b", marginTop: 8 },
  link: { color: "#0f766e", marginTop: 14, textAlign: "center", fontSize: 15 },
  scanBtn: {
    alignSelf: "stretch",
    borderWidth: 1,
    borderColor: "#0f766e",
    paddingVertical: 13,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 4
  },
  scanBtnText: { color: "#0f766e", fontWeight: "700", fontSize: 16 },
languageRow: { flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 12 },
  langBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, backgroundColor: "#e2e8f0" },
  langBtnActive: { backgroundColor: "#0f766e" },
  langText: { color: "#334155", fontWeight: "600" },
  langTextActive: { color: "#ffffff", fontWeight: "700" },
});
