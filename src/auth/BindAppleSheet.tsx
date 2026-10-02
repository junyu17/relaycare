import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Translate } from "../i18n";
import type { BindResult } from "./AuthContext";
import { AppleButton } from "./AppleButton";
import { runBindFlow } from "./accountFlows";

export type BindSheetReason = "protect" | "invite" | "afterCreate" | "firstUpload" | "newDevice";

const copy: Record<BindSheetReason, { title: string; body: string }> = {
  protect: { title: "bind.title", body: "bind.why" },
  invite: { title: "bind.title", body: "bind.whyInvite" },
  afterCreate: { title: "prompt.bindAfterCreateTitle", body: "prompt.bindAfterCreate" },
  firstUpload: { title: "prompt.bindFirstUploadTitle", body: "prompt.bindFirstUpload" },
  newDevice: { title: "prompt.newDeviceTitle", body: "prompt.newDevice" }
};

// 绑定弹层：一句话说明为什么要绑定，配官方 Apple 按钮。
// linked / switched：关闭弹层，继续原本要做的动作；both_have_data：显示 4a(c) 的说明和支持邮箱后关闭；
// cancelled：什么也不做，弹层留着。newDevice 用全屏样式。
export function BindAppleSheet({
  visible,
  reason,
  t,
  appleAvailable,
  userId,
  bind,
  onClose,
  onDone
}: {
  visible: boolean;
  reason: BindSheetReason;
  t: Translate;
  appleAvailable: boolean;
  userId?: string | null;
  bind: () => Promise<BindResult>;
  onClose: () => void;
  onDone?: (result: BindResult) => void;
}) {
  const fullScreen = reason === "newDevice";
  const text = copy[reason];

  const onApple = async () => {
    const result = await runBindFlow(bind, t, { userId });
    if (result === "failed" || result === "cancelled") return;
    onClose();
    onDone?.(result);
  };

  const content = (
    <View style={fullScreen ? s.fullContent : s.sheet}>
      <View style={s.iconRow}>
        <Ionicons name="shield-checkmark-outline" size={30} color="#0f766e" />
      </View>
      <Text style={s.title} allowFontScaling>
        {t(text.title)}
      </Text>
      <Text style={s.body} allowFontScaling>
        {t(text.body)}
      </Text>
      {appleAvailable ? (
        <AppleButton kind="signIn" accessibilityLabel={t("auth.continueWithApple")} onPress={onApple} />
      ) : (
        <Text style={s.body} allowFontScaling>
          {t("bind.unavailable")}
        </Text>
      )}
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("bind.later")} onPress={onClose}>
        <Text style={s.later} allowFontScaling>
          {t("bind.later")}
        </Text>
      </TouchableOpacity>
    </View>
  );

  if (fullScreen) {
    return (
      <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
        <View style={s.fullScreen}>{content}</View>
      </Modal>
    );
  }
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.scrim}>{content}</View>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 22,
    paddingBottom: 36
  },
  fullScreen: { flex: 1, backgroundColor: "#f7faf7", justifyContent: "center" },
  fullContent: { width: "100%", maxWidth: 520, alignSelf: "center", padding: 24 },
  iconRow: { alignItems: "center", marginBottom: 8 },
  title: { fontSize: 22, fontWeight: "800", color: "#0f766e", textAlign: "center", marginBottom: 8 },
  body: { fontSize: 15, color: "#334155", lineHeight: 21, textAlign: "center", marginBottom: 16 },
  later: { color: "#0f766e", marginTop: 16, textAlign: "center", fontSize: 15 }
});
