#!/usr/bin/env bash
# dsh-updater 安装脚本（幂等，可重复执行，支持卸载/状态查询）
#
# 用法:
#   bash install.sh              # 安装到默认 profile (web)
#   bash install.sh <profile>    # 安装到指定 profile
#   bash install.sh status       # 查看当前安装状态
#   bash install.sh uninstall    # 卸载（移除符号链接与补丁条目）
#
# 设计要点：
#   - 脚本基于自身所在目录，插件目录可整体拷贝/克隆到任意机器直接运行。
#   - 合并式写入 cordis.patch.yml，保留用户已有补丁内容，只追加 dsh-updater 条目。
#   - 幂等：重复执行不会重复添加；卸载后残留的注释/空项会被清理。
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_NAME="@deepseek-ai/dsh-updater"
MODE="${1:-install}"
PROFILE="${2:-web}"

# 定位 dsh CLI 安装锚点
NPM_ROOT="$(npm root -g 2>/dev/null || true)"
if [ -z "$NPM_ROOT" ] || [ ! -d "$NPM_ROOT" ]; then
  echo "错误: 无法定位 npm 全局根目录 (npm root -g)。请先安装: npm install -g @deepseek-ai/dsh" >&2
  exit 1
fi

PROFILE_DIR="$HOME/.dsh/profiles/$PROFILE"
if [ ! -f "$PROFILE_DIR/package.json" ]; then
  echo "错误: 未找到 profile 目录 $PROFILE_DIR（当前没有该 profile）" >&2
  exit 1
fi

CLI_NM="$NPM_ROOT/@deepseek-ai/dsh/node_modules"
LINK_CLI="$CLI_NM/$PLUGIN_NAME"                # CLI 侧符号链接（client-modules 解析）
LINK_PROFILE="$PROFILE_DIR/node_modules/$PLUGIN_NAME" # profile 侧符号链接（loader 解析）
PATCH_FILE="$PROFILE_DIR/cordis.patch.yml"

# ── 补丁编辑辅助（Python：按顶层项拆分，过滤/统计 dsh-updater） ──────────
patch_rebuild() {
  # $1 = 动作: install|uninstall
  python3 - "$PATCH_FILE" "$1" "$PLUGIN_NAME" <<'PY'
import sys, re
path, action, entry_name = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path, encoding="utf-8").read()
# 按"行首无缩进的 '-'"拆分顶层列表项（注释与空行归入前面的项）
lines = text.splitlines(keepends=True)
items, cur = [], []
for ln in lines:
    if re.match(r'^- ', ln) and cur and any(x.strip() for x in cur):
        items.append(''.join(cur)); cur = [ln]
    else:
        cur.append(ln)
if cur: items.append(''.join(cur))
has_entry = any('id: dsh-updater' in it for it in items)
kept = [it for it in items if 'id: dsh-updater' not in it]

if action == 'uninstall':
    rest = ''.join(kept)
    # 是否还剩其他顶层项（含 id: 或 insert: 的实质条目）
    has_other = bool(re.search(r'^- (id:|insert:)', rest, re.M))
    out = rest if has_other else '[]\n'
    open(path, "w", encoding="utf-8").write(out)
    sys.exit(0 if has_entry else 2)
else:  # install
    if has_entry:
        sys.exit(1)  # 已存在
    # 若无任何实质条目，则整体写入标准头
    if not any(re.search(r'^- (id:|insert:)', it, re.M) for it in kept):
        header = "# 该补丁在 profile 的所有 bundle 层之后应用（用户自定义层）。\n"
        note = f"# 由 {entry_name}/install.sh 管理；如需添加自己的补丁条目，请追加到下方列表。\n"
        block = f"- insert:\n    - id: dsh-updater\n      name: '{entry_name}'\n      config: {{}}\n"
        open(path, "w", encoding="utf-8").write(header + note + block)
        sys.exit(0)
    # 保留现有实质内容，追加 dsh-updater 项
    block = f"- insert:\n    - id: dsh-updater\n      name: '{entry_name}'\n      config: {{}}\n"
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(block)
    sys.exit(0)
PY
}

# ── status ───────────────────────────────────────────────────────────────────
if [ "$MODE" = "status" ]; then
  echo "插件目录: $PLUGIN_DIR"
  [ -L "$LINK_CLI" ] && echo "CLI 链接:     已安装 -> $(readlink "$LINK_CLI")" || echo "CLI 链接:     未安装"
  [ -L "$LINK_PROFILE" ] && echo "Profile 链接: 已安装 -> $(readlink "$LINK_PROFILE")" || echo "Profile 链接: 未安装"
  patch_rebuild install >/dev/null 2>&1 || true  # 无害探测
  grep -q "id: dsh-updater" "$PATCH_FILE" 2>/dev/null && echo "补丁条目:     已配置" || echo "补丁条目:     未配置"
  exit 0
fi

# ── uninstall ───────────────────────────────────────────────────────────────
if [ "$MODE" = "uninstall" ]; then
  rm -f "$LINK_CLI" "$LINK_PROFILE"
  if [ -f "$PATCH_FILE" ]; then
    patch_rebuild uninstall
    echo "已从 $PATCH_FILE 移除 dsh-updater 条目"
  fi
  echo "已卸载。请重启 dsh web 生效。"
  exit 0
fi

# ── install ──────────────────────────────────────────────────────────────────
# 1) CLI 侧符号链接
mkdir -p "$CLI_NM/@deepseek-ai"
if [ -e "$LINK_CLI" ] && [ ! -L "$LINK_CLI" ]; then
  echo "错误: $LINK_CLI 已存在且不是符号链接，请先移除。" >&2
  exit 1
fi
if [ ! -L "$LINK_CLI" ]; then
  ln -s "$PLUGIN_DIR" "$LINK_CLI"
  echo "已链接: $LINK_CLI -> $PLUGIN_DIR"
else
  echo "CLI 符号链接已存在 -> $(readlink "$LINK_CLI")"
fi

# 2) Profile 侧符号链接
mkdir -p "$PROFILE_DIR/node_modules/@deepseek-ai"
if [ -e "$LINK_PROFILE" ] && [ ! -L "$LINK_PROFILE" ]; then
  echo "错误: $LINK_PROFILE 已存在且不是符号链接，请先移除。" >&2
  exit 1
fi
if [ ! -L "$LINK_PROFILE" ]; then
  ln -s "$PLUGIN_DIR" "$LINK_PROFILE"
  echo "已链接: $LINK_PROFILE -> $PLUGIN_DIR"
else
  echo "Profile 符号链接已存在 -> $(readlink "$LINK_PROFILE")"
fi

# 3) 合并式写入补丁
mkdir -p "$(dirname "$PATCH_FILE")"
set +e
patch_rebuild install
rc=$?
set -e
if [ "$rc" -eq 1 ]; then
  echo "profile 补丁已包含 dsh-updater，跳过写入。"
else
  echo "已写入: $PATCH_FILE"
fi

# 4) 自检
if command -v dsh >/dev/null 2>&1; then
  if dsh --profile "$PROFILE" --dump-config 2>/dev/null | grep -q "dsh-updater"; then
    echo "自检通过：dsh 配置已解析到 dsh-updater ✓"
  else
    echo "自检：dsh-updater 尚未在配置中生效（需要重启 dsh web）"
  fi
fi

echo
echo "✅ 安装完成。请重启 dsh web 生效："
echo "  kill \$(pgrep -f 'dsh web') 2>/dev/null; dsh web --no-open"
echo
echo "跨机器迁移：整个插件目录可以 git clone 或拷贝到任意机器，"
echo "在新机器上进入该目录执行: bash install.sh 即可（无需修改任何路径）。"