# ClassIsland SecAgent Connector

这是 SecAgent 侧的 ClassIsland 联动。它连接 ClassIsland 端 SecAgent 联动提供的 http://127.0.0.1:18789 普通 HTTP JSON 服务，动态暴露工具和 classisland Skill。插件安装后会在 SecAgent 设置页导航栏增加“ClassIsland联动”，连接失败时会提示在 ClassIsland 设置页安装并启动对应插件。

插件同时声明了 `agent.prompts` 权限：每次对话时都会把 ClassIsland 的课表上下文（当前活动、全天课表序列、下一个活动）注入系统提示词末尾，让模型了解当前所处的课表状态。
