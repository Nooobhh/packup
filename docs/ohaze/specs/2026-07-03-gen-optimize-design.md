# packup 0.3.0 生成优化 — Design Spec
> 读者:Codex(执行者)。产品语言与验收标准见同日 brief(`docs/ohaze/briefs/2026-07-03-gen-optimize-brief.md`)。
> 基线:0.2.0 已跑通 fetch→extract→ground→plan 全管线。本 spec 是对既有代码的改造,所有引用 file:line 以 `main` 分支为准。

## 0. 上下文与目标

0.2.0 是「一次性生成器」:7 字段表单一把梭,plan 段 LLM 三轮裁决 12-15 分钟,输出分钟级时刻表,地图画直线。0.3.0 改造为「生成 + 轻确认的规划工作台」:

1. **自然语言输入**:一句话 query(「香港3天2晚 city walk+美食」)解析出 destination/days/preferences,表单收敛为搜索框 + 链接粘贴区。
2. **两段式管线**:ground 后停下出「选点确认页」,haze 勾选 POI 后才跑 plan,plan 只消化选中子集。
3. **plan 段提速**:一次 LLM 分天(按 id 引用)+ 算法排序 + 确定性兜底,去掉 LLM 修复循环;时刻粒度降为 morning/afternoon/evening 时段。机器耗时合计目标 3 分钟、上限 5 分钟。
4. **per-leg 交通推荐 + 真实 polyline**:每段按距离推荐 mode;route() 解析高德 direction 响应的 polyline 存进产物,前端画真实折线。
5. **数据层邻近聚合**:≤250m 的 POI 聚成 cluster,时间轴组合节点 + 地图单 marker。
6. **重排/改交通 API**:只重算受影响相邻段,不重跑 LLM。UI 壳(拖拽)不做,checkbox 选点页要做。
7. **两个 bug**:空行程(rehydration 名字匹配脆性)、failReason 泄漏 prompt 原文。

**已拍板**:无链接模式延后不做(links 仍必填);重排后不跑 LLM 校对;时段粒度 morning/afternoon/evening。

**硬约束**:旧 trip 落盘数据(分钟制 40-plan.json)必须仍可 parse 与渲染;测试一律 mock 外部调用(项目 CLAUDE.md 约定)。

## 0.5 时间预算(机器耗时 ≤5min 的落实)

新建 `lib/pipeline/budgets.ts` 集中所有超时/预算常量(替换散落的 magic number):

```ts
export const BUDGETS = {
  fetchTotalMs: 25_000,        // 第一段:HTTP 抓取全部链接
  extractStageMs: 120_000,     // 第一段:extract 段级 deadline(并发 3)
  extractPerNoteMs: 120_000,   // 单笔记 LLM 超时(现 300_000,extract.ts:39)
  groundStageMs: 40_000,       // 第一段:ground 段级 deadline
  planLlmMs: 90_000,           // 第二段:分天 LLM 单次超时(现 900_000,plan.ts:115)
  planRoutesMs: 25_000,        // 第二段:相邻段 route 填充总预算
  parseQueryMs: 20_000,        // query 解析 LLM 兜底(与 fetch 并行,不计入总和)
  routeCallMs: 5_000           // 单次高德 route(现无显式超时,fetch 默认)
} as const;
```

**段级 deadline 语义(部分成功,不炸管线)**:
- extract:段开始计时,到 `extractStageMs` 时未完成的笔记记 `failedNotes(reason:"提取超时")`,已完成的照常输出。
- ground:到 `groundStageMs` 时未查证的 POI 标 `verified:false` 直接过,不再调高德。
- plan LLM:`planLlmMs` 超时;**无重试**——超时或校验失败直接走确定性兜底(§9a 地理均分),warning 记「LLM 分天失败,已按地理就近自动分配」。plan 段 LLM 调用恒为 1 次。
- plan routes:到 `planRoutesMs` 时未填的 transportToNext 用 estimateWalk 直线估算(amap-rest.ts:132-136 已有)。

**预算数学**(验收断言写进单测):
- 正常路径上界:fetch 25s + extract 120s + ground 40s(第一段 185s)+ plan LLM 90s + routes 25s(第二段 115s)= **300s 整**,兑现 brief 的 ≤5min;典型 3 链接场景(extract 1 批、POI≤15)实测预期 ≈ 2-3min。
- 结构性断言:`BUDGETS.fetchTotalMs + extractStageMs + groundStageMs + planLlmMs + planRoutesMs ≤ 300_000`,且 `planLlmMs ≤ 90_000`、`extractPerNoteMs ≤ extractStageMs`——防止未来把预算调大而不自知。

## 1. 契约变更(`lib/pipeline/types.ts`)

全部**向后兼容**:新字段 optional,旧字段不删只是不再由表单收集。

### 1a. TripInput(types.ts:15-54)

```ts
// 新增
query: z.string().optional(),          // 原始一句话输入,溯源用
preferences: z.array(z.string()).optional(),  // query 解析出的偏好词,进 plan prompt
// 不变但表单不再收集(schema 保留,兼容旧 00-input.json):
// startDate / dailyThemes / days.flex — 解析步不再产出 flex(days 只有 base)
// transport 保留 default("public") — 作为 route 调用的 fallback mode(§5)
// pace 保留 default("moderate") — budgetPois(plan.ts:47-63)仍消费
```

超严校验放松:types.ts:39-52 的 dailyThemes superRefine 保留不动(旧数据可能带)。

### 1b. 时段与 PlanItem(types.ts:130-146)

```ts
export const SlotSchema = z.enum(["morning", "afternoon", "evening"]);
// PlanItemSchema 变更:
startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),  // required→optional(旧数据兼容)
slot: SlotSchema.optional(),                                // 新:时段
clusterKey: z.string().optional(),                          // 新:邻近聚合组 key(§6)
```

新产物必须有 slot;startTime 仅旧数据存在。渲染层规则:有 slot 按时段分组,无 slot 回退按 startTime 排序展示(§8)。

### 1c. TransportToNext(types.ts:123-128)

```ts
mode: TransportModeSchema.or(z.string()),   // 不变;新产物写推荐出的实际 mode
durationMin / distanceKm 不变
polyline: z.array(LngLatSchema).optional(), // 新:真实路线坐标串
```

### 1d. GroundedPoi 稳定 id(types.ts:84-93)

`id` 保持 optional(旧数据兼容),但 **ground 段新代码必须填充**:`amapId` 存在用 `amapId`,否则 `unverified-<sourceNoteId>-<序号>`。这是选点页勾选与 plan 段 id 引用的基石。

### 1e. 选点产物(新)

```ts
export const SelectionSchema = z.object({
  selectedPoiIds: z.array(z.string()).min(1),
  selectedAt: z.string()
});
```

落盘 `data/trips/<id>/25-selection.json`。

### 1f. StageEvent(types.ts:190-199)

`StageNameSchema` 不变(仍 4 段)。StageEvent.status 枚举增加 `"await-selection"`:ground 完成后 generate API 发 `{stage:"ground", status:"await-selection", tripId}`(§7)。zod 枚举加值向后兼容。

## 2. query 解析(新 `lib/pipeline/parse-query.ts`)

```ts
export async function parseQuery(query: string, llm: LLMRunner): Promise<{ destination: string; days?: number; preferences: string[] }>
```

- **规则先行**(不花钱):
  - 天数:`/(\d{1,2})\s*天/` 取第一个匹配;`X天Y晚` 只取天。
  - 停用词剥离:`旅游|旅行|攻略|游玩|出行|自由行|之旅` 等词表。
  - destination:剥掉天数词与停用词后的**最前段连续非空白词**(如「香港」「吉隆坡」)。
  - preferences:剩余的非空 token(如「city walk」「美食」),`+`/`、`/空格分隔。
- **LLM 兜底**:规则解析出的 destination 为空或长度>10(疑似没切干净)时,调一次 `llm.run`,jsonSchema `{destination, days?, preferences[]}`,timeoutMs 60_000,prompt 一句话即可。兜底也失败 → 抛错,API 返回 400 提示「无法识别目的地,请在开头写明城市」。
- 单测:纯规则路径全 mock 场景表驱动(至少覆盖 brief 里 4 个例句 + 无天数 + 兜底触发)。

**接线**:`app/api/generate/route.ts:15` 在 `TripInputSchema.safeParse` 之前——body 若含 `query` 且无 `destination`,先 parseQuery 再合成 TripInput(`{query, links, destination, days: days?{base:days}:undefined, preferences, transport/pace 用默认}`)。

## 3. 两段式管线(`lib/pipeline/run.ts`)

### 3a. runPipeline 增加 toStage

run.ts:42 opts 增加 `toStage?: StageName`。run.ts:53 循环条件改为 `index <= stages.indexOf(opts.toStage ?? "plan")`。

### 3b. plan 段消费选点

`runPlanStage`(run.ts:132-136):读 `25-selection.json`(不存在 = 旧 trip/直跑,用全量 grounded——现行为不变);存在则 `grounded.filter(p => selection.selectedPoiIds.includes(p.id))`,filtered 追加未选中项 `{stage:"plan", reason:"用户未选入排程"}`。

### 3c. 断点续跑

`startStageIndex`(run.ts:92-100)不变——两段式天然复用:第一段跑完 ground 有 30-grounded.json,第二段 `fromStage:"plan"` 直接续。

## 4. plan 段重构(`lib/pipeline/plan.ts` 大改)

替换现 runPlan(plan.ts:8-43)的「LLM 全责 + 3 轮修复」为「LLM 一次分天 + 算法排序 + 确定性兜底」:

```
budgetPois(保留,plan.ts:47-63)
  → clusterPois(§6,cluster 视为单点)
  → LLM 一次调用:分天分时段(输出 poiId 引用)
  → 每天内算法排序(nearestItemOrder 扩展,cluster 整体移动)
  → per-leg mode 推荐 + fillAdjacentRoutes(带 polyline)
  → findViolations(plan.ts:175-215 保留)→ 仅确定性 fallback(不回 LLM)
  → 空行程保险(§9)
```

### 4a. LLM 分天调用

- prompt(`lib/prompts/plan.ts` 重写 buildPlanPrompt):输入 slimPois **带 id**(plan.ts:51-62 的 slimPois 加 `id` 字段)、destination、days(固定或缺省推荐)、preferences、distanceMatrix(近邻表保留,plan.ts:71-78)。**去掉** routeSamples 实测采样(buildContext 的 15 次 route 调用,plan.ts:80-87——纯耗时,分天不需要实测)。
- 输出 jsonSchema(planJsonSchema 重写,plan.ts:363-396):

```json
{ "days": [{ "theme": "...", "slots": { "morning": ["poiId"], "afternoon": ["poiId"], "evening": ["poiId"] } }],
  "daysDecision": "...(缺省天数时)" }
```

- **id 引用杜绝名字匹配**:rehydratePlanItems(plan.ts:127-160)重写为按 id 从 grounded Map 查找;查不到的 id 是幻觉,丢弃并 warning(空行程保险见 §9)。durationMin 由程序侧填:`suggestedDuration` 解析(小时/分钟正则)或按 type 默认(sight 90 / food 60 / shop 45 / stay 30 / experience 120 / other 60)。
- timeoutMs 从 900_000 降为 `BUDGETS.planLlmMs`(90_000,§0.5)。**删除校验失败重试**(callPlanner 的 attempt 循环,plan.ts:102-123):LLM 调用恒 1 次,超时/解析失败/校验失败一律直接走 §9a 确定性兜底——失败路径不再多等 90s。
- 每日窗口约束改为 prompt 提示「morning≤2 / afternoon≤3 / evening≤2 个节点(cluster 算 1 个)」,硬校验交给 findViolations。

### 4b. 算法排序

每天:morning→afternoon→evening slot 顺序固定;**天内整体**跑 nearestItemOrder(plan.ts:258-277 已有,提为 exported 并支持 cluster 成组),起点取 slot 序第一个;排序后重新按容量切回 slot(保持 LLM 的 slot 分配数量,只优化组内顺序——即排序在 slot 内进行,不跨 slot 挪动)。实现取简:**每个 slot 内独立 nearestItemOrder,slot 间衔接点为上一 slot 末尾**。

### 4c. findViolations / fallback

- findViolations 保留三指标(day-total-min 720 / segment-transport-min 90 / backtrack-ratio 1.5),plan.ts:175-215 不动。
- fallbackPlan(plan.ts:217-246)保留但改两点:①去掉「LLM 修复循环」入口(runPlan 不再回调 callPlanner);②`fillAdjacentRoutes` 在裁剪循环内只重算**被裁 POI 前后相邻段**,不再全量(plan.ts:241 现状全量——顺手落 ROADMAP P2)。

## 5. per-leg 交通推荐 + polyline

### 5a. mode 推荐规则(plan.ts fillAdjacentRoutes 重写,plan.ts:162-173)

```
distanceKm(haversine) < 0.8        → walk
其余                                → input.transport ?? "public"
route 返回 durationMin > 90 且 mode 为 public → 试 drive,取耗时短者
```

每段把最终 mode 写入 transportToNext.mode。route 调用带回 polyline(§5b)。

### 5b. amap-rest.ts route() 返 polyline(amap-rest.ts:68-88)

- 返回类型扩为 `{durationMin, distanceKm, polyline?: LngLat[]}`(MapProvider 接口 lib/map/types.ts:13-17 同步)。
- driving/walking:`route.paths[0].steps[].polyline`(格式 `"lng,lat;lng,lat;..."`)逐段 split 拼接。
- transit:`route.transits[0].segments[]` 内 walking.steps[].polyline 与 bus.buslines[0].polyline 顺序拼接;任一缺失跳过该子段。
- 拼接后去重相邻重复点;**解析失败或为空不抛错**,返回无 polyline(前端直线兜底)。estimateWalk 兜底路径(amap-rest.ts:83,86)天然无 polyline。
- 体积控制:>500 点时按步长抽稀到 ≤500 点。

## 6. 邻近聚合(`lib/pipeline/geo.ts` 新增)

```ts
export function clusterByDistance<T extends { id: string; location?: LngLat }>(pois: T[], thresholdKm = 0.25): Map<string, string>
// 返回 poiId → clusterKey;无 location 的 POI 各自成组(clusterKey = 自身 id)
```

贪心/并查集:两两 haversine ≤ threshold 连边,连通分量为 cluster,clusterKey 取组内第一个 poi.id。plan 段:LLM 分天前对 kept POI 聚类,**prompt 中 cluster 以「组合点」形式出现**(id 用 clusterKey,name 拼「A+B」),LLM 按组分配;排序与 route 计算时组内成员相邻、组间以组质心计;PlanItem 逐成员输出但同组共享 clusterKey,组内成员间 transportToNext 置 `{mode:"walk", durationMin:≤5, distanceKm:实测直线}` 不调 route(≤250m 无需 API)。

## 7. API 变更

### 7a. POST /api/generate(app/api/generate/route.ts)

- body 支持 `{query, links}`(§2 接线);仍兼容显式 destination(测试与 stage CLI 用)。
- 管线跑 `toStage:"ground"`;完成后 send `{stage:"ground", status:"await-selection", tripId}` 并关流。前端跳 `/trip/<id>/select`。

### 7b. GET /api/trips/[id]/candidates(新)

读 30-grounded.json + 20-pois.json filtered,返回 `{grounded, filtered}`。404/409 语义仿 app/api/trips/[id]/route.ts:8-17。

### 7c. POST /api/trips/[id]/selection(新)

body `{selectedPoiIds}` → SelectionSchema 校验 → 写 25-selection.json → `runPipeline(input, deps, {fromStage:"plan", onEvent})` SSE 推进度(复用 generate 的流封装,提取公共 helper),done 后前端跳 `/trip/<id>`。重复提交 = 覆盖 selection + force 重跑 plan(deleteDownstream 已支持,run.ts:102-107)。

### 7d. PATCH /api/trips/[id]/plan(新,重排/改交通)

```ts
// body 二选一
{ op: "reorder", day: number, orderedIds: string[] }   // 该天 items 新顺序(clusterKey 作为整体 id 引用)
{ op: "set-transport", day: number, segmentIndex: number, mode: TransportMode }
```

读 40-plan.json → 应用 → **pair-diff 只重算受影响段** → TripPlanSchema.parse → 写回 → 返回新 plan。**不调 LLM**。非法 id/越界返回 400。

pair-diff 规则(reorder):对新顺序的每个相邻有向对 `(a,b)`,若旧顺序中 a 的下一个就是 b 且 a.transportToNext 存在 → **复用**旧值;否则重算该段(route 调用)。route 调用次数 = 新序中不存在于旧序的相邻对数——相邻两节点互换为 3 段(物理下界:X→B/B→A/A→Y 三段的端点都变了),移动单节点到别处为 ≤3 段,顺序不变为 0 段。set-transport 恒为 1 次。单测用 mock route 计数断言:相邻互换 =3、不变 =0、set-transport=1。cluster 成员整体移动,组内段不重算(§6 规则不变)。

## 8. 前端(生成侧功能壳,不做美化)

- `components/trip-form.tsx` 重写:query 搜索框 + links textarea 两个输入;提交 `{query, links}`;SSE 处理 `await-selection` → `location.href = /trip/<id>/select`。
- `app/trip/[id]/select/page.tsx`(新):fetch candidates;checkbox 列表(verified 默认勾选,未验证默认不勾但可勾),显示 name/type/reason/未验证标;「排程」按钮 POST selection,SSE 进度复用 `components/progress-stream.tsx`,done 跳行程页。
- `components/day-timeline.tsx`:按 slot 分组渲染(morning/上午 afternoon/下午 evening/晚上小节);同 clusterKey 相邻成员合并为组合节点(标题「A + B」,成员逐行);无 slot 旧数据回退现渲染。startTime 显示逻辑删除(day-timeline.tsx:10)。
- `components/day-map.tsx` renderDayMapOverlays(day-map.tsx:65-89):transportToNext.polyline 存在画折线(逐段连接),否则保持现直线;同 clusterKey 只放一个 marker(取组内首个有 location 的成员,title 拼成员名)。
- `app/trip/[id]/page.tsx`:warnings 收进 `<details>` 折叠(page.tsx:16);failedLinks 渲染 reason 已是截断摘要(§9b 管线侧修)。

## 9. 两个 bug 修复

### 9a. 空行程保险(plan.ts)

id 引用(§4a)已根治名字改写剔除。再加终极保险:rehydrate 后若 `plan.days 全部 items 为空` 且选中 grounded 非空 → 确定性兜底:POI 按 clusterKey 分组 → 按天数均分(顺序:地理最近邻链)→ slot 依次填 morning/afternoon/evening → warning「LLM 分天失败,已按地理就近自动分配」。**不变式:选中 POI 非空 ⇒ 产出行程非空**,单测断言。

### 9b. failReason 摘要(lib/llm/claude-cli.ts + extract.ts)

- 根因:execFile 报错 message 为 `Command failed: claude -p <整个 prompt>`(claude-cli.ts:57-69 的 error 透传)。
- 修:claude-cli.ts run() catch(claude-cli.ts:33-42)构造干净错误:`claude CLI exit <code>: <stderr 或 stdout 提取,截 200 字符>`,**不含 args/prompt**。extractErrorFromStdout(claude-cli.ts:110-121)已有,复用。
- extract.ts:42/50 的 reason 再 `.slice(0, 200)` 双保险。
- 顺带:app/trip/[id]/page.tsx:57 failedLinks 渲染无需改(数据源干净了)。

## 10. 测试与验收

- 全 mock(fetcher/map/llm 均注入 fake,现有测试风格 run.test.ts / plan.test.ts 延续)。
- 必须覆盖:parse-query 场景表;两段式(toStage 停 + selection 续跑 + 旧 trip 无 selection 直跑);plan 重构(id 引用 rehydrate、slot 输出、幻觉 id 丢弃、空行程保险不变式);per-leg mode 规则表;polyline 解析(driving/transit/缺段);clusterByDistance(阈值内/外/无 location);PATCH pair-diff route 计数断言(相邻互换=3/顺序不变=0/set-transport=1,§7d);旧 40-plan.json fixture(分钟制)parse+渲染兼容。
- 时间预算(§0.5):①BUDGETS 常量结构性断言(五段总和 ≤300_000ms、planLlmMs ≤90_000、extractPerNoteMs ≤ extractStageMs);②extract/ground 段级 deadline 部分成功行为(mock 慢调用,断言超时笔记进 failedNotes、超时 POI 标 unverified 而管线继续);③plan 段 LLM 调用恒 =1(mock llm 计数)、buildContext 无 route 采样调用;④LLM 失败(超时/坏 JSON)直接产出兜底行程且非空。
- 验收命令:`npm test` && `npm run build`。

## 11. 不做(勿实现)

- 无链接生成、自动搜小红书、拖拽 UI、地图 marker 聚合动画、协作/分享、视觉美化、DB。
- 不改 fetch/extract 段逻辑(除 failReason 截断);不动 fetchers/ 三实现。

## 12. 版本与文档

- `package.json` version → 0.3.0;CHANGELOG [Unreleased] 填条目(发版块由 finishing 收口)。
- ROADMAP 当前主线更新为 0.3.0 主题行(finishing 收口)。
