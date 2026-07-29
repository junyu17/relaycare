import { useMemo } from "react";
import { View, StyleSheet } from "react-native";
import makeQR from "qrcode-generator";

// 纯 JS 二维码渲染（无原生依赖）。把 join 深链编码为 QR。
export function QRCode({ value, size = 220 }: { value: string; size?: number }) {
  const modules = useMemo(() => {
    const qr = makeQR(0, "M");
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    const grid: boolean[][] = [];
    for (let r = 0; r < count; r += 1) {
      const row: boolean[] = [];
      for (let c = 0; c < count; c += 1) {
        row.push(qr.isDark(r, c));
      }
      grid.push(row);
    }
    return grid;
  }, [value]);

  const count = modules.length;
  if (!count) return null;
  const cell = size / count;

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      {modules.map((row, r) => (
        <View key={r} style={styles.row}>
          {row.map((dark, c) => (
            <View key={c} style={{ width: cell, height: cell, backgroundColor: dark ? "#0f766e" : "transparent" }} />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: "#fff", padding: 12, borderRadius: 8, alignSelf: "center" },
  row: { flexDirection: "row" }
});
