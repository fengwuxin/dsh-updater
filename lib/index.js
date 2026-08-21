// @deepseek-ai/dsh-updater — 服务端半（host）
//
// 功能：
//   1. 每天本地时间 checkHour（默认 10 点）检查 npm 上 @deepseek-ai/dsh 的新版本。
//   2. 通过 GET /upgrade/status 暴露检查结果（供浏览器轮询/获取）。
//   3. 通过 POST /upgrade/run 执行升级（npm install -g）并自动重启服务。
//
// 该插件通过 web profile 的 cordis.patch.yml 注入（见 install.sh），
// 包目录经符号链接挂进 CLI 的 node_modules（@deepseek-ai/dsh-updater），
// 客户端半由 dsh.client 声明被 dsh-client-modules 发现并下发到浏览器。

import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";

// 模块定位到运行中的 dsh CLI 安装树（用于读取已安装版本号）：
// process.argv[1] 指向 dsh 可执行文件（bin 下的软链），其上级两级是 node 版本根，
// 其下的 lib/node_modules/@deepseek-ai/dsh/package.json 是 CLI 包本体。
// 注意：插件自身零依赖（不 import 外部包），避免因不同机器的 npm 布局差异
// （nvm / ~/.local / pnpm 全局）导致模块解析失败。
function cliPkgJson() {
	try {
		return join(dirname(dirname(process.argv[1])), "lib", "node_modules", "@deepseek-ai", "dsh", "package.json");
	} catch {
		return null;
	}
}

const name = "dsh-updater";
const inject = ["timer", "webServer"];

/** 插件配置字段表：类型 / 默认值 / 范围 / 枚举，并据此生成 Standard Schema（~standard）。 */
const CONFIG_FIELDS = {
	/** 检测渠道：both=latest 与 next 里取较新者；next=只跟踪预发布渠道；latest=只跟踪稳定渠道。 */
	channel: { type: "string", default: "both", enum: ["both", "next", "latest"] },
	/** 每天检查的本地时刻（0-23 点）。 */
	checkHour: { type: "number", default: 10, min: 0, max: 23 },
	/** npm registry 基础地址。 */
	registry: { type: "string", default: "https://registry.npmjs.org" },
	/** 升级完成后是否自动重启服务（重启会短暂断开当前网页连接）。 */
	autoRestart: { type: "boolean", default: true },
	/** 升级完成后到重启的延迟（毫秒），用于让 HTTP 响应先落盘。 */
	restartDelayMs: { type: "number", default: 3000, min: 0 }
};

/**
 * 插件配置 schema。
 * dsh 的 cordis 按 Standard Schema v1（Config["~standard"].validate）校验插件配置，
 * 兼容 0.1.0-rc.8 与新版；不依赖 schemastery/zod，零依赖实现默认值补全与类型/范围校验。
 */
const Config = {
	"~standard": {
		version: 1,
		vendor: "dsh-updater",
		validate(input) {
			if (input === null || typeof input !== "object" || Array.isArray(input)) {
				return { issues: [{ message: "配置必须是对象" }] };
			}
			const issues = [];
			const value = {};
			for (const [key, field] of Object.entries(CONFIG_FIELDS)) {
				const raw = input[key];
				const v = raw === undefined ? field.default : raw;
				const bad = (message) => issues.push({ message, path: [key] });
				if (field.type === "string") {
					if (typeof v !== "string") { bad(`期望字符串类型，得到 ${typeof v}`); continue; }
				} else if (field.type === "number") {
					if (typeof v !== "number" || !Number.isFinite(v)) { bad(`期望数字类型，得到 ${typeof v}`); continue; }
				} else if (field.type === "boolean") {
					if (typeof v !== "boolean") { bad(`期望布尔类型，得到 ${typeof v}`); continue; }
				}
				if (field.min !== undefined && v < field.min) bad(`不能小于 ${field.min}`);
				if (field.max !== undefined && v > field.max) bad(`不能大于 ${field.max}`);
				if (field.enum && !field.enum.includes(v)) bad(`必须是 ${field.enum.join(" / ")} 之一`);
				value[key] = v;
			}
			return issues.length ? { issues } : { value };
		}
	}
};

/** 读取已安装的 @deepseek-ai/dsh 版本（从运行中的 CLI 安装读取）。 */
function readInstalledVersion() {
	try {
		const pkg = cliPkgJson();
		if (!pkg) return null;
		return JSON.parse(readFileSync(pkg, "utf8")).version ?? null;
	} catch {
		return null;
	}
}

/** 到下一个整点时刻的毫秒数（本地时区）。 */
function msUntilHour(date, hour) {
	const next = new Date(date);
	next.setHours(hour, 0, 0, 0);
	if (next.getTime() <= date.getTime()) next.setDate(next.getDate() + 1);
	return next.getTime() - date.getTime();
}

/** 与 npm semver 兼容的版本比较：返回 <0 / 0 / >0。 */
function compareVersions(a, b) {
	const parse = (v) => {
		const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-.]+))?(?:\+[0-9A-Za-z-.]+)?$/.exec(String(v).trim());
		if (!m) throw new Error(`非 semver 版本号: ${v}`);
		const [, ma, mi, pa, pre = ""] = m;
		return { major: +ma, minor: +mi, patch: +pa, pre };
	};
	const A = parse(a);
	const B = parse(b);
	if (A.major !== B.major) return A.major - B.major;
	if (A.minor !== B.minor) return A.minor - B.minor;
	if (A.patch !== B.patch) return A.patch - B.patch;
	const splitPre = (p) => (p === "" ? [] : p.split("."));
	const pa = splitPre(A.pre);
	const pb = splitPre(B.pre);
	if (pa.length === 0 && pb.length === 0) return 0;
	if (pa.length === 0) return 1;
	if (pb.length === 0) return -1;
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const x = pa[i];
		const y = pb[i];
		if (x === undefined) return -1;
		if (y === undefined) return 1;
		if (/^\d+$/.test(x) && /^\d+$/.test(y)) {
			const d = Number(x) - Number(y);
			if (d !== 0) return d;
		} else if (/^\d+$/.test(x)) {
			return -1; // 数字段低于字母段（semver 规则）
		} else if (/^\d+$/.test(y)) {
			return 1;
		} else if (x !== y) {
			return x < y ? -1 : 1;
		}
	}
	return 0;
}

/** 从 npm registry 拉取 dist-tags（会话已暴露网络，npm 本机可访问）。 */
async function fetchDistTags(registry) {
	const url = `${registry.replace(/\/$/, "")}/@deepseek-ai%2Fdsh`;
	const res = await fetch(url, {
		headers: { "accept": "application/json", "user-agent": "dsh-updater" },
		signal: AbortSignal.timeout(15000)
	});
	if (!res.ok) throw new Error(`npm registry HTTP ${res.status}`);
	const body = await res.json();
	return body["dist-tags"] ?? {};
}

/**
 * 计算一次检查结果：目标版本 = dist-tags 中语义版本高于当前安装版本的最高者。
 * 与 dist-tag 所指版本相等或更低 → 无更新。
 */
async function runCheck(config, installed) {
	const distTags = await fetchDistTags(config.registry);
	const candidates = config.channel === "latest"
		? { latest: distTags.latest }
		: config.channel === "next"
			? { next: distTags.next }
			: distTags;
	let best = null;
	let bestTag = null;
	for (const [tag, version] of Object.entries(candidates)) {
		if (version === undefined || typeof version !== "string" || version === "") continue;
		let cmp;
		try {
			cmp = compareVersions(version, installed ?? "0.0.0");
		} catch {
			continue;
		}
		if (cmp <= 0) continue; // 不提供降级
		if (best === null || compareVersions(version, best) > 0) {
			best = version;
			bestTag = tag;
		}
	}
	return {
		checkedAt: Date.now(),
		channel: config.channel,
		installed,
		latest: best,
		channelTag: bestTag,
		updateAvailable: best !== null
	};
}

/** 写 JSON 响应（node:http 封装）。 */
function sendJson(res, statusCode, payload) {
	res.writeHead(statusCode, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(JSON.stringify(payload));
}

/** 读取请求体（限制大小，防滥用）。 */
function readBody(req, limit = 64 * 1024) {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks = [];
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > limit) {
				reject(new Error("请求体过大"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}

/** 仅允许本地回环访问本插件的管理端点。 */
function isLoopback(socket) {
	const addr = socket?.remoteAddress ?? "";
	return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1" || addr === "localhost";
}

/** 升级完成后以相同参数重启服务：固定当前端口，派生分离进程后退出当前进程。 */
function restartWithSelf(config, currentPort) {
	const args = [...process.argv.slice(1)];
	const portIndex = args.indexOf("--port");
	if (portIndex !== -1 && portIndex + 1 < args.length) args[portIndex + 1] = String(currentPort);
	const child = spawn(process.execPath, args, {
		detached: true,
		stdio: "ignore",
		env: process.env
	});
	child.unref();
	setTimeout(() => {
		process.exit(0);
	}, config.restartDelayMs);
	return child.pid;
}

/** 服务端插件主体。 */
function apply(ctx, config) {
	// 运行时状态（进程生命周期内共享给所有会话/页面）。
	const state = {
		status: { checkedAt: null, channel: config.channel, installed: readInstalledVersion(), latest: null, updateAvailable: false, error: null },
		upgrading: false,
		upgradeResult: null
	};

	log(`dsh-updater: 已安装版本 v${state.status.installed ?? "unknown"}，每天 ${config.checkHour}:00 检查更新`);

	const check = async () => {
		try {
			const result = await runCheck(config, state.status.installed);
			state.status = result;
			log(`dsh-updater: 检查完成 (${new Date(result.checkedAt).toLocaleString()}) 最新=${result.latest ?? "无"} 可更新=${result.updateAvailable}`);
		} catch (error) {
			state.status = { ...state.status, error: String(error?.message ?? error) };
			ctx.logger.warn(`dsh-updater: 检查失败: ${error?.message ?? error}`);
		}
		return state.status;
	};

	// 每天 checkHour 点触发（本地时区）；先等待计划时刻，触发后重排下一次。
	const arm = () => {
		const delay = msUntilHour(new Date(), config.checkHour);
		return ctx.setTimeout(async () => {
			try { await check(); } catch { /* check 内部已处理 */ }
			arm();
		}, delay);
	};

	// GET /upgrade/status — 当前状态（浏览器轮询/初次加载）。
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/upgrade/status",
		handler: async (req, res) => {
			if (!isLoopback(req.socket)) {
				sendJson(res, 403, { ok: false, error: "forbidden" });
				return;
			}
			sendJson(res, 200, { ok: true, ...state.status, upgrading: state.upgrading, result: state.upgradeResult });
		}
	}), "dsh-updater: status route");

	// POST /upgrade/run — 执行升级（npm install -g），完成后自动重启。
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/upgrade/run",
		handler: async (req, res) => {
			if (!isLoopback(req.socket)) {
				sendJson(res, 403, { ok: false, error: "forbidden" });
				return;
			}
			if (req.method !== "POST") {
				sendJson(res, 405, { ok: false, error: "method not allowed" });
				return;
			}
			if (state.upgrading) {
				sendJson(res, 409, { ok: false, error: "already upgrading" });
				return;
			}
			if (!state.status.updateAvailable || !state.status.latest) {
				sendJson(res, 409, { ok: false, error: "no update available", status: state.status });
				return;
			}
			const target = state.status.latest;
			state.upgrading = true;
			state.upgradeResult = null;
			log(`dsh-updater: 开始升级 v${state.status.installed} -> v${target} (npm install -g @deepseek-ai/dsh@${target})`);
			try {
				const child = spawn("npm", ["install", "-g", `@deepseek-ai/dsh@${target}`], {
					stdio: ["ignore", "pipe", "pipe"]
				});
				let stdout = "";
				let stderr = "";
				child.stdout.on("data", (d) => { stdout += d; });
				child.stderr.on("data", (d) => { stderr += d; });
				const code = await new Promise((resolve) => {
					child.on("close", (c) => resolve(c));
					child.on("error", (e) => resolve({ error: e }));
				});
				if (code && typeof code === "object") {
					throw code.error;
				}
				if (code !== 0) {
					throw new Error(`npm install 退出码 ${code}`);
				}
				state.status = { ...state.status, installed: target, latest: null, updateAvailable: false };
				state.upgradeResult = { ok: true, stdout, stderr };
				const port = ctx.webServer.port ?? null;
				const pid = config.autoRestart ? restartWithSelf(config, port) : null;
				log(`dsh-updater: 升级完成 → v${target}，将自动重启 (pid=${pid})`);
				sendJson(res, 200, {
					ok: true,
					message: `升级到 v${target} 成功，服务即将${config.autoRestart ? "自动重启" : "重启"}。`,
					installed: target,
					needRestart: config.autoRestart,
					restartDelayMs: config.autoRestart ? config.restartDelayMs : 0
				});
			} catch (error) {
				state.upgrading = false;
				state.upgradeResult = { ok: false, error: String(error?.message ?? error) };
				ctx.logger.warn(`dsh-updater: 升级失败: ${error?.message ?? error}`);
				sendJson(res, 500, { ok: false, error: String(error?.message ?? error) });
			}
		}
	}), "dsh-updater: run route");

	// 启动时立即检查一次 + 安排每日检查。立即检查让 UI 一打开就有状态；10 点定时保证每日语义。
	ctx.effect(() => {
		const dispose = arm();
		void check();
		return () => {
			try { dispose(); } catch { /* 忽略重复清理 */ }
		};
	}, "dsh-updater: daily schedule");
}

function log(message) {
	console.log(`[dsh-updater] ${message}`);
}

export { Config, apply, inject, name };