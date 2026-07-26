import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Expo SDK 50+ 支持 EXPO_PUBLIC_ 前缀的环境变量，无需 babel 插件。
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
// This accepts Supabase's current publishable key and the legacy anon key.
// A secret/service_role key must never be bundled into the mobile app.
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// 未配置时（.env 为空）app 走本地 demo 模式，不会真正调用 Supabase。
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// 用 placeholder 创建客户端以保证类型完整；未配置时所有调用前都由 isSupabaseConfigured 拦截。
export const supabase: SupabaseClient = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabaseAnonKey || "placeholder-anon-key"
);
