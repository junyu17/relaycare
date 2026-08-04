# 多设备同步修复复审（第 2 轮）

复审日期：2026-08-04
范围：`85ab395..41c2447`（4 个 commit，15 个文件，+836 / −130）
迁移：0048 / 0049 / 0050 / 0051
依据：[SYNC_FIX_REVIEW_2026-08-03.md](./SYNC_FIX_REVIEW_2026-08-03.md) 的 S1–S7 + 方案 2 规格（P0/P1/P2）
复审人：Claude（Opus 5）

## 结论

**第 1 轮：NO-GO（1 项阻断）→ 整改后复查：GO。** 详见第六节。

S1 / S2 / S7 / P0 / P1 / P2 / S6 全部正确关闭，质量很高（0051 的跨家庭 id 占用处理是主动加固，超出规格）。

唯一的问题是 **S3 的防重入锁在 4 个调用点全部写反了**，导致 cloud 模式下**创建任务 / 时间线的第一次点击什么都不做**。这是核心功能的阻断级回归，必须先修才能进真机测试。

门禁全绿：typecheck / lint / **58 tests**（56 → 58）/ prettier —— 但锁的单测只测了模块本身（语义正确），没覆盖调用点，所以绿灯没拦住。

---

## 一、阻断项

### X1　`tryAcquireCreateLock` 的判断反了 —— 创建功能实际半瘫

`src/lib/create-lock.ts` 模块本身写得对：

```ts
export function tryAcquireCreateLock(key: string, timeoutMs = 30_000): boolean {
  const heldUntil = locks.get(key) ?? 0;
  if (heldUntil > now) return false; // 已被占用 → 拒绝
  locks.set(key, now + timeoutMs);
  return true; // 拿到锁 → 允许继续
}
```

`create-lock.test.ts:6-7` 也断言了这个语义（第一次 `true`、第二次 `false`）。

但 **4 个调用点全部写成了相反的判断**：

```
src/App.tsx:535   if (tryAcquireCreateLock("custom-task")) return;      // 自定义任务
src/App.tsx:602   if (tryAcquireCreateLock("other-update")) return;     // 时间线 + 可选任务
src/App.tsx:934   if (tryAcquireCreateLock("template-task")) return;    // 模板任务
src/App.tsx:977   if (tryAcquireCreateLock("template-event")) return;   // 模板时间线
```

`true` 表示**成功拿到锁、应该继续**，代码却在这时 `return`。实际行为变成：

| 操作        | 锁状态 | `tryAcquire` 返回              | 代码走向 | 结果                              |
| ----------- | ------ | ------------------------------ | -------- | --------------------------------- |
| 第 1 次点击 | 空闲   | `true`（**并把锁占住 30 秒**） | `return` | **什么都没发生**，也没有任何提示  |
| 第 2 次点击 | 占用中 | `false`                        | 继续执行 | 任务创建成功，`.finally()` 释放锁 |
| 第 3 次点击 | 空闲   | `true`（再占 30 秒）           | `return` | 又什么都没发生                    |

也就是说：**每次创建都必须点两下，而且第一下会静默吞掉**。更糟的是第 1 次点击后如果用户等超过 30 秒，锁自然过期，下一次点击又落回"什么都不做"。

这比原来的重复提交问题严重得多 —— 原来是多建一条（可删），现在是**核心功能一半时间不工作，且无任何反馈**。

Local（演示）模式不受影响，因为守卫只在 `if (cloud)` 分支内。

**修复**：4 处各加一个 `!`。

```ts
if (!tryAcquireCreateLock("custom-task")) return;
```

**并补一条能拦住它的测试** —— 现在的单测只验证模块语义，调用点写反它测不到。建议在 `create-lock.ts` 里换个不会用反的 API 形状，从根上消除歧义：

```ts
// 语义写进名字，调用点不可能反着用
export function isCreateBusy(key: string): boolean { ... }   // true = 忙，应该 return
export function beginCreate(key: string): void { ... }
export function endCreate(key: string): void { ... }
```

或者保留现名但让它返回 `null | release` 函数，拿不到锁时返回 `null` —— 调用点写成 `const release = tryAcquire(...); if (!release) return;`，反用会立刻类型报错。

---

## 二、中低优先级

### X2（中）　时间线创建失败时会弹两次错误框

`src/App.tsx:657-670`：

```ts
const taskPromise = eventPromise.then(() => { ... });
eventPromise.catch((e) => { 撤事件; reportCloudActionFailure(e); });
taskPromise.catch((e) => { 撤任务; reportCloudActionFailure(e); }).finally(...);
```

`taskPromise` 派生自 `eventPromise`，所以**事件创建失败时两个 catch 都会触发**，`reportCloudActionFailure` 被调用两次 → 用户连续看到两个内容相同的错误弹窗。

分侧回滚的思路是对的（这正是上一轮我提的），只是链式派生把失败也传下去了。改法：

```ts
const taskPromise = eventPromise.then(
  () => {
    /* 建任务 */
  },
  () => undefined // 事件已失败：静默跳过，不再重复报错
);
```

### X3（低）　0050 已被 0051 完全取代

`0050_task_id_conflict_error.sql` 用 `exists` 预探测判断 id 占用，`0051` 改成 `unique_violation` 捕获并说明了原因（跨家庭 id 唯一约束不经过 RLS、`exists` 探测查不到；顺带消除 TOCTOU）。两者都是 `create or replace`，顺序执行后生效的是 0051，**功能上没问题**。

只是仓库里留了一个一天就作废的迁移。如果 0050 已经 push 到生产，按约束 C7 不要回改；记录在案即可。

---

## 三、验收通过的部分

| 项                                     | 结论 | 证据                                                                                                                                                      |
| -------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S1** members 硬删                    | ✅   | `0048:6` `alter table public.members replica identity full;`，注释还纠正了 0045 的误判（"invite_status 只是业务标记，行确实被 delete 移除"）              |
| **S2** audit 刷新风暴                  | ✅   | `0048:11` 回退为 `default`，注释写明了每日 03:00 UTC 批量删除的场景                                                                                       |
| **S7/P0** 乐观通道                     | ✅   | `CloudProps.applyOptimistic`（`App.tsx:233`）+ `LocalApp` 包装（`242-245`）；乐观删除已改走它（`467/470/494/502`）；`onRemoveMember` 也一并改了（`1065`） |
| **P0-4** 缓存不再被乐观污染            | ✅   | 全文件 `cacheHouseholdState` 只剩 `App.tsx:1686` 一处，在 `guardedFetch` 内部，写的是服务端真实快照                                                       |
| **P0-5** 污染缓存兜底                  | ✅   | `db.ts:352` `parsed.household.id !== householdId` → 丢弃。老用户机器上已存的演示数据会被自动清掉                                                          |
| **P1** 任务乐观插入                    | ✅   | `0049` 加 `p_task_id`（末位、向后兼容）；客户端 `optimisticId` 同时作 `task.id` 与 `client_request_id`（`App.tsx:536`），id 一致 → refetch 原地替换不闪烁 |
| **P2** 事件乐观插入                    | ✅   | `actions.ts:157` upsert payload 带 `id`，无需迁移；事件与任务各自独立乐观行、独立回滚（回滚正确性见 X2）                                                  |
| **硬约束 1** 不伪造 audit/notification | ✅   | 4 个入口的乐观插入与回滚都只动 `tasks` / `events`，逐一核对无误                                                                                           |
| **S6** 错误透传                        | ✅   | `App.tsx:1707` 用 `firstLoadError` 而非 `new Error("load failed")`；还额外加了缓存回退前的 seq 竞态防护（`1703-1705`）                                    |

**主动加固，超出规格：**

- **`0051` 的跨家庭 id 占用处理**。规格里我只说"uuid 碰撞概率可忽略，让它报 23505"。实现走得更远：用 `unique_violation` 捕获而非 `exists` 预探测，理由写得很准 —— 唯一约束不经过 RLS，`exists` 在跨家庭场景查不到目标行，会漏判；同时消除了 check-then-insert 的 TOCTOU，并保证并发幂等撞键时走回查而不是误报 `TASK_ID_TAKEN`。三个点都对。
- **`uuid.ts` 换成 CSPRNG**。原来的 `Math.random()` fallback 理论上可预测 → 配合客户端指定主键，存在预占他人任务 id 的路径。现在 `crypto.getRandomValues`，且无 WebCrypto 时**显式抛错而不是降级**。这个判断很好 —— 引入客户端指定主键之后，请求 id 的随机性质从"防碰撞"升级成了"防预测"。
- `paywall/prices.ts` 抽出价格常量、`Alert.alert("Error", ...)` 改成 i18n 标题 —— 顺手清掉的散落硬编码。

---

## 四、修复清单

1. **X1** 4 处加 `!`（`App.tsx:535 / 602 / 934 / 977`）← **阻断，先修**
2. **X1 加固** `create-lock` 换成不可能用反的 API 形状 + 补一条覆盖调用点的测试
3. **X2** `eventPromise.then(onOk, () => undefined)`，避免双重错误弹窗

前两项加起来 20 分钟。

## 五、验收（修完后两台设备各跑一遍）

| #   | 操作                                                   | 期望                                                    |
| --- | ------------------------------------------------------ | ------------------------------------------------------- |
| 1   | **点一次**"新建任务"                                   | **一次就建成**，任务立刻出现（← X1）                    |
| 2   | 连点 3 次模板任务                                      | 只出现 1 条                                             |
| 3   | 弱网新建                                               | 立刻出现，refetch 后不闪烁、不重复                      |
| 4   | 断网新建                                               | 先出现，随后撤回 + **一个**错误提示（← X2）             |
| 5   | A 删任务 / 删时间线                                    | 本机立刻消失，B 设备 1 秒内同步                         |
| 6   | A 移除成员 C                                           | **B 的 Care circle 里 C 消失**（← S1，本轮重点）        |
| 7   | C 自己退出家庭                                         | A / B 都看到 C 消失                                     |
| 8   | 断网冷启动                                             | 显示本家庭缓存，**不是 Chen Family 演示数据**（← P0-5） |
| 9   | 手动执行 `select public.cleanup_audit_by_retention();` | 在线客户端不出现大量刷新（← S2）                        |

第 1 条是本轮新增的必查项 —— 整改前会失败，整改后已修复（见第六节）。

---

## 六、整改复查（`41c2447..8ec1ced`，5 个 commit）

**结论：X1 / X2 / X3 全部关闭，可以进真机测试。** 新发现 1 项中等（Y1），是 X2 修复顺带带出来的错误路径遗漏，建议一并修但不阻断。

门禁全绿：typecheck / lint / **60 tests**（58 → 60）/ prettier。App.tsx 的改动经逐行核对，只有锁与 X2 两处，无其他夹带。

### X1　✅ 关闭，而且是按"从根上消除歧义"的方式修的

没有简单加 `!` 了事，而是把 API 换成了防呆形状：

```ts
export function isCreateBusy(key: string): boolean; // 名字即语义：忙 → 调用点 return
export function beginCreate(key: string): void;
export function endCreate(key: string): void;
```

4 个调用点（`App.tsx:535 / 603 / 941 / 985`）全部改成 `if (isCreateBusy(k)) return; beginCreate(k);`，`endCreate` 在 `.finally()` 里。这种形状**读一眼就不可能反着理解**。

更好的是补了一条**源码断言回归测试**（`create-lock.test.ts:40-60`）：直接读 `App.tsx` 文本，断言 4 个 key 都出现 `if (isCreateBusy("<key>")) return;`、且其位置在 `beginCreate` 之前，并断言旧 API 名 `tryAcquireCreateLock` / `releaseCreateLock` 已彻底消失。

这正好补上了上一轮门禁失灵的原因 —— 单测只测模块、不测调用点。以后任何调用点写反或漏改，这条测试必挂。

### X2　✅ 关闭

`eventPromise.then(onOk, () => undefined)`（`App.tsx:645-663`），事件失败时派生链静默跳过，错误只由 `eventPromise.catch` 弹一次。

### X3　✅ 按 C7 处理

0050 未回改，只在 `QA_Log.md` 记录"已被 0051 取代、生产生效 0051"。符合"不改写已应用迁移"的约束。

---

### Y1（中）　X2 的修复漏了任务侧回滚 —— 事件失败会留下幽灵任务

`App.tsx:618-631` 在发请求**之前**就插入了两条乐观行（事件 + 可选任务）。现在的回滚分工是：

| 失败方           | 事件乐观行                   | 任务乐观行                  |
| ---------------- | ---------------------------- | --------------------------- |
| 任务创建失败     | 保留（正确，事件已落库）     | `taskPromise.catch` 撤回 ✅ |
| **事件创建失败** | `eventPromise.catch` 撤回 ✅ | **无人撤回** ❌             |

因为 X2 让 `taskPromise` 在事件失败时**走 resolve**（`onRejected → undefined`），`taskPromise.catch` 就不再触发了 —— 而任务的回滚恰恰挂在那个 catch 上。

后果：勾选了"同时创建任务"、而事件创建失败时，UI 里会**留下一条服务端根本不存在的任务**。失败本身不触发 refetch，所以它会一直挂着，直到别处产生 realtime 事件或用户切换家庭 / 重启才被整份快照冲掉。期间用户还能点它去 claim / complete，然后收到莫名其妙的服务端报错。

**修复**：事件失败时任务从未发起，两条乐观行一起撤。

```ts
eventPromise.catch((e) => {
  applyOptimistic((cur) => ({
    ...cur,
    events: cur.events.filter((x) => x.id !== eventId),
    tasks: taskId ? cur.tasks.filter((x) => x.id !== taskId) : cur.tasks // Y1：事件失败 → 任务未发起，一并撤回
  }));
  reportCloudActionFailure(e);
});
```

验收补一条：**勾选"同时创建任务" + 断网 → 提交 → 事件和任务两条都要消失，且只弹一个错误框。**

### Y2（低）　QA_Log 的测试数字过期

`QA_Log.md` 的 R2 整改条目写 "vitest 58/58"，实际是 60/60 —— 那条记录写于 `05c2612`，后面 3 个 commit 又补了源码断言测试。不影响任何东西，下次更新顺手改掉即可。

### 已核实无问题

`tsconfig.json` 新增 `"types": ["node"]` 我特意查了一遍：`@types/node@26.1.2` 本来就在 `node_modules/@types` 里，而 `expo/tsconfig.base` 没有设 `types` 字段 —— 也就是说改之前**所有** @types 包（含 node）就已经全局自动引入了。这次显式声明反而把范围**收窄**成只有 node（chai / emscripten / yargs 等全局声明被排除掉了）。不是放宽类型安全网，可以放心。
