// 崩溃回归断言（Hermes 无 WebCrypto）：uuid.ts 必须走 expo-crypto，禁止 globalThis.crypto。
/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { newClientRequestId } from "../lib/uuid";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("newClientRequestId", () => {
  it("returns RFC4122 v4-shaped uuids", () => {
    for (let i = 0; i < 50; i++) {
      const id = newClientRequestId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it("is unique across calls", () => {
    const seen = new Set(Array.from({ length: 100 }, () => newClientRequestId()));
    expect(seen.size).toBe(100);
  });
});

describe("uuid source: crash-resistant crypto loading (white-screen regression)", () => {
  const source = readFileSync(resolve(__dirname, "../lib/uuid.ts"), "utf8");
  it("loads expo-crypto dynamically with try/catch (native-missing must not white-screen)", () => {
    expect(source).toMatch(/require\("expo-crypto"\)/); // 动态 require，非顶层 import
    expect(source).toContain("try {");
    expect(source).toContain("} catch");
    expect(source).not.toMatch(/^import[\s\S]*expo-crypto/m); // 禁止任何顶层静态 import（白屏根因，含副作用导入）
    expect(source).not.toMatch(/globalThis\s*\.\s*crypto/); // 禁止读取 WebCrypto（注释里中文提及允许）
  });
  it("falls back to RFC4122-shaped uuid without throwing", () => {
    expect(newClientRequestId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
