# 多设备同步修复复审（Bug1 删除不同步 / Bug2 重复提交）

复审日期：2026-08-03
范围：`bc784e6..85ab395`（2 个 commit，9 个文件，+503 / −66）
迁移：0045 / 0046 / 0047
复审人：Claude（Opus 5）

## 结论

**部分通过。** 任务 / 时间线 / 文档 的删除同步确实修好了（靠 realtime + refetch），但有三处需要返工：**"权限"（成员）这一类没修到**（0045 的注释把它判断反了）、多加了一张不该加的表（每日凌晨刷新风暴）、以及新增的乐观删除在 cloud 模式其实是空操作并且把演示数据写进了真实家庭的离线缓存。

**方案 2（乐观插入）的实施规格见第三节**，可直接交给 Codex。

门禁全绿：typecheck / lint / **56 tests**（54 → 56）/ prettier。

| 类别 | 数量                                                                                    |
| ---- | --------------------------------------------------------------------------------------- |
| 高   | 3（S1 成员删除仍不同步、S2 审计表刷新风暴、S7 乐观删除空操作 + 离线缓存被演示数据污染） |
| 中   | 3（S3 防重入失效、S4 幂等键挡不住实际场景、S5 幂等键挂可空列）                          |
| 低   | 1（S6 首次加载错误信息被吞）                                                            |

---

## 一、高优先级

### S1　`members` 缺 `REPLICA IDENTITY FULL` —— "权限同步"没修到

`0045_realtime_delete_and_idempotency.sql:13` 的注释写着：

> 注：members/households/role_notifications 走 UPDATE/INSERT 事件（新值完整），无需 FULL。

以及第 5 行：

> members 软删因此正常

**这两句都是错的。`members` 是硬删，共 5 处：**

```
0011_paywall_security.sql:149    delete from public.members where user_id = p_user_id;    -- 删除账号
0014_join_codes.sql:194          delete from public.members where id = v_member.id;       -- 成员退出
0014_join_codes.sql:223          delete from public.members where id = p_member_id;       -- 协调人移除成员
0015_member_notifications.sql:119  delete from public.members where id = v_member.id;     -- 同上（0015 覆盖版）
0015_member_notifications.sql:159  delete from public.members where id = p_member_id;
```

而 `src/lib/db.ts:367` 订阅 `members` 时用了 `filter: household_id=eq.${householdId}` —— 与 tasks 完全相同的结构。所以**成员被移除 / 主动退出后，其他设备的 Care circle 里那个人不会消失**，和原来的任务删除问题一模一样。

这正是你说的"权限"同步的核心场景，目前没有覆盖到。

注意 0047 已经给 `households` 补了 FULL（第 5 行注释"解散家庭硬删场景"）—— 说明当时已经意识到 0045 的判断有误，但只补了 households，漏了 members。

**修复**（新迁移 0048）：

```sql
alter table public.members replica identity full;
```

### S2　`audit_events` 不该加 FULL —— 每日凌晨会触发刷新风暴

`0045:11` 加了 `alter table public.audit_events replica identity full;`

`cleanup_audit_by_retention()`（0040）由 pg_cron **每天 03:00 UTC 批量删除**过期审计。加了 FULL 之后：

```
删除 N 行 → N 个带完整旧元组的 DELETE 事件
         → 每个都匹配 filter household_id=eq.X
         → 每个都触发 onChanged
         → 每个都调一次 guardedFetch()
         → 每次都是 8 张表的全量并行查询
```

`refetchSeq` 守卫只保证**旧快照不覆盖新快照**，它**不会阻止请求发出**。所以 N 次删除 = N 次完整的 `fetchHouseholdState` HTTP 往返，对每个在线客户端。一个积累了几个月审计的家庭，跨过 30 天 / 3 年边界那天可能是几百行。

而且客户端**根本不需要感知保留期清理** —— 那是不可见的后台维护。

**修复**（并入 0048）：

```sql
alter table public.audit_events replica identity default;
```

### S7　`setState` 在 cloud 模式是空操作 —— 乐观删除没生效，而且污染了离线缓存

`src/App.tsx:231-233`：

```ts
const [localState, setLocalState] = useState<AppState>(initialState); // initialState = data.ts 的演示数据
const rawState = cloud ? cloud.state : localState; // cloud 模式读的是 cloud.state
const setState = setLocalState; // 但 setState 写的是 localState
```

在 cloud 模式下，UI 读 `cloud.state`（由 `CloudApp` 的 `useState` 持有），而 `setState` 写的是 `localState` —— **两者毫无关系**。`CloudProps`（`App.tsx:219-227`）也没有暴露任何 setter。

于是本轮新增的乐观删除（`App.tsx:455-469`、`483-500`）产生两个后果：

**1. 乐观删除在 cloud 模式完全无效。** 删除后列表变化其实来自 realtime → refetch，不是来自这段代码。回滚逻辑同样是死代码。

**2. 更麻烦的是，离线缓存被演示数据污染：**

```ts
setState((current) => {                                    // current = localState = 演示数据
  const next = { ...current, tasks: current.tasks.filter(...) };
  void cacheHouseholdState(cloud.householdId, next);       // ← 把演示数据写进【真实家庭】的缓存
  return next;
});
```

`current` 是 `initialState`（`src/data.ts:3`，"Chen Family Care Circle" / Maya Chen / Eli Chen 那套演示数据），却被以 `taskkin-care:household:<真实householdId>` 为 key 写进了 AsyncStorage。

之后只要有一次 `fetchHouseholdState` 失败（弱网、断网冷启动），`CloudApp` 的回退分支就会 `getCachedHouseholdState(householdId)` 读出这份演示数据并 `setState(cached)` —— **用户会看到一个不属于自己的假家庭**，里面是 Chen 家的成员和任务。

严重度高，且是本轮新引入的。我上一轮夸了这段"乐观删除 + 失败回滚"，当时没核查 `setState` 在 cloud 模式的语义，判断有误。

**修复**：见第三节 P0 —— 与方案 2 是同一处架构改动，一起做。

---

## 二、中优先级

### S3　`createInFlight` 用 `useState`，挡不住同一批次的连点

`src/App.tsx:368`：

```ts
const [createInFlight, setCreateInFlight] = useState<string | null>(null);
```

`src/App.tsx:364` 的注释写"事件处理器内同步置位" —— **`useState` 的 setter 不是同步的**，它不会更新当前闭包里的 `createInFlight`。同一个事件循环批次内的两次点击（快速双击、双指同时点）都会读到 `null`，然后都放行。

`useRef` 才是同步的：

```ts
const createInFlightRef = useRef<string | null>(null);
// ...
if (createInFlightRef.current) return;
createInFlightRef.current = "custom-task";
// finally: createInFlightRef.current = null;
```

一行改动，4 个调用点（529 / 578 / 873 / 899）一起换。

### S4　幂等键每次点击重新生成 —— 挡不住你实际遇到的场景

四个创建入口都是 `clientRequestId: newClientRequestId()` —— **每次调用现生成一个新 uuid**。

这意味着：

| 场景                          | 幂等键能挡吗                                          |
| ----------------------------- | ----------------------------------------------------- |
| 同一请求因网络问题被 SDK 重试 | ✅ 能（同一个 id）                                    |
| **用户点了两次**              | ❌ **不能**（两个不同 id → 服务端认为是两个独立请求） |

而你报告的正是后者，且更麻烦的是时序：

```
点第 1 次 → 请求成功返回 → createInFlight 已置回 null → UI 还没 refetch 出来
         → 用户以为失败 → 点第 2 次 → 守卫是 null，放行 → 第 2 条任务
```

`createInFlight` 只覆盖"请求进行中"这个窗口，而用户重复点击恰恰发生在**请求已完成、UI 还没更新**的窗口。两道防线都没盖住实际发生的那一刻。

最容易复现的是模板任务 / 模板时间线（`onCreateTemplateTask` / `onCreateTemplateEvent`）—— 那是首页上的一键按钮，点完不会关弹窗，重复点的门槛最低。

**已定方案 2（乐观插入）** —— 用户点完立刻看到任务，就不会再点第二次，这是治本。实施规格见第三节。

配合 S3 的 `useRef` 后两条路径全覆盖：乐观插入解决"以为没成功所以再点"，`useRef` 解决"同一批次连点"。原先考虑的"requestId 按内容缓存"方案不再需要。

### S5　`care_events` 幂等键挂在可空的 `owner_id` 上

0046 把索引从部分索引改成非部分索引：

```sql
create unique index care_events_request_dedup_idx on public.care_events (owner_id, client_request_id);
```

**0046 的判断本身是对的** —— PostgREST 的 `.upsert(onConflict)` 确实无法推断带 `WHERE` 的部分索引，而标准 btree 唯一索引里 NULL 互不冲突，唯一性语义等价。这个分析没问题。

但 `care_events.owner_id` 是 `references members(id) on delete set null`（`0001:107`），**可空**。owner_id 为 NULL 时唯一索引形同虚设，完全不去重。

当前 `addTimelineEvent` 总是传 `args.actor.id`，插入时非空，**所以暂时不会触发**。只是比 tasks 用 `NOT NULL` 的 `requested_by_id` 脆一档。记录在案，不必现在改。

### S6（低）　首次加载失败的真实错误被吞掉了

`src/App.tsx` 重构后：

```ts
if (cached) setState(cached);
else setErr(errorMessage(new Error("load failed")));
```

原来这里是 `setErr(errorMessage(e))`，会显示真实错误。现在 fetch 和缓存双双失败时，用户和你都只看到 "load failed"，排障没有任何线索。把原始 error 透传回来即可。

---

## 三、方案 2 实施规格（乐观插入）——交给 Codex

> 你已选定方案 2。以下是可直接执行的规格。**必须先做 S7 的架构修复**，否则乐观插入会和乐观删除踩同一个坑（写进 `localState`，cloud 模式下看不到任何效果）。

### P0　打通 cloud 模式的乐观更新通道（前置，必做）

**1. `CloudProps` 增加一个受控的乐观更新入口**（不要直接暴露 `setState`，避免调用方误写整份 state）：

```ts
interface CloudProps {
  state: AppState;
  applyOptimistic: (fn: (s: AppState) => AppState) => void; // 新增
  actor: Member;
  // ...其余不变
}
```

`CloudApp` 传入：

```ts
applyOptimistic={(fn) => setState((s) => (s ? fn(s) : s))}
```

**2. `LocalApp` 内统一走一个函数，两种模式都正确：**

```ts
const applyOptimistic = (fn: (s: AppState) => AppState) => {
  if (cloud) cloud.applyOptimistic(fn);
  else setLocalState(fn);
};
```

**3. 把已有的乐观删除改成走 `applyOptimistic`**（`onDeleteTask` / `onDeleteEvent` 各两处：乐观移除 + 失败回滚）。

**4. 🔴 删掉乐观更新里的 `cacheHouseholdState(...)` 调用。** 离线缓存只应由 `CloudApp` 的 `guardedFetch()` 用**服务端真实快照**写入。乐观状态是未确认的本地推测，不能进缓存。

**5. 清理被污染的缓存**：这一版发出去时，老用户机器上可能已经存了演示数据。在 `getCachedHouseholdState` 里加一道校验——读出来的 `state.household.id !== householdId` 就丢弃并返回 `null`。这条同时也是对未来同类 bug 的兜底。

### P1　任务乐观插入（客户端生成 id，无闪烁）

**迁移 0049**：让 `create_task_with_activity` 接受客户端指定的主键，使乐观行与服务端行 **id 相同**，refetch 时原地替换，不会出现"先消失再出现"的闪烁或 list key 抖动。

```sql
-- 0049: 任务乐观插入——允许客户端指定主键（id 一致，refetch 原地替换不闪烁）
create or replace function public.create_task_with_activity(
  p_household_id uuid, p_title text, p_expected_minutes integer, p_due_at timestamptz,
  p_priority text, p_subtasks jsonb default '[]'::jsonb, p_event_id uuid default null,
  p_document_id uuid default null, p_client_request_id uuid default null,
  p_task_id uuid default null                                    -- 新增，置于末位保持向后兼容
) returns uuid ...
  insert into public.tasks (id, household_id, ...)
  values (coalesce(p_task_id, gen_random_uuid()), p_household_id, ...)
  on conflict (requested_by_id, client_request_id) do nothing    -- 0047 的幂等逻辑保持不变
  returning id into v_task_id;
```

其余分支（幂等命中回查、审计、通知）**一行都不要改**。

**客户端**（`onCreateCustomTask` / `onCreateTemplateTask` 两处）：

```ts
const id = newClientRequestId(); // 同时作为 task.id 与 client_request_id
const optimistic: Task = {
  id,
  title: args.title,
  expectedMinutes: args.expectedMinutes,
  dueAt: args.dueAt,
  priority: args.priority,
  status: "open",
  requestedById: actor.id,
  subtasks: [],
  createdAt: new Date().toISOString()
};
applyOptimistic((s) => ({ ...s, tasks: [optimistic, ...s.tasks] }));
cloudActions.createTask({ ...原有参数, taskId: id, clientRequestId: id }).catch((e) => {
  applyOptimistic((s) => ({ ...s, tasks: s.tasks.filter((x) => x.id !== id) })); // 失败撤回
  reportCloudActionFailure(e);
});
```

`src/lib/actions.ts` 的 `createTask` 增加 `taskId?: string` 参数，透传为 `p_task_id`。

### P2　时间线事件乐观插入（不需要迁移）

`addTimelineEvent` 是客户端直接 `.upsert()`，在 payload 里带上 `id` 即可：

```ts
const id = newClientRequestId();
applyOptimistic((s) => ({ ...s, events: [optimisticEvent, ...s.events] }));
// actions.addTimelineEvent 的 upsert payload 增加 id: args.eventId ?? undefined
```

`onCreateOtherTimelineUpdate`（`App.tsx:578`）里的"事件 + 可选任务"两步，各自独立乐观插入、各自独立回滚。

### 三条硬约束

1. **只插入 `tasks` / `events` 行，绝对不要伪造 `auditEvents` / `roleNotifications`。** 那两类由服务端产生，伪造出来会在 refetch 时闪一下就消失，比没有还糟。
2. **保留 S3 的 `useRef` 防重入。** 两者互补：乐观插入解决"以为没成功所以再点"，`useRef` 解决"同一批次连点"。
3. **S4 的 requestId 缓存方案不用做了。** 乐观插入让用户立刻看到结果，`useRef` 挡住同批次连点，两条路径都覆盖了。

### 可选（低优先级）

`confirmDocumentAndCreateTask`（`App.tsx:702`）也是创建任务路径，同样没有即时反馈。可以照 P1 处理，但不是你报告的场景，可以留到 1.0.1。

### 验收

| #   | 操作                      | 期望                                                                  |
| --- | ------------------------- | --------------------------------------------------------------------- |
| 1   | 弱网下点"新建任务"        | 任务**立刻**出现在列表；refetch 回来后**不闪烁、不重复**              |
| 2   | 断网点新建                | 任务先出现，随后被撤回并提示失败                                      |
| 3   | 快速连点模板任务按钮 3 次 | 只出现 1 条                                                           |
| 4   | A 新建任务                | B 设备 1 秒内出现（走 realtime，与乐观无关）                          |
| 5   | 删除任务                  | **本机立刻消失**（S7 修完才会通过；此前是等 refetch）                 |
| 6   | 断网冷启动                | 显示的是本家庭的缓存数据，**不是 Chen Family 演示数据**（S7 第 5 点） |

---

## 四、做对的部分

### refetch 序号守卫　⭐ 超出我提的范围

```ts
let refetchSeq = 0;
const seq = ++refetchSeq;
...
if (!active || seq !== refetchSeq) return false;  // 有更新的请求已发出，丢弃旧结果
```

这是主动发现的真问题：DELETE 事件修好之后会出现**突发的连续事件**，多个 `fetchHouseholdState` 并发在途，先发的后回就会用旧快照覆盖新快照——删除的行会"复活"，看起来像修了个 bug 又冒出来一个。这个守卫正确解决了它。

### 乐观删除 + 失败回滚

回滚前先 `current.tasks.some(...)` 检查，避免 realtime 已经收敛后重复插入。考虑得细。

### 0047 的原子幂等

```sql
insert into ... on conflict (requested_by_id, client_request_id) do nothing returning id into v_task_id;
if v_task_id is null then select id into v_task_id from ... ; return v_task_id; end if;
```

正确消除了 0045 里 select-then-insert 的并发窗口（两个并发请求同时查不到、同时插入 → 23505）。而且重复命中时不再重复写审计和通知，避免了脏数据。

### 表覆盖

`tasks` / `care_events` / `documents` / `households` 的 FULL 都对（documents 目前无直接硬删，但有 household 级联删除，加了无害）。

---

## 五、修复清单

**必做（新迁移 0048，纯 SQL，不需要重新出包）**

```sql
-- 0048: 0045/0047 的 replica identity 修正
-- S1: members 是硬删（0011:149 / 0014:194,223 / 0015:119,159），
--     0045 注释误判为软删，导致移除成员/退出后其他设备不刷新。
alter table public.members replica identity full;

-- S2: audit_events 由 cleanup_audit_by_retention 每日批量删除，
--     FULL 会让每删一行都触发所有在线客户端一次全量 refetch。
--     客户端不需要感知保留期清理，回退为 default。
alter table public.audit_events replica identity default;
```

**代码改动（会重新出包）——按此顺序做**

1. **S7 / P0** 打通 cloud 模式乐观更新通道（`applyOptimistic`）+ 移除乐观路径里的 `cacheHouseholdState` + 缓存 household_id 校验 ← **前置，先做**
2. **P1 / P2** 方案 2 乐观插入（迁移 0049 + 客户端两处任务、两处事件）
3. **S3** `createInFlight` → `useRef`（4 处调用点：529 / 578 / 873 / 899）
4. **S6** 透传原始 error

**不用做**

- S4 的 requestId 缓存（已被方案 2 覆盖）

**记录不改**

- S5 `care_events` 幂等键挂可空列（当前插入路径保证非空）

---

## 六、验收建议

0048 push 之后，用两台设备各验一次：

| #   | 操作                                                     | 期望                                                |
| --- | -------------------------------------------------------- | --------------------------------------------------- |
| 1   | A 删任务                                                 | B 的列表 **1 秒内**少一条                           |
| 2   | A 删时间线                                               | B 同步消失                                          |
| 3   | A（协调人）移除成员 C                                    | **B 的 Care circle 里 C 消失**（← S1 修完才会通过） |
| 4   | C 自己退出家庭                                           | A / B 都看到 C 消失                                 |
| 5   | A 连点两次模板任务按钮                                   | 只出现 1 条（← S3 + S4 修完才会通过）               |
| 6   | 手动跑一次 `select public.cleanup_audit_by_retention();` | 在线客户端**不应**出现大量刷新（← S2 修完才会通过） |

第 3、4 条是这次的重点 —— 它们正是"权限同步"，也是本轮唯一没被覆盖到的类别。
