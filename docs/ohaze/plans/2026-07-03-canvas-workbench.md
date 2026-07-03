# 画布工作台 (canvas-workbench) — Guidance Plan

> **For Codex (the executor):** Each Task below specifies WHAT must be true at completion, not HOW to write it line by line. You have autonomy over internal naming, control flow, helper extraction, and algorithm choice. You do NOT have autonomy over public interfaces, file paths in Files lists, acceptance criteria, or cross-Task invariants. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把行程页从只读展示升级为三栏编辑工作台(左待计划池 / 中按天横向泳道 / 右地图),全部编辑动词走既有 PATCH 端点扩 op,单机闭环。

**Architecture:** 数据真相源保持单文件 40-plan.json(pool 与 days 同居其中,复用既有乐观并发 409 防线与 clusterKey 组原子性);编辑期交通重算只算受影响相邻段;前端以纯函数 reducer 把拖拽意图映射为 PATCH op,乐观更新 + 失败回滚。设计依据见 `docs/ohaze/specs/2026-07-03-canvas-workbench-design.md`(含 file:line 锚点),产品验收见 `docs/ohaze/briefs/2026-07-03-canvas-workbench-brief.md` 四场景。

**Tech Stack:** Next.js App Router + zod(契约在 `lib/pipeline/types.ts`)+ vitest(全 mock 外部调用)+ 高德 REST(`lib/map/amap-rest.ts`,QPS 2 并发)+ 高德 JS SDK(`components/day-map.tsx` 加载器可复用)。新依赖仅 `@dnd-kit/core` + `@dnd-kit/sortable`。

**硬约束(全 Task 生效):**
- 测试一律 mock 外部调用(claude / 高德),沿用 globalThis override 注入模式(见 `app/api/trips/[id]/plan/route.ts:113-115`)
- 守恒不变量:除「搜索新增」外,任何 op 不得使卡片消失或重复(days+pool 的 itemId 多重集只增不减);**本版无任何永久删除 op**
- 不动 fetch/extract/ground 三段与 SSE 协议;不做协作/undo/虚拟滚动/移动端手势
- 历史 40-plan.json(无 pool/transportPrefs 字段)必须能被新 schema 解析

---

### Task 1: 数据模型扩展(types.ts)

**Files:**
- Modify: `lib/pipeline/types.ts`
- Test: `lib/pipeline/types.test.ts`

**Behavior Contract:**
- `TransportModeSchema` 扩为 `["public","drive","walk","bike"]`(现 types.ts:3)
- 新增导出 `TransportPrefsSchema`:`{ shortKm: number>0 默认 1, shortMode: TransportMode 默认 "walk", longMode: TransportMode 默认 "public" }`,及类型 `TransportPrefs`
- `TripPlanSchema` 追加:`pool: PlanItem[] 默认 []`、`transportPrefs?: TransportPrefs`
- `CandidatePoiSchema.sourceType` 枚举扩含 `"manual"`
- `TripInputSchema.links` 由 `.min(1)` 放宽为 `.min(0).default([])`
- 不变量:不含新字段的历史 plan JSON 与历史 input JSON 均解析成功且行为不变

**Acceptance Criteria:**
- [ ] Test: 旧格式 plan JSON(无 pool/transportPrefs)parse 成功,pool 得到 `[]`
- [ ] Test: bike 作为 TransportMode 与 PlanItem.transportToNext.mode 均合法
- [ ] Test: TransportPrefs 默认值(1/walk/public)与非法值(shortKm≤0)拒绝
- [ ] Test: links 空数组的 TripInput parse 成功;sourceType "manual" 合法
- [ ] Interface conformance: 上述导出名与形状与本契约一致

**TDD Sequence:**
- [ ] Step 1: 写失败测试(上述断言)
- [ ] Step 2: 确认按预期原因失败
- [ ] Step 3: 实现 schema 变更
- [ ] Step 4: 全量测试通过(含既有 119 条)
- [ ] Step 5: Commit,建议 `feat(types): bike/pool/transportPrefs 模型扩展`

**Cross-Task Dependencies:** Provides 全部新类型 for Task 2-13。

---

### Task 2: 地图层——骑行路由 + 多结果搜索(amap-rest)

**Files:**
- Modify: `lib/map/types.ts`(MapProvider 接口 + AmapPoi 不动)
- Modify: `lib/map/amap-rest.ts`
- Test: `lib/map/amap-rest.test.ts`

**Behavior Contract:**
- `route(from, to, "bike")` 走高德 `/v4/direction/bicycling`;**v4 响应结构与 v3 不同**:`{errcode:0, data:{paths:[{distance(米), duration(秒), steps:[{polyline}]}]}}`,成功判定是 `errcode===0` 而非 v3 的 `status==="1"`
- bike 失败降级:errcode≠0、空 paths、或距离时长同时为 0 → 返回骑行估算(直线距离 ×1.3 折算、12km/h、durationMin 下限 3);polyline 由 steps 拼接,复用既有去重/抽稀行为(≤500 点)
- MapProvider 新增方法 `searchPois(keyword: string, city: string, limit?: number): Promise<AmapPoi[]>`(limit 默认 8、上限 10):place/text 单次请求 offset=limit,**不做 detail 二跳**;openHours/rating 允许 undefined;无结果返回 `[]`
- 既有 `searchPoi`(ground 用)行为不变;QPS 限流与退避对新调用同样生效

**Acceptance Criteria:**
- [ ] Test: bike 路由用 mock fetchJson 断言请求 URL 含 v4 端点,且正确解析 distance/duration/polyline
- [ ] Test: bike errcode≠0 与空 paths 各自降级为估算(时长下限 3 分钟)
- [ ] Test: searchPois 返回多条、limit 传递到 offset、不发 detail 请求(mock 断言调用次数=1)
- [ ] Test: searchPois 无结果返回空数组不抛错
- [ ] Interface conformance: MapProvider 含 searchPois 签名,walk/drive/public 路由行为回归不变

**TDD Sequence:**
- [ ] Step 1-2: 失败测试 + 确认失败原因
- [ ] Step 3: 实现 v4 分支与 searchPois
- [ ] Step 4: 全量测试通过
- [ ] Step 5: Commit,建议 `feat(map): 骑行 v4 路由 + POI 多结果搜索`

**Cross-Task Dependencies:** Depends on Task 1(bike enum)。Provides `searchPois` for Task 8;Provides bike 路由 for Task 5/6。

---

### Task 3: 排程函数改造——prefs 档位推荐 + 复用导出(plan.ts)

**Files:**
- Modify: `lib/pipeline/plan.ts`
- Test: `lib/pipeline/plan.test.ts`

**Behavior Contract:**
- `recommendLegTransport`(现 plan.ts:241)追加可选参数 `prefs?: TransportPrefs`:
  - 有 prefs:`directKm < prefs.shortKm` → 首选 `prefs.shortMode`;否则首选 `prefs.longMode`
  - 无 prefs:行为与现状完全一致(0.8km/walk、`input.transport` 回退)
  - 保留:同 clusterKey 短路直接 walk 估算;public 且 >90min 时与 drive 比价取快者
- `planItemFromPoi`(现 :194)与 `nearestClusterOrder`(现 :347)改为导出(签名不变),供 run.ts 与 PATCH route 复用
- 不变量:runPlan 主流程(不传 prefs)所有既有测试不变绿

**Acceptance Criteria:**
- [ ] Test: prefs {shortKm:2, shortMode:"bike", longMode:"drive"} 下,1.5km 段推荐 bike、3km 段推荐 drive
- [ ] Test: 不传 prefs 时 0.5km 段仍推荐 walk(现状回归)
- [ ] Test: 同 cluster 两点仍走 walk 短路(带 prefs 也不覆盖)
- [ ] Interface conformance: planItemFromPoi / nearestClusterOrder 可被外部 import 且签名同现内部版

**TDD Sequence:**
- [ ] Step 1-2: 失败测试 + 确认
- [ ] Step 3: 实现参数扩展与导出
- [ ] Step 4: 全量通过
- [ ] Step 5: Commit,建议 `feat(plan): 段交通推荐接全局距离档偏好`

**Cross-Task Dependencies:** Depends on Task 1(TransportPrefs)。Provides prefs 推荐 + 两个导出 for Task 4/5/6。

---

### Task 4: 未选候选入池(run.ts)

**Files:**
- Modify: `lib/pipeline/run.ts`(runPlanStage,现 :135-161)
- Test: `lib/pipeline/run.test.ts`

**Behavior Contract:**
- selection 存在时,未选候选拆两路:`verified===true` 且有 `location` → 经 planItemFromPoi 转 PlanItem(清 slot 与 transportToNext)追加进 `plan.pool`;其余仍进 filtered(reason「用户未选入排程」不变)
- selection 不存在(全量排程)时 pool 为空数组,行为与现状一致
- 写盘的 40-plan.json 经 TripPlanSchema 校验含 pool 字段

**Acceptance Criteria:**
- [ ] Test: 5 个 grounded 选 3,未选 2 个中 verified 的进 pool、未验证的进 filtered
- [ ] Test: pool 内 item 无 slot、无 transportToNext
- [ ] Test: 无 selection 文件时 pool===[]、既有行为回归
- [ ] Interface conformance: 40-plan.json 落盘结构过 TripPlanSchema.parse

**TDD Sequence:**
- [ ] Step 1-2: 失败测试 + 确认
- [ ] Step 3: 实现拆流
- [ ] Step 4: 全量通过
- [ ] Step 5: Commit,建议 `feat(pipeline): 落选候选入待计划池`

**Cross-Task Dependencies:** Depends on Task 1(pool 字段)、Task 3(planItemFromPoi 导出)。

---

### Task 5: PATCH 结构编辑 op(plan/route.ts 之一)

**Files:**
- Modify: `app/api/trips/[id]/plan/route.ts`
- Test: `app/api/api.test.ts`(或新建 `app/api/plan-patch.test.ts`,二选一,若现文件超 ~400 行则拆新)

**Behavior Contract:**
新增 op(PatchSchema discriminatedUnion 追加;全部沿用:读前快照/写前比对 409、TripPlanSchema.parse 后写盘、返回全量 plan JSON、itemId 匹配含 clusterKey 组语义、cluster 组为最小移动单位):
- `add-item {day, index?, poolItemId}`:池内组移入 `days[day-1].items` 的 index(缺省末尾),池中移除该组
- `add-item {day, index?, poi: GroundedPoi}`:新 poi 经 planItemFromPoi 入位(搜索新增路径,是唯一合法「增量」来源)
- `remove-item {day, itemId}`:组整体移出该天,清 slot/transportToNext 后追加池尾(**一律回池,无删除变体**)
- `move-item {fromDay, toDay, itemId, toIndex?}`:组整体跨天移动
- `update-item {day, itemId, set:{note?, startTime?, durationMin?}}`:浅合并;startTime 必须匹配 `HH:MM`;durationMin 正整数;三字段全缺 → 400
- `add-day {theme?}`:days 追加空天,index=N+1
- `remove-day {day}`:该天所有组回池,该天删除,剩余天 index 重排为数组位+1;删除后 days 为空 → 400「至少保留一天」
- `set-day-theme {day, theme}`:设置;空字符串视为清空(undefined)
- 交通重算规则(用 plan.transportPrefs 经 Task 3 推荐函数):入位 i → 重算 (i-1,i) 与 (i,i+1) 存在的段;移出位 i → 重算拼接段 (i-1,i);跨天 = 源天移出规则 + 目标天入位规则;不受影响段的 transportToNext 保持原值
- 段路由失败(map.route 抛错):该段 transportToNext=undefined,op 整体仍 200(部分成功)
- 边界:day 越界 / poolItemId 不存在 / itemId 不存在 → 400 且不写盘

**Acceptance Criteria:**
- [ ] Test: 每个 op 的 happy path(断言返回 plan 与落盘一致)
- [ ] Test: 交通重算调用次数(mock map.route 计数):add 中位=2、add 尾位=1、remove 中位=1、move 跨天=3、未受影响段引用不变
- [ ] Test: 守恒——混合 op 序列(add-item{poolItemId}/remove-item/move-item/remove-day)后 days+pool 的 itemId 多重集与初始一致
- [ ] Test: 409 并发(复用现有 __packupPatchAfterReadForTest 钩子模式)对新 op 生效
- [ ] Test: 全部 400 边界(越界/不存在/update 三缺/删空天)
- [ ] Test: 段失败(mock route 抛错)→ 200 且该段 undefined
- [ ] Interface conformance: 既有 reorder/set-transport 回归不变

**TDD Sequence:**
- [ ] Step 1-2: 失败测试 + 确认
- [ ] Step 3: 实现 op 集(内部结构自决,建议按 op 拆 handler 但不强制)
- [ ] Step 4: 全量通过
- [ ] Step 5: Commit,建议 `feat(api): 画布结构编辑 op 集(池/天/卡片)`

**Cross-Task Dependencies:** Depends on Task 1/3。Provides 编辑 op for Task 9/10。

---

### Task 6: PATCH 交通类 op(plan/route.ts 之二)

**Files:**
- Modify: `app/api/trips/[id]/plan/route.ts`
- Test: 同 Task 5 的测试文件

**Behavior Contract:**
- `optimize-day {day}`:该天 items 重排为 nearestClusterOrder(Task 3 导出)结果展开;重排后该天段交通重算,**已存在的相邻对复用原 transportToNext**(oldPair 语义,同现有 reorder :59-69),新相邻对才调路由;幂等——连续两次结果一致且第二次零路由调用
- `set-transport-prefs {shortKm, shortMode, longMode}`:写 plan.transportPrefs,不触发任何重算
- `recalc-transport {day?}`:day 给定 → 该天全段重算;缺省 → 所有天全段重算;按当前 transportPrefs 推荐;整体 deadline 为 BUDGETS.planRoutesMs(超时后剩余段保留原值,响应含 warning)
- bike 作为 set-transport 的 mode 合法(Task 1 enum 放宽自动生效,需测试覆盖)

**Acceptance Criteria:**
- [ ] Test: optimize-day 对乱序天(mock 坐标构造明确最近邻序)产出确定顺序;二次调用零 route 调用(mock 计数)
- [ ] Test: set-transport-prefs 后 GET plan 含 prefs 且无 route 调用;recalc-transport{day} 路由调用=该天段数,推荐 mode 符合档位
- [ ] Test: recalc 全量作用于所有天;set-transport mode=bike 生效
- [ ] Test: 409 与越界 400 对三个 op 生效
- [ ] Interface conformance: 返回全量 plan 形状与 Task 5 一致

**TDD Sequence:**
- [ ] Step 1-2: 失败测试 + 确认
- [ ] Step 3: 实现
- [ ] Step 4: 全量通过
- [ ] Step 5: Commit,建议 `feat(api): 智能排程/全局交通偏好/重算 op`

**Cross-Task Dependencies:** Depends on Task 1/2/3/5(同文件,置后避免冲突)。

---

### Task 7: 手动从零建行程 + generate 守卫

**Files:**
- Create: `app/api/trips/route.ts`
- Modify: `app/api/generate/route.ts`
- Test: `app/api/api.test.ts`

**Behavior Contract:**
- `POST /api/trips` body `{destination: string 非空, days: {base: 1..15}, startDate?: YYYY-MM-DD}`:
  - 建 trip 目录(id 生成沿用 nanoid(10) 惯例),写 00-input.json(links:[]、transport "public"、pace "moderate")与 40-plan.json(N 个空天 index 1..N、pool:[]、filtered:[]、warnings:[]、transportPrefs 默认值)
  - 返回 201 `{tripId}`;body 非法 → 400(zod issues);不跑管线、不写 10/20/30 文件
- `POST /api/generate`:body links 缺失或空数组 → 400「至少提供一条链接」(在 TripInputSchema.safeParse 之前拦截,防 Task 1 放宽泄漏到导入路径);既有合法路径行为不变

**Acceptance Criteria:**
- [ ] Test: POST /api/trips 后 GET /api/trips/[id] 返回可解析 plan(N 空天+空池)
- [ ] Test: days.base 0 或 16 → 400;destination 空 → 400
- [ ] Test: generate 空 links → 400,含 1 条链接的既有用例回归
- [ ] Interface conformance: 201 响应仅 `{tripId}`

**TDD Sequence:**
- [ ] Step 1-2: 失败测试 + 确认
- [ ] Step 3: 实现
- [ ] Step 4: 全量通过
- [ ] Step 5: Commit,建议 `feat(api): 手动从零建空行程`

**Cross-Task Dependencies:** Depends on Task 1(links 放宽、pool/prefs 字段)。Provides 空行程入口 for Task 12。

---

### Task 8: POI 搜索端点 + 行程响应带 notes

**Files:**
- Create: `app/api/pois/search/route.ts`
- Modify: `app/api/trips/[id]/route.ts`
- Test: `app/api/api.test.ts`

**Behavior Contract:**
- `GET /api/pois/search?tripId=<id>&q=<关键词>`:city 取该 trip 00-input.json 的 destination;经 MapProvider.searchPois 返回 ≤8 条 AmapPoi JSON 数组;缺 tripId 或 q → 400;trip 不存在 → 404;map 层可用 globalThis override 注入 mock(沿用现有测试注入惯例)
- `GET /api/trips/[id]` 响应追加 `notes: {id, title, author?, url, body}[]`(来自 10-notes.json,已在 route.ts:20 读入;文件缺失时为 `[]`)
- 不变量:既有响应字段 {plan, failedLinks, input} 不变

**Acceptance Criteria:**
- [ ] Test: search 正常返回 mock 的多条结果;400/404 边界
- [ ] Test: trips/[id] 响应 notes 含 body;无 notes 文件时 notes===[]
- [ ] Interface conformance: notes 元素形状如上(body 必含)

**TDD Sequence:**
- [ ] Step 1-2: 失败测试 + 确认
- [ ] Step 3: 实现
- [ ] Step 4: 全量通过
- [ ] Step 5: Commit,建议 `feat(api): POI 搜索端点 + 行程响应带笔记`

**Cross-Task Dependencies:** Depends on Task 2(searchPois)。Provides 搜索数据 for Task 10;Provides notes for Task 11。

---

### Task 9: 工作台意图 reducer(纯函数层)

**Files:**
- Create: `components/workbench/workbench-reducer.ts`
- Test: `components/workbench/workbench-reducer.test.ts`

**Behavior Contract:**
- 导出纯函数 `applyIntent(plan: TripPlan, intent: WorkbenchIntent): { optimisticPlan: TripPlan, patchBody: object } | { error: string }`,以及 `WorkbenchIntent` 可辨识联合类型,至少覆盖:`pool→day 放置(含目标序)`、`day 内重排`、`day→day 跨天`、`day→pool 移回`、`编辑卡片字段`、`增天`、`删天`、`改天主题`、`改段交通`、`改全局偏好`、`天内智能排程`
- patchBody 与 Task 5/6 的 op 形状一一对应;optimisticPlan 是不可变新对象(不 mutate 入参),其结构性变化(卡片归属/顺序)与后端 op 执行结果一致,交通段允许暂缺(undefined,等 PATCH 返回覆盖)
- cluster 组语义:intent 目标是组 id,optimistic 变化整组移动(分组逻辑与 `components/day-timeline.tsx:27-35` groupAdjacent 一致)
- 非法意图(越界天、不存在的组)返回 `{error}` 不产 patchBody

**Acceptance Criteria:**
- [ ] Test: 每类 intent 的 optimisticPlan 结构断言 + patchBody 与 op schema 匹配
- [ ] Test: 守恒——任意合法 intent 序列后 optimisticPlan 的 itemId 多重集不减
- [ ] Test: 入参 plan 未被 mutate(深比较引用前后)
- [ ] Test: 非法意图返回 error
- [ ] Interface conformance: 导出名与签名如上

**TDD Sequence:**
- [ ] Step 1-2: 失败测试 + 确认
- [ ] Step 3: 实现
- [ ] Step 4: 全量通过
- [ ] Step 5: Commit,建议 `feat(workbench): 拖拽意图→op 纯函数映射层`

**Cross-Task Dependencies:** Depends on Task 1(类型)、Task 5/6(op 形状契约)。Provides reducer for Task 10。

---

### Task 10: 工作台组件树 + 拖拽接线

**Files:**
- Create: `components/workbench/trip-workbench.tsx`
- Create: `components/workbench/pool-panel.tsx`
- Create: `components/workbench/day-lane.tsx`
- Create: `components/workbench/poi-card.tsx`
- Modify: `package.json`(新依赖 @dnd-kit/core、@dnd-kit/sortable)
- Test: `components/components.test.tsx`(扩展)

**Behavior Contract:**
- `<TripWorkbench initialPlan initialNotes tripId>`(client):三栏布局(左池/中横向多列天泳道/右地图占位插槽),持有 plan state;拖拽经 dnd-kit → intent → Task 9 reducer → 乐观 setState + `fetch PATCH`;PATCH 200 → 用返回全量 plan 覆盖 state;失败/409 → 回滚快照 + 顶部提示条(409 文案含「行程已更新」并自动 GET 刷新)
- `<PoolPanel>`:分类 chips(PoiType 计数)过滤 + 卡片列表(可拖出/接收)+ 搜索框(调 `/api/pois/search`,每个结果提供「入池」与「加入 Day N」动作,走 add-item{poi} / pool 追加)
- `<DayLane>`:天头(Day N + date + theme 行内编辑 → set-day-theme;「智能排程」按钮 → optimize-day;「删除天」→ remove-day 带确认)+ 卡片流(SortableContext)+ 卡片间交通条(方式图标+距离+耗时;点击弹出四方式选择 → set-transport;transportToNext 为 undefined 时显示「交通待计算 · 点击重试」→ 单段 set-transport 或该天 recalc-transport,实现取其一并保持一致)+ 列尾「+添加」(聚焦池搜索);泳道容器尾「+新增 Day」→ add-day;工具栏「交通偏好」入口(shortKm/shortMode/longMode 表单 → set-transport-prefs;保存后询问是否立即全程重算 → recalc-transport)
- `<PoiCard>`:名称/类型徽章/时长/备注截断/未验证标记;点击触发详情回调(Task 11 接);编辑弹层(note/startTime/durationMin → update-item)
- 可拖单位 = cluster 组(与 reducer 一致)
- 组件测试范围:渲染冒烟(三栏出现、卡片计数正确、409 提示条出现)——拖拽物理事件不测,intent 映射已由 Task 9 覆盖

**Acceptance Criteria:**
- [ ] Test: 给定含 2 天 + 池 3 卡的 plan,渲染出 2 泳道 + 池 3 卡 + 分类计数
- [ ] Test: mock fetch 409 后出现「行程已更新」提示且触发一次 GET
- [ ] Test: mock fetch 500 后 state 回滚为拖拽前(卡片归属还原)
- [ ] Manual check: `npm run dev` 下池↔天/天内/跨天拖拽落位且刷新保留;交通条切换方式生效
- [ ] Interface conformance: 组件 props 签名如上;PATCH body 均由 reducer 产出(组件内不手拼 op)

**TDD Sequence:**
- [ ] Step 1-2: 冒烟失败测试 + 确认
- [ ] Step 3: 实现组件树与接线(dnd-kit 配置自决)
- [ ] Step 4: 全量通过
- [ ] Step 5: Commit,建议 `feat(ui): 三栏工作台组件树 + 拖拽编辑闭环`

**Cross-Task Dependencies:** Depends on Task 5/6/7/8/9。Provides 工作台壳 for Task 11/12。

---

### Task 11: 地图联动 + 溯源详情

**Files:**
- Create: `components/workbench/workbench-map.tsx`
- Create: `components/workbench/detail-drawer.tsx`
- Modify: `components/workbench/trip-workbench.tsx`(插入两组件与选中态)
- Modify: `components/day-timeline.tsx`(仅 MODE_LABEL 补 bike:"骑行")
- Test: `components/components.test.tsx`

**Behavior Contract:**
- `<WorkbenchMap days pool focus selectedItemId showPool onMarkerClick>`:SDK 加载与 overlay 渲染复用 `components/day-map.tsx` 的 loadAmapSdk(:125)与渲染思路(:65-108),泛化为多天:`focus="all"` 渲染所有天(每天固定色板循环着色 polyline+marker),`focus=<dayIndex>` 只渲染该天;showPool 开启时池点位以灰 marker 呈现;selectedItemId 对应 marker 高亮(放大或换色自决);点击 marker 回调 (itemId, dayIndex|null)
- 地图 key 缺失/加载失败呈现占位文案(现状行为保留)
- `<DetailDrawer item note onClose>`:展示 address/openHours/rating/reason + **来源笔记引用区**:①推荐理由(item.reason);②笔记原文摘录——按地点名在 note.body 内首次匹配位置截取前后各约 80 字(纯字符串,无 LLM),未命中则提供 body 折叠全文;③笔记标题/作者/「查看原笔记」外链(note.url);sourceNoteId==="manual" → 显示「手动添加」且无引用区
- 联动:点卡片 → 地图高亮该 marker + 打开 drawer;点 marker → 对应泳道卡片滚动进入视野 + 打开 drawer
- 不变量:day-timeline.tsx 除 MODE_LABEL 外零改动

**Acceptance Criteria:**
- [ ] Test: DetailDrawer 对含地点名的 body 渲染出摘录片段;不含时渲染折叠全文;manual 来源显示「手动添加」
- [ ] Test: WorkbenchMap 在无 key 环境渲染占位(现有模式)
- [ ] Manual check: 总览/单天切换着色正确;卡片↔marker 双向联动;详情引用可跳原笔记
- [ ] Interface conformance: 两组件 props 如上

**TDD Sequence:**
- [ ] Step 1-2: 失败测试 + 确认
- [ ] Step 3: 实现
- [ ] Step 4: 全量通过
- [ ] Step 5: Commit,建议 `feat(ui): 多天地图联动 + 笔记溯源详情`

**Cross-Task Dependencies:** Depends on Task 8(notes 数据)、Task 10(工作台壳)。

---

### Task 12: 页面接线——工作台页 + 首页入口 + 选点页文案

**Files:**
- Modify: `app/trip/[id]/page.tsx`
- Modify: `components/trip-form.tsx`
- Modify: `components/candidate-list.tsx`
- Test: `components/components.test.tsx`

**Behavior Contract:**
- `app/trip/[id]/page.tsx`:server 端 readTripPayload(:49)扩展返回 notes(含 body,缺文件时 []),整页渲染 `<TripWorkbench initialPlan initialNotes tripId>`;不再渲染 DayTimeline/DayMap 旧组合;warnings/daysDecision/failedLinks 提示区保留(位置自决)
- `components/trip-form.tsx`:新增「手动从零」入口(目的地+天数最小表单)→ POST /api/trips → 成功跳 `/trip/<tripId>`;既有链接导入表单不变
- `components/candidate-list.tsx`:提交按钮旁新增一行提示文案,语义含两点——「未选中的地点会进入工作台待计划池」「重新排程将覆盖工作台里的已有编辑」;行为零改动
- 不变量:导入全流程(表单→SSE→选点→工作台)可走通

**Acceptance Criteria:**
- [ ] Test: trip 页对含 pool 的 payload 渲染工作台(冒烟)
- [ ] Test: trip-form 含手动入口且提交产生 POST /api/trips(mock fetch 断言)
- [ ] Test: candidate-list 渲染包含两点语义的提示文案
- [ ] Manual check: 手动从零 → 空工作台 → 搜索加点 → 排程,全程无笔记依赖(brief Scenario 2)
- [ ] Interface conformance: page 为 server component、TripWorkbench 为 client 的分界保持

**TDD Sequence:**
- [ ] Step 1-2: 失败测试 + 确认
- [ ] Step 3: 实现
- [ ] Step 4: 全量通过
- [ ] Step 5: Commit,建议 `feat(ui): 工作台页面接线 + 手动从零入口`

**Cross-Task Dependencies:** Depends on Task 7(POST /api/trips)、Task 10/11(工作台组件)。

---

### Task 13: 端到端验证收口

**Files:**
- Test: 全量既有 + 新增测试
- Modify: 仅允许修复本 plan 范围内代码的缺陷(发现范围外 bug 记录不修)

**Behavior Contract:**
- `npm test` 全绿;`npm run build` 通过(类型与 Next 构建)
- 用临时 PACKUP_DATA_DIR(mktemp 目录,**不写仓库路径**)构造 fixture 走一遍 API 级链路:POST /api/trips → PATCH add-item{poi} ×3 → optimize-day → move-item → GET 校验守恒与段交通存在性(mock map)
- brief 四场景的 Manual check 清单落在 PR 描述/commit body(供 haze 测试时逐条勾)

**Acceptance Criteria:**
- [ ] `npm test` 0 fail;`npm run build` 0 error
- [ ] API 级链路测试通过且守恒断言成立
- [ ] 全部 Task 的 commit 均已落在 feat/canvas-workbench 分支

**TDD Sequence:**
- [ ] Step 1: 跑全量测试与 build,记录任何红灯
- [ ] Step 2: 修复本范围缺陷至全绿
- [ ] Step 3: Commit(如有修复),建议 `test(workbench): 端到端链路验证`

**Cross-Task Dependencies:** Depends on Task 1-12 全部。

---

**尾注:** 四件套同步由 doc-finish 收口(CHANGELOG [Unreleased] / ROADMAP 主线与 Backlog 变更均不在本 plan 任何 Task 内)。
