import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView } from "react-native";
import { useAuth } from "./AuthContext";

// 未登录时显示：登录 / 注册
export function AuthScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email || !password) return;
    setBusy(true);
    try {
      if (mode === "signin") await signIn(email, password);
      else await signUp(email, password);
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={s.container}>
      <Text style={s.title}>RelayCare</Text>
      <Text style={s.subtitle}>Family care coordination</Text>
      <View style={s.tabs}>
        <TouchableOpacity style={[s.tab, mode === "signin" && s.tabActive]} onPress={() => setMode("signin")}>
          <Text style={mode === "signin" ? s.tabTextActive : s.tabText}>Sign in</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.tab, mode === "signup" && s.tabActive]} onPress={() => setMode("signup")}>
          <Text style={mode === "signup" ? s.tabTextActive : s.tabText}>Sign up</Text>
        </TouchableOpacity>
      </View>
      <TextInput
        style={s.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <TextInput style={s.input} placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry />
      <TouchableOpacity style={s.button} onPress={submit} disabled={busy}>
        <Text style={s.buttonText}>{busy ? "..." : mode === "signin" ? "Sign in" : "Create account"}</Text>
      </TouchableOpacity>
      <Text style={s.hint}>
        {mode === "signup" ? "After signup, confirm via email if required, then sign in." : ""}
      </Text>
    </ScrollView>
  );
}

// 已登录但还没家庭时显示：创建家庭 / 加入家庭
export function OnboardingScreen() {
  const { createHousehold, acceptInvite, signOut } = useAuth();
  const [tab, setTab] = useState<"create" | "join">("create");
  const [householdName, setHouseholdName] = useState("");
  const [memberName, setMemberName] = useState("");
  const [relation, setRelation] = useState("");
  const [inviteId, setInviteId] = useState("");
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
    if (!inviteId) return;
    setBusy(true);
    try {
      await acceptInvite(inviteId.trim());
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
          <TouchableOpacity style={s.button} onPress={onCreate} disabled={busy}>
            <Text style={s.buttonText}>{busy ? "..." : "Create household"}</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={s.hint}>Paste the invite member ID your coordinator shared with you.</Text>
          <TextInput
            style={s.input}
            placeholder="Invite member ID"
            value={inviteId}
            onChangeText={setInviteId}
            autoCapitalize="none"
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
  container: { flexGrow: 1, padding: 24, justifyContent: "center", backgroundColor: "#f7faf7" },
  title: { fontSize: 26, fontWeight: "700", color: "#0f766e", marginBottom: 4 },
  subtitle: { fontSize: 14, color: "#64748b", marginBottom: 24 },
  tabs: { flexDirection: "row", marginBottom: 16, borderRadius: 8, overflow: "hidden", backgroundColor: "#e2e8f0" },
  tab: { flex: 1, paddingVertical: 10, alignItems: "center" },
  tabActive: { backgroundColor: "#0f766e" },
  tabText: { color: "#475569" },
  tabTextActive: { color: "#fff", fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    backgroundColor: "#fff"
  },
  button: { backgroundColor: "#0f766e", paddingVertical: 12, borderRadius: 8, alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "600" },
  hint: { fontSize: 12, color: "#64748b", marginTop: 8 },
  link: { color: "#0f766e", marginTop: 16, textAlign: "center" }
});
