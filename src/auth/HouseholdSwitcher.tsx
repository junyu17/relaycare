import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Translate } from "../i18n";
import type { HouseholdSummary } from "../lib/db";
import { errorMessage } from "../lib/error";
import type { CreateHouseholdArgs } from "./AuthContext";

export function HouseholdSwitcher({
  visible,
  onClose,
  households,
  currentName,
  memberName,
  memberRelation,
  onSwitch,
  onCreate,
  t
}: {
  visible: boolean;
  onClose: () => void;
  households: HouseholdSummary[];
  currentName: string;
  memberName: string;
  memberRelation: string;
  onSwitch: (householdId: string) => Promise<void>;
  onCreate: (args: CreateHouseholdArgs) => Promise<void>;
  t: Translate;
}) {
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [householdName, setHouseholdName] = useState("");
  const [careRecipientLabel, setCareRecipientLabel] = useState("");

  const perform = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      setCreating(false);
      setHouseholdName("");
      setCareRecipientLabel("");
    } catch (error) {
      Alert.alert("Error", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 12 : 0}
        style={s.keyboardView}
      >
        <View style={s.scrim}>
          <View style={s.sheet}>
            <View style={s.header}>
              <View>
                <Text style={s.title}>{t("households.title")}</Text>
                <Text style={s.subtitle}>{t("households.current", { name: currentName })}</Text>
              </View>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("paywall.close")} onPress={onClose}>
                <Ionicons name="close-outline" size={24} color="#0f766e" />
              </TouchableOpacity>
            </View>

            <ScrollView
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={s.content}
            >
              {households.map((household) => (
                <TouchableOpacity
                  key={household.id}
                  disabled={busy || household.isActive}
                  style={[s.row, household.isActive && s.rowActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: household.isActive, disabled: busy || household.isActive }}
                  accessibilityLabel={t("households.switchTo", { name: household.name })}
                  onPress={() => perform(async () => onSwitch(household.id))}
                >
                  <Ionicons name={household.isActive ? "home" : "home-outline"} size={20} color="#0f766e" />
                  <View style={s.rowText}>
                    <Text style={s.rowTitle}>{household.name}</Text>
                    <Text style={s.rowMeta}>{household.careRecipientLabel}</Text>
                  </View>
                  {household.isActive && <Ionicons name="checkmark-circle" size={20} color="#0f766e" />}
                </TouchableOpacity>
              ))}

              {creating ? (
                <View style={s.form}>
                  <TextInput
                    style={s.input}
                    placeholder={t("households.namePlaceholder")}
                    value={householdName}
                    onChangeText={setHouseholdName}
                    editable={!busy}
                  />
                  <TextInput
                    style={s.input}
                    placeholder={t("households.recipientPlaceholder")}
                    value={careRecipientLabel}
                    onChangeText={setCareRecipientLabel}
                    editable={!busy}
                  />
                  <TouchableOpacity
                    style={[s.createButton, (!householdName || busy) && s.disabled]}
                    disabled={!householdName || busy}
                    onPress={() =>
                      perform(() =>
                        onCreate({
                          householdName,
                          timezone: "America/Los_Angeles",
                          careRecipientLabel: careRecipientLabel || t("households.defaultRecipient"),
                          memberName,
                          memberRelation,
                          memberTimezone: "America/Los_Angeles"
                        })
                      )
                    }
                  >
                    {busy ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={s.createText}>{t("households.create")}</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={s.addRow} disabled={busy} onPress={() => setCreating(true)}>
                  <Ionicons name="add-circle-outline" size={20} color="#0f766e" />
                  <Text style={s.addText}>{t("households.add")}</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  keyboardView: { flex: 1 },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20, maxHeight: "86%" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 },
  title: { fontSize: 21, fontWeight: "800", color: "#0f766e" },
  subtitle: { fontSize: 13, color: "#64748b", marginTop: 3 },
  content: { gap: 8, paddingBottom: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: "#dce4e8",
    borderRadius: 8,
    padding: 12
  },
  rowActive: { borderColor: "#0f766e", backgroundColor: "#f0fdfa" },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 15, fontWeight: "700", color: "#1f2937" },
  rowMeta: { fontSize: 12, color: "#64748b", marginTop: 2 },
  addRow: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center", paddingVertical: 12 },
  addText: { color: "#0f766e", fontWeight: "700", fontSize: 14 },
  form: { gap: 8, paddingTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: "#1f2937"
  },
  createButton: { backgroundColor: "#0f766e", borderRadius: 8, alignItems: "center", paddingVertical: 12 },
  createText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  disabled: { opacity: 0.55 }
});
