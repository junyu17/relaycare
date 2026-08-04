import { describe, expect, it } from "vitest";
import { tryAcquireCreateLock, releaseCreateLock } from "../lib/create-lock";

describe("create-lock (S3, SYNC_FIX_REVIEW)", () => {
  it("rejects same-key re-entry while held", () => {
    expect(tryAcquireCreateLock("k")).toBe(true);
    expect(tryAcquireCreateLock("k")).toBe(false); // 连点被拒
    releaseCreateLock("k");
    expect(tryAcquireCreateLock("k")).toBe(true); // 释放后可再获取
    releaseCreateLock("k");
  });

  it("allows different keys concurrently", () => {
    tryAcquireCreateLock("a");
    tryAcquireCreateLock("b");
    expect(tryAcquireCreateLock("b")).toBe(false);
    releaseCreateLock("a");
    releaseCreateLock("b");
  });
});
