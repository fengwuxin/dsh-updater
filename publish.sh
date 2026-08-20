#!/usr/bin/env bash
# dsh-updater 发布到 npm 的脚本（供发布者本人执行）
#
# 用法:
#   bash publish.sh <npm-scope> [--dry-run]        # 仓库从 git remote origin 自动读取
#   bash publish.sh <npm-scope> [--dry-run] <repo> # 手动指定 GitHub owner/repo
#
# 示例:
#   bash publish.sh fengwuxin --dry-run                    # 发布为 @fengwuxin/dsh-updater
#   bash publish.sh fengwuxin --dry-run fengwuxin/dsh-updater
set -euo pipefail

SCOPE="${1:-}"
[ -z "$SCOPE" ] && { echo "用法: bash publish.sh <npm-scope> [--dry-run] [repo]"; echo "  例: bash publish.sh fengwuxin --dry-run"; exit 1; }
DRY_RUN="${2:-}"
REPO_ARG="${3:-}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_NAME="@${SCOPE}/dsh-updater"
VERSION="$(python3 -c "import json;print(json.load(open('$SRC/package.json'))['version'])")"

echo "== 发布目标: $PKG_NAME@$VERSION"
[ -z "${DRY_RUN}" ] && DRY_RUN="release"  # 非 --dry-run 才真正发布

# 1) 组装配制发布目录
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp -R "$SRC/lib" "$TMP/lib"
cp "$SRC/README.md" "$SRC/install.sh" "$SRC/pack.sh" "$TMP/" 2>/dev/null || true

# 2) 生成 bundle 补丁（按发布后的包名）
cat > "$TMP/cordis.patch.yml" <<EOF
# 由 publish.sh 生成。市场一键安装 (dsh plugin add) 后自动成为 profile 层。
- insert:
    - id: dsh-updater
      name: '$PKG_NAME'
      config: {}
EOF

# 3) 提取 GitHub owner/repo（优先从 git remote origin 自动取，否则交互输入）
REPO=""
if [ -n "$REPO_ARG" ]; then
  REPO="$REPO_ARG"
elif git -C "$SRC" rev-parse --git-dir >/dev/null 2>&1; then
  REPO="$(git -C "$SRC" remote get-url origin 2>/dev/null | sed -E 's#^.*github.com[:/]##; s#\.git$##')" || REPO=""
fi
if [ -z "$REPO" ]; then
  printf "请输入 GitHub owner/repo（自动填进 package.json 的 repository，市场防冒名校验用）: "
  read -r REPO
fi
REPO="$(printf '%s' "$REPO" | sed -E 's#^https?://##; s#^github\.com[:/]##; s#\.git$##')"
# 校验格式必须是 owner/repo
if ! printf '%s' "$REPO" | grep -qE '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'; then
  echo "错误: GitHub 仓库必须是 owner/repo 格式（如 fengwuxin/dsh-updater），得到: '$REPO'" >&2
  exit 1
fi

# 4) 生成发布版 package.json
cat > "$TMP/package.json" <<EOF
{
  "name": "$PKG_NAME",
  "version": "$VERSION",
  "description": "DeepSeek Harness auto-updater: daily npm update check with an upgrade button in the Web GUI top-right. · DSH 升级助手：每天 10 点自动检测 npm 新版本，右上角按钮一键升级。",
  "keywords": ["dsh", "deepseek-harness", "deepseek", "harness", "plugin", "update", "upgrade", "auto-update", "dsh-updater"],
  "license": "MIT",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./package.json": "./package.json"
  },
  "files": ["lib/index.js", "lib/client.js", "cordis.patch.yml", "README.md", "install.sh"],
  "repository": {
    "type": "git",
    "url": "git+https://github.com/$REPO.git"
  },
  "homepage": "https://github.com/$REPO#readme",
  "dependencies": {},
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": [
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-conversation",
        "@deepseek-ai/dsh-client-ui-primitives"
      ]
    }
  }
}
EOF

# 5) 预检 + 发布
cd "$TMP"
echo
echo "== 打包预览 =="
npm pack --dry-run

echo
echo "== 待发布内容 ==="
ls -la "$TMP"
echo "package.json 关键字段:"
python3 -c "import json;d=json.load(open('package.json'));print('  name:',d['name']);print('  version:',d['version']);print('  repository:',d['repository']['url']);print('  dsh.bundle:',d['dsh']['bundle']);print('  dsh.client:',d['dsh']['client']['platform'])"

if [ "$DRY_RUN" = "--dry-run" ]; then
  echo
  echo "== 预检模式，未发布 ✅ =="
  echo "确认无误后取消 --dry-run 执行: bash $(basename "$0") $SCOPE"
  exit 0
fi

echo
echo "== 发布中 =="
npm publish --access public
echo
echo "✅ 已发布: https://www.npmjs.com/package/$PKG_NAME"
echo
echo "下一步：去 awesome-dsh-plugin 提 PR 上架市场（见 README「发布到市场」章节）"