// 账号相关的界面流程（弹窗）：绑定 Apple 的结果处理、退出警告、删除账号、付款人提示。
// App.tsx 和 AuthScreen.tsx 共用，保证每个入口的行为一致。
import { Alert, Linking } from "react-native";
import type { Translate } from "../i18n";
import { localizedErrorMessage } from "../lib/error";
import type { BindResult, SignOutResult } from "./AuthContext";
import type { SignOutOptions } from "./guards";
import { accountIdLabel } from "./guards";

// 和网站删除页、隐私页上公开的联系邮箱一致。
export const SUPPORT_EMAIL = "Billy.yu@me.com";

export function openSupportEmail(t: Translate, userId?: string | null): void {
  const subject = encodeURIComponent(t("bind.supportEmailSubject"));
  const body = encodeURIComponent(t("bind.supportEmailBody", { id: accountIdLabel(userId) }));
  void Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`).catch(() =>
    Alert.alert(t("bind.supportContact"), SUPPORT_EMAIL)
  );
}

// 4a(c)：两边都有数据，什么都不删也不切换。
export function showBothHaveData(t: Translate, userId?: string | null): void {
  Alert.alert(t("bind.alreadyHasDataTitle"), t("bind.alreadyHasData"), [
    { text: t("bind.supportContact"), onPress: () => openSupportEmail(t, userId) },
    { text: t("settings.continue"), style: "cancel" }
  ]);
}

// 执行一次绑定并处理结果。返回值让调用方决定是否继续原本要做的动作（例如生成加入码、订阅）。
export async function runBindFlow(
  bind: () => Promise<BindResult>,
  t: Translate,
  options: { userId?: string | null; announceLinked?: boolean } = {}
): Promise<BindResult | "failed"> {
  try {
    const result = await bind();
    if (result === "linked" && options.announceLinked !== false) {
      Alert.alert(t("bind.linkedTitle"), t("bind.linked"));
    } else if (result === "switched") {
      Alert.alert(t("bind.linkedTitle"), t("bind.switched"));
    } else if (result === "both_have_data") {
      showBothHaveData(t, options.userId);
    }
    return result;
  } catch (e) {
    Alert.alert(t("auth.error"), localizedErrorMessage(e, t));
    return "failed";
  }
}

// 所有退出入口共用：已绑定直接退出；匿名会话弹三选项警告（先用 Apple 登录 / 仍然退出 / 取消）。
// 「先用 Apple 登录」打开带官方 Apple 按钮的绑定弹层，不在系统弹窗里直接发起授权。
export async function promptSignOut(args: {
  t: Translate;
  requestSignOut: () => Promise<SignOutResult>;
  signOut: (options?: SignOutOptions) => Promise<SignOutResult>;
  appleAvailable: boolean;
  onProtectFirst: () => void;
}): Promise<void> {
  const { t } = args;
  let result: SignOutResult;
  try {
    result = await args.requestSignOut();
  } catch (e) {
    Alert.alert(t("auth.error"), localizedErrorMessage(e, t));
    return;
  }
  if (result !== "needs_confirmation") return;
  Alert.alert(t("settings.anonSignOutTitle"), t("settings.anonSignOutWarning"), [
    ...(args.appleAvailable ? [{ text: t("bind.protectFirst"), onPress: args.onProtectFirst }] : []),
    {
      text: t("settings.signOutAnyway"),
      style: "destructive" as const,
      onPress: () => {
        void args
          .signOut({ confirmedAnonymousLoss: true })
          .catch((e) => Alert.alert(t("auth.error"), localizedErrorMessage(e, t)));
      }
    },
    { text: t("settings.cancel"), style: "cancel" as const }
  ]);
}

// 付款人在转让、退出、解散、删号之前看到：Apple 会继续扣费，以及取消的路径。
export function confirmSubscriptionStillCharging(t: Translate): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      t("settings.subscriptionStillChargingTitle"),
      t("settings.subscriptionStillCharging"),
      [
        { text: t("settings.cancel"), style: "cancel", onPress: () => resolve(false) },
        { text: t("settings.continue"), onPress: () => resolve(true) }
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });
}

// 删除账号：付款人先看扣费提示 → 确认（绑定了 Apple 的会再做一次 Apple 授权，用来撤销授权）→ 删除并登出。
export async function runDeleteAccountFlow(args: {
  t: Translate;
  hasAppleIdentity: boolean;
  isPayer: () => Promise<boolean>;
  deleteAccount: () => Promise<"deleted" | "cancelled">;
}): Promise<void> {
  const { t } = args;
  const payer = await args.isPayer().catch(() => false);
  if (payer && !(await confirmSubscriptionStillCharging(t))) return;
  const message = args.hasAppleIdentity
    ? `${t("settings.deleteAccountConfirm")}\n\n${t("settings.deleteAppleNote")}`
    : t("settings.deleteAccountConfirm");
  Alert.alert(t("settings.deleteAccountTitle"), message, [
    { style: "cancel", text: t("paywall.close") },
    {
      style: "destructive",
      text: t("settings.deleteAccountTitle"),
      onPress: () => {
        args.deleteAccount().catch((e) => Alert.alert(t("alerts.actionFailedTitle"), localizedErrorMessage(e, t)));
      }
    }
  ]);
}
