/**
 * dsh-nailong-pet —— 奶龙桌宠（DeepSeek Harness 插件）
 *
 * 在 Web 界面右下角显示一个会动的"奶龙"桌宠，根据 Agent 的实时工作状态切换动画：
 *
 *   - idle（空闲）          → 呼吸眨眼循环
 *   - running（工作中）     → 原地跑 + 思考检查交替
 *   - 任务完成（running→idle）→ 跳跃庆祝 + 气泡「我是奶龙～」+ 播放语音
 *   - 出错（agent/error）   → 难过表情 + 气泡「哎呀…出错了」
 *
 * 实现方式（静态 Host 插件，零构建步骤）：
 *   1. 通过 `webServer.register` 提供 `/nailong/*` 静态路由，从包内 `assets/` 目录
 *      提供精灵图（sprite.webp）、语音（voice.mp3）和浏览器端脚本（pet.js）。
 *   2. 通过 `webServer.tapIndex` 在每个页面的 <head> 注入 <script defer> 引入 pet.js。
 *   3. 监听 `agent/status` / `agent/error` 事件维护全局状态机，并通过 `/nailong/state`
 *      以 JSON 形式提供给浏览器端轮询。
 *
 * pet.js 是纯 DOM 脚本（不依赖 React / 打包器），用 CSS steps() 播放精灵图帧动画，
 * 并轮询 /nailong/state 切换动作、播放语音。详细说明见 README.md。
 *
 * @module dsh-nailong-pet
 */
import z from "@deepseek-ai/schemastery";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** Cordis 插件名。 */
export const name = "nailong-pet";

/**
 * 硬依赖：webServer（浏览器 HTTP 载体服务）。
 * 仅在 web profile 下存在；若宿主未提供，插件会等待而非报错。
 */
export const inject = ["webServer"];

/** 插件配置 schema。 */
export const Config = z.object({
  /** 静态资源与状态接口的 URL 前缀（无尾斜杠）。 */
  routePrefix: z.string().default("/nailong"),
  /** 桌宠精灵显示宽度（px），高度按 192:208 原始比例自动计算。 */
  petWidth: z.number().min(60).max(400).default(140),
  /** 浏览器端轮询 Agent 状态的间隔（ms）。 */
  pollMs: z.number().min(200).default(600),
});

/** 首次读取静态资源；后续请求直接命中内存缓存。 */
function loadAssets() {
  return {
    sprite: readFileSync(join(here, "assets", "sprite.webp")),
    voice: readFileSync(join(here, "assets", "voice.mp3")),
    petJs: readFileSync(join(here, "assets", "pet.js"), "utf8"),
  };
}

/** 从状态表中聚合出"是否存在任一 running 的 Agent"。 */
function anyRunning(statuses) {
  for (const v of statuses.values()) if (v === "running") return true;
  return false;
}

/**
 * 挂载桌宠插件。
 * @param {import("@deepseek-ai/cordis").Context} ctx
 * @param {import("@deepseek-ai/schemastery").Infer<typeof Config>} config
 */
export function apply(ctx, config) {
  let assets;
  try {
    assets = loadAssets();
  } catch (error) {
    ctx.logger.error(`nailong-pet: 无法读取 assets/ 目录资源（${String(error)}）`);
    return;
  }

  const prefix = config.routePrefix.replace(/\/+$/, "");
  const petJs = assets.petJs.replace("__ROUTE_PREFIX__", prefix);

  // ---- Agent 状态机 ----
  const statuses = new Map();
  const state = { status: "idle", completionSeq: 0, errorSeq: 0 };
  let seenAny = false;
  let prevPollRunning = false;

  const offStatus = ctx.on("agent/status", (payload) => {
    if (payload === null || typeof payload !== "object") return;
    if (payload.status !== "running" && payload.status !== "idle") return;
    seenAny = true;
    const id =
      payload.agent && typeof payload.agent.id === "string" ? payload.agent.id : "root";
    const prev = statuses.get(id);
    statuses.set(id, payload.status);
    if (prev === "running" && payload.status === "idle" && !anyRunning(statuses)) {
      state.completionSeq += 1;
    }
    state.status = anyRunning(statuses) ? "running" : "idle";
  });

  const offError = ctx.on("agent/error", () => {
    state.errorSeq += 1;
  });

  /** 若尚未收到任何 agent/status 事件，则回退到直接读取 agents 服务的实时状态。 */
  function reconcileFallback() {
    if (seenAny) return;
    const agents = ctx.get("agents");
    if (agents === undefined) return;
    let running = false;
    try {
      for (const a of agents.list()) {
        if (a !== null && typeof a === "object" && a.status === "running") running = true;
      }
    } catch (error) {
      return;
    }
    if (prevPollRunning && !running) state.completionSeq += 1;
    prevPollRunning = running;
    state.status = running ? "running" : "idle";
  }

  // ---- 静态路由 + 状态接口 ----
  const removeRoute = ctx.webServer.register({
    kind: "prefix",
    path: prefix,
    handler: (req, res) => {
      const name = String(req.url || "").split("?")[0].slice(prefix.length).replace(/^\/+/, "");
      if (name === "state") {
        reconcileFallback();
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        return res.end(JSON.stringify(state));
      }
      if (name === "sprite.webp") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "image/webp");
        res.setHeader("Cache-Control", "no-store");
        return res.end(assets.sprite);
      }
      if (name === "voice.mp3") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("Cache-Control", "no-store");
        return res.end(assets.voice);
      }
      if (name === "pet.js") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        return res.end(petJs);
      }
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.end("not found");
    },
  });

  // ---- 向每个页面的 <head> 注入浏览器端脚本 ----
  const scriptTag = `<script src="${prefix}/pet.js" defer></script>`;
  const removeTap = ctx.webServer.tapIndex((html) => {
    if (html.includes(scriptTag)) return html;
    return html.replace("</head>", scriptTag + "</head>");
  });

  ctx.logger.info(`nailong-pet: 桌宠已挂载，资源前缀 ${prefix}`);

  return () => {
    offStatus();
    offError();
    removeRoute();
    removeTap();
  };
}
