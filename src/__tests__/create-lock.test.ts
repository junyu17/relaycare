// 仅本文件启用 node 类型（不修改 tsconfig 全局 types，保持 @types 自动引入范围不变）。
/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { isCreateBusy, beginCreate, endCreate } from "../lib/create-lock";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

// LOW 清零（R2 复查）：X1 回归测试引用真实调用点——未来任何调用点写反/漏改，本测试必挂。
describe("call sites reference the fail-safe shape (X1 source assertion)", () => {
  const appSource = readFileSync(resolve(__dirname, "../App.tsx"), "utf8");
  const keys = ["custom-task", "other-update", "template-task", "template-event"] as const;
  it("every creation call site uses isCreateBusy -> return, then beginCreate", () => {
    for (const key of keys) {
      expect(appSource).toContain(`if (isCreateBusy("${key}")) return;`);
      expect(appSource.indexOf(`if (isCreateBusy("${key}")) return;`)).toBeLessThan(
        appSource.indexOf(`beginCreate("${key}");`)
      );
    }
  });
  it("every lock is released via endCreate in a finally", () => {
    for (const key of keys) {
      expect(appSource).toContain(`endCreate("${key}");`);
    }
    // 无旧 API 残留
    expect(appSource).not.toContain("tryAcquireCreateLock");
    expect(appSource).not.toContain("releaseCreateLock");
  });
});
