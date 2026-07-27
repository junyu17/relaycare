import { Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Translate } from "../i18n";
import type { Plan } from "../types";

interface Row {
  labelKey: string;
  free: string;
  plus: string;
}

const ROWS: Row[] = [
  { labelKey: "paywall.row.households", free: "1", plus: "3" },
  { labelKey: "paywall.row.members", free: "3", plus: "12" },
  { labelKey: "paywall.row.tasks", free: "10", plus: "∞" },
  { labelKey: "paywall.row.storage", free: "25 MB", plus: "25 MB" },
  { labelKey: "paywall.row.report", free: "reportManual", plus: "reportAuto" },
  { labelKey: "paywall.row.ocr", free: "1", plus: "50" },
  { labelKey: "paywall.row.audit", free: "30 days", plus: "3 years" },
  { labelKey: "paywall.row.export", free: "none", plus: "PDF/CSV" },
  { labelKey: "paywall.row.notifications", free: "none", plus: "✓" }
];

function rowValue(value: string, t: Translate): string {
  if (value === "reportManual") return t("paywall.value.reportManual");
  if (value === "reportAuto") return t("paywall.value.reportAuto");
  if (value === "none") return t("paywall.value.none");
  return value;
}

// 付费墙：Free / Family Plus 对比 + 订阅按钮（IAP 第二步接入）+ dev 测试切换。
export function Paywall({
  visible,
  onClose,
  t,
  currentPlan,
  isCoordinator,
  onDevSetPlus
}: {
  visible: boolean;
  onClose: () => void;
  t: Translate;
  currentPlan: Plan;
  isCoordinator: boolean;
  onDevSetPlus: (plan: "free" | "monthly" | "yearly") => void;
}) {
  const isPlus = currentPlan === "monthly" || currentPlan === "yearly";

  const onSubscribe = (_plan: "monthly" | "yearly") => {
    // 第二步接入 expo-iap + 校验 Edge Function。当前提示 + dev 切换用于测试。
    Alert.alert(
      t("paywall.title"),
      t("paywall.iapSoon"),
      isCoordinator
        ? [
            { text: t("paywall.devEnablePlus"), onPress: () => onDevSetPlus(_plan) },
            { text: t("paywall.close"), style: "cancel" as const }
          ]
        : [{ text: t("paywall.close"), style: "cancel" as const }]
    );
  };

  const onRestore = () => {
    Alert.alert(t("paywall.title"), t("paywall.iapSoon"));
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.scrim}>
        <View style={s.sheet}>
          <View style={s.header}>
            <Text style={s.title} allowFontScaling>
              {t("paywall.title")}
            </Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("paywall.close")} onPress={onClose}>
              <Ionicons name="close-outline" size={24} color="#0f766e" />
            </TouchableOpacity>
          </View>
          <Text style={s.subtitle} allowFontScaling>
            {t("paywall.subtitle")}
          </Text>

          {isPlus && (
            <View style={s.activeBanner}>
              <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
              <Text style={s.activeBannerText} allowFontScaling>
                {t("paywall.plusActive")}
              </Text>
            </View>
          )}

          <ScrollView style={s.table}>
            <View style={s.tableHeader}>
              <Text style={[s.tableCell, s.tableHeadCell, s.featureCol]} allowFontScaling>
                {t("paywall.col.feature")}
              </Text>
              <Text style={[s.tableCell, s.tableHeadCell]} allowFontScaling>
                {t("paywall.col.free")}
              </Text>
              <Text style={[s.tableCell, s.tableHeadCell, s.plusCol]} allowFontScaling>
                {t("paywall.col.plus")}
              </Text>
            </View>
            {ROWS.map((row) => (
              <View key={row.labelKey} style={s.tableRow}>
                <Text style={[s.tableCell, s.featureCol]} allowFontScaling>
                  {t(row.labelKey)}
                </Text>
                <Text style={s.tableCell} allowFontScaling>
                  {rowValue(row.free, t)}
                </Text>
                <Text style={[s.tableCell, s.plusCol, s.plusValue]} allowFontScaling>
                  {rowValue(row.plus, t)}
                </Text>
              </View>
            ))}
          </ScrollView>

          {!isPlus && (
            <>
              <TouchableOpacity
                style={[s.subscribeBtn, s.yearlyBtn]}
                accessibilityRole="button"
                accessibilityLabel={t("paywall.subscribeYearly")}
                onPress={() => onSubscribe("yearly")}
              >
                <Text style={s.subscribeText} allowFontScaling>
                  {t("paywall.subscribeYearly")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.subscribeBtn, s.monthlyBtn]}
                accessibilityRole="button"
                accessibilityLabel={t("paywall.subscribeMonthly")}
                onPress={() => onSubscribe("monthly")}
              >
                <Text style={s.subscribeText} allowFontScaling>
                  {t("paywall.subscribeMonthly")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={t("paywall.restore")}
                onPress={onRestore}
              >
                <Text style={s.restoreText} allowFontScaling>
                  {t("paywall.restore")}
                </Text>
              </TouchableOpacity>
            </>
          )}

          <Text style={s.iapSoon} allowFontScaling>
            {t("paywall.iapSoon")}
          </Text>

          {/* dev 测试切换（仅协调人可见）：上线前移除或隐藏到 debug 菜单 */}
          {isCoordinator && (
            <View style={s.devRow}>
              {isPlus ? (
                <TouchableOpacity style={s.devBtn} onPress={() => onDevSetPlus("free")}>
                  <Text style={s.devBtnText} allowFontScaling>
                    {t("paywall.devDisablePlus")}
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={s.devBtn} onPress={() => onDevSetPlus("yearly")}>
                  <Text style={s.devBtnText} allowFontScaling>
                    {t("paywall.devEnablePlus")}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 20,
    maxHeight: "92%"
  },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  title: { fontSize: 22, fontWeight: "800", color: "#0f766e" },
  subtitle: { fontSize: 13, color: "#64748b", marginBottom: 14 },
  activeBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#0f766e",
    padding: 10,
    borderRadius: 8,
    marginBottom: 14
  },
  activeBannerText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  table: { marginBottom: 14 },
  tableHeader: { flexDirection: "row", borderBottomWidth: 2, borderBottomColor: "#0f766e", paddingBottom: 6 },
  tableRow: { flexDirection: "row", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  tableCell: { flex: 1, fontSize: 13, color: "#334155" },
  tableHeadCell: { fontWeight: "700", color: "#0f766e" },
  featureCol: { flex: 1.4 },
  plusCol: { backgroundColor: "rgba(15,118,110,0.06)" },
  plusValue: { fontWeight: "700", color: "#0f766e" },
  subscribeBtn: { paddingVertical: 14, borderRadius: 10, alignItems: "center", marginBottom: 8 },
  yearlyBtn: { backgroundColor: "#0f766e" },
  monthlyBtn: { backgroundColor: "#0e6b63" },
  subscribeText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  restoreText: { color: "#0f766e", textAlign: "center", marginTop: 4, fontSize: 13 },
  iapSoon: { fontSize: 11, color: "#94a3b8", textAlign: "center", marginTop: 8 },
  devRow: { marginTop: 10, alignItems: "center" },
  devBtn: { borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  devBtnText: { color: "#64748b", fontSize: 12 }
});
