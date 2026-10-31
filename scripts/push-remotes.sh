#!/usr/bin/env bash
# 把本机提交推送到你自己的多个远端仓库。
# 凭证一律从环境变量读取：不写进脚本、不写进 .git/config、不出现在任何提交里。
#
#   export GH_TOKEN_X33834=ghp_xxx          # GitHub 经典令牌，需勾选 repo 权限
#   export GH_TOKEN_MORNINGSTAR=ghp_xxx
#   export GH_TOKEN_BADHOPE=ghp_xxx
#   export GITCODE_TOKEN=xxx               # GitCode 访问令牌（个人设置→访问令牌）
#   export GITEE_TOKEN=xxx                 # Gitee 私人令牌（需 projects 权限）
#
#   ./scripts/push-remotes.sh            # 建库（若不存在）+ 推送 main 与 tag
#   ./scripts/push-remotes.sh --check    # 只探测每个 token 是否可用、仓库是否存在，不做任何写操作
set -uo pipefail

REPO=shopcash
DESC="店收宝 ShopCash — 单机门店收银与收款记账软件（钱只进商家自己的微信/支付宝商户号，软件零资金介入）"
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

root="$(cd "$(dirname "$0")/.." && pwd)"; cd "$root"
sha=$(git rev-parse HEAD)
tag=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
rc=0

# ---------- 只读探测 ----------
probe () { # $1=标签 $2=用户 $3=令牌
  printf "%-26s " "$1"
  local body http
  body=$(curl -s -m 30 -o /dev/null -w "%{http_code}" "https://api.github.com/user" -H "Authorization: Bearer $3")
  if [ "$body" = "200" ]; then
    local who; who=$(curl -s -m 30 "https://api.github.com/user" -H "Authorization: Bearer $3" | grep -o '"login":"[^"]*"' | head -1 | cut -d'"' -f4)
    printf "令牌可用(login=%s) " "$who"
  else
    printf "令牌不可用(HTTP %s) " "$body"; rc=1; return
  fi
  body=$(curl -s -m 30 -o /dev/null -w "%{http_code}" "https://api.github.com/repos/$2/$REPO" -H "Authorization: Bearer $3")
  printf "仓库=%s\n" "$([ "$body" = "200" ] && echo 存在 || echo "不存在($body)")"
}

# ---------- GitHub ----------
gh_ensure_repo () { # $1=用户 $2=令牌
  local code; code=$(curl -s -m 30 -o /dev/null -w "%{http_code}" "https://api.github.com/repos/$1/$REPO" -H "Authorization: Bearer $2")
  [ "$code" = "200" ] && { echo "   仓库已存在"; return 0; }
  local out
  out=$(curl -s -m 60 -X POST https://api.github.com/user/repos -H "Authorization: Bearer $2" \
        -H 'content-type: application/json' \
        -d "{\"name\":\"$REPO\",\"description\":\"$DESC\",\"private\":false,\"has_issues\":true,\"auto_init\":false}")
  echo "$out" | grep -q '"full_name"' && { echo "   已创建 $1/$REPO"; return 0; }
  echo "   建库失败: $(echo "$out" | head -c 160)"; return 1
}

gh_push () { # $1=用户 $2=令牌
  echo "== github/$1"
  if [ "$CHECK_ONLY" = "1" ]; then probe "github/$1" "$1" "$2"; return; fi
  gh_ensure_repo "$1" "$2" || { rc=1; return; }
  local out
  out=$(timeout 300 git -c credential.helper= push -f "https://x-access-token:$2@github.com/$1/$REPO.git" "HEAD:refs/heads/main" 2>&1)
  if [ $? -eq 0 ]; then
    echo "   推送 main 成功"
    [ -n "$tag" ] && timeout 120 git -c credential.helper= push -f "https://x-access-token:$2@github.com/$1/$REPO.git" "refs/tags/$tag" >/dev/null 2>&1 && echo "   推送 tag $tag 成功"
    curl -s -m 30 -o /dev/null -X PATCH "https://api.github.com/repos/$1/$REPO" -H "Authorization: Bearer $2" \
      -H 'content-type: application/json' \
      -d "{\"description\":\"$DESC\",\"homepage\":\"https://github.com/$1/$REPO#readme\",\"topics\":[\"pos\",\"cashier\",\"nestjs\",\"vue3\",\"sqlite\",\"wechat-pay\",\"alipay\",\"reconciliation\",\"self-hosted\"],\"has_issues\":true}" >/dev/null \
      && echo "   描述与 topics 已更新"
    local remote; remote=$(timeout 60 git ls-remote "https://x-access-token:$2@github.com/$1/$REPO.git" refs/heads/main 2>/dev/null | cut -f1)
    [ "$remote" = "$sha" ] && echo "   校验一致：远端 main = 本地 HEAD" || { echo "   校验不一致：远端=${remote:-空} 本地=$sha"; rc=1; }
  else
    echo "   推送失败：$(echo "$out" | grep -viE '^remote:$' | head -c 200)"; rc=1
  fi
}

# ---------- Gitee ----------
gitee_push () {
  echo "== gitee/badhope"
  local t=$1 code
  code=$(curl -s -m 30 -o /dev/null -w "%{http_code}" "https://gitee.com/api/v5/user?access_token=$t")
  if [ "$code" != "200" ]; then echo "   令牌不可用（HTTP $code）——需要在 Gitee「设置→私人令牌」重新生成并勾选 projects 权限"; rc=1; return; fi
  [ "$CHECK_ONLY" = "1" ] && { echo "   令牌可用，跳过写操作"; return; }
  code=$(curl -s -m 30 -o /dev/null -w "%{http_code}" "https://gitee.com/api/v5/repos/badhope/$REPO?access_token=$t")
  if [ "$code" != "200" ]; then
    code=$(curl -s -m 60 -o /tmp/gitee_create.json -w "%{http_code}" -X POST "https://gitee.com/api/v5/user/repos" \
      -d "access_token=$t&name=$REPO&description=$DESC&private=false&issues=true")
    grep -q '"full_name"' /tmp/gitee_create.json && echo "   已创建 badhope/$REPO" || { echo "   建库失败 HTTP $code: $(head -c 160 /tmp/gitee_create.json)"; rc=1; return; }
  fi
  local out
  out=$(timeout 300 git -c credential.helper= push -f "https://badhope:$t@gitee.com/badhope/$REPO.git" "HEAD:refs/heads/main" 2>&1)
  [ $? -eq 0 ] && echo "   推送 main 成功" || { echo "   推送失败：$(echo "$out" | head -c 200)"; rc=1; }
}

# ---------- GitCode ----------
gitcode_push () {
  echo "== gitcode/badhope"
  local t=$1 code
  code=$(curl -s -m 30 -o /dev/null -w "%{http_code}" "https://api.gitcode.com/api/v5/user" -H "PRIVATE-TOKEN: $t")
  if [ "$code" = "401" ]; then echo "   令牌不可用（GitCode 返回 token not found）——需要在「个人设置→访问令牌」重新生成"; rc=1; return; fi
  [ "$CHECK_ONLY" = "1" ] && { echo "   令牌可达（HTTP $code），跳过写操作"; return; }
  local out
  out=$(timeout 300 git -c credential.helper= push -f "https://oauth2:$t@gitcode.com/badhope/$REPO.git" "HEAD:refs/heads/main" 2>&1)
  if [ $? -eq 0 ]; then echo "   推送 main 成功"; return; fi
  echo "   推送失败：$(echo "$out" | grep -E "error|fatal|remote:" | head -c 200)"
  echo "   多为仓库不存在且无建库 API 权限——请在 GitCode 网页新建空仓库 $REPO（不要勾选初始化 README），再重跑本脚本"
  rc=1
}

[ -n "${GH_TOKEN_X33834:-}" ]      && gh_push "X33834" "$GH_TOKEN_X33834"
[ -n "${GH_TOKEN_MORNINGSTAR:-}" ] && gh_push "Morningstar202604" "$GH_TOKEN_MORNINGSTAR"
[ -n "${GH_TOKEN_BADHOPE:-}" ]     && gh_push "badhope" "$GH_TOKEN_BADHOPE"
[ -n "${GITEE_TOKEN:-}" ]          && gitee_push "$GITEE_TOKEN"
[ -n "${GITCODE_TOKEN:-}" ]        && gitcode_push "$GITCODE_TOKEN"

echo
if [ "$rc" = "0" ]; then echo "全部目标推送完成（本地 HEAD=$sha）"; else echo "存在未通过的目标（见上方逐项原因），本地 HEAD=$sha"; fi
printf '本仓库 git 配置里是否残留凭证： '; git config --get-regexp 'remote|url' 2>/dev/null | grep -c "token\|ghp_\|@" || echo "0（干净）"
exit $rc
