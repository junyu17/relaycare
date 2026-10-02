#!/usr/bin/env bash
# =============================================================================
# 本地回归测试：一条命令跑完迁移 + SQL 测试 + Edge Function 的 Deno 测试
#
# 不需要 Docker / supabase start，也不连任何 Supabase 项目（不碰线上）：
#   - 在 backend/.localpg 下建一个私有 Postgres 实例（只开 unix socket，不开 TCP），
#   - 加载 qa/local_pg_stubs.sql（auth / storage / 角色 / realtime 的最小替身，只存在于本地库），
#   - 按编号顺序应用 supabase/migrations/*.sql，
#   - 另建一个库：schema dump（supabase/all_in_one.sql）+ 0004 之后的迁移，核对 public schema 与上面完全一致，
#   - 跑 qa/sql/*.sql 与 qa/delete_account_regression.sql，以及两会话并发测试，
#   - deno check 本次新增 / 改动的 Edge Function，跑 supabase/functions/_tests 下的 Deno 测试
#     （stub 掉 supabase-js、Apple 接口与 Deno.serve）。
#
# 分两轮建库，对应两个上线状态：
#   shipped：migrations/ 目录（0001–0059，TestFlight 之前就会 db push 的部分）
#   all    ：再加上 pending_migrations/（0060 审核通过当天、0061/0062 发布后才移进 migrations/）
#
# 关于 supabase/all_in_one.sql：它是 0001–0003 的旧汇总（文件头写明已废弃、不要在项目上执行），
# 和 0001–0003 叠加会因重复 create table 失败。所以测试库按编号迁移建，另用「dump + 0004…」建一个对照库，
# 比对两者的 public schema（pg_dump --schema-only）完全相同，证明 dump 与迁移链一致。
#
# 用法：
#   bash backend/qa/local_pg.sh             # 全部（结束时停掉本地实例）
#   bash backend/qa/local_pg.sh --sql-only  # 只跑 SQL，不跑 Deno
#   bash backend/qa/local_pg.sh --keep      # 跑完不停库：psql -h backend/.localpg/sock -p 54399 -U postgres taskkin_all
# 环境变量：PG_BIN（默认 /opt/homebrew/opt/postgresql@17/bin）、LOCALPG_PORT（默认 54399）、DENO（默认 deno）
# 退出码：全部通过为 0，否则为 1。
# =============================================================================
set -uo pipefail
shopt -s nullglob

QA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$QA_DIR/.." && pwd)"
SUPA_DIR="$BACKEND_DIR/supabase"
STATE_DIR="$BACKEND_DIR/.localpg"
DATA_DIR="$STATE_DIR/data"
SOCK_DIR="$STATE_DIR/sock"
LOG_FILE="$STATE_DIR/server.log"
PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}"
PORT="${LOCALPG_PORT:-54399}"
DENO_BIN="${DENO:-deno}"

RUN_DENO=1
KEEP=0
for arg in "$@"; do
  case "$arg" in
    --sql-only) RUN_DENO=0 ;;
    --keep) KEEP=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

PASS=0
FAIL=0
FAILED_STEPS=()
ok()  { PASS=$((PASS + 1)); printf '  ✔ %s\n' "$*"; }
bad() { FAIL=$((FAIL + 1)); FAILED_STEPS+=("$*"); printf '  ✘ %s\n' "$*"; }
say() { printf '\n== %s ==\n' "$*"; }

# macOS 上 postmaster 需要有效的 locale，否则启动即退出（"postmaster became multithreaded"）。
export LC_ALL=C

psql_db() { # psql_db <db> [psql args...]
  local db="$1"
  shift
  "$PG_BIN/psql" -h "$SOCK_DIR" -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1 -d "$db" "$@"
}

stop_server() {
  if [ "$KEEP" -eq 0 ] && [ -f "$DATA_DIR/postmaster.pid" ]; then
    "$PG_BIN/pg_ctl" -D "$DATA_DIR" -m fast -w stop >/dev/null 2>&1 || true
  fi
}
trap stop_server EXIT

# ---------- 1. 本地实例 ----------
say "本地 Postgres（$PG_BIN，端口 $PORT，socket $SOCK_DIR）"
[ -x "$PG_BIN/initdb" ] || { echo "找不到 $PG_BIN/initdb"; exit 2; }
mkdir -p "$STATE_DIR" "$SOCK_DIR"
# 整个 .localpg 目录都不进 git（不改仓库根的 .gitignore）。
printf '*\n' >"$STATE_DIR/.gitignore"
if [ ! -f "$DATA_DIR/PG_VERSION" ]; then
  "$PG_BIN/initdb" -D "$DATA_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null ||
    { echo "initdb 失败"; exit 2; }
  ok "initdb $DATA_DIR"
fi
if ! "$PG_BIN/pg_ctl" -D "$DATA_DIR" status >/dev/null 2>&1; then
  "$PG_BIN/pg_ctl" -D "$DATA_DIR" -l "$LOG_FILE" -w \
    -o "-p $PORT -k $SOCK_DIR -c listen_addresses='' -c max_connections=40" start >/dev/null ||
    { echo "pg_ctl start 失败，见 $LOG_FILE"; tail -5 "$LOG_FILE"; exit 2; }
fi
ok "server running"

# 把 psql 输出里的 PASS / SKIP 提示整理成一行一条；其余 NOTICE 去掉。
show_notices() {
  sed -n -e 's/^psql:[^ ]* NOTICE:  \(PASS .*\)$/      \1/p' -e 's/^psql:[^ ]* NOTICE:  \(SKIP .*\)$/      \1/p'
}

run_sql_file() { # run_sql_file <db> <file>
  local db="$1" file="$2" out rc
  out="$(psql_db "$db" -f "$file" 2>&1)"
  rc=$?
  printf '%s\n' "$out" | show_notices
  if [ $rc -eq 0 ]; then
    ok "$(basename "$file")"
  else
    printf '%s\n' "$out" | grep -E 'ERROR|FAIL' | head -5 | sed 's/^/      /'
    bad "$(basename "$file") [$db]"
  fi
}

build_db() { # build_db <db> <include_pending 0|1> [from_dump 0|1]
  local db="$1" pending="$2" from_dump="${3:-0}" f out
  psql_db postgres -c "drop database if exists $db" -c "create database $db" >/dev/null 2>&1 ||
    { bad "create database $db"; return 1; }
  out="$(psql_db "$db" -f "$QA_DIR/local_pg_stubs.sql" 2>&1)" || { printf '%s\n' "$out"; bad "stubs [$db]"; return 1; }
  local files=()
  if [ "$from_dump" -eq 1 ]; then
    # schema dump 代替 0001–0003，再接 0004 之后的迁移。
    files+=("$SUPA_DIR/all_in_one.sql")
    for f in "$SUPA_DIR"/migrations/*.sql; do
      case "$(basename "$f")" in 0001_* | 0002_* | 0003_*) ;; *) files+=("$f") ;; esac
    done
  else
    files+=("$SUPA_DIR"/migrations/*.sql)
  fi
  if [ "$pending" -eq 1 ]; then
    files+=("$SUPA_DIR"/pending_migrations/*.sql)
  fi
  for f in "${files[@]}"; do
    out="$(psql_db "$db" -f "$f" 2>&1)" || {
      printf '%s\n' "$out" | tail -5 | sed 's/^/      /'
      bad "apply $(basename "$f") [$db]"
      return 1
    }
  done
  ok "$db: applied ${#files[@]} migrations ($(basename "${files[0]}") … $(basename "${files[${#files[@]} - 1]}"))"
  out="$(psql_db "$db" -f "$QA_DIR/sql/00_helpers.sql" 2>&1)" || { printf '%s\n' "$out"; bad "helpers [$db]"; return 1; }
  return 0
}

# 两会话并发：delete_auth_user_if_empty 的行锁 vs 并发写入成员行（方案 tests：0058 冲突辅助函数）。
run_concurrency() { # run_concurrency <db>
  local db="$1" setup x y hid s1 s2 rc2 racer_rows
  setup="$(psql_db "$db" -At -c "select qa.user('apple') || ',' || qa.user('apple') || ',' || qa.household(qa.user('apple'), 'Race home')")" ||
    { bad "concurrency setup"; return; }
  IFS=',' read -r x y hid <<<"$setup"

  # A：删除方先拿到锁 → 插入方等锁，删除提交后因外键失败。
  s1="$(mktemp)"
  psql_db "$db" -At \
    -c "begin" \
    -c "select 1 from auth.users where id = '$x' for update" \
    -c "select pg_sleep(1.5)" \
    -c "select 'deleted=' || public.delete_auth_user_if_empty('$x')::text" \
    -c "commit" >"$s1" 2>&1 &
  local pid1=$!
  sleep 0.4
  s2="$(psql_db "$db" -c "insert into public.members (household_id, user_id, name, role, timezone) values ('$hid', '$x', 'Racer A', 'caregiver', 'UTC')" 2>&1)"
  rc2=$?
  wait "$pid1"
  racer_rows="$(psql_db "$db" -At -c "select count(*) from public.members where name = 'Racer A'")"
  if grep -q 'deleted=true' "$s1" && [ $rc2 -ne 0 ] && printf '%s' "$s2" | grep -q 'foreign key' && [ "$racer_rows" = "0" ]; then
    ok "concurrency A: lock held by delete → concurrent member insert fails on FK, no orphan member row"
  else
    echo "      s1: $(tr '\n' ' ' <"$s1")"
    echo "      s2(rc=$rc2): $s2  racer_rows=$racer_rows"
    bad "concurrency A [$db]"
  fi
  rm -f "$s1"

  # B：插入方先拿到 KEY SHARE 锁 → 删除方等锁，复查时看到新成员行，拒绝删除。
  s1="$(mktemp)"
  psql_db "$db" -At \
    -c "begin" \
    -c "insert into public.members (household_id, user_id, name, role, timezone) values ('$hid', '$y', 'Racer B', 'caregiver', 'UTC')" \
    -c "select pg_sleep(1.5)" \
    -c "commit" >"$s1" 2>&1 &
  pid1=$!
  sleep 0.4
  s2="$(psql_db "$db" -At -c "select 'deleted=' || public.delete_auth_user_if_empty('$y')::text" 2>&1)"
  wait "$pid1"
  racer_rows="$(psql_db "$db" -At -c "select count(*) from public.members where name = 'Racer B' and user_id = '$y'")"
  local y_exists
  y_exists="$(psql_db "$db" -At -c "select count(*) from auth.users where id = '$y'")"
  if [ "$s2" = "deleted=false" ] && [ "$racer_rows" = "1" ] && [ "$y_exists" = "1" ]; then
    ok "concurrency B: insert committed first → recheck under lock sees it, account kept"
  else
    echo "      s1: $(tr '\n' ' ' <"$s1")"
    echo "      s2: $s2  racer_rows=$racer_rows y_exists=$y_exists"
    bad "concurrency B [$db]"
  fi
  rm -f "$s1"

  local orphans
  orphans="$(psql_db "$db" -At -c "select count(*) from public.members where name like 'Racer %' and user_id is null")"
  [ "$orphans" = "0" ] && ok "concurrency: no member row with user_id set to NULL" || bad "concurrency orphans=$orphans [$db]"
}

# public schema 的结构快照（去掉 pg_dump 每次随机生成的 \restrict 行）。
schema_of() { # schema_of <db>
  "$PG_BIN/pg_dump" -h "$SOCK_DIR" -p "$PORT" -U postgres --schema-only --schema=public --no-owner "$1" |
    grep -vE '^\\(un)?restrict '
}

# ---------- 2. shipped：0001–0059 ----------
say "shipped：supabase/migrations（TestFlight 之前上线的状态）"
if build_db taskkin_shipped 0; then
  if build_db taskkin_dump 0 1; then
    shipped_schema="$(schema_of taskkin_shipped)"
    dump_schema="$(schema_of taskkin_dump)"
    # 正向对照：两边都确实导出了 schema（pg_dump 失败时两边都是空串，diff 会误判为一致）。
    if ! grep -q 'CREATE TABLE public.household_join_requests' <<<"$shipped_schema" ||
      ! grep -q 'CREATE TABLE public.household_join_requests' <<<"$dump_schema"; then
      bad "pg_dump 没有导出 schema"
    elif [ "$shipped_schema" = "$dump_schema" ]; then
      ok "schema dump（all_in_one.sql）+ 0004… 与 0001… 的 public schema 完全一致（$(wc -l <<<"$shipped_schema" | tr -d ' ') 行）"
    else
      diff <(printf '%s\n' "$shipped_schema") <(printf '%s\n' "$dump_schema") | head -20 | sed 's/^/      /'
      bad "schema dump 与迁移链不一致"
    fi
    psql_db postgres -c "drop database if exists taskkin_dump" >/dev/null 2>&1
  fi
  for f in "$QA_DIR"/sql/10_*.sql "$QA_DIR"/sql/20_*.sql "$QA_DIR"/sql/30_*.sql "$QA_DIR/delete_account_regression.sql"; do
    run_sql_file taskkin_shipped "$f"
  done
  run_concurrency taskkin_shipped
fi

# ---------- 3. all：再加 pending_migrations（0060–0062）----------
say "all：再加 supabase/pending_migrations（0060 审核通过当天、0061/0062 发布后）"
if build_db taskkin_all 1; then
  for f in "$QA_DIR"/sql/[1-9]*.sql "$QA_DIR/delete_account_regression.sql"; do
    run_sql_file taskkin_all "$f"
  done
  run_concurrency taskkin_all
fi

# ---------- 4. Deno：Edge Functions ----------
# 测试用 _tests/deno.json 的 import map 把 supabase-js 和 _shared/apple-jws.ts 换成替身，
# Apple 的 HTTP 端点由测试 stub 掉 fetch；不连网络上的任何服务（首次运行需要下载 jose / @std/assert 模块）。
# deno check 用真实的 supabase-js 类型检查这次改动 / 新增的函数。verify-apple-receipt 不在列表里：
# 它 import 的 _shared/apple-jws.ts 在 HEAD 上就有两处 @peculiar/x509 类型错误（与本次改动无关），
# 它的授权逻辑由 _tests/verify_apple_receipt_test.ts 覆盖。
if [ "$RUN_DENO" -eq 1 ]; then
  say "Deno：supabase/functions"
  if command -v "$DENO_BIN" >/dev/null 2>&1; then
    deno_out="$(cd "$SUPA_DIR/functions" && NO_COLOR=1 "$DENO_BIN" check --no-lock --node-modules-dir=none \
      apple-identity-conflict/index.ts purge-abandoned-anonymous/index.ts delete-account/index.ts 2>&1)"
    if [ $? -eq 0 ]; then ok "deno check（apple-identity-conflict / purge-abandoned-anonymous / delete-account）"; else
      printf '%s\n' "$deno_out" | tail -20 | sed 's/^/      /'
      bad "deno check"
    fi

    deno_out="$(cd "$SUPA_DIR/functions" && NO_COLOR=1 "$DENO_BIN" test --config _tests/deno.json --no-lock \
      --allow-env --allow-read=. _tests/ 2>&1)"
    deno_rc=$?
    printf '%s\n' "$deno_out" | grep -E '^running |\.\.\. (ok|FAILED)|^(ok|FAILED) \|' | sed 's/^/      /'
    if [ $deno_rc -eq 0 ]; then ok "deno test"; else
      printf '%s\n' "$deno_out" | grep -vE '\.\.\. ok' | tail -60 | sed 's/^/      /'
      bad "deno test"
    fi
  else
    bad "deno not found（设 DENO=/path/to/deno，或用 --sql-only）"
  fi
fi

say "结果"
echo "PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "✅ 全部通过"
  exit 0
fi
printf '❌ 失败：\n'
printf '   - %s\n' "${FAILED_STEPS[@]}"
exit 1
