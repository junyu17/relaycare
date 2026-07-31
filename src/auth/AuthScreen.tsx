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
import { makeTranslator } from "../i18n";

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
  const t = makeTranslator("en");

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
        Alert.alert("Check your email", "If an account exists, a password reset link has been sent.");
        setMode("signin");
      } catch (e) {
        Alert.alert("Error", e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (mode === "join") {
      if (!/^\d{6}$/.test(joinCode)) {
        Alert.alert("Invalid code", "Enter the 6-digit family code.");
        return;
      }
      if (!displayName.trim()) {
        Alert.alert("Name required", "Please enter your name.");
        return;
      }
      setBusy(true);
      try {
        await joinByCode(joinCode, displayName.trim() || undefined);
        clearPendingJoinCode();
      } catch (e) {
        Alert.alert("Error", e instanceof Error ? e.message : String(e));
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
          Alert.alert("Check your email", "Please check your email for confirmation, then sign in.");
          setMode("signin");
        }
      }
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitLabel = busy
    ? "..."
    : mode === "signin"
      ? "Sign in"
      : mode === "signup"
        ? "Create account"
        : mode === "reset"
          ? "Send reset link"
          : "Join household";

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
        <Text style={s.subtitle}>Family care coordination</Text>
        {mode !== "reset" && mode !== "join" && (
          <View style={s.tabs}>
            <TouchableOpacity style={[s.tab, mode === "signin" && s.tabActive]} onPress={() => setMode("signin")}>
              <Text style={mode === "signin" ? s.tabTextActive : s.tabText}>Sign in</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.tab, mode === "signup" && s.tabActive]} onPress={() => setMode("signup")}>
              <Text style={mode === "signup" ? s.tabTextActive : s.tabText}>Sign up</Text>
            </TouchableOpacity>
          </View>
        )}

        {mode === "join" ? (
          <>
            <Text style={s.hint}>Enter the 6-digit code your family coordinator shared, or scan their QR code.</Text>
            <TextInput
              style={s.input}
              placeholder="6-digit family code"
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
              placeholder="Your name (required)"
              value={displayName}
              onChangeText={setDisplayName}
            />
          </>
        ) : (
          <>
            <TextInput
              style={s.input}
              placeholder="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            {mode !== "reset" && (
              <TextInput
                style={s.input}
                placeholder="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />
            )}
            {mode === "signup" && <Text style={s.hint}>Password must be at least 6 characters.</Text>}
          </>
        )}

        <TouchableOpacity style={s.button} onPress={submit} disabled={busy}>
          <Text style={s.buttonText}>{submitLabel}</Text>
        </TouchableOpacity>

        {mode === "signin" && (
          <>
            <TouchableOpacity onPress={() => setMode("reset")}>
              <Text style={s.link}>Forgot password?</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setMode("join")}>
              <Text style={s.link}>Have a family code? Join</Text>
            </TouchableOpacity>
          </>
        )}
        {mode === "reset" && (
          <TouchableOpacity onPress={() => setMode("signin")}>
            <Text style={s.link}>Back to sign in</Text>
          </TouchableOpacity>
        )}
        {mode === "join" && (
          <TouchableOpacity onPress={() => setMode("signin")}>
            <Text style={s.link}>Coordinator? Sign in / sign up</Text>
          </TouchableOpacity>
        )}
        <Text style={s.hint}>
          {mode === "signup"
            ? "After signup, confirm via email if required, then sign in."
            : mode === "reset"
              ? "Enter your account email and we'll send a reset link."
              : mode === "join"
                ? "Joining creates a device-linked identity; no email needed."
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
  const [tab, setTab] = useState<"create" | "join">("create");
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
        careRecipientLabel: "Care recipient",
        memberName,
        memberRelation: "",
        memberTimezone: "America/Los_Angeles"
      });
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onJoin = async () => {
    if (!/^\d{6}$/.test(joinCode)) {
      Alert.alert("Invalid code", "Enter the 6-digit family code.");
      return;
    }
    if (!memberName.trim()) {
      Alert.alert("Name required", "Please enter your name.");
      return;
    }
    setBusy(true);
    try {
      await joinByCode(joinCode, memberName.trim() || undefined);
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : String(e));
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
        <Text style={s.title}>Set up your care circle</Text>
        <View style={s.tabs}>
          <TouchableOpacity style={[s.tab, tab === "create" && s.tabActive]} onPress={() => setTab("create")}>
            <Text style={tab === "create" ? s.tabTextActive : s.tabText}>Create</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.tab, tab === "join" && s.tabActive]} onPress={() => setTab("join")}>
            <Text style={tab === "join" ? s.tabTextActive : s.tabText}>Join</Text>
          </TouchableOpacity>
        </View>
        {tab === "create" ? (
          <>
            <TextInput
              style={s.input}
              placeholder="Household name (e.g. Chen Family)"
              value={householdName}
              onChangeText={setHouseholdName}
            />
            <TextInput style={s.input} placeholder="Your name" value={memberName} onChangeText={setMemberName} />
            <Text style={s.hint}>The first member is the Coordinator (admin). Others join by code.</Text>
            <TouchableOpacity style={s.button} onPress={onCreate} disabled={busy}>
              <Text style={s.buttonText}>{busy ? "..." : "Create household"}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={s.hint}>Enter the 6-digit code your coordinator shared.</Text>
            <TextInput
              style={s.input}
              placeholder="6-digit family code"
              value={joinCode}
              onChangeText={(v) => setJoinCode(v.replace(/\D/g, "").slice(0, 6))}
              keyboardType="number-pad"
            />
            <TextInput
              style={s.input}
              placeholder="Your name (required)"
              value={memberName}
              onChangeText={setMemberName}
            />
            <TouchableOpacity style={s.button} onPress={onJoin} disabled={busy}>
              <Text style={s.buttonText}>{busy ? "..." : "Join household"}</Text>
            </TouchableOpacity>
          </>
        )}
        <TouchableOpacity onPress={signOut}>
          <Text style={s.link}>Sign out</Text>
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
  scanBtnText: { color: "#0f766e", fontWeight: "700", fontSize: 16 }
});
