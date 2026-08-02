const BASE_URL = "http://127.0.0.1:18789";
const SKILL_PATH = "skills/classisland";

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
    catch { throw new Error(`ClassIsland 返回了无效 JSON（HTTP ${response.status}）`); }
    if (!response.ok) throw new Error(payload?.error?.message || payload?.error || `ClassIsland HTTP ${response.status}`);
    return payload;
  };

  const unregister = () => {
    for (const name of registeredTools) api.unregisterTool(name);
    registeredTools = [];
    if (connected) api.unregisterSkill("classisland");
    connected = false;
  };

  const refresh = async () => {
    try {
      const health = await request("/health");
      const catalog = await request("/tools");
      if (health?.apiVersion !== 1 || catalog?.apiVersion !== 1 || health?.status !== "ok" || !Array.isArray(catalog?.tools)) throw new Error("ClassIsland HTTP API 响应不完整");

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
      api.setStatus(`已连接 ClassIsland（${registeredTools.length} 个工具）`);
    } catch (error) {
      unregister();
      api.setStatus(`无法连接 ClassIsland：${error instanceof Error ? error.message : String(error)}。请在 ClassIsland 设置页安装并启动“SecAgent 联动插件”。`, "error");
    }
  };

  await refresh();
  const timer = setInterval(refresh, 5000);
  timer.unref?.();
  return () => { clearInterval(timer); unregister(); };
}
