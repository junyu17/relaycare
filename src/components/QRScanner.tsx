import { useState, useEffect } from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import type { Translate } from "../i18n";

// 从扫码结果（深链 taskkin-care://join?code=XXXXXX 或纯 6 位码）提取加入码。
export function parseScannedCode(data: string): string | null {
  const trimmed = data.trim();
  if (/^\d{6}$/.test(trimmed)) return trimmed;
  try {
    const parsed = Linking.parse(trimmed);
    const code = parsed.queryParams?.code;
    if (typeof code === "string" && /^\d{6}$/.test(code)) return code;
  } catch {
    // not a URL
  }
  const match = trimmed.match(/[?&]code=(\d{6})/);
  return match ? match[1] : null;
}

export function QRScanner({
  visible,
  onClose,
  onCode,
  t
}: {
  visible: boolean;
  onClose: () => void;
  onCode: (code: string) => void;
  t: Translate;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    if (visible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setScanned(false);
    }
  }, [visible]);

  const handleBarCode = (result: { data: string }) => {
    if (scanned) return;
    const code = parseScannedCode(result.data);
    if (code) {
      setScanned(true);
      onCode(code);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={s.container}>
        {permission?.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={handleBarCode}
          />
        ) : permission && !permission.granted ? (
          <View style={s.center}>
            <Ionicons name="camera-outline" size={48} color="#94a3b8" />
            <Text style={s.body}>{t("join.cameraDenied")}</Text>
            <TouchableOpacity style={s.btn} onPress={() => requestPermission()}>
              <Text style={s.btnText}>{t("join.grantCamera")}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={s.center}>
            <ActivityIndicator />
          </View>
        )}

        <View style={s.hintBar}>
          <Text style={s.hint}>{t("join.scanning")}</Text>
        </View>
        <TouchableOpacity
          style={s.closeBtn}
          accessibilityRole="button"
          accessibilityLabel={t("paywall.close")}
          onPress={onClose}
        >
          <Ionicons name="close-outline" size={28} color="#fff" />
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  body: { color: "#cbd5e1", fontSize: 14, textAlign: "center", marginVertical: 16 },
  btn: { backgroundColor: "#0f766e", paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8 },
  btnText: { color: "#fff", fontWeight: "700" },
  hintBar: { position: "absolute", bottom: 60, left: 20, right: 20, alignItems: "center" },
  hint: {
    color: "#fff",
    fontSize: 13,
    textAlign: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8
  },
  closeBtn: {
    position: "absolute",
    top: 50,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center"
  }
});
