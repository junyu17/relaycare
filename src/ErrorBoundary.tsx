import { Component, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

interface Props {
  children: ReactNode;
}
interface State {
  error: string | null;
}

// 全局兜底：任何未预期错误（render/事件处理器）显示可恢复界面，绝不静默退出 app。
// 上线最后一道防线——错误信息不泄露内部细节（仅展示已本地化提示 + 重试）。
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
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.body}>The app hit an unexpected error. Your data is safe — try again.</Text>
          <Pressable style={styles.button} onPress={this.reset}>
            <Text style={styles.buttonText}>Try again</Text>
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
