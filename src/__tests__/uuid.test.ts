import { describe, expect, it } from "vitest";
import { newClientRequestId } from "../lib/uuid";

describe("newClientRequestId (Bug2)", () => {
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
