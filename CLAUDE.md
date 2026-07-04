# packup
> 社媒 UGC → 结构化行程转换器，3 分钟打包好你的旅行

> README ./README.md ｜ ROADMAP ./ROADMAP.md ｜ CHANGELOG ./CHANGELOG.md

## 项目类型
- 类型: 发行产品
- 集群归属: 未分类（待归类）
- 状态: active
- 版本: 0.3.0

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
- UI：`app/page.tsx`（搜索框+链接+手动从零）、`app/trip/[id]/select`（选点页，落选入池）、`app/trip/[id]/`（三栏画布工作台，组件在 `components/workbench/`）
- API：`app/api/generate`（SSE，首事件带 tripId）+ `POST /api/trips`（手动从零）+ `GET /api/pois/search`（POI 搜索）+ `app/api/trips/[id]` 及其下 candidates/selection/plan（PATCH 编辑 op 集：增删移/排程/交通/偏好）
- 画布编辑：结构变换核心前后端共享 `lib/pipeline/plan-edit.ts`（改结构编辑必须双端同源，勿在 route/reducer 内重写）；守恒不变量有测试锁定，不加永久删除 op

## 集成点
- LLM = 本机 `claude -p`（订阅内零 API 费；`PACKUP_CLAUDE_MODEL` 换模型，默认 sonnet）
- 地图 = 高德：服务端 REST（`AMAP_REST_KEY`）+ 前端 JS SDK（`NEXT_PUBLIC_AMAP_JS_KEY`），`.env.local` 配置
- 小红书获取 = 免登录裸 HTTP 主路径（分享链接自带 xsec_token）；`PACKUP_FETCHER=cli` 切 xhs-cli 备选

<!-- 本文件只记 agent 指令。进度 / 待办 / bug → ROADMAP.md；版本变更 → CHANGELOG.md -->
