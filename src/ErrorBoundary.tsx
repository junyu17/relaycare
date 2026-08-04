import { Component, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { makeTranslator } from "./i18n";
import { getStoredLanguage } from "./lib/language";

interface Props {
  children: ReactNode;
}
interface State {
  error: string | null;
}

// 全局兜底（最后一道防线）：React 错误边界捕获 **render / 生命周期 / 构造函数** 中抛出的错误
// （注意：事件处理器内的错误不会进入边界——那些路径已由各按钮的 .catch/reportCloudActionFailure 兜底）。
// 错误信息不泄露内部细节；文案跟随已存语言。
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(err: unknown): State {
    return { error: err instanceof Error ? err.message : String(err) };
  }

  componentDidCatch(err: unknown) {
    console.error("ErrorBoundary caught:", err);
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      const t = makeTranslator(getStoredLanguage());
      return (
        <View style={styles.container}>
          <Text style={styles.title}>{t("error.boundaryTitle")}</Text>
          <Text style={styles.body}>{t("error.boundaryBody")}</Text>
          <Pressable style={styles.button} onPress={this.reset} accessibilityRole="button">
            <Text style={styles.buttonText}>{t("error.tryAgain")}</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "#fff" },
  title: { fontSize: 18, fontWeight: "600", marginBottom: 8 },
  body: { fontSize: 14, color: "#555", textAlign: "center", marginBottom: 16 },
  button: { backgroundColor: "#0a7ea4", paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  buttonText: { color: "#fff", fontSize: 15, fontWeight: "600" }
});
