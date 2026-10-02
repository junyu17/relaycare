import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { loadAppleAuthentication } from "./apple";

// 官方 Sign in with Apple 按钮（ASAuthorizationAppleIDButton，系统负责文案本地化，符合 HIG）。
// 每个发起 Apple 授权的地方都用它；系统弹窗里只放「先用 Apple 登录」这类跳转，不直接发起授权。
// onPress 返回 Promise 时按钮期间显示忙碌，防止连点。
export function AppleButton({
  kind,
  onPress,
  accessibilityLabel
}: {
  kind: "signIn" | "continue";
  onPress: () => Promise<unknown> | void;
  accessibilityLabel: string;
}) {
  const [busy, setBusy] = useState(false);
  const apple = loadAppleAuthentication();

  const handlePress = () => {
    if (busy) return;
    const result = onPress();
    if (result && typeof (result as Promise<unknown>).finally === "function") {
      setBusy(true);
      void (result as Promise<unknown>).catch(() => undefined).finally(() => setBusy(false));
    }
  };

  if (busy) {
    return (
      <View style={[s.button, s.busy]} accessibilityLabel={accessibilityLabel}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  if (!apple) {
    // 原生模块不在当前二进制里（只会出现在开发构建）：给一个可用的占位按钮。
    return (
      <TouchableOpacity
        style={[s.button, s.busy]}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={handlePress}
      >
        <Text style={s.fallbackText}>{accessibilityLabel}</Text>
      </TouchableOpacity>
    );
  }

  const { AppleAuthenticationButton, AppleAuthenticationButtonType, AppleAuthenticationButtonStyle } = apple;
  return (
    <AppleAuthenticationButton
      buttonType={kind === "continue" ? AppleAuthenticationButtonType.CONTINUE : AppleAuthenticationButtonType.SIGN_IN}
      buttonStyle={AppleAuthenticationButtonStyle.BLACK}
      cornerRadius={8}
      style={s.button}
      accessibilityLabel={accessibilityLabel}
      onPress={handlePress}
    />
  );
}

const s = StyleSheet.create({
  button: { alignSelf: "stretch", width: "100%", height: 50, marginTop: 6 },
  busy: { backgroundColor: "#000", borderRadius: 8, alignItems: "center", justifyContent: "center" },
  fallbackText: { color: "#fff", fontWeight: "600", fontSize: 17 }
});
