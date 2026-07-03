# packup 0.3.0 生成优化 — Guidance Plan

> **For Codex (the executor):** Each Task below specifies WHAT must be true at completion, not HOW to write it line by line. You have autonomy over internal naming, control flow, helper extraction, and algorithm choice. You do NOT have autonomy over public interfaces, file paths in Files lists, acceptance criteria, or cross-Task invariants. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Spec: `docs/ohaze/specs/2026-07-03-gen-optimize-design.md`(§引用指向它)。Brief: `docs/ohaze/briefs/2026-07-03-gen-optimize-brief.md`。

**Goal:** 把 packup 从「一次性生成器」改造为「生成 + 轻确认的规划工作台」:自然语言输入 → 选点确认 → 时段制快速排程 + 真实路线,机器耗时正常路径 ≤300s。

**Architecture:** 管线仍是 fetch→extract→ground→plan 四段(zod 契约、落盘断点续跑不变),但在 ground 后加人工选点闸门(25-selection.json),plan 段从「LLM 全责 3 轮裁决」改为「LLM 一次分天(id 引用)+ 确定性算法排序/路线/兜底」。所有超时收敛进集中预算表,段级 deadline 走部分成功而非炸管线。契约全部向后兼容(新字段 optional),旧落盘 trip 必须仍可打开。

**Tech Stack:** Next.js App Router + TypeScript + zod + vitest(全 mock 外部调用)+ 高德 REST(`lib/map/amap-rest.ts`)+ 本机 claude CLI(`lib/llm/claude-cli.ts`)。npm。

**验收总命令:** `npm test && npm run build`

---

### Task 1: 契约与时间预算地基

**Files:**
- Create: `lib/pipeline/budgets.ts`
- Modify: `lib/pipeline/types.ts`
- Test: `lib/pipeline/types.test.ts`、`lib/pipeline/budgets.test.ts`

**Behavior Contract:**
- `budgets.ts` 导出 `BUDGETS` 常量对象(as const),字段与默认值见 spec §0.5 代码块(fetchTotalMs 25_000 / extractStageMs 120_000 / extractPerNoteMs 120_000 / groundStageMs 40_000 / planLlmMs 90_000 / planRoutesMs 25_000 / parseQueryMs 20_000 / routeCallMs 5_000)。
- `types.ts` 变更(全部向后兼容):
  - 新 `SlotSchema = z.enum(["morning","afternoon","evening"])` 并导出类型。
  - `PlanItemSchema`:`startTime` 由 required 改 optional(格式校验保留);新增 `slot`(SlotSchema optional)、`clusterKey`(string optional)。
  - `TransportToNextSchema`:新增 `polyline: z.array(LngLatSchema).optional()`。
  - `TripInputSchema`:新增 `query`(string optional)、`preferences`(string[] optional);其余字段与 superRefine 不动。
  - 新 `SelectionSchema = { selectedPoiIds: string[].min(1), selectedAt: string }` 并导出类型。
  - `StageEventSchema.status` 枚举增加 `"await-selection"`。
- 不删除任何既有字段/校验;`TripPlanSchema.parse` 对旧分钟制数据(带 startTime、无 slot)必须仍通过。

**Acceptance Criteria:**
- [ ] Test: BUDGETS 结构性断言 —— `fetchTotalMs+extractStageMs+groundStageMs+planLlmMs+planRoutesMs <= 300_000`、`planLlmMs <= 90_000`、`extractPerNoteMs <= extractStageMs`(spec §0.5 预算数学)。
- [ ] Test: 旧分钟制 PlanItem(`{name, startTime:"09:00", durationMin:60}`)通过 PlanItemSchema.parse;新时段制(`{name, slot:"morning", durationMin:60}`,无 startTime)也通过。
- [ ] Test: TransportToNext 带 polyline 数组与不带均可 parse。
- [ ] Test: TripInput 带 query/preferences 可 parse;不带(旧 00-input.json 形状)仍可 parse。
- [ ] Test: SelectionSchema 拒绝空数组。
- [ ] Interface conformance: 上述导出名与 spec §1 一致。

**TDD Sequence:**
- [ ] Step 1: 在两个测试文件写失败断言(上述行为)
- [ ] Step 2: 跑测试确认按预期失败
- [ ] Step 3: 实现 budgets.ts 与 types.ts 变更
- [ ] Step 4: 全量 `npm test` 通过(既有 75 测试不回归)
- [ ] Step 5: Commit 建议:`feat(types): 0.3.0 契约地基(slot/polyline/selection/query)+ 时间预算表`

**Cross-Task Dependencies:** Provides 全部下游 Task 的类型与预算常量。

---

### Task 2: 自然语言 query 解析

**Files:**
- Create: `lib/pipeline/parse-query.ts`
- Test: `lib/pipeline/parse-query.test.ts`

**Behavior Contract:**
- Public: `parseQuery(query: string, llm: LLMRunner): Promise<{ destination: string; days?: number; preferences: string[] }>`
- 规则路径(不调 llm):从 query 提取天数(`N天`/`N天M晚` 取 N,1-15 之外视为未指定)、剥离旅行停用词(旅游/旅行/攻略/游玩/出行/自由行/之旅 等)、destination 取剥离后最前段连续词、preferences 为剩余按 `+`/`、`/`,`/空格切分的非空 token。
- LLM 兜底:规则得到的 destination 为空或长度 >10 时调 `llm.run` 一次(jsonSchema 约束 `{destination, days?, preferences[]}`,timeoutMs 用 `BUDGETS.parseQueryMs`);兜底输出仍无有效 destination 则 throw(错误信息含「无法识别目的地」)。
- 纯函数无副作用;llm 仅在兜底路径被调用。

**Acceptance Criteria:**
- [ ] Test 场景表(mock llm,断言不被调用):「香港旅游攻略」→ {destination:"香港", days:undefined, preferences:[]};「杭州3天旅游攻略」→ {"杭州", 3, []};「泰国3天2晚旅游攻略」→ {"泰国", 3, []};「吉隆坡5天city walk+美食」→ {"吉隆坡", 5, ["city walk","美食"]}。
- [ ] Test: 规则失败(如「帮我规划一个超级好玩的假期行程」)→ mock llm 被调用恰 1 次,返回值被采用。
- [ ] Test: 兜底也无 destination → 抛错,信息含「无法识别目的地」。
- [ ] Interface conformance: 签名与 spec §2 一致。

**TDD Sequence:**
- [ ] Step 1: 写场景表驱动的失败测试
- [ ] Step 2: 确认失败原因正确
- [ ] Step 3: 实现(内部切词/正则策略自选)
- [ ] Step 4: 全量测试通过
- [ ] Step 5: Commit 建议:`feat(pipeline): 一句话 query 解析(规则先行 + LLM 兜底)`

**Cross-Task Dependencies:** Depends on Task 1 的 BUDGETS。Provides parseQuery for Task 8(generate API 接线)。

---

### Task 3: 邻近聚类

**Files:**
- Modify: `lib/pipeline/geo.ts`
- Test: `lib/pipeline/geo.test.ts`

**Behavior Contract:**
- Public: `clusterByDistance<T extends { id: string; location?: LngLat }>(pois: T[], thresholdKm?: number): Map<string, string>`(默认阈值 0.25)。
- 返回 poiId → clusterKey 映射:两两 haversine ≤ threshold 传递连通(并查集/图连通分量语义)为一组;clusterKey 为组内第一个(按输入序)成员的 id;无 location 的 POI 各自独立成组(clusterKey = 自身 id)。
- 纯函数;不修改输入。

**Acceptance Criteria:**
- [ ] Test: 三点 A-B 150m、B-C 200m、A-C 320m → 同一 cluster(传递连通),clusterKey 为 A.id。
- [ ] Test: 两点相距 >250m → 各自成组。
- [ ] Test: 无 location 的 POI 独立成组,不与任何组合并。
- [ ] Test: 空数组 → 空 Map。
- [ ] Interface conformance: 签名与 spec §6 一致。

**TDD Sequence:**
- [ ] Step 1-2: 失败测试 + 确认
- [ ] Step 3: 实现(并查集或 BFS 自选)
- [ ] Step 4: 全量测试通过
- [ ] Step 5: Commit 建议:`feat(geo): 250m 邻近聚类 clusterByDistance`

**Cross-Task Dependencies:** Provides clusterByDistance for Task 5。

---

### Task 4: 高德 route 返回真实 polyline

**Files:**
- Modify: `lib/map/types.ts`、`lib/map/amap-rest.ts`
- Test: `lib/map/amap-rest.test.ts`

**Behavior Contract:**
- `MapProvider.route` 返回类型扩展为 `{ durationMin: number; distanceKm: number; polyline?: LngLat[] }`(接口在 lib/map/types.ts:13-17)。
- amap-rest 实现(现 route() 在 amap-rest.ts:68-88):
  - drive/walk:解析 `route.paths[0].steps[].polyline`(高德格式 `"lng,lat;lng,lat;..."`)按 step 顺序拼接。
  - public(transit):解析 `route.transits[0].segments[]`,按顺序拼接每 segment 的 walking.steps[].polyline 与 bus.buslines[0].polyline;缺失的子段跳过。
  - 拼接后去除相邻重复点;总点数 >500 时均匀抽稀至 ≤500。
  - 解析失败/无 polyline 数据:不抛错,返回值省略 polyline 字段(durationMin/distanceKm 照常)。
  - estimateWalk 兜底路径(极近距离/空 path,amap-rest.ts:81-86)无 polyline,行为不变。
- QPS 重试、并发闸门(amap-rest.ts:98-128)不动。

**Acceptance Criteria:**
- [ ] Test(mock fetchJson): driving 响应带 2 个 step 各 2 点(有 1 个共享点)→ polyline 为去重后的 3 点。
- [ ] Test: transit 响应 walking+bus 混合 segment → 按序拼接;bus 段缺 polyline 时仅拼 walking 段,不抛错。
- [ ] Test: polyline 字段整体缺失 → 返回无 polyline,duration/distance 正常。
- [ ] Test: >500 点输入 → 输出 ≤500 点且首尾点保留。
- [ ] Test: 既有 route 测试(时长/距离/QPS/estimateWalk)不回归。
- [ ] Interface conformance: MapProvider.route 返回类型与 spec §5b 一致。

**TDD Sequence:**
- [ ] Step 1-2: 失败测试 + 确认
- [ ] Step 3: 实现解析/拼接/抽稀(内部结构自选)
- [ ] Step 4: 全量测试通过
- [ ] Step 5: Commit 建议:`feat(map): route 解析高德真实 polyline(transit 分段拼接/抽稀/缺段容错)`

**Cross-Task Dependencies:** Provides polyline for Task 5(fillAdjacentRoutes)与 Task 9(day-map)。

---

### Task 5: plan 段重构(一次 LLM 分天 + 算法排序 + 确定性兜底)

**Files:**
- Modify: `lib/pipeline/plan.ts`、`lib/prompts/plan.ts`、`lib/pipeline/ground.ts`
- Test: `lib/pipeline/plan.test.ts`、`lib/pipeline/ground.test.ts`

**Behavior Contract:**

*ground 段(前置小改)*:
- runGround 输出的每个 GroundedPoi **必须有稳定唯一 id**:verified 命中用 amapId;未命中用 `unverified-<sourceNoteId>-<该笔记内序号>`(spec §1d)。既有去重/城市过滤逻辑(ground.ts:14-61)不变。

*plan 段(runPlan 重写,plan.ts:8-43 的编排换血)*:
- 流程:budgetPois(保留,plan.ts:47-63)→ clusterByDistance(Task 3)→ 一次 LLM 分天 → slot 内算法排序 → per-leg mode 推荐 + 路线填充 → findViolations(保留,plan.ts:175-215)→ 仅确定性 fallback → 空行程保险 → warnings。
- **LLM 分天调用**(callPlanner 重写):
  - prompt(lib/prompts/plan.ts 重写 buildPlanPrompt):输入含带 **id** 的 slimPois(cluster 以组合点出现:id=clusterKey,name 拼成员名)、destination、days(固定数或缺省推荐指令)、preferences(替代 transport/pace/dailyThemes/startDate 渲染,这些渲染函数删除)、近邻表(保留 plan.ts:71-78 的 matrix);**删除 routeSamples 实测采样**(buildContext 不再调 map.route,plan.ts:80-87)。
  - 输出 jsonSchema:`{days:[{theme?, slots:{morning:[poiId], afternoon:[poiId], evening:[poiId]}}], daysDecision?}`;prompt 提示每 slot 容量 morning≤2/afternoon≤3/evening≤2(cluster 算 1)。
  - timeoutMs = `BUDGETS.planLlmMs`;**无重试**——超时/JSON 解析失败/zod 校验失败一律直接走确定性兜底(LLM 调用恒 ≤1 次)。
- **rehydration(id 引用)**:LLM 输出的 poiId/clusterKey 从 grounded Map 查找回填完整 POI 数据;查不到的 id 视为幻觉丢弃并记 warning。durationMin 程序侧决定:解析 suggestedDuration 的小时/分钟数字,缺失按 type 默认(sight 90/food 60/shop 45/stay 30/experience 120/other 60)。
- **算法排序**:每天每 slot 内最近邻排序(起点为上一 slot 末尾 POI,首 slot 起点为该 slot 首个);cluster 成员始终相邻且作为整体参与排序。
- **per-leg 交通推荐 + 路线**(fillAdjacentRoutes 重写,plan.ts:162-173):相邻两 item 直线距离 <0.8km → mode "walk";否则 `input.transport ?? "public"`;public 结果 durationMin >90 时再以 "drive" 试一次取耗时短者。route 结果(含 polyline)写入 transportToNext(mode 为最终选定值)。同 clusterKey 成员之间**不调 route**:mode "walk"、durationMin ≤5、distanceKm 为直线值、无 polyline。路线填充总预算 `BUDGETS.planRoutesMs`,到点未填的段用 estimateWalk 直线估算。
- **确定性 fallback**(fallbackPlan 改造,plan.ts:217-246):违规时不回 LLM;折返>1.5 最近邻重排(既有);超载裁剪循环中**只重算被裁 POI 前后相邻段**而非全量(plan.ts:241 现状全量,spec §4c)。
- **空行程保险(硬不变式)**:rehydrate 后所有 days 的 items 全空且入参 grounded 非空 → 按 clusterKey 分组、地理最近邻链均分到天、slot 依次填 morning/afternoon/evening,warning「LLM 分天失败,已按地理就近自动分配」。**选中 POI 非空 ⇒ 产出行程非空**。
- 产出 PlanItem 带 slot 与 clusterKey,不带 startTime;ensureDaysDecision/enforceFlexibleDayRange/addWarnings(plan.ts:295-353)保留,addWarnings 的 dailyThemes 分支在 input 无该字段时自然跳过。

**Acceptance Criteria:**
- [ ] Test: mock llm 返回合法 slots 输出 → 产物 PlanItem 带 slot/无 startTime,POI 数据由 id 回填(name/location/verified 与 grounded 源一致)。
- [ ] Test: mock llm 输出含幻觉 id → 该条被丢弃 + warning,其余正常。
- [ ] Test: mock llm 抛超时/返回坏 JSON → llm.run 恰被调 1 次,产物为地理均分兜底,行程非空且带兜底 warning(空行程保险不变式)。
- [ ] Test: 全部 POI verified=false(未验证)且被选中 → 行程非空、items 带未验证标(brief Scenario 3)。
- [ ] Test: per-leg 规则表 —— 相邻 0.5km → walk;5km → public;mock public 返回 95min 且 drive 40min → mode=drive。
- [ ] Test: 同 cluster 成员间无 route 调用(mock map.route 计数),跨 cluster 段有。
- [ ] Test: buildContext/分天路径中 map.route 调用次数为 0(routeSamples 已删)。
- [ ] Test: durationMin 回填 —— suggestedDuration "2小时" → 120;缺失的 food → 60。
- [ ] Test: ground 输出全部带唯一 id;未验证 POI id 形如 `unverified-<noteId>-<n>`。
- [ ] Test: 既有 budgetPois/violations 阈值测试不回归(断言按新流程调整,阈值语义不变)。

**TDD Sequence:**
- [ ] Step 1-2: 按上述验收逐条写失败测试 + 确认
- [ ] Step 3: 实现(建议顺序:ground id → prompt/schema → rehydrate → 排序 → routes → fallback → 保险)
- [ ] Step 4: 全量测试通过
- [ ] Step 5: Commit 建议:`feat(plan): 一次 LLM 分天 + 算法排序/兜底,时段制输出,per-leg 交通与 polyline`

**Cross-Task Dependencies:** Depends on Task 1(SlotSchema/BUDGETS)、Task 3(clusterByDistance)、Task 4(route polyline)。Provides 新 TripPlan 形状 for Task 6/8/9。

---

### Task 6: 两段式管线编排

**Files:**
- Modify: `lib/pipeline/run.ts`
- Test: `lib/pipeline/run.test.ts`

**Behavior Contract:**
- `runPipeline` opts 新增 `toStage?: StageName`:执行到该段(含)后停止并返回 tripId(run.ts:39-75 的段循环)。缺省行为不变(跑满 4 段)。
- `runPlanStage`(run.ts:132-136):存在 `25-selection.json`(SelectionSchema)时,plan 只消化 `grounded.filter(id ∈ selectedPoiIds)`,未选中项以 `{stage:"plan", reason:"用户未选入排程"}` 进 filtered;文件不存在时用全量 grounded(旧 trip/直跑兼容)。
- 断点续跑逻辑(startStageIndex/deleteDownstream,run.ts:92-107)不变——`fromStage:"plan"` 配合 selection 文件即为第二段入口。

**Acceptance Criteria:**
- [ ] Test: `toStage:"ground"` → fetch/extract/ground 跑、plan 不跑,40-plan.json 不存在,事件流止于 ground done。
- [ ] Test: 写入 selection(选 2/3 个 POI)后 `fromStage:"plan"` → plan 只收到选中 2 个,未选中 1 个进 filtered 且 reason 为「用户未选入排程」。
- [ ] Test: 无 selection 文件 + fromStage plan → 全量 grounded 进 plan(现行为不回归)。
- [ ] Test: 既有 5 个 run 测试不回归。

**TDD Sequence:**
- [ ] Step 1-2: 失败测试 + 确认
- [ ] Step 3: 实现
- [ ] Step 4: 全量测试通过
- [ ] Step 5: Commit 建议:`feat(pipeline): 两段式编排(toStage 停 + selection 过滤)`

**Cross-Task Dependencies:** Depends on Task 1(SelectionSchema)。Provides 两段入口 for Task 8。

---

### Task 7: 时间预算接线 + failReason 摘要

**Files:**
- Modify: `lib/llm/claude-cli.ts`、`lib/pipeline/extract.ts`、`lib/pipeline/ground.ts`、`lib/fetchers/xhs-http.ts`(仅当其无总超时时)
- Test: `lib/llm/claude-cli.test.ts`、`lib/pipeline/extract.test.ts`、`lib/pipeline/ground.test.ts`

**Behavior Contract:**
- claude-cli 错误信息**不得包含 prompt/args 原文**(现状:execFile 失败的 error.message 为 `Command failed: claude -p <整个 prompt>`,claude-cli.ts:33-42 透传):失败时构造 `claude CLI failed: <stderr 或 stdout 提取物,截 ≤200 字符>`;超时错误保持 LLMTimeoutError 语义。
- extract:单笔记 LLM timeoutMs 从 300_000(extract.ts:39)改 `BUDGETS.extractPerNoteMs`;新增段级 deadline `BUDGETS.extractStageMs`——到点未完成的笔记记 `failedNotes(reason:"提取超时")`,已完成结果照常返回(部分成功,不抛错);failedNotes.reason 一律 ≤200 字符。
- ground:段级 deadline `BUDGETS.groundStageMs`——到点未查证的 POI 直接 `verified:false` 收进 grounded(仍分配稳定 id),不再调 searchPoi。
- fetch:若 fetcher 无总超时,包一层 `BUDGETS.fetchTotalMs` 总 deadline,超时的链接记 fetchStatus:"failed"(reason 摘要),已完成的照常。

**Acceptance Criteria:**
- [ ] Test: mock execClaude 抛含长 prompt 的 Command failed 错误 → run() 抛出的 message ≤250 字符且不含 prompt 正文标记词。
- [ ] Test: extract mock 一慢一快两笔记 + 极小 stage 预算 → 快的产出 POI,慢的进 failedNotes(reason 含「超时」),函数正常返回。
- [ ] Test: ground mock 慢 searchPoi + 极小预算 → 到点后剩余 POI verified:false 且有 id,无未处理 rejection。
- [ ] Test: 既有 claude-cli 7 测试、extract/ground 测试不回归。

**TDD Sequence:**
- [ ] Step 1-2: 失败测试 + 确认
- [ ] Step 3: 实现(deadline 机制内部实现自选,注意并发 mapLimit 的取消语义可用「到点不再等未完成 promise」实现,不要求真正 abort 子进程)
- [ ] Step 4: 全量测试通过
- [ ] Step 5: Commit 建议:`feat(pipeline): 段级时间预算(部分成功)+ failReason 摘要化`

**Cross-Task Dependencies:** Depends on Task 1(BUDGETS)、Task 5 的 ground id 规则(同文件,若先做本 Task 则由本 Task 引入 id 分配,两者以先执行者为准,后者复用)。

---

### Task 8: API 层(generate 两段化 + candidates/selection/PATCH)

**Files:**
- Modify: `app/api/generate/route.ts`
- Create: `app/api/trips/[id]/candidates/route.ts`、`app/api/trips/[id]/selection/route.ts`、`app/api/trips/[id]/plan/route.ts`
- Test: `app/api/api.test.ts`(路由 handler 直接 import 测试,mock 管线依赖)

**Behavior Contract:**
- **POST /api/generate**(route.ts:7-48 改造):
  - body 含 `query` 且无 `destination` → 先 `parseQuery`(Task 2)合成 TripInput(days 取 `{base}`,无 flex);显式 destination 的 body(测试/CLI)照旧直通。parseQuery 抛错 → 400 + 错误信息。
  - 管线以 `toStage:"ground"` 运行;SSE 事件流最后一条为 `{stage:"ground", status:"await-selection", tripId}`。
- **GET /api/trips/[id]/candidates**:读 30-grounded.json + 20-pois.json,返回 `{grounded, filtered}`;目录不存在 404,30-grounded 未就绪 409(语义仿 app/api/trips/[id]/route.ts:8-17)。
- **POST /api/trips/[id]/selection**:body 过 SelectionSchema(400 on 违规);写 25-selection.json;以 `{fromStage:"plan", force:false}` 续跑管线并 SSE 推事件,done 事件 `{stage:"done", tripId}`。重复提交:覆盖 selection 并重跑 plan(先删旧 40-plan.json 与 plan.error.json)。
- **PATCH /api/trips/[id]/plan**:body 二选一 —— `{op:"reorder", day, orderedIds}` / `{op:"set-transport", day, segmentIndex, mode}`。
  - reorder:orderedIds 为该天 items 的完整新顺序(cluster 以 clusterKey 引用、整组移动);**pair-diff**:新序相邻对 (a,b) 在旧序中已相邻(a 紧邻 b)且 a.transportToNext 存在 → 复用;否则按 Task 5 的 per-leg 规则重算该段。末位 item 的 transportToNext 置空。
  - set-transport:仅重算该段(1 次 route,指定 mode,不做推荐比较)。
  - 校验:day 越界/orderedIds 与该天 items 集合不一致/segmentIndex 越界 → 400;成功后 TripPlanSchema.parse 写回 40-plan.json 并返回新 plan。**不调 LLM**。
- 全部 handler 不引入鉴权(自用本机,现状一致)。

**Acceptance Criteria:**
- [ ] Test: generate 收 `{query:"杭州3天旅游攻略", links:[...]}`(mock 管线)→ 管线收到 destination"杭州"/days.base 3,SSE 含 await-selection 事件。
- [ ] Test: generate 收无法解析的 query → 400,错误含「无法识别目的地」。
- [ ] Test: candidates 在 30-grounded.json 就绪/未就绪/目录不存在时分别 200/409/404。
- [ ] Test: selection 合法 body → 25-selection.json 落盘,管线以 fromStage:"plan" 被调;空数组 body → 400。
- [ ] Test: reorder 相邻互换(mock route 计数)→ 恰 3 次;顺序不变 → 0 次;set-transport → 恰 1 次(brief Scenario 2 拍板口径)。
- [ ] Test: reorder 的 orderedIds 缺一个 id → 400 且 40-plan.json 未被改写。

**TDD Sequence:**
- [ ] Step 1-2: 失败测试 + 确认(handler 直接函数调用,文件系统用临时目录 PACKUP_DATA_DIR)
- [ ] Step 3: 实现(SSE 封装可从 generate 提取共用 helper,自选)
- [ ] Step 4: 全量测试通过
- [ ] Step 5: Commit 建议:`feat(api): 两段式 generate + candidates/selection + PATCH 重排改交通`

**Cross-Task Dependencies:** Depends on Task 2(parseQuery)、Task 5(per-leg 规则/plan 形状)、Task 6(toStage/selection 编排)。Provides API for Task 9。

---

### Task 9: 前端功能壳(表单/选点页/时段时间轴/真实路线图)

**Files:**
- Modify: `components/trip-form.tsx`、`components/day-timeline.tsx`、`components/day-map.tsx`、`app/trip/[id]/page.tsx`
- Create: `app/trip/[id]/select/page.tsx`、`components/candidate-list.tsx`
- Test: `components/components.test.tsx`

**Behavior Contract:**
- **trip-form 重写**:仅两个输入 —— query 单行搜索框(placeholder 示例「香港3天2晚 city walk+美食」)+ links textarea(识别条数提示保留,trip-form.tsx:83-84);移除 destination/days/flex/startDate/transport/pace/dailyThemes 全部字段;提交 `{query, links}`;SSE 收到 `await-selection` → 跳 `/trip/<id>/select`;error 事件展示保留。
- **选点页** `app/trip/[id]/select/page.tsx` + `candidate-list.tsx`:加载 candidates API;POI 列表按 verified 分区,每项 checkbox(verified 默认勾选,未验证默认不勾)+ name/type/reason/「未验证」徽标;「排程」按钮 POST selection 并消费 SSE(进度复用 `components/progress-stream.tsx`),done → 跳 `/trip/<id>`;0 勾选时按钮禁用。
- **day-timeline**:PlanDay.items 按 slot 分组渲染,组标题 上午/下午/晚上(无 slot 的旧数据回退现有平铺渲染,startTime 有则显示);同 clusterKey 相邻成员渲染为一个组合节点(标题为成员名 " + " 连接,成员逐行列出各自 reason/时长);transportToNext 展示模式中文(walk 步行/public 公交/drive 驾车)。
- **day-map**:transportToNext.polyline 存在 → 按段画折线(既有 Polyline API);无 polyline 段维持点间直线;同 clusterKey 只放一个 marker(title 为成员名拼接);verifiedMapPoints 语义(只画 verified 且有 location,day-map.tsx:54-63)保留。
- **行程页** `app/trip/[id]/page.tsx`:warnings 收进 `<details><summary>提示 N 条</summary>` 折叠块(page.tsx:16 现状平铺);failedLinks 区不变(数据已由 Task 7 摘要化)。
- 不引入拖拽/编辑交互;不追求视觉美化(Tailwind 现有风格)。

**Acceptance Criteria:**
- [ ] Test: trip-form 渲染仅含 query 输入与 links textarea(无 transport/pace 等字段);提交 body 形状 `{query, links}`。
- [ ] Test: candidate-list —— verified POI 默认勾选、unverified 默认不勾;全不勾时排程按钮 disabled。
- [ ] Test: day-timeline 对带 slot 数据输出 上午/下午/晚上 分组;对旧 startTime 数据(fixture:`lib/pipeline/__fixtures__/legacy-plan.json`,分钟制)不报错且渲染条目。
- [ ] Test: day-timeline 相邻同 clusterKey 两成员渲染为一个组合节点。
- [ ] Test: day-map overlays —— 带 polyline 的段生成折线点数 = polyline 点数;同 cluster 两 POI 只产生 1 个 marker(renderDayMapOverlays 纯函数可测,components.test.tsx 现模式)。
- [ ] Manual check: `npm run dev` 手动过一遍 表单→选点→行程 主链路(记录在 PR/commit body,不阻塞自动验收)。

**TDD Sequence:**
- [ ] Step 1-2: 组件级失败测试 + 确认(现 components.test.tsx 的 testing-library 模式)
- [ ] Step 3: 实现
- [ ] Step 4: 全量 `npm test && npm run build` 通过
- [ ] Step 5: Commit 建议:`feat(ui): 搜索式表单 + 选点确认页 + 时段时间轴 + 真实路线图`

**Cross-Task Dependencies:** Depends on Task 1(slot/clusterKey/polyline 类型)、Task 8(三个新 API)。

---

## 收尾注记

- 四件套同步(package.json version 0.3.0、CHANGELOG [Unreleased]、ROADMAP 主线)由 doc-finish 收口,不设 Task。
- 旧数据兼容 fixture:Task 9 引用的 `lib/pipeline/__fixtures__/legacy-plan.json` 若在 Task 1 测试中先需要,由先到者创建(内容:0.2.0 形状的最小 TripPlan,含 startTime 分钟制 items)。
- 执行顺序即 Task 编号;Task 2/3/4 相互独立可乱序,但都在 Task 5 之前。
