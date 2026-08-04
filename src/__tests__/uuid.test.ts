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

describe("uuid source uses expo-crypto (Hermes crash regression)", () => {
  const source = readFileSync(resolve(__dirname, "../lib/uuid.ts"), "utf8");
  it("imports expo-crypto and never reads globalThis.crypto", () => {
    expect(source).toMatch(/from ['"]expo-crypto['"]/); // 接受单/双引号
    expect(source).not.toContain("globalThis.crypto");
    expect(source).not.toContain("getRandomValues");
  });
});
