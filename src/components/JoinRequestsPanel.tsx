import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Translate } from "../i18n";
import type { JoinRequest } from "../types";

// 协调人看到的加入申请（只在熔断期出现）：首页横幅和 设置 → 成员 都用它。
// 每张卡片都提示：如果你没有把码发给这个人，请拒绝。
export function JoinRequestsPanel({
  requests,
  t,
  formatDate,
  onApprove,
  onReject
}: {
  requests: JoinRequest[];
  t: Translate;
  formatDate: (iso: string) => string;
  onApprove: (request: JoinRequest) => Promise<void>;
  onReject: (request: JoinRequest) => Promise<void>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  if (requests.length === 0) return null;

  const run = (request: JoinRequest, action: (request: JoinRequest) => Promise<void>) => {
    if (busyId) return;
    setBusyId(request.id);
    void action(request).finally(() => setBusyId(null));
  };

  return (
    <View style={s.panel}>
      <View style={s.header}>
        <Ionicons name="person-add-outline" size={20} color="#a76600" />
        <Text style={s.title} allowFontScaling>
          {t("join.requestsBanner", { count: requests.length })}
        </Text>
      </View>
      <Text style={s.hint} allowFontScaling>
        {t("join.rejectHint")}
      </Text>
      {requests.map((request) => {
        const name = request.displayName.trim() || t("member.fallback");
        const busy = busyId === request.id;
        return (
          <View key={request.id} style={s.card}>
            <Text style={s.name} allowFontScaling>
              {t("join.requestFrom", { name })}
            </Text>
            <Text style={s.meta} allowFontScaling>
              {t("join.requestedAt", { date: formatDate(request.createdAt) })}
            </Text>
            <View style={s.actions}>
              <TouchableOpacity
                style={[s.button, s.approve, busy && s.disabled]}
                accessibilityRole="button"
                accessibilityLabel={`${t("join.approve")} ${name}`}
                disabled={busy}
                onPress={() => run(request, onApprove)}
              >
                <Text style={s.approveText} allowFontScaling>
                  {t("join.approve")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.button, s.reject, busy && s.disabled]}
                accessibilityRole="button"
                accessibilityLabel={`${t("join.reject")} ${name}`}
                disabled={busy}
                onPress={() => run(request, onReject)}
              >
                <Text style={s.rejectText} allowFontScaling>
                  {t("join.reject")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  panel: {
    backgroundColor: "#fff3d8",
    borderColor: "#e5c270",
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    marginBottom: 14,
    gap: 8
  },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontSize: 16, fontWeight: "700", color: "#172026" },
  hint: { fontSize: 13, color: "#65717a" },
  card: { backgroundColor: "#ffffff", borderRadius: 8, padding: 12, gap: 4 },
  name: { fontSize: 15, fontWeight: "600", color: "#172026" },
  meta: { fontSize: 13, color: "#65717a" },
  actions: { flexDirection: "row", gap: 10, marginTop: 6 },
  button: { flex: 1, minHeight: 44, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  approve: { backgroundColor: "#0f766e" },
  reject: { borderWidth: 1, borderColor: "#b42318", backgroundColor: "#ffffff" },
  approveText: { color: "#ffffff", fontWeight: "700", fontSize: 15 },
  rejectText: { color: "#b42318", fontWeight: "700", fontSize: 15 },
  disabled: { opacity: 0.6 }
});
