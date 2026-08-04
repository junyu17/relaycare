// Y1（Claude 复审）源码断言：事件创建失败必须同时撤回事件与任务乐观行，
// 防止未来把双撤改回单撤（任务乐观行悬空、UI 残留服务端不存在的任务）而测试不拦。
/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("other-update optimistic rollback (Y1 regression guard)", () => {
  const app = readFileSync(resolve(__dirname, "../App.tsx"), "utf8");
  it("eventPromise.catch rolls back BOTH event and task optimistic rows", () => {
    const start = app.indexOf("eventPromise.catch((e) => {");
    const segment = app.slice(start, start + 600);
    expect(segment).toContain("events: cur.events.filter((x) => x.id !== eventId)");
    expect(segment).toContain("tasks: taskId ? cur.tasks.filter((x) => x.id !== taskId) : cur.tasks");
  });
});
