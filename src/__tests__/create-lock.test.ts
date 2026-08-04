import { describe, expect, it } from "vitest";
import { isCreateBusy, beginCreate, endCreate } from "../lib/create-lock";

describe("create-lock (S3 + X1, SYNC_FIX_REVIEW)", () => {
  it("call-site pattern: busy -> return, else begin + proceed (X1 regression)", () => {
    // 模拟 App.tsx 调用点形状：忙则 return，否则 begin 后继续。
    // 无 finally（模拟请求在途、锁未释放时的第二次点击）。
    let ran = 0;
    const guarded = (key: string, fn: () => void) => {
      if (isCreateBusy(key)) return; // 忙：直接返回（X1 修复后的正确形状）
      beginCreate(key);
      fn();
    };
    guarded("t", () => {
      ran += 1;
    }); // 第一次：执行，锁在途
    expect(ran).toBe(1);
    guarded("t", () => {
      ran += 1;
    }); // 在途重入：被拒
    expect(ran).toBe(1);
    endCreate("t"); // 请求结束释放
    guarded("t", () => {
      ran += 1;
    }); // 释放后再点：执行
    expect(ran).toBe(2);
    endCreate("t");
  });

  it("busy state is per-key", () => {
    beginCreate("a");
    expect(isCreateBusy("a")).toBe(true);
    expect(isCreateBusy("b")).toBe(false);
    endCreate("a");
    expect(isCreateBusy("a")).toBe(false);
  });
});
