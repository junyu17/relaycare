import { useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView } from "react-native";
import { useAuth } from "./AuthContext";

// 接受纯 token 或完整邀请链接（taskkin-care://invite?token=... 或 https://...token=...），统一抽出 token。
function parseInviteToken(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const tokenMatch = trimmed.match(/[?&]token=([^&]+)/i);
  if (tokenMatch) return decodeURIComponent(tokenMatch[1]);
  return trimmed;
}

const ROLE_LABEL: Record<"coordinator" | "caregiver" | "viewer", string> = {
  coordinator: "Coordinator",
  caregiver: "Caregiver",
  viewer: "Viewer"
};
const ROLE_OPTIONS: ("coordinator" | "caregiver" | "viewer")[] = ["coordinator", "caregiver", "viewer"];

// 未登录时显示：登录 / 注册 / 重置密码
export function AuthScreen() {
  const { signIn, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup" | "reset">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (mode === "reset") {
      if (!email) return;
      setBusy(true);
      try {
        await resetPassword(email);
        Alert.alert("Check your email", "If an account exists for that email, a password reset link has been sent.");
        setMode("signin");
      } catch (e) {
        Alert.alert("Error", e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
      return;
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      Alert.alert("Missing information", "Enter both email and password.");
      return;
    }
    if (mode === "signup" && password.length < 6) {
      Alert.alert("Password too short", "Password must be at least 6 characters.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signin") {
        await signIn(trimmedEmail, password);
      } else {
        const result = await signUp(trimmedEmail, password);
        if (result.signedIn) {
          Alert.alert("Account created", "账号已建立，正在进入应用。");
        } else {
          Alert.alert("Check your email", `请去 ${trimmedEmail} 点击确认链接，然后返回登录。`);
          setMode("signin");
          setPassword("");
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
        : "Send reset link";

  return (
    <ScrollView contentContainerStyle={s.container}>
      <Text style={s.title}>TaskKin Care</Text>
      <Text style={s.subtitle}>Family care coordination</Text>
      {mode !== "reset" && (
        <View style={s.tabs}>
          <TouchableOpacity style={[s.tab, mode === "signin" && s.tabActive]} onPress={() => setMode("signin")}>
            <Text style={mode === "signin" ? s.tabTextActive : s.tabText}>Sign in</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.tab, mode === "signup" && s.tabActive]} onPress={() => setMode("signup")}>
            <Text style={mode === "signup" ? s.tabTextActive : s.tabText}>Sign up</Text>
          </TouchableOpacity>
        </View>
      )}
      <TextInput
        style={s.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      {mode !== "reset" && (
        <TextInput style={s.input} placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry />
      )}
      <TouchableOpacity style={s.button} onPress={submit} disabled={busy}>
        <Text style={s.buttonText}>{submitLabel}</Text>
      </TouchableOpacity>
      {mode === "signin" && (
        <TouchableOpacity onPress={() => setMode("reset")}>
          <Text style={s.link}>Forgot password?</Text>
        </TouchableOpacity>
      )}
      {mode === "reset" && (
        <TouchableOpacity onPress={() => setMode("signin")}>
          <Text style={s.link}>Back to sign in</Text>
        </TouchableOpacity>
      )}
      {mode === "reset" && <Text style={s.hint}>Enter your account email and we will send a reset link.</Text>}
    </ScrollView>
  );
}

// 已登录但还没家庭时显示：创建家庭 / 加入家庭
export function OnboardingScreen() {
  const { createHousehold, acceptInvite, signOut, pendingInviteToken, clearPendingInvite } = useAuth();
  const [tab, setTab] = useState<"create" | "join">("create");
  const [householdName, setHouseholdName] = useState("");
  const [memberName, setMemberName] = useState("");
  const [relation, setRelation] = useState("");
  const [inviteInput, setInviteInput] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pendingInviteToken) return;
    // Sync invite token from deep link into local input state (one-time on link arrival).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInviteInput(pendingInviteToken);
    setTab("join");
  }, [pendingInviteToken]);

  const onCreate = async () => {
    if (!householdName || !memberName) return;
    setBusy(true);
    try {
      await createHousehold({
        householdName,
        timezone: "America/Los_Angeles",
        careRecipientLabel: "Care recipient",
        memberName,
        memberRelation: relation,
        memberTimezone: "America/Los_Angeles"
      });
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onJoin = async () => {
    const token = parseInviteToken(inviteInput);
    if (!token) return;
    setBusy(true);
    try {
      await acceptInvite(token);
      clearPendingInvite();
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={s.container}>
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
          <TextInput
            style={s.input}
            placeholder="Your relation (e.g. Primary caregiver)"
            value={relation}
            onChangeText={setRelation}
          />
          <Text style={s.fieldLabel}>Your role (3 roles available)</Text>
          <View style={s.roleRow}>
            {ROLE_OPTIONS.map((r) => {
              const selected = r === "coordinator";
              return (
                <View
                  key={r}
                  style={[s.roleChip, selected && s.roleChipActive, s.roleChipDisabled]}
                  accessibilityState={{ selected, disabled: true }}
                >
                  <Text style={selected ? s.roleChipTextActive : s.roleChipText}>{ROLE_LABEL[r]}</Text>
                </View>
              );
            })}
          </View>
          <Text style={s.hint}>
            The first member of a household is always the Coordinator. You can invite Caregivers and Viewers later from
            Settings.
          </Text>
          <TouchableOpacity style={s.button} onPress={onCreate} disabled={busy}>
            <Text style={s.buttonText}>{busy ? "..." : "Create household"}</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={s.hint}>Paste the invite link or token your coordinator shared with you.</Text>
          <TextInput
            style={s.input}
            placeholder="Invite link or token"
            value={inviteInput}
            onChangeText={setInviteInput}
            autoCapitalize="none"
            autoCorrect={false}
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
  );
}

const s = StyleSheet.create({
  container: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    paddingHorizontal: 24,
    paddingVertical: 16,
    justifyContent: "center",
    backgroundColor: "#f7faf7"
  },
  title: { alignSelf: "stretch", flexShrink: 1, fontSize: 34, fontWeight: "800", color: "#0f766e", marginBottom: 6 },
  subtitle: { alignSelf: "stretch", flexShrink: 1, fontSize: 17, color: "#64748b", marginBottom: 18 },
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
  tabText: { color: "#475569", fontSize: 16, fontWeight: "600" },
  tabTextActive: { color: "#fff", fontSize: 16, fontWeight: "700" },
  input: {
    alignSelf: "stretch",
    width: "100%",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 12,
    backgroundColor: "#fff",
    fontSize: 17
  },
  fieldLabel: { alignSelf: "stretch", fontSize: 13, fontWeight: "600", color: "#334155", marginBottom: 8 },
  roleRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  roleChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#fff",
    opacity: 0.55
  },
  roleChipActive: { backgroundColor: "#0f766e", borderColor: "#0f766e", opacity: 1 },
  roleChipDisabled: {},
  roleChipText: { color: "#475569", fontWeight: "600" },
  roleChipTextActive: { color: "#fff", fontWeight: "700" },
  button: {
    alignSelf: "stretch",
    width: "100%",
    backgroundColor: "#0f766e",
    paddingVertical: 15,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 8
  },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 17 },
  hint: { fontSize: 14, color: "#64748b", marginTop: 10, lineHeight: 20 },
  link: { color: "#0f766e", marginTop: 16, textAlign: "center", fontSize: 16, fontWeight: "600" }
});
