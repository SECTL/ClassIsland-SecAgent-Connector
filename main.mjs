const BASE_URL = process.env.CLASSISLAND_CONNECTOR_URL || "http://127.0.0.1:18789";
const SKILL_PATH = "skills/classisland";

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
    parts.push(`（来源：ClassIsland 课表 ${data.date} ${data.weekday || ""}）`);
    scheduleContext = parts.join("\n");
  } catch {
    scheduleContext = "";
  }
};

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
    if (connected) api.unregisterSkill("classisland");
    scheduleContext = "";
    connected = false;
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
      api.setStatus(`已连接 ClassIsland（${registeredTools.length} 个工具）`);
    } catch (error) {
      unregister();
      api.setStatus(`无法连接 ClassIsland：${error instanceof Error ? error.message : String(error)}。请在 ClassIsland 设置页安装并启动“SecAgent 联动插件”。`, "error");
    }
  };

  api.registerPrompt(SCHEDULE_PROMPT, () => scheduleContext);
  await refresh();
  const timer = setInterval(refresh, 5000);
  timer.unref?.();
  return () => { clearInterval(timer); api.unregisterPrompt(SCHEDULE_PROMPT); unregister(); };
}
