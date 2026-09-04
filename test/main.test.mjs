import test from "node:test";
import assert from "node:assert/strict";
import { parseIslandCallerPreRule, renderIslandCallerResult } from "../main.mjs";

test("matches plain roll-call phrases", () => {
  for (const input of [
    "点名",
    "点个名",
    "随机点名",
    "帮我点个名",
    "请帮我点个名",
    "请随机点名",
    "麻烦您点个名",
    "抽人",
    "抽个人",
    "抽同学",
    "帮我抽个人",
    "点个名吧",
    "用ClassIsland点个名",
    "在ClassIsland里随机点名"
  ]) {
    const match = parseIslandCallerPreRule(input);
    assert.ok(match, `should match: ${input}`);
    assert.equal(match.tool, "call_island_caller", `tool for ${input}`);
  }
});

test("parses count in Arabic digits", () => {
  const cases = [["点名3个", 3], ["点名3人", 3], ["抽5个人", 5], ["抽5名同学", 5], ["随机点名5人", 5]];
  for (const [input, expected] of cases) {
    const match = parseIslandCallerPreRule(input);
    assert.ok(match, `should match: ${input}`);
    assert.equal(match.arguments.count, expected, `count for ${input}`);
  }
});

test("parses count in Chinese numerals", () => {
  const cases = [
    ["点名三个人", 3],
    ["点名三名同学", 3],
    ["抽两个人", 2],
    ["抽十个人", 10],
    ["点五名同学", 5]
  ];
  for (const [input, expected] of cases) {
    const match = parseIslandCallerPreRule(input);
    assert.ok(match, `should match: ${input}`);
    assert.equal(match.arguments.count, expected, `count for ${input}`);
  }
});

test("defaults to 1 person", () => {
  const match = parseIslandCallerPreRule("点名");
  assert.ok(match);
  assert.equal(match.arguments.count, 1);
});

test("does not match unrelated phrases", () => {
  for (const input of [
    "",
    "抽奖",
    "点外卖",
    "点赞",
    "点名册",
    "别点名",
    "不要点名",
    "今天点名了吗",
    "帮我看看今天课表",
    "帮我抽时间检查下作业",
    "随机应变",
    "点开设置页面"
  ]) {
    assert.equal(parseIslandCallerPreRule(input), undefined, `should NOT match: ${input}`);
  }
});

test("bare 抽/点 commands are treated as a 1-person draw", () => {
  assert.equal(parseIslandCallerPreRule("抽").arguments.count, 1);
  assert.equal(parseIslandCallerPreRule("点").arguments.count, 1);
});

test("renders a successful draw result", () => {
  const message = renderIslandCallerResult({
    ok: true,
    installed: true,
    ready: true,
    triggered: true,
    count: 3,
    students: ["张三", "李四", "王五"]
  });
  assert.ok(message.includes("张三"), message);
  assert.ok(message.includes("3 人"), message);
});

test("renders an empty/failure result as a friendly message", () => {
  const failure = renderIslandCallerResult({ ok: false, installed: false, message: "未检测到 IslandCaller 插件" });
  assert.ok(failure.includes("IslandCaller"), failure);
  const empty = renderIslandCallerResult({ ok: true, message: "IslandCaller 点名已触发，但没有返回学生。" });
  assert.ok(empty.includes("没有返回学生"), empty);
  assert.equal(renderIslandCallerResult(null), "IslandCaller 点名结果未知。");
});
