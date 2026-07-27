import { describe, expect, it, vi, beforeEach } from "vitest";

// 原生模块在 node/vitest 环境不可用；mock 掉以隔离测试 OCR 工厂的选择逻辑。
vi.mock("@dariyd/react-native-text-recognition", () => ({ recognizeText: vi.fn() }));

describe("getOcrProvider mode selection", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("selects the on-device provider when EXPO_PUBLIC_OCR_MODE=device (production default)", async () => {
    vi.stubEnv("EXPO_PUBLIC_OCR_MODE", "device");
    const { getOcrProvider } = await import("../lib/ocr/providers");
    expect(getOcrProvider().name).toBe("device");
  });

  it("falls back to the on-device provider when the env var is unset (safe production default)", async () => {
    vi.stubEnv("EXPO_PUBLIC_OCR_MODE", "");
    const { getOcrProvider } = await import("../lib/ocr/providers");
    expect(getOcrProvider().name).toBe("device");
  });

  it("uses the mock provider only when explicitly set (Expo Go dev fallback)", async () => {
    vi.stubEnv("EXPO_PUBLIC_OCR_MODE", "mock");
    const { getOcrProvider } = await import("../lib/ocr/providers");
    expect(getOcrProvider().name).toBe("mock");
  });
});
