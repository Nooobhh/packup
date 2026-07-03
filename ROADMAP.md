# packup Roadmap
> 项目 overview（现在 + 未来）。已发布历史看 CHANGELOG.md，agent 指令看 CLAUDE.md。

## 当前主线
0.2.0 — MVP：攻略正确性优先，先能用再美观

- [ ] 补第 2 组真实场景验收（纯图九宫格笔记，验证多模态提取）

## Backlog
<!-- 待开发功能池，按优先级倒序，置顶 = 下一步。单条目 ≤ 3 行：「优先级 + 一句话描述 + 触发线索」-->
- P1 地图 SDK 加载失败韧性：失败文案与 key 缺失区分 + script 竞态清理重试。触发：day-map SDK 失败场景
- P2 修复期路线调用预算：兜底裁剪后只重路由受影响天。触发：高德免费额度告警
- P2 获取韧性：单图下载失败不废整篇笔记（per-image 容错）。触发：真实批量使用
- P3 清理未使用的 shadcn 存根组件与依赖。触发：UI 正式化时
- P3 高德 MCP 模式排程试验（claude -p --mcp-config）。触发：REST 矩阵方案遇质量瓶颈

## Bug
<!-- 已知 bug：「一句话描述 + 复现条件」-->
- `npm run stage` 不加载 .env.local,报 AMAP_REST_KEY is required。复现:配好 .env.local 后直接跑 stage CLI

## 长期目标
<!-- 项目愿景，bullet 形式 -->
