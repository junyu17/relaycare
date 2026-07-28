import { useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Linking
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Translate } from "../i18n";
import type { Plan } from "../types";
import {
  fetchIosSubscriptions,
  purchaseIosSubscription,
  verifyApplePurchase,
  finishIosPurchase,
  restoreIos,
  isIosIapAvailable,
  type ProductSubscription
} from "./iap";

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

function findPrice(subs: ProductSubscription[], plan: "monthly" | "yearly"): string | null {
  const sku = plan === "yearly" ? "TaskKin.care.pro.yearly" : "TaskKin.care.pro.mon";
  const sub = subs.find((item) => item.id === sku);
  if (!sub) return null;
  const ios = sub as { localizedPrice?: string | null; price?: string };
  return ios.localizedPrice ?? ios.price ?? null;
}

// 付费墙：Free / Family Plus 对比 + 订阅。
// cloud 模式（householdId 提供）：走真实 iOS IAP（expo-iap + 校验 Edge Function）。
// local 模式 / 非 iOS：dev 切换用于测试。
export function Paywall({
  visible,
  onClose,
  t,
  currentPlan,
  isCoordinator,
  householdId,
  ownerId,
  onPurchased,
  onDevSetPlus
}: {
  visible: boolean;
  onClose: () => void;
  t: Translate;
  currentPlan: Plan;
  isCoordinator: boolean;
  householdId?: string;
  ownerId?: string;
  onPurchased?: () => void;
  onDevSetPlus: (plan: "free" | "monthly" | "yearly") => void;
}) {
  const isPlus = currentPlan === "monthly" || currentPlan === "yearly";
  const canIap = Boolean(householdId && ownerId) && isIosIapAvailable();
  const [subs, setSubs] = useState<ProductSubscription[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible && canIap) {
      void fetchIosSubscriptions()
        .then(setSubs)
        .catch(() => {});
    }
  }, [visible, canIap]);

  const handlePurchased = async (
    plan: "monthly" | "yearly",
    purchase: Awaited<ReturnType<typeof purchaseIosSubscription>>
  ) => {
    if (!householdId || !ownerId) return;
    try {
      const result = await verifyApplePurchase({ purchase, householdId, ownerId });
      await finishIosPurchase(purchase);
      if (result.ok) {
        onPurchased?.();
        Alert.alert(t("paywall.title"), t("paywall.plusActive"));
      } else {
        Alert.alert(t("paywall.title"), t("paywall.iapSoon"));
      }
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : String(e));
    }
  };

  const onSubscribe = (plan: "monthly" | "yearly") => {
    if (canIap) {
      setBusy(true);
      purchaseIosSubscription(plan)
        .then((purchase) => handlePurchased(plan, purchase))
        .catch((e) => Alert.alert("Error", e instanceof Error ? e.message : String(e)))
        .finally(() => setBusy(false));
      return;
    }
    // 非 iOS 或 local 模式：dev 切换。
    Alert.alert(
      t("paywall.title"),
      t("paywall.iapSoon"),
      isCoordinator
        ? [
            { text: t("paywall.devEnablePlus"), onPress: () => onDevSetPlus(plan) },
            { text: t("paywall.close"), style: "cancel" as const }
          ]
        : [{ text: t("paywall.close"), style: "cancel" as const }]
    );
  };

  const onRestore = () => {
    if (canIap && householdId && ownerId) {
      setBusy(true);
      restoreIos(householdId, ownerId)
        .then((plan) => {
          if (plan) {
            onPurchased?.();
            Alert.alert(t("paywall.title"), t("paywall.plusActive"));
          } else {
            Alert.alert(t("paywall.title"), t("paywall.iapSoon"));
          }
        })
        .catch((e) => Alert.alert("Error", e instanceof Error ? e.message : String(e)))
        .finally(() => setBusy(false));
      return;
    }
    Alert.alert(t("paywall.title"), t("paywall.iapSoon"));
  };

  const monthlyPrice = findPrice(subs, "monthly") ?? t("paywall.subscribeMonthly");
  const yearlyPrice = findPrice(subs, "yearly") ?? t("paywall.subscribeYearly");

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
                style={[s.subscribeBtn, s.yearlyBtn, busy && s.disabledBtn]}
                accessibilityRole="button"
                accessibilityLabel={t("paywall.subscribeYearly")}
                disabled={busy}
                onPress={() => onSubscribe("yearly")}
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={s.subscribeText} allowFontScaling>
                    {yearlyPrice}
                  </Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.subscribeBtn, s.monthlyBtn, busy && s.disabledBtn]}
                accessibilityRole="button"
                accessibilityLabel={t("paywall.subscribeMonthly")}
                disabled={busy}
                onPress={() => onSubscribe("monthly")}
              >
                <Text style={s.subscribeText} allowFontScaling>
                  {monthlyPrice}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={t("paywall.restore")}
                disabled={busy}
                onPress={onRestore}
              >
                <Text style={s.restoreText} allowFontScaling>
                  {t("paywall.restore")}
                </Text>
              </TouchableOpacity>
            </>
          )}

          {canIap && (
            <Text style={s.iapSoon} allowFontScaling>
              {t("paywall.iapSoon")}
            </Text>
          )}

          <Text style={s.disclosure} allowFontScaling>
            {t("paywall.disclosure")}
          </Text>

          {isPlus && (
            <TouchableOpacity
              style={s.devBtn}
              accessibilityRole="button"
              accessibilityLabel={t("paywall.manage")}
              onPress={() => Linking.openURL("https://apps.apple.com/account/subscriptions").catch(() => {})}
            >
              <Text style={s.devBtnText} allowFontScaling>
                {t("paywall.manage")}
              </Text>
            </TouchableOpacity>
          )}

          {/* dev 测试切换（仅本地 demo 模式；cloud 走真实 IAP，不提供）*/}
          {!householdId && isCoordinator && (
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
  disabledBtn: { opacity: 0.6 },
  subscribeText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  restoreText: { color: "#0f766e", textAlign: "center", marginTop: 4, fontSize: 13 },
  iapSoon: { fontSize: 11, color: "#94a3b8", textAlign: "center", marginTop: 8 },
  disclosure: { fontSize: 11, color: "#64748b", marginTop: 10, lineHeight: 16 },
  devRow: { marginTop: 10, alignItems: "center" },
  devBtn: { borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  devBtnText: { color: "#64748b", fontSize: 12 }
});
