# ClassIsland SecAgent Connector

这是 SecAgent 侧的 ClassIsland 联动。它连接 ClassIsland 端 SecAgent 联动提供的 http://127.0.0.1:18789 普通 HTTP JSON 服务，动态暴露工具和 classisland Skill。插件安装后会在 SecAgent 设置页导航栏增加“ClassIsland联动”，连接失败时会提示在 ClassIsland 设置页安装并启动对应插件。

插件同时声明了 `agent.prompts` 权限：每次对话时都会把 ClassIsland 的课表上下文（当前活动、全天课表序列、下一个活动）注入系统提示词末尾，让模型了解当前所处的课表状态。

## IslandCaller 随机点名

当 ClassIsland 端插件暴露 `call_island_caller` 且 IslandCaller 插件可用时，本连接插件会额外注册 `agent.pre_rules` 前置规则：用户说“点名/随机点名/抽人/抽N个同学”等时直接调用 IslandCaller 随机点名并返回被点学生，不经过 LLM。名单管理（列名单/读写名单）通过隐藏工具 `list_island_caller_profiles` / `read_island_caller_roster` / `write_island_caller_roster` 完成，详见 `skills/classisland/SKILL.md`。

注意：若同时安装 SecRandom 联动插件，“点名/抽人”类关键词可能同时命中两边的规则，SecAgent 会执行先注册的一方。
