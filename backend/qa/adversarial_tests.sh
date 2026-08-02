#!/usr/bin/env bash
# =============================================================================
# TaskKin Care 上线前 adversarial 测试（B1/B2/B6/I4 + 支付面）
# 依据：docs/CODEX_REAUDIT_RESPONSE_2026-08-01.md §4.3 与 LAUNCH_READINESS_REVIEW
# v2：修复支付端点（Edge Function）、清理路径（delete-account Edge Function +
#      service_role admin）、viewer 入家语义、补非 coordinator 越权用例。
#
# 用法（目标环境需已部署 0024-0030 迁移 + 3 个 Edge Function）：
#   SUPABASE_URL=https://<ref>.supabase.co \
#   SUPABASE_ANON_KEY=<publishable key> \
#   SUPABASE_SERVICE_ROLE_KEY=<service_role（可选，用于角色用例与清理）> \
#   bash backend/qa/adversarial_tests.sh
#
# 通过标准：全部 PASS；任一 FAIL 即上线门禁不通过。
# =============================================================================
set -uo pipefail

SUPABASE_URL="${SUPABASE_URL:?需要 SUPABASE_URL（https://<ref>.supabase.co）}"
ANON_KEY="${SUPABASE_ANON_KEY:?需要 SUPABASE_ANON_KEY}"
SERVICE_ROLE="${SUPABASE_SERVICE_ROLE_KEY:-}"

REST="$SUPABASE_URL/rest/v1"
AUTH="$SUPABASE_URL/auth/v1"
FUN="$SUPABASE_URL/functions/v1"
API_H="apikey: $ANON_KEY"
JSON_H="Content-Type: application/json"
TS="$(date +%s)"
PASS=0
FAIL=0

say()  { printf '\n== %s ==\n' "$*"; }
ok()   { PASS=$((PASS+1)); printf '  ✔ %s\n' "$*"; }
bad()  { FAIL=$((FAIL+1)); printf '  ✘ %s\n' "$*"; }

http() { # http <method> <url> <bearer|null> <json|''> -> HTTP 状态码
  local m="$1" u="$2" b="$3" d="${4:-}"
  local args=(-s -o /dev/null -w '%{http_code}' -X "$m" -H "$API_H")
  [ -n "$b" ] && args+=(-H "Authorization: Bearer $b")
  [ -n "$d" ] && args+=(-H "$JSON_H" -d "$d")
  curl "${args[@]}" "$u"
}
rpc() { http POST "$REST/rpc/$1" "$2" "$3"; }
signup() { http POST "$AUTH/signup" "" "{\"email\":\"$1\",\"password\":\"TestPass123!\"}"; }
token() {
  curl -s -X POST "$AUTH/token?grant_type=password" -H "$API_H" -H "$JSON_H" \
    -d "{\"email\":\"$1\",\"password\":\"TestPass123!\"}" |
    python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])' 2>/dev/null || echo ""
}
uid_of() { # uid_of <email> -> user id
  curl -s "$AUTH/user" -H "$API_H" -H "Authorization: Bearer $1" |
    python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])' 2>/dev/null || echo ""
}
expect_fail() { # expect_fail <desc> <actual_http>
  if [[ "$2" =~ ^2 ]]; then bad "$1：预期失败，实际 HTTP $2"; else ok "$1（HTTP $2）"; fi
}

# ---------- 0. 环境检查 ----------
say "环境检查"
curl -s -o /dev/null -w '%{http_code}' "$REST/households" -H "$API_H" >/dev/null 2>&1 || { echo "无法连接 $REST"; exit 2; }
echo "  连接 OK：$REST"

# ---------- 1. 准备测试账号 ----------
say "准备测试账号（autoconfirm 环境无需邮箱确认）"
C_EMAIL="qa-coord-$TS@example.test"; G_EMAIL="qa-caregiver-$TS@example.test"; V_EMAIL="qa-viewer-$TS@example.test"
signup "$C_EMAIL" >/dev/null; signup "$G_EMAIL" >/dev/null; signup "$V_EMAIL" >/dev/null
C_TOK="$(token "$C_EMAIL")"; G_TOK="$(token "$G_EMAIL")"; V_TOK="$(token "$V_EMAIL")"
[ -n "$C_TOK" ] && ok "coordinator 注册+登录" || bad "coordinator 注册/登录失败（autoconfirm 是否生效？）"
[ -n "$G_TOK" ] && ok "caregiver 注册+登录" || bad "caregiver 注册/登录失败"
[ -n "$V_TOK" ] && ok "viewer 注册+登录" || bad "viewer 注册/登录失败"

# ---------- 2. 建立测试家庭 + 真实 6 位码 ----------
say "coordinator 建家庭并生成 6 位码"
HID=$(curl -s -X POST "$REST/rpc/create_household" -H "$API_H" -H "Authorization: Bearer $C_TOK" -H "$JSON_H" \
  -d "{\"p_household_name\":\"QA $TS\",\"p_timezone\":\"UTC\",\"p_care_recipient_label\":\"Dad\",\"p_member_name\":\"QA Coordinator\",\"p_member_relation\":\"self\",\"p_member_timezone\":\"UTC\"}")
if [ "${#HID}" -eq 36 ]; then ok "create_household -> $HID"; else bad "create_household 失败：$HID"; exit 2; fi
CODE=$(curl -s -X POST "$REST/rpc/generate_household_code" -H "$API_H" -H "Authorization: Bearer $C_TOK" -H "$JSON_H" -d '{}' | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d[0]["code"] if isinstance(d,list) and d else "")' 2>/dev/null)
[ "${#CODE}" -eq 6 ] && ok "生成 6 位码 $CODE" || bad "generate_household_code 失败/非 6 位：$CODE"

# ---------- 3. B1：households 表级写必须失败（0024 revoke） ----------
say "B1: 客户端直写 households 必须失败"
expect_fail "PATCH households.plus_plan='yearly'（免费升级）" \
  "$(http PATCH "$REST/households?id=eq.$HID" "$C_TOK" '{"plus_plan":"yearly","plus_until":"2099-01-01T00:00:00Z"}')"
expect_fail "INSERT 第二个 household（绕过家庭数配额）" \
  "$(http POST "$REST/households" "$C_TOK" '{"name":"Sneaky","created_by":"00000000-0000-0000-0000-000000000000","plus_plan":"yearly"}')"

# ---------- 4. B2：members 表级写必须失败（0024 revoke） ----------
say "B2: 客户端直写 members 必须失败"
G_UID="$(uid_of "$G_TOK")"
expect_fail "PATCH members.role（身份/角色直改）" \
  "$(http PATCH "$REST/members?user_id=eq.$G_UID" "$C_TOK" '{"role":"coordinator"}')"
expect_fail "INSERT members（绑定任意 user_id）" \
  "$(http POST "$REST/members" "$C_TOK" "{\"household_id\":\"$HID\",\"user_id\":\"$G_UID\",\"role\":\"caregiver\",\"invite_status\":\"active\"}")"

# ---------- 5. caregiver 合法入家 + 入家后直写仍被 0024 拒绝 ----------
say "caregiver 凭 6 位码加入（合法路径），入家后表级写仍必须失败"
if [ -n "$CODE" ]; then
  JOIN_RESP=$(curl -s -w '|%{http_code}' -X POST "$REST/rpc/join_by_code" -H "$API_H" -H "Authorization: Bearer $G_TOK" -H "$JSON_H" \
    -d "{\"p_code\":\"$CODE\",\"p_display_name\":\"QA Caregiver\"}")
  JOIN_CODE="${JOIN_RESP##*|}"
  JOIN_BODY="${JOIN_RESP%|*}"
  if [ "$JOIN_CODE" = "200" ] && [ "${#JOIN_BODY}" -eq 36 ]; then
    ok "join_by_code 成功（HTTP 200, uuid ${#JOIN_BODY} 位）"
  else
    bad "join_by_code 失败：HTTP $JOIN_CODE body=$JOIN_BODY（检查 0014/0020 已部署）"
  fi
else
  bad "未获取到 6 位码，跳过 caregiver 入家断言"
fi
expect_fail "caregiver（入家后）PATCH members.invite_status" \
  "$(http PATCH "$REST/members?user_id=eq.$G_UID" "$G_TOK" '{"invite_status":"removed"}')"
expect_fail "caregiver（入家后）PATCH households.name（0024 revoke 无列例外）" \
  "$(http PATCH "$REST/households?id=eq.$HID" "$G_TOK" '{"name":"Hacked"}')"

# ---------- 6. viewer（未入家）直写 tasks/documents 必须失败 ----------
say "viewer（未入家）直写 tasks/documents 必须失败"
expect_fail "viewer INSERT tasks" "$(http POST "$REST/tasks" "$V_TOK" "{\"household_id\":\"$HID\",\"title\":\"x\",\"requested_by_id\":\"$G_UID\"}")"
expect_fail "viewer INSERT documents" "$(http POST "$REST/documents" "$V_TOK" "{\"household_id\":\"$HID\",\"name\":\"x\",\"uploaded_by_id\":\"$G_UID\",\"source\":\"manual_upload\"}")"

# ---------- 7. I4: cleanup_old_audit 必须拒绝 authenticated（0030 revoke） ----------
say "I4: cleanup_old_audit 仅 service_role（0030）"
expect_fail "authenticated 调 cleanup_old_audit" "$(rpc cleanup_old_audit "$C_TOK" '{}')"

# ---------- 8. B6: 加入码格式 ----------
say "B6: 加入码格式"
expect_fail "8 位字母数字码被拒（仅 6 位数字）" "$(rpc join_by_code "$V_TOK" '{"p_code":"ABCD2345"}')"
expect_fail "7 位码被拒" "$(rpc join_by_code "$V_TOK" '{"p_code":"1234567"}')"
expect_fail "6 位数字格式通过、码无效返回 400" "$(rpc join_by_code "$V_TOK" '{"p_code":"000000"}')"

# ---------- 9. 支付面（Edge Function 端点；可选，需 SANDBOX_JWS） ----------
if [ -n "${SANDBOX_JWS:-}" ]; then
  say "支付面: Sandbox JWS 在 production mode 必须被拒（Edge Function）"
  expect_fail "Sandbox JWS 兑换 Plus" \
    "$(http POST "$FUN/verify-apple-receipt" "$C_TOK" "{\"productId\":\"TaskKin.care.pro.mon\",\"householdId\":\"$HID\",\"purchaseToken\":\"$SANDBOX_JWS\"}")"
else
  echo "  （跳过支付面：未提供 SANDBOX_JWS。真机验收时用无 ALLOW_SANDBOX_PURCHASES 的环境重复本项）"
fi

# ---------- 10. 非 coordinator 越权（需要 service_role 辅助） ----------
if [ -n "$SERVICE_ROLE" ] && [ -n "$G_UID" ]; then
  say "非 coordinator 越权调用必须失败（service_role 辅助）"
  SR_H="apikey: $SERVICE_ROLE"
  # 用 service_role 把 caregiver 入家（绕过生成码），再断言其越权调用失败
  curl -s -o /dev/null -X POST "$REST/members" -H "$SR_H" -H "Authorization: Bearer $SERVICE_ROLE" -H "$JSON_H" \
    -d "{\"household_id\":\"$HID\",\"user_id\":\"$G_UID\",\"name\":\"QA Caregiver\",\"role\":\"caregiver\",\"invite_status\":\"active\",\"timezone\":\"UTC\"}" 2>/dev/null || true
  expect_fail "caregiver 调 update_member_role（改自己为 coordinator）" \
    "$(rpc update_member_role "$G_TOK" "{\"p_member_id\":\"$G_UID\",\"p_role\":\"coordinator\"}")"
  expect_fail "caregiver 调 dissolve_household" "$(rpc dissolve_household "$G_TOK" '{}')"
  expect_fail "caregiver 调 invite_member（非目标家庭 coordinator）" \
    "$(rpc invite_member "$G_TOK" "{\"p_household_id\":\"$HID\",\"p_role\":\"caregiver\"}")"
  # removed member 不能读旧 household
  curl -s -o /dev/null -X PATCH "$REST/members?user_id=eq.$G_UID&household_id=eq.$HID" -H "$SR_H" -H "Authorization: Bearer $SERVICE_ROLE" -H "$JSON_H" -d '{"invite_status":"removed"}' 2>/dev/null || true
  REM_RESP=$(curl -s -w '|%{http_code}' "$REST/households?id=eq.$HID" -H "$API_H" -H "Authorization: Bearer $G_TOK")
  REM_CODE="${REM_RESP##*|}"
  REM_BODY="${REM_RESP%|*}"
  if [ "$REM_CODE" = "200" ] && [ "$REM_BODY" = "[]" ]; then
    ok "removed member 读旧 household 返回空（RLS 过滤）"
  else
    bad "removed member 读旧 household：HTTP $REM_CODE body=$REM_BODY（预期 200 空数组）"
  fi
else
  echo "  （未提供 SERVICE_ROLE，跳过 §4.3 角色/removed 用例；建议补传后完整执行）"
fi

# ---------- 11. 清理（service_role + delete-account Edge Function） ----------
if [ -n "$SERVICE_ROLE" ]; then
  say "清理测试数据"
  SR_H="apikey: $SERVICE_ROLE"
  curl -s -o /dev/null -X POST "$FUN/delete-account" -H "Authorization: Bearer $C_TOK" -H "$JSON_H" -d '{}' 2>/dev/null || true
  for E in "$G_EMAIL" "$V_EMAIL"; do
    UID_=$(curl -s "$AUTH/admin/users" -H "$SR_H" -H "Authorization: Bearer $SERVICE_ROLE" 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin);print(next((u['id'] for u in d.get('users',[]) if u.get('email')=='$E'),''))" 2>/dev/null)
    [ -n "$UID_" ] && curl -s -o /dev/null -X DELETE "$AUTH/admin/users/$UID_" -H "$SR_H" -H "Authorization: Bearer $SERVICE_ROLE" 2>/dev/null || true
  done
  ok "清理完成"
else
  echo "  （未提供 SERVICE_ROLE，跳过清理；测试账号为 qa-*-$TS@example.test，请手动清理）"
fi

# ---------- 结果 ----------
say "结果"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] && echo "✅ 全部通过（上线门禁 OK）" || { echo "❌ $FAIL 项失败（上线门禁不通过）"; exit 1; }
