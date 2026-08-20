# dsh-updater

DeepSeek Harness 升级助手插件。

在 Web GUI 的右上角（会话头工具区）显示当前版本按钮：每天本地时间 10:00 检查 npm 上
`@deepseek-ai/dsh` 是否有新版本；发现新版本时按钮高亮并弹出提示框，点击「立即升级」即执行
`npm install -g` 并自动重启服务。当本机已是最新版本时，按钮置灰不可点击。

## 安装

```bash
bash install.sh                    # 安装到默认 profile (web)
bash install.sh <profile>          # 安装到指定 profile
bash install.sh status             # 查看安装状态
bash install.sh uninstall          # 卸载
kill $(pgrep -f 'dsh web') 2>/dev/null; dsh web --no-open   # 重启生效
```

## 跨机器 / 多机器安装（持久化）

插件目录完全自包含、无硬编码路径，可整体分发：

**方式 A —— git 仓库（推荐，可跟踪更新）**

1. 把 `dsh-updater` 目录推送到 GitHub/Gitee 私有仓库：
   ```bash
   cd dsh-updater
   git init && git add . && git commit -m "dsh-updater"
   git remote add origin <你的仓库地址>
   git push -u origin main
   ```
2. 在其他机器上（已装 dsh）：
   ```bash
   git clone <你的仓库地址> ~/.dsh/plugins/dsh-updater
   cd ~/.dsh/plugins/dsh-updater && bash install.sh
   kill $(pgrep -f 'dsh web') 2>/dev/null; dsh web --no-open
   ```

**方式 B —— 打包分发**

```bash
bash pack.sh          # 生成 dsh-updater-v<版本>-<日期>.tar.gz
```
把 tar 包拷到其他机器后：
```bash
mkdir -p ~/.dsh/plugins && tar -xzf dsh-updater-v*.tar.gz -C ~/.dsh/plugins
bash ~/.dsh/plugins/dsh-updater/install.sh
kill $(pgrep -f 'dsh web') 2>/dev/null; dsh web --no-open
```

> 安装脚本会自动定位目标机器的 dsh 安装位置并建立符号链接，无需改动任何路径或代码。
> 唯一前置条件：目标机器已 `npm install -g @deepseek-ai/dsh`。

## 工作原理

| 部分 | 位置 | 职责 |
|---|---|---|
| 服务端 | `lib/index.js` | 定时器（每天 10:00 本地时区，启动时立即补检一次）、npm registry 检查、`/upgrade/status` 查询接口、`/upgrade/run` 升级接口 |
| 客户端 | `lib/client.js` | 右上角按钮（`conversation.session.header.utilities` 插槽）、更新提示对话框、5 分钟轮询、有更新时按钮高亮/无更新时置灰、升级后自动刷新页面 |
| 声明 | `package.json` 的 `dsh.client` | 让 `dsh-client-modules` 发现并把浏览器半下发到页面 |

- 版本比较：同时跟踪 npm 的 `latest` 与 `next` 标签，只在其语义版本高于当前安装版本时提示（不会出现"降级"提示）。
- 升级动作：`npm install -g @deepseek-ai/dsh@<目标版本>`，成功后以相同端口重启服务（端口保持不变），当前页面会自动刷新到新版本。
- 安全：升级相关接口仅允许本地回环访问，并校验 `X-Requested-With` 头（防跨站滥用）。
- 安装脚本合并式写入 `cordis.patch.yml`：保留用户已有补丁内容，仅追加 dsh-updater 条目；卸载时只删除自身条目。

## 配置

可在 profile 的 `cordis.patch.yml` 中通过 `config` 覆盖默认值：

```yaml
- insert:
    - id: dsh-updater
      name: '@deepseek-ai/dsh-updater'
      config:
        channel: next        # both | next | latest
        checkHour: 10        # 每天检测的小时（本地时区）
        autoRestart: true    # 升级后自动重启
        restartDelayMs: 3000 # 重启前等待，让响应先落盘
```

## 卸载

```bash
bash install.sh uninstall
kill $(pgrep -f 'dsh web') 2>/dev/null; dsh web --no-open
```

## 发布到 dshmarket 插件市场

> dshmarket（`dsh plugin --profile web add dshmarket`）本身不是插件仓库，
> 它的插件列表来自精选集 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)，
> 发布 = **建公开 GitHub 仓库 + 发布 npm 包 + 去 awesome-dsh-plugin 提 PR**，
> 收录后通常一天内出现在市场里。

**发布信息**：GitHub 仓库 `fengwuxin/dsh-updater`（已存在，公开）→ npm 发布为 `@fengwuxin/dsh-updater`。

**三步上架：**

**① 推送源码到 GitHub 仓库**（已在榜首，市场用仓库做来源识别、防冒名）：
```bash
cd ~/.dsh/plugins/dsh-updater
git init && git add . && git commit -m "dsh-updater: auto-update plugin for DeepSeek Harness"
git branch -M main
git remote add origin git@github.com:fengwuxin/dsh-updater.git  # 见下方“SSH 注意”
git push -u origin main
# 记得在 GitHub 仓库 Settings → Topics 里添加 dsh-plugin 标签（收录要求）
```

**② 发布 npm 包**（发布版自动带 dsh.bundle，市场一键安装后无需手动改补丁）：
```bash
npm login        # 用你的 npm 账号，scope = fengwuxin
cd ~/.dsh/plugins/dsh-updater
bash publish.sh fengwuxin --dry-run fengwuxin/dsh-updater   # 先预览，确认无误
bash publish.sh fengwuxin             # 真正发布为 @fengwuxin/dsh-updater
```

**③ 去 awesome-dsh-plugin 提 PR**：fork `awesome-dsh-plugin/awesome-dsh-plugin` 后，
在 `data/plugins/` 下新建 `data/plugins/fengwuxin__dsh-updater.yml`（内容见本目录 `market-entry.yml`），
在仓库根执行 `npm ci && node scripts/generate-readme.mjs` 重新生成 README 后提交 PR。
站点与 dshmarket 会自动收录（通常一天内），收录要求：仓库 ≥1 天、≥10 commits、带 `dsh-plugin` topic。

> 发布版发布路径为 `@fengwuxin/dsh-updater`（裸名 `dsh-updater` 已被他人占用；
> 本地开发包名保持 `@deepseek-ai/dsh-updater` 不受影响，两者通过 `publish.sh` 解耦）。

> **SSH 注意**：本机对 GitHub 报过「REMOTE HOST IDENTIFICATION HAS CHANGED」警告，
> 属 SSH known_hosts 变更提示；若 push 受阻，改用 HTTPS 远程即可：
> `git remote add origin https://github.com/fengwuxin/dsh-updater.git`（会要求凭据）。

## 注意

- 升级会重启正在运行的服务，当前正在进行的会话会被中断（会话数据已持久化，重启后恢复）。
- 每次执行 `npm install -g @deepseek-ai/dsh` 更新后，npm 会清掉符号链接，需重新执行 `bash install.sh` 恢复。