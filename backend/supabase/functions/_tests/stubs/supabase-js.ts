// 测试替身：_tests/deno.json 把 "https://esm.sh/@supabase/supabase-js@2" 映射到这里。
// Edge Function 里的 createClient(...) 交给测试安装的假客户端工厂（_tests/support.ts 的 FakeSupabase），
// 测试因此不需要网络、不连任何 Supabase 项目。
// deno-lint-ignore-file no-explicit-any

export type SupabaseClient = any;

export function createClient(url: string, key: string, options?: unknown): any {
  const factory = (globalThis as { __taskkinCreateClient?: (url: string, key: string, options?: unknown) => unknown })
    .__taskkinCreateClient;
  if (typeof factory !== "function") {
    throw new Error("test did not install a supabase client factory (support.ts installSupabase)");
  }
  return factory(url, key, options);
}
