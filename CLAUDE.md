# packup
> 社媒 UGC → 结构化行程转换器，3 分钟打包好你的旅行

> README ./README.md ｜ ROADMAP ./ROADMAP.md ｜ CHANGELOG ./CHANGELOG.md

## 项目类型
- 类型: 发行产品
- 集群归属: 未分类（待归类）
- 状态: active
- 版本: 0.4.1

## Agent 行为约定
- 继承全局 ~/CLAUDE.md 编码原则
- 测试一律 mock 外部调用（claude / 高德 / 小红书），真实调用只在验收与 spike 脚本
<!-- 项目特殊约定 / 分支策略：haze 按需填，不填则继承全局 -->

## 关键文件 / 命令
- 命令：`npm run dev` / `npm test` / `npm run build`；单段重跑 `npm run stage -- <tripId> <stage> [--force]`
- 管线：`lib/pipeline/`（fetch→extract→ground→【选点】→plan 两段式，run.ts 支持 toStage/fromStage），契约全在 types.ts（zod）
- 三抽象接口：`lib/fetchers/`（ContentFetcher）、`lib/map/`（MapProvider）、`lib/llm/`（LLMRunner），换实现不动管线
- 中间产物：`data/trips/<id>/00~40-*.json` + 25-selection.json（选点）+ images/（gitignored，断点续跑依据）
- 时间预算：超时常量集中 `lib/pipeline/budgets.ts`（正常路径 ≤300s 单测锁死），段超时走部分成功不炸管线
- UI：`app/page.tsx`（表单+3 类入口：LLM 打包/提取地点入池/空白画布）+ `app/trip/[id]/select`（选点，落选入池）+ `app/trip/[id]/`（画布，组件 `components/canvas/`；`components/workbench/` 遗留不再是入口）
- API 生成：`app/api/generate`（SSE，body.mode=plan 默认走选点页 / mode=pool 写空 selection 直接全部落池进画布）/ `POST /api/trips`（手动，body 可带 preferences）/ `GET /api/pois/search`
- API 行程：`app/api/trips/[id]` 及其下 candidates/selection/plan（PATCH 编辑 op 集：增删移/排程/交通/偏好）
- 画布编辑：结构变换核心前后端共享 `lib/pipeline/plan-edit.ts`，实例 uid 是编辑主键；移动类 op 守恒有测试锁定，唯一永久删除入口是池卡 `pool-remove`
- canvas 展示层每 PlanItem 一张独立卡片/marker（不按 clusterKey 相邻聚合），pipeline 仍写 clusterKey 供地理优化与同簇交通使用

## 集成点
- LLM = 路由（`router.ts`）：三段全走 pptoken 中转（gpt-5.6 多模态，`PACKUP_PPTOKEN_API_KEY`）；deepseek / claude-cli 留作备用 provider
- 地图 = 高德：服务端 REST（`AMAP_REST_KEY`）+ 前端 JS SDK（`NEXT_PUBLIC_AMAP_JS_KEY`），`.env.local` 配置
- 小红书获取 = 免登录裸 HTTP 主路径（分享链接自带 xsec_token）；`PACKUP_FETCHER=cli` 切 xhs-cli 备选

<!-- 本文件只记 agent 指令。进度 / 待办 / bug → ROADMAP.md；版本变更 → CHANGELOG.md -->
