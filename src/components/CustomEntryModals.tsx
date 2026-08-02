import { useEffect, useState } from "react";
import {
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
import type { AppState, Member, EventType } from "../types";

// ============ 日期/时间工具 ============
function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function formatLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function parseLocal(s: string): Date | null {
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return isNaN(d.getTime()) ? null : d;
}
function tomorrow6pm(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(18, 0, 0, 0);
  return formatLocal(d);
}

// ============ Custom Task Modal ============
export function CustomTaskModal({
  visible,
  onClose,
  t,
  onCreate
}: {
  visible: boolean;
  onClose: () => void;
  t: Translate;
  onCreate: (args: { title: string; dueAt: string; expectedMinutes: number; priority: "normal" | "critical" }) => void;
}) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(tomorrow6pm());
  const [minutes, setMinutes] = useState("15");
  const [priority, setPriority] = useState<"normal" | "critical">("normal");

  useEffect(() => {
    if (visible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTitle("");
      setDue(tomorrow6pm());
      setMinutes("15");
      setPriority("normal");
    }
  }, [visible]);

  const submit = () => {
    if (!title.trim()) {
      Alert.alert(t("tasks.errTitleEmpty"), "");
      return;
    }
    const dueDate = parseLocal(due);
    if (!dueDate || dueDate.getTime() <= Date.now()) {
      Alert.alert(t("tasks.errDuePast"), "");
      return;
    }
    const mins = Number(minutes);
    if (!Number.isFinite(mins) || mins <= 0) {
      Alert.alert(t("tasks.errMinPositive"), "");
      return;
    }
    onCreate({ title: title.trim(), dueAt: dueDate.toISOString(), expectedMinutes: mins, priority });
    onClose();
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
              <Text style={s.title} allowFontScaling>
                {t("tasks.customTask")}
              </Text>
              <TouchableOpacity onPress={onClose}>
                <Ionicons name="close-outline" size={24} color="#0f766e" />
              </TouchableOpacity>
            </View>
            <Text style={s.helper} allowFontScaling>
              {t("tasks.customTaskHelper")}
            </Text>
            <ScrollView
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={s.scrollContent}
            >
              <Text style={s.label} allowFontScaling>
                {t("tasks.fieldTitle")}
              </Text>
              <TextInput style={s.input} value={title} onChangeText={setTitle} placeholder={t("tasks.fieldTitle")} />
              <Text style={s.label} allowFontScaling>
                {t("tasks.fieldDue")}
              </Text>
              <TextInput style={s.input} value={due} onChangeText={setDue} placeholder="2026-08-01 18:00" />
              <Text style={s.label} allowFontScaling>
                {t("tasks.fieldMinutes")}
              </Text>
              <TextInput
                style={s.input}
                value={minutes}
                onChangeText={(v) => setMinutes(v.replace(/\D/g, ""))}
                keyboardType="number-pad"
              />
              <Text style={s.label} allowFontScaling>
                {t("tasks.fieldPriority")}
              </Text>
              <View style={s.segRow}>
                {(["normal", "critical"] as const).map((p) => (
                  <TouchableOpacity
                    key={p}
                    style={[s.segBtn, priority === p && s.segActive]}
                    onPress={() => setPriority(p)}
                  >
                    <Text style={priority === p ? s.segTextActive : s.segText} allowFontScaling>
                      {p === "normal" ? t("tasks.normal") : t("tasks.critical")}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
            <TouchableOpacity style={s.btn} onPress={submit}>
              <Text style={s.btnText} allowFontScaling>
                {t("tasks.create")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ============ Other Timeline Update Modal ============
const EVENT_TYPES: EventType[] = ["appointment", "transport", "visit", "reminder", "document"];

export function OtherTimelineModal({
  visible,
  onClose,
  t,
  state,
  actor,
  canCreateTask,
  onCreate
}: {
  visible: boolean;
  onClose: () => void;
  t: Translate;
  state: AppState;
  actor: Member;
  canCreateTask: boolean;
  onCreate: (args: {
    type: EventType;
    title: string;
    startsAt: string;
    ownerId?: string;
    createTask: boolean;
    taskTitle?: string;
    taskDueAt?: string;
    taskMinutes?: number;
    taskPriority?: "normal" | "critical";
  }) => void;
}) {
  const [type, setType] = useState<EventType>("reminder");
  const [time, setTime] = useState(formatLocal(new Date()));
  const [title, setTitle] = useState("");
  const [memberId, setMemberId] = useState(actor.id);
  const [createTask, setCreateTask] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState(tomorrow6pm());
  const [taskMinutes, setTaskMinutes] = useState("15");
  const [taskPriority, setTaskPriority] = useState<"normal" | "critical">("normal");

  useEffect(() => {
    if (visible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setType("reminder");
      setTime(formatLocal(new Date()));
      setTitle("");
      setMemberId(actor.id);
      setCreateTask(false);
      setTaskTitle("");
      setTaskDue(tomorrow6pm());
      setTaskMinutes("15");
      setTaskPriority("normal");
    }
  }, [visible, actor.id]);

  const submit = () => {
    if (!title.trim()) {
      Alert.alert(t("timeline.errTitleEmpty"), "");
      return;
    }
    const timeDate = parseLocal(time);
    if (!timeDate) {
      Alert.alert(t("timeline.errTimeRequired"), "");
      return;
    }
    let taskDueIso: string | undefined;
    let taskMins: number | undefined;
    if (createTask) {
      const td = parseLocal(taskDue);
      if (!td || td.getTime() <= Date.now()) {
        Alert.alert(t("tasks.errDuePast"), "");
        return;
      }
      taskDueIso = td.toISOString();
      taskMins = Number(taskMinutes);
      if (!Number.isFinite(taskMins) || taskMins <= 0) {
        Alert.alert(t("tasks.errMinPositive"), "");
        return;
      }
    }
    onCreate({
      type,
      title: title.trim(),
      startsAt: timeDate.toISOString(),
      ownerId: memberId,
      createTask,
      taskTitle: createTask ? taskTitle.trim() || title.trim() : undefined,
      taskDueAt: taskDueIso,
      taskMinutes: taskMins,
      taskPriority: createTask ? taskPriority : undefined
    });
    onClose();
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
              <Text style={s.title} allowFontScaling>
                {t("timeline.otherUpdate")}
              </Text>
              <TouchableOpacity onPress={onClose}>
                <Ionicons name="close-outline" size={24} color="#0f766e" />
              </TouchableOpacity>
            </View>
            <Text style={s.helper} allowFontScaling>
              {t("timeline.otherUpdateHelper")}
            </Text>
            <ScrollView
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={s.scrollContent}
            >
              <Text style={s.label} allowFontScaling>
                {t("timeline.fieldType")}
              </Text>
              <View style={s.segRow}>
                {EVENT_TYPES.map((et) => (
                  <TouchableOpacity key={et} style={[s.segBtn, type === et && s.segActive]} onPress={() => setType(et)}>
                    <Text style={type === et ? s.segTextActive : s.segText} allowFontScaling>
                      {et}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={s.label} allowFontScaling>
                {t("timeline.fieldTime")}
              </Text>
              <TextInput style={s.input} value={time} onChangeText={setTime} placeholder="2026-08-01 14:30" />
              <Text style={s.label} allowFontScaling>
                {t("timeline.fieldTitle")}
              </Text>
              <TextInput style={s.input} value={title} onChangeText={setTitle} placeholder={t("timeline.fieldTitle")} />
              <Text style={s.label} allowFontScaling>
                {t("timeline.relatedMember")}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.memberScroll}>
                {state.members.map((m) => (
                  <TouchableOpacity
                    key={m.id}
                    style={[s.segBtn, memberId === m.id && s.segActive]}
                    onPress={() => setMemberId(m.id)}
                  >
                    <Text style={memberId === m.id ? s.segTextActive : s.segText} allowFontScaling>
                      {m.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              {canCreateTask && (
                <TouchableOpacity style={s.toggleRow} onPress={() => setCreateTask((v) => !v)}>
                  <Ionicons name={createTask ? "checkbox-outline" : "square-outline"} size={20} color="#0f766e" />
                  <Text style={s.toggleText} allowFontScaling>
                    {t("timeline.createRelatedTask")}
                  </Text>
                </TouchableOpacity>
              )}
              {createTask && canCreateTask && (
                <View style={s.taskSection}>
                  <Text style={s.label} allowFontScaling>
                    {t("tasks.fieldTitle")}
                  </Text>
                  <TextInput
                    style={s.input}
                    value={taskTitle}
                    onChangeText={setTaskTitle}
                    placeholder={title || t("tasks.fieldTitle")}
                  />
                  <Text style={s.label} allowFontScaling>
                    {t("tasks.fieldDue")}
                  </Text>
                  <TextInput style={s.input} value={taskDue} onChangeText={setTaskDue} placeholder="2026-08-02 14:30" />
                  <Text style={s.label} allowFontScaling>
                    {t("tasks.fieldMinutes")}
                  </Text>
                  <TextInput
                    style={s.input}
                    value={taskMinutes}
                    onChangeText={(v) => setTaskMinutes(v.replace(/\D/g, ""))}
                    keyboardType="number-pad"
                  />
                  <Text style={s.label} allowFontScaling>
                    {t("tasks.fieldPriority")}
                  </Text>
                  <View style={s.segRow}>
                    {(["normal", "critical"] as const).map((p) => (
                      <TouchableOpacity
                        key={p}
                        style={[s.segBtn, taskPriority === p && s.segActive]}
                        onPress={() => setTaskPriority(p)}
                      >
                        <Text style={taskPriority === p ? s.segTextActive : s.segText} allowFontScaling>
                          {p === "normal" ? t("tasks.normal") : t("tasks.critical")}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}
            </ScrollView>
            <TouchableOpacity style={s.btn} onPress={submit}>
              <Text style={s.btnText} allowFontScaling>
                {t("timeline.create")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ============ 共享样式 ============
const s = StyleSheet.create({
  keyboardView: { flex: 1 },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20, maxHeight: "88%" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  title: { fontSize: 20, fontWeight: "800", color: "#0f766e" },
  helper: { fontSize: 13, color: "#64748b", marginBottom: 14 },
  scrollContent: { paddingBottom: 8 },
  label: { fontSize: 13, fontWeight: "600", color: "#334155", marginTop: 10, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: "#fff"
  },
  segRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  segBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#fff"
  },
  segActive: { backgroundColor: "#0f766e", borderColor: "#0f766e" },
  segText: { color: "#475569", fontSize: 13 },
  segTextActive: { color: "#fff", fontWeight: "600", fontSize: 13 },
  memberScroll: { flexDirection: "row" },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 14,
    padding: 10,
    backgroundColor: "#e5f3ef",
    borderRadius: 8
  },
  toggleText: { fontSize: 14, color: "#0f766e", fontWeight: "600", flex: 1, flexShrink: 1 },
  taskSection: { marginTop: 8, padding: 12, backgroundColor: "#f8fafc", borderRadius: 8 },
  btn: { backgroundColor: "#0f766e", paddingVertical: 14, borderRadius: 10, alignItems: "center", marginTop: 14 },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 16 }
});
