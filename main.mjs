const BASE_URL = process.env.CLASSISLAND_CONNECTOR_URL || "http://127.0.0.1:18789";
const SKILL_PATH = "skills/classisland";

// IslandCaller 随机点名前置规则（工具 call_island_caller 由 ClassIsland 端插件动态暴露）
const ISLAND_CALLER_TOOL = "call_island_caller";
const ISLAND_CALLER_PROBE_TOOL = "list_island_caller_profiles";
const ISLAND_CALLER_PRE_RULE = "islandcaller_call";
let islandCallerPreRuleRegistered = false;

const SCHEDULE_PROMPT = "classisland_schedule_context";
let scheduleContext = "";

const entryName = (entry) => {
  if (entry.type === "lesson") return entry.subject || (entry.period ? `第 ${entry.period} 节` : "");
  if (entry.type === "break") return entry.label || "课间";
  if (entry.type === "action") return entry.label || "活动";
  return "";
};

const parseLocal = (text) => {
  const match = String(text || "").match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  return match ? new Date(+match[1], +match[2] - 1, +match[3], +match[4], +match[5]) : new Date();
};

const refreshScheduleContext = async (request) => {
  try {
    const schedule = await request("/tools/get_classisland_schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    if (schedule?.ok !== true) throw new Error(schedule?.error?.message || schedule?.error || "获取课表失败");
    const data = schedule.result;
    if (!data?.has_schedule || !Array.isArray(data.entries)) { scheduleContext = "今天没有安排课表。"; return; }
    const now = parseLocal(data.now_local || data.now);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const toMinutes = (time) => { const [h, m] = String(time || "00:00").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
    let currentIndex = -1;
    for (let i = 0; i < data.entries.length; i++) {
      const entry = data.entries[i];
      const start = toMinutes(entry.start);
      const end = toMinutes(entry.end);
      if (end <= start) continue;
      if (nowMinutes >= start && nowMinutes < end) { currentIndex = i; break; }
    }
    let currentName = "";
    let nextName = "";
    if (currentIndex >= 0) {
      currentName = entryName(data.entries[currentIndex]);
      for (let i = currentIndex + 1; i < data.entries.length; i++) {
        const name = entryName(data.entries[i]);
        if (name) { nextName = name; break; }
      }
    }
    const dayNames = data.entries.map(entryName).filter(Boolean);
    const parts = [];
    if (currentName) parts.push(`当前活动：${currentName}`);
    if (nextName) parts.push(`下个活动：${nextName}`);
    if (dayNames.length) parts.push(`今日活动：${dayNames.join(" → ")}`);
    parts.push(`（来源：ClassIsland 课表 ${data.date} ${data.weekday || ""}；以上上下文仅供参考，回答前请调用 get_classisland_schedule 等工具确认。）`);
    scheduleContext = parts.join("\n");
  } catch {
    scheduleContext = "";
  }
};

const chineseDigits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function parseCallCount(value) {
  if (!value) return 1;
  if (/^\d+$/u.test(value)) return Number(value);
  let total = 0;
  let current = 0;
  for (const char of value) {
    if (char in chineseDigits) { current = chineseDigits[char]; continue; }
    if (char === "十" || char === "百") {
      const unit = char === "十" ? 10 : 100;
      total += (current || 1) * unit;
      current = 0;
      continue;
    }
    return NaN;
  }
  return total + current;
}

/**
 * 匹配“点名/随机点名/抽人/抽N个同学”等用户指令，命中后直接调用 IslandCaller
 * 随机点名，绕过 LLM。与 SecRandom 联动插件的前置规则命名与行为保持一致。
 */
export function parseIslandCallerPreRule(input) {
  const text = String(input || "").trim()
    .replace(/[。！？!?，,；;、]+$/u, "")
    .replace(/\s+/gu, "")
    .toLowerCase();
  const match = text.match(/^(?:请帮我|请|帮我|帮|麻烦(?:你|您)?|用classisland|在classisland|在classisland里|classisland)?(?:随机)?(点名|点个名|抽个人|抽同学|抽人|点人|点|抽选|抽取|抽)(?:(\d+|[零〇一二两三四五六七八九十百]+)(?:个|名|位)?)?(?:人|同学)?(?:吧|啊|呀|呗|嘛|哦|呢|咯|了)?$/u);
  if (!match) return undefined;
  const count = parseCallCount(match[2]);
  if (!Number.isInteger(count) || count < 1) return undefined;
  return {
    tool: ISLAND_CALLER_TOOL,
    arguments: { count },
    render: renderIslandCallerResult
  };
}

export function renderIslandCallerResult(result) {
  if (!result || typeof result !== "object") return "IslandCaller 点名结果未知。";
  if (result.ok === false) return result.message || "IslandCaller 点名失败。";
  const students = Array.isArray(result.students) ? result.students.filter((item) => typeof item === "string" && item) : [];
  if (students.length > 0) return `已随机点名 ${students.length} 人：${students.join("、")}。`;
  return result.message || "已触发 IslandCaller 随机点名。";
}

export async function activate(api) {
  let connected = false;
  let registeredTools = [];

  const request = async (path, init = {}) => {
    const response = await api.fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { Accept: "application/json", ...(init.headers || {}) },
      signal: AbortSignal.timeout(3000)
    });
    let payload;
    try { payload = await response.json(); }
    catch { throw new Error(`ClassIsland 返回了无效服务响应（${response.status}）`); }
    if (!response.ok) throw new Error(payload?.error?.message || payload?.error || `ClassIsland 服务请求失败（${response.status}）`);
    return payload;
  };

  const unregister = () => {
    for (const name of registeredTools) api.unregisterTool(name);
    registeredTools = [];
    if (typeof api.unregisterPreRule === "function" && islandCallerPreRuleRegistered) {
      api.unregisterPreRule(ISLAND_CALLER_PRE_RULE);
      islandCallerPreRuleRegistered = false;
    }
    if (connected) api.unregisterSkill("classisland");
    scheduleContext = "";
    connected = false;
  };

  // 探测 ClassIsland 端是否可实际使用 IslandCaller（无副作用，仅读取名单状态）。
  const probeIslandCaller = async () => {
    try {
      const payload = await request(`/tools/${ISLAND_CALLER_PROBE_TOOL}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      return payload?.result?.ok === true && payload?.result?.installed === true;
    } catch {
      return false;
    }
  };

  const refresh = async () => {
    try {
      const health = await request("/health");
      const catalog = await request("/tools");
      if (health?.apiVersion !== 1 || catalog?.apiVersion !== 1 || health?.status !== "ok" || !Array.isArray(catalog?.tools)) throw new Error("ClassIsland 服务响应不完整");

      unregister();
      for (const tool of catalog.tools) {
        if (!tool || typeof tool.name !== "string" || !/^[a-z][a-z0-9_]*$/.test(tool.name)) continue;
        api.registerTool({
          name: tool.name,
          description: tool.description || `调用 ClassIsland 工具 ${tool.name}`,
          inputSchema: tool.inputSchema || { type: "object", additionalProperties: false },
          hidden: tool.hidden ?? true
        }, async (args) => {
          const result = await request(`/tools/${encodeURIComponent(tool.name)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(args || {})
          });
          if (result?.ok !== true) throw new Error(result?.error?.message || result?.error || "ClassIsland 工具调用失败");
          return result.result;
        });
        registeredTools.push(tool.name);
      }
      api.registerSkill(SKILL_PATH);
      connected = true;
      await refreshScheduleContext(request);

      // 只有 ClassIsland 端真实可用 IslandCaller 时才注册“点名”前置规则，
      // 避免占用关键词导致 SecRandom 等其它连接插件的点名规则失效。
      // unregister() 已在新一轮刷新前清掉旧的前置规则，因此这里只需按当前状态重新注册。
      const islandCallerAvailable = registeredTools.includes(ISLAND_CALLER_TOOL);
      if (islandCallerAvailable && typeof api.registerPreRule === "function" && !islandCallerPreRuleRegistered && await probeIslandCaller()) {
        api.registerPreRule(ISLAND_CALLER_PRE_RULE, parseIslandCallerPreRule);
        islandCallerPreRuleRegistered = true;
      }

      api.setStatus(`已连接 ClassIsland（${registeredTools.length} 个工具${islandCallerPreRuleRegistered ? "，IslandCaller 可用" : ""}）`);
    } catch (error) {
      unregister();
      // The connector itself is healthy; the companion service may simply be offline.
      api.setStatus(`无法连接 ClassIsland：${error instanceof Error ? error.message : String(error)}。请在 ClassIsland 设置页安装并启动“SecAgent 联动”。`);
    }
  };

  api.registerPrompt(SCHEDULE_PROMPT, () => scheduleContext);
  await refresh();
  const timer = setInterval(refresh, 5000);
  timer.unref?.();
  return () => { clearInterval(timer); api.unregisterPrompt(SCHEDULE_PROMPT); unregister(); };
}
