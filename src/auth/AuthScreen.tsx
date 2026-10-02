import { errorMessage, localizedErrorMessage } from "../lib/error";
import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  AppState as RNAppState
} from "react-native";
import { ACCOUNT_GONE_HINT, useAuth } from "./AuthContext";
import { QRScanner } from "../components/QRScanner";
import { initStoredLanguage, setStoredLanguage } from "../lib/language";
import { languageOptions, makeTranslator, type Language, type Translate } from "../i18n";
import { joinStatusMessageKey, pendingOutcomeAlertKey, type JoinStatus } from "../lib/joinV2";
import { AppleButton } from "./AppleButton";
import { BindAppleSheet } from "./BindAppleSheet";
import { promptSignOut, runBindFlow, runDeleteAccountFlow } from "./accountFlows";

type AuthMode = "welcome" | "signin" | "signup" | "reset" | "join";

// 加入结果的提示：joined 直接进入家庭，pending 进入等待页，其余按状态显示本地化文案。
// already_pending 是提示而不是错误：说明已有申请在等，然后回到那条申请的等待页。
function alertJoinStatus(status: JoinStatus, t: Translate) {
  const key = joinStatusMessageKey(status);
  if (!key) return;
  Alert.alert(status === "already_pending" ? t("join.pendingTitle") : t("auth.error"), t(key));
}

// 账号在服务端已不存在时 AuthContext 已经登出，欢迎页会说明原因：这里不再弹一次错误。
function alertActionError(e: unknown, t: Translate) {
  if ((e as { hint?: unknown } | null)?.hint === ACCOUNT_GONE_HINT) return;
  Alert.alert(t("auth.error"), localizedErrorMessage(e, t));
}

// 未登录：欢迎页（开始使用 / 用 Apple 继续 / 我有家庭码 / 用邮箱登录）+ 邮箱登录、注册、重置 + 用 6 位码加入。
// Android，或者 Apple 登录不可用的设备，只显示「我有家庭码」和「用邮箱登录」。
export function AuthScreen() {
  const {
    signIn,
    signUp,
    resetPassword,
    joinByCode,
    startAnonymously,
    continueWithApple,
    appleAvailable,
    pendingJoinCode,
    clearPendingJoinCode,
    accountGone,
    clearAccountGone
  } = useAuth();
  const [mode, setMode] = useState<AuthMode>("welcome");
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

  // 账号在服务端已不存在（例如另一台设备把同一个 Apple ID 绑到了别的账号上）：说明为什么回到了欢迎页。
  useEffect(() => {
    if (!accountGone) return;
    clearAccountGone();
    void initStoredLanguage().then((lng) => {
      const tr = makeTranslator(lng);
      Alert.alert(tr("auth.accountGoneTitle"), tr("auth.accountGone"));
    });
  }, [accountGone, clearAccountGone]);

  useEffect(() => {
    if (!pendingJoinCode) return;
    // Sync join code from deep link (taskkin-care://join?code=XXXXXX).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setJoinCode(pendingJoinCode);
    setMode("join");
  }, [pendingJoinCode]);

  const onStart = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await startAnonymously();
    } catch (e) {
      Alert.alert(t("auth.error"), localizedErrorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };

  const onContinueWithApple = async () => {
    try {
      await continueWithApple();
    } catch (e) {
      Alert.alert(t("auth.error"), localizedErrorMessage(e, t));
    }
  };

  const submit = async () => {
    if (busy) return;
    if (mode === "reset") {
      if (!email) {
        Alert.alert(t("auth.error"), t("auth.requiredFields"));
        return;
      }
      setBusy(true);
      try {
        await resetPassword(email);
        Alert.alert(t("auth.checkEmail"), t("auth.resetSentMsg"));
        setMode("signin");
      } catch (e) {
        Alert.alert(t("auth.error"), errorMessage(e));
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
        const status = await joinByCode(joinCode, displayName.trim() || undefined);
        if (status === "joined") clearPendingJoinCode();
        alertJoinStatus(status, t);
      } catch (e) {
        alertActionError(e, t);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!email || !password) {
      Alert.alert(t("auth.error"), t("auth.requiredFields"));
      return;
    }
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
      Alert.alert(t("auth.error"), localizedErrorMessage(e, t));
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

  const languageRow = (
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
  );

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
        {languageRow}

        {mode === "welcome" ? (
          <>
            <Text style={s.welcomeBody}>{t("auth.welcomeBody")}</Text>
            {appleAvailable && (
              <>
                <TouchableOpacity
                  style={s.button}
                  accessibilityRole="button"
                  accessibilityLabel={t("auth.startNoAccount")}
                  onPress={onStart}
                  disabled={busy}
                >
                  {busy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={s.buttonText}>{t("auth.startNoAccount")}</Text>
                  )}
                </TouchableOpacity>
                <Text style={s.hint}>{t("auth.welcomeHint")}</Text>
                <AppleButton
                  kind="continue"
                  accessibilityLabel={t("auth.continueWithApple")}
                  onPress={onContinueWithApple}
                />
              </>
            )}
            <TouchableOpacity
              style={s.secondaryBtn}
              accessibilityRole="button"
              accessibilityLabel={t("auth.joinFamily")}
              onPress={() => setMode("join")}
            >
              <Text style={s.secondaryBtnText}>{t("auth.joinFamily")}</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" onPress={() => setMode("signin")}>
              <Text style={s.link}>{t("auth.signInWithEmail")}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
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
              <TouchableOpacity onPress={() => setMode("reset")}>
                <Text style={s.link}>{t("auth.forgotPassword")}</Text>
              </TouchableOpacity>
            )}
            {mode === "reset" && (
              <TouchableOpacity onPress={() => setMode("signin")}>
                <Text style={s.link}>{t("auth.backToSignIn")}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => setMode("welcome")}>
              <Text style={s.link}>{mode === "join" ? t("auth.coordinatorLink") : t("auth.backToWelcome")}</Text>
            </TouchableOpacity>
            <Text style={s.hint}>
              {mode === "signup"
                ? t("auth.afterSignup")
                : mode === "reset"
                  ? t("auth.resetHint")
                  : mode === "join"
                    ? t("auth.joinHint")
                    : ""}
            </Text>
          </>
        )}
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

// 熔断期的加入申请：等待协调人同意。每 5 秒、每次回到前台查询一次。
// 被拒绝或过期时先弹提示，再清掉等待状态（AuthContext 不会抢先清，否则这个面板会在提示之前卸载）。
function JoinPendingPanel({ t }: { t: Translate }) {
  const { checkPendingJoinRequest, dismissPendingJoinRequest } = useAuth();
  const checkRef = useRef(checkPendingJoinRequest);
  const dismissRef = useRef(dismissPendingJoinRequest);
  useEffect(() => {
    checkRef.current = checkPendingJoinRequest;
    dismissRef.current = dismissPendingJoinRequest;
  });

  useEffect(() => {
    let stopped = false;
    let inFlight = false;
    const check = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        const outcome = await checkRef.current();
        if (stopped) return;
        const alertKey = pendingOutcomeAlertKey(outcome);
        if (alertKey) {
          // 先停掉轮询：清状态之后、面板卸载之前的那一次查询不能再弹一遍。
          stopped = true;
          Alert.alert(t("join.pendingTitle"), t(alertKey));
          dismissRef.current();
        }
      } finally {
        inFlight = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), 5000);
    const sub = RNAppState.addEventListener("change", (next) => {
      if (next === "active") void check();
    });
    return () => {
      stopped = true;
      clearInterval(timer);
      sub.remove();
    };
  }, [t]);

  return (
    <View style={s.pendingPanel}>
      <Text style={s.pendingTitle}>{t("join.pendingTitle")}</Text>
      <Text style={s.pendingBody}>{t("join.pendingBody")}</Text>
      <View style={s.pendingRow}>
        <ActivityIndicator color="#0f766e" />
        <Text style={s.hint}>{t("join.pendingWaiting")}</Text>
      </View>
      <TouchableOpacity accessibilityRole="button" onPress={dismissPendingJoinRequest}>
        <Text style={s.link}>{t("join.pendingNewCode")}</Text>
      </TouchableOpacity>
    </View>
  );
}

// 已登录但还没家庭：创建家庭（协调人）/ 用 6 位码加入。
// 有 pendingJoinCode（深链或回填的码）时默认打开「加入」页并预填。
export function OnboardingScreen() {
  const {
    user,
    createHousehold,
    joinByCode,
    requestSignOut,
    signOut,
    deleteAccount,
    bindApple,
    isAnonymous,
    hasAppleIdentity,
    appleAvailable,
    householdsError,
    retryHouseholds,
    pendingJoinCode,
    clearPendingJoinCode,
    pendingJoinRequest
  } = useAuth();
  const [language, setLanguage] = useState<Language>("en");
  const t = makeTranslator(language);
  const [tab, setTab] = useState<"create" | "join">(pendingJoinCode ? "join" : "create");

  useEffect(() => {
    void initStoredLanguage().then((lng) => setLanguage(lng));
  }, []);
  const [householdName, setHouseholdName] = useState("");
  const [memberName, setMemberName] = useState("");
  const [joinCode, setJoinCode] = useState(pendingJoinCode ?? "");
  const [busy, setBusy] = useState(false);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [protectVisible, setProtectVisible] = useState(false);

  useEffect(() => {
    if (!pendingJoinCode) return;
    // 深链、欢迎页「我有家庭码」或「码无效」回填：切到「加入」页并预填，然后消费掉，
    // 免得以后（例如退出所有家庭回到这里时）又带出一个旧码。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setJoinCode(pendingJoinCode);
    setTab("join");
    clearPendingJoinCode();
  }, [pendingJoinCode, clearPendingJoinCode]);

  const onCreate = async () => {
    if (!householdName || !memberName) {
      Alert.alert(t("auth.error"), t("auth.requiredFields"));
      return;
    }
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
      alertActionError(e, t);
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
      const status = await joinByCode(joinCode, memberName.trim() || undefined);
      if (status === "joined") clearPendingJoinCode();
      alertJoinStatus(status, t);
    } catch (e) {
      alertActionError(e, t);
    } finally {
      setBusy(false);
    }
  };

  const onRetry = async () => {
    setBusy(true);
    try {
      await retryHouseholds();
    } finally {
      setBusy(false);
    }
  };

  const onSignOut = () =>
    void promptSignOut({
      t,
      requestSignOut,
      signOut,
      appleAvailable,
      onProtectFirst: () => setProtectVisible(true)
    });

  const onDeleteAccount = () =>
    void runDeleteAccountFlow({
      t,
      hasAppleIdentity,
      // 还没有家庭：没有可提示的订阅（确认文案本身已说明订阅不会自动取消）。
      isPayer: async () => false,
      deleteAccount
    });

  const languageRow = (
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
  );

  let body;
  if (householdsError) {
    // 家庭列表加载失败不等于没有家庭：只给「重试」，不让人误建一个新家庭。
    body = (
      <>
        <Text style={s.hint}>{t("cloud.householdsLoadError")}</Text>
        <TouchableOpacity style={s.button} onPress={onRetry} disabled={busy}>
          <Text style={s.buttonText}>{busy ? "..." : t("cloud.loadErrorRetry")}</Text>
        </TouchableOpacity>
      </>
    );
  } else if (pendingJoinRequest) {
    body = <JoinPendingPanel t={t} />;
  } else {
    body = (
      <>
        <View style={s.tabs}>
          <TouchableOpacity style={[s.tab, tab === "create" && s.tabActive]} onPress={() => setTab("create")}>
            <Text style={tab === "create" ? s.tabTextActive : s.tabText}>{t("auth.tabCreate")}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.tab, tab === "join" && s.tabActive]} onPress={() => setTab("join")}>
            <Text style={tab === "join" ? s.tabTextActive : s.tabText}>{t("auth.tabJoin")}</Text>
          </TouchableOpacity>
        </View>
        {languageRow}
        {tab === "create" ? (
          <>
            <TextInput
              style={s.input}
              placeholder={t("households.namePlaceholder")}
              value={householdName}
              onChangeText={setHouseholdName}
            />
            <TextInput
              style={s.input}
              placeholder={t("auth.yourName")}
              value={memberName}
              onChangeText={setMemberName}
            />
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
            <TouchableOpacity style={s.scanBtn} onPress={() => setScannerVisible(true)}>
              <Text style={s.scanBtnText}>{t("join.scanQR")}</Text>
            </TouchableOpacity>
            <TextInput style={s.input} placeholder={t("auth.name")} value={memberName} onChangeText={setMemberName} />
            <TouchableOpacity style={s.button} onPress={onJoin} disabled={busy}>
              <Text style={s.buttonText}>{busy ? "..." : t("auth.titleJoin")}</Text>
            </TouchableOpacity>
          </>
        )}
        {isAnonymous && appleAvailable && (
          <View style={s.appleBlock}>
            <Text style={s.hint}>{t("auth.haveAppleAccount")}</Text>
            <AppleButton
              kind="signIn"
              accessibilityLabel={t("auth.continueWithApple")}
              onPress={() => runBindFlow(bindApple, t, { userId: user?.id })}
            />
          </View>
        )}
      </>
    );
  }

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
        {body}
        <TouchableOpacity onPress={onSignOut}>
          <Text style={s.link}>{t("auth.signOut")}</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" onPress={onDeleteAccount}>
          <Text style={[s.link, s.dangerLink]}>{t("settings.deleteAccount")}</Text>
        </TouchableOpacity>
        <QRScanner
          visible={scannerVisible}
          onClose={() => setScannerVisible(false)}
          onCode={(code) => {
            setJoinCode(code);
            setScannerVisible(false);
          }}
          t={t}
        />
        <BindAppleSheet
          visible={protectVisible}
          reason="protect"
          t={t}
          appleAvailable={appleAvailable}
          userId={user?.id}
          bind={bindApple}
          onClose={() => setProtectVisible(false)}
        />
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
  welcomeBody: { alignSelf: "stretch", fontSize: 16, color: "#334155", lineHeight: 22, marginBottom: 14 },
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
  secondaryBtn: {
    alignSelf: "stretch",
    borderWidth: 1,
    borderColor: "#0f766e",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 14
  },
  secondaryBtnText: { color: "#0f766e", fontWeight: "700", fontSize: 16 },
  hint: { fontSize: 13, color: "#64748b", marginTop: 8 },
  link: { color: "#0f766e", marginTop: 14, textAlign: "center", fontSize: 15 },
  dangerLink: { color: "#b42318", fontSize: 14 },
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
  languageRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, marginBottom: 12 },
  langBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, backgroundColor: "#e2e8f0" },
  langBtnActive: { backgroundColor: "#0f766e" },
  langText: { color: "#334155", fontWeight: "600" },
  langTextActive: { color: "#ffffff", fontWeight: "700" },
  appleBlock: { alignSelf: "stretch", marginTop: 18 },
  pendingPanel: {
    alignSelf: "stretch",
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d9e1dc",
    padding: 16,
    marginTop: 12
  },
  pendingTitle: { fontSize: 18, fontWeight: "700", color: "#0f766e", marginBottom: 6 },
  pendingBody: { fontSize: 15, color: "#334155", lineHeight: 21 },
  pendingRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 }
});
