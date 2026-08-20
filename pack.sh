#!/usr/bin/env bash
# dsh-updater 打包脚本：把插件打成 tar.gz，便于拷贝到其他机器/git 仓库
# 用法: bash pack.sh [输出目录]    默认输出到当前目录
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${1:-$PLUGIN_DIR}"
VERSION="$(python3 -c "import json;print(json.load(open('$PLUGIN_DIR/package.json'))['version'])" 2>/dev/null || echo "0.1.0")"
STAMP="$(date +%Y%m%d)"
TARBALL="$OUT_DIR/dsh-updater-v${VERSION}-${STAMP}.tar.gz"

mkdir -p "$OUT_DIR"
# 只打包需要的文件（排除符号链接/缓存等）
tar -czf "$TARBALL" -C "$PLUGIN_DIR" \
  package.json README.md install.sh publish.sh pack.sh market-entry.yml \
  cordis.patch.yml lib

echo "✅ 已打包: $TARBALL"
echo
echo "分发方式："
echo "  1) 拷到其他机器后解压并安装:"
echo "     tar -xzf $(basename "$TARBALL") -C ~/.dsh/plugins && bash ~/.dsh/plugins/dsh-updater/install.sh"
echo "  2) 或推送到 GitHub/Gitee 私有仓库，在其他机器上 git clone 后直接执行 install.sh"
echo
echo "跨机器安装只需满足: 目标机器已安装 dsh (npm install -g @deepseek-ai/dsh)"