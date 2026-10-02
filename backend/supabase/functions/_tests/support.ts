// Edge Function 的 Deno 测试支架（只在 `deno test --config _tests/deno.json` 下使用）。
//
// - loadFunction：先设环境变量、把 Deno.serve 换成「只记下 handler」，再 import 函数的 index.ts，
//   测试直接调用 handler(Request)。deno test 每个测试文件跑在独立的 isolate 里，每个文件只 import 一次。
// - FakeSupabase：supabase-js 的最小内存替身（auth.getUser / auth.admin.deleteUser / rpc / from / storage），
//   记录每一次调用，并能按 "操作:表名" 注入失败。stubs/supabase-js.ts 的 createClient 交给它。
// - stubFetch / captureConsole：拦截对 Apple 的 HTTP 请求和日志输出（断言日志里没有 token、sub、用户 id）。
//
// 不连网络、不连任何 Supabase 项目，也不需要任何真实 secret。
// deno-lint-ignore-file no-explicit-any

export type Handler = (req: Request) => Promise<Response>;

export async function loadFunction(moduleUrl: string, env: Record<string, string>): Promise<Handler> {
  for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
  let captured: ((req: Request, info?: unknown) => Response | Promise<Response>) | null = null;
  const original = Deno.serve;
  (Deno as any).serve = (...args: unknown[]) => {
    captured = args.find((a) => typeof a === "function") as typeof captured;
    return { finished: Promise.resolve(), shutdown: () => Promise.resolve(), ref() {}, unref() {}, addr: null };
  };
  try {
    await import(moduleUrl);
  } finally {
    (Deno as any).serve = original;
  }
  if (!captured) throw new Error(`${moduleUrl} did not call Deno.serve`);
  const handler = captured as (req: Request, info?: unknown) => Response | Promise<Response>;
  return async (req: Request) =>
    await handler(req, { remoteAddr: { transport: "tcp", hostname: "127.0.0.1", port: 0 } });
}

export interface FakeError {
  message: string;
  code?: string;
}
type Result = { data: unknown; error: FakeError | null };

export interface FakeUser {
  id: string;
  is_anonymous?: boolean;
  identities?: { provider: string; id?: string; identity_data?: Record<string, unknown> }[];
}

export class FakeSupabase {
  /** 调用记录，按发生顺序：rpc:<name> / select:<table> / delete:<table> / update:<table> / storage.list / storage.remove / deleteUser:<id> */
  calls: string[] = [];
  rpcArgs: { name: string; args: Record<string, unknown> }[] = [];
  /** access token → 用户 */
  sessions = new Map<string, FakeUser>();
  rpcHandlers: Record<string, (args: Record<string, unknown>) => Result | Promise<Result>> = {};
  tables: Record<string, Record<string, unknown>[]> = {};
  /** "select:<table>" / "delete:<table>" / "update:<table>" / "storage.list" / "storage.remove" / "deleteUser" → 返回这个错误 */
  failures = new Map<string, FakeError>();
  /** documents 桶里的对象路径（household_id/文件名） */
  storage = new Set<string>();
  removedObjects: string[] = [];
  deletedUsers: string[] = [];
  clientKeys: string[] = [];

  client(_url: string, key: string, options?: { global?: { headers?: Record<string, string> } }): any {
    this.clientKeys.push(key);
    const bearer = (options?.global?.headers?.Authorization ?? "").replace(/^Bearer\s+/i, "");
    return {
      auth: {
        getUser: () => {
          const user = this.sessions.get(bearer);
          return Promise.resolve(
            user ? { data: { user }, error: null } : { data: { user: null }, error: { message: "invalid JWT" } }
          );
        },
        admin: {
          deleteUser: (id: string) => {
            this.calls.push(`deleteUser:${id}`);
            const failure = this.failures.get("deleteUser");
            if (failure) return Promise.resolve({ data: null, error: failure });
            this.deletedUsers.push(id);
            return Promise.resolve({ data: {}, error: null });
          }
        }
      },
      rpc: async (name: string, args: Record<string, unknown> = {}) => {
        this.calls.push(`rpc:${name}`);
        this.rpcArgs.push({ name, args });
        const handler = this.rpcHandlers[name];
        if (!handler) return { data: null, error: { message: `rpc ${name} not stubbed` } };
        return await handler(args);
      },
      from: (table: string) => new FakeQuery(this, table),
      storage: {
        from: (_bucket: string) => ({
          list: (prefix: string, opts: { limit?: number; offset?: number } = {}) => {
            this.calls.push("storage.list");
            const failure = this.failures.get("storage.list");
            if (failure) return Promise.resolve({ data: null, error: failure });
            const names = [...this.storage]
              .filter((p) => p.startsWith(`${prefix}/`))
              .map((p) => p.slice(prefix.length + 1))
              .sort();
            const offset = opts.offset ?? 0;
            const page = names.slice(offset, offset + (opts.limit ?? 100));
            return Promise.resolve({ data: page.map((name) => ({ name, id: `obj-${name}` })), error: null });
          },
          remove: (paths: string[]) => {
            this.calls.push("storage.remove");
            const failure = this.failures.get("storage.remove");
            if (failure) return Promise.resolve({ data: null, error: failure });
            for (const p of paths) {
              this.storage.delete(p);
              this.removedObjects.push(p);
            }
            return Promise.resolve({ data: paths.map((name) => ({ name })), error: null });
          }
        })
      }
    };
  }
}

class FakeQuery implements PromiseLike<Result> {
  private op: "select" | "delete" | "update" = "select";
  private filters: { column: string; value: unknown }[] = [];
  private patch: Record<string, unknown> = {};
  private columns: string[] | null = null;
  private single = false;

  constructor(
    private fake: FakeSupabase,
    private table: string
  ) {}

  select(columns = "*"): this {
    this.columns = columns === "*" ? null : columns.split(",").map((c) => c.trim());
    return this;
  }
  delete(): this {
    this.op = "delete";
    return this;
  }
  update(patch: Record<string, unknown>): this {
    this.op = "update";
    this.patch = patch;
    return this;
  }
  eq(column: string, value: unknown): this {
    this.filters.push({ column, value });
    return this;
  }
  is(column: string, value: unknown): this {
    this.filters.push({ column, value });
    return this;
  }
  maybeSingle(): Promise<Result> {
    this.single = true;
    return this.execute();
  }
  then<T1 = Result, T2 = never>(
    onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: any) => T2 | PromiseLike<T2>) | null
  ): PromiseLike<T1 | T2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private execute(): Promise<Result> {
    this.fake.calls.push(`${this.op}:${this.table}`);
    const failure = this.fake.failures.get(`${this.op}:${this.table}`);
    if (failure) return Promise.resolve({ data: null, error: failure });
    const rows = (this.fake.tables[this.table] ??= []);
    const matches = rows.filter((row) => this.filters.every((f) => (row[f.column] ?? null) === f.value));
    if (this.op === "delete") {
      this.fake.tables[this.table] = rows.filter((row) => !matches.includes(row));
      return Promise.resolve({ data: null, error: null });
    }
    if (this.op === "update") {
      for (const row of matches) Object.assign(row, this.patch);
      return Promise.resolve({ data: null, error: null });
    }
    const picked = matches.map((row) =>
      this.columns ? Object.fromEntries(this.columns.map((c) => [c, row[c] ?? null])) : { ...row }
    );
    return Promise.resolve({ data: this.single ? (picked[0] ?? null) : picked, error: null });
  }
}

/** 让 stubs/supabase-js.ts 的 createClient 返回这个 fake 的客户端。 */
export function installSupabase(fake: FakeSupabase): FakeSupabase {
  (globalThis as any).__taskkinCreateClient = (url: string, key: string, options?: any) =>
    fake.client(url, key, options);
  return fake;
}

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Headers;
  body: string;
}

/** 替换全局 fetch；返回记录到的请求。所有测试结束前必须 restore。 */
export function stubFetch(respond: (req: RecordedRequest) => Response | Promise<Response>): {
  requests: RecordedRequest[];
  restore: () => void;
} {
  const original = globalThis.fetch;
  const requests: RecordedRequest[] = [];
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const req = new Request(input, init);
    const recorded = { url: req.url, method: req.method, headers: req.headers, body: await req.text() };
    requests.push(recorded);
    return await respond(recorded);
  }) as typeof fetch;
  return { requests, restore: () => (globalThis.fetch = original) };
}

/** 收集 console.log / warn / error 的输出（不打印），用于断言日志里没有敏感信息。 */
export function captureConsole(): { lines: string[]; text: () => string; restore: () => void } {
  const lines: string[] = [];
  const saved = { log: console.log, warn: console.warn, error: console.error };
  const push = (...args: unknown[]) => {
    lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  console.log = push;
  console.warn = push;
  console.error = push;
  return {
    lines,
    text: () => lines.join("\n"),
    restore: () => Object.assign(console, saved)
  };
}

export function bearer(token: string, body?: unknown, extraHeaders: Record<string, string> = {}): Request {
  return new Request("http://localhost/fn", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

export const TEST_ENV = {
  SUPABASE_URL: "http://supabase.test",
  SUPABASE_ANON_KEY: "test-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key"
};
