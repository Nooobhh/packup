# 0.4.0 画布工作台 (canvas-workbench) — Design Spec

> Brief: docs/ohaze/briefs/2026-07-03-canvas-workbench-brief.md(产品语言,验收场景以它为准)
> 本 spec 给实现者。所有 file:line 基于 main@919c16f。

## 1. 目标一句话

行程页从只读展示升级为三栏编辑工作台(左待计划池 / 中按天横向泳道 / 右地图),编辑动词全部走既有 PATCH 扩 op,单机闭环,不动 fetch/extract/ground 三段。

## 2. 现状锚点(实现前必读)

- 契约:`lib/pipeline/types.ts` — PlanItem:136 已有 `note/startTime/durationMin`;PlanDay:156 已有 `theme`;TripPlan:175;TransportMode:3 仅 public/drive/walk;Selection:201;TripInput.links `.min(1)`:21
- PATCH:`app/api/trips/[id]/plan/route.ts` — PatchSchema:9(reorder/set-transport);乐观并发 47-49(读前快照写前比对→409);clusterKey 组原子性 85-99(groupItems,非相邻同组抛错);itemId 语义:105(`clusterKey ?? poiId ?? id ?? name`)
- 排程:`lib/pipeline/plan.ts` — recommendLegTransport:241(段交通推荐,0.8km 硬编码 + public>90min 换 drive 比价 259);nearestClusterOrder:347(最近邻组排序,兜底重排在用 297);fillAdjacentRoutes:230(全天段重算,带 deadline);planItemFromPoi:194(GroundedPoi→PlanItem)
- 地图 REST:`lib/map/amap-rest.ts` — searchPoi:33(单结果+detail 二跳);route:68-70(v3 三端点映射);QPS 2 并发+指数退避 99-114;estimateWalk 空路线降级 133
- 管线:`lib/pipeline/run.ts` — runPlanStage:135-161(selection 消费:未选→filtered「用户未选入排程」144-157)
- API:GET `app/api/trips/[id]/route.ts`:5-33(返回 {plan,failedLinks,input},notes 已在 :20 读入);selection POST `.../selection/route.ts`:8-50(写 25-selection → rm 40-plan → SSE fromStage=plan);generate POST `app/api/generate/route.ts`:35(TripInputSchema.safeParse)
- UI:`app/trip/[id]/page.tsx`:9-40(server 读文件渲染 DayTimeline+DayMap,readTripPayload:49);`components/day-map.tsx`(DayMap:20 单天;loadAmapSdk:125 script 单例;renderDayMapOverlays:65 clearMap+markers+polyline;clusteredMapPoints:110);`components/day-timeline.tsx`(MODE_LABEL:5 无 bike;groupAdjacent:27-35)
- 预算:`lib/pipeline/budgets.ts`(routeCallMs=5s:9,planRoutesMs=25s:6)

## 3. 数据模型变更(types.ts)

### 3.1 TransportMode 加 bike

`TransportModeSchema`(types.ts:3)→ `z.enum(["public","drive","walk","bike"])`。
影响面:amap-rest route 端点映射(§5.1)、recommendLegTransport(§6.1)、day-timeline MODE_LABEL、PATCH set-transport(自动兼容,enum 放宽)。

### 3.2 TripPlan 加 pool 与 transportPrefs

```ts
export const TransportPrefsSchema = z.object({
  shortKm: z.number().positive().default(1),
  shortMode: TransportModeSchema.default("walk"),
  longMode: TransportModeSchema.default("public")
});
// TripPlanSchema(types.ts:175)追加两字段:
pool: z.array(PlanItemSchema).default([]),
transportPrefs: TransportPrefsSchema.optional()
```

pool 内 item 约定:无 `slot`、无 `transportToNext`(入池前清空)。历史 40-plan.json 无这两字段,`default([])`/`optional()` 保证向后兼容解析。

### 3.3 手动来源哨兵与 links 放宽

- `CandidatePoiSchema.sourceType`(types.ts:85)加 `"manual"`;手动/搜索来源的 `sourceNoteId` 用哨兵字符串 `"manual"`。
- `TripInputSchema.links`(types.ts:21)`.min(1)` → `.min(0).default([])`;同时 `/api/generate` 在 safeParse 前显式校验 `links` 非空(400,「至少提供一条链接」),导入语义不变(generate/route.ts:35 前加)。

## 4. 管线与新建入口

### 4.1 未选候选入池(run.ts:144-157)

runPlanStage 中 selection 存在时,未选集合拆两路:

- `verified === true` 且有 `location` → 转 PlanItem 进 `plan.pool`(复用 planItemFromPoi,**需从 plan.ts:194 export**;slot 与 transportToNext 置空)
- 其余(未验证/无坐标)→ 仍进 filtered,reason 不变

pool 在 runPlanStage 拼装后随 plan 一起写盘,runPlan 签名不动。

### 4.2 手动从零:POST /api/trips(新文件 app/api/trips/route.ts)

body `{destination: string, days: {base: number}, startDate?: string}`:

1. 建 trip 目录,写 00-input.json(`{id, links: [], destination, days, startDate, transport: "public", pace: "moderate"}`)
2. 直接写 40-plan.json:`{days: N×{index, items: []}, pool: [], filtered: [], warnings: [], transportPrefs: 默认值}`
3. 返回 `{tripId}`;前端跳 `/trip/<id>`

不跑管线、不写 10/20/30 文件。GET trips/[id] 对缺失 10-notes/20-pois 已 catch 容错(route.ts:20-21),空数组路径可用。首页 `components/trip-form.tsx` 加「手动从零」入口(目的地+天数最小表单)。

## 5. 地图层(lib/map)

### 5.1 骑行(amap-rest.ts:68)

`mode === "bike"` → `GET /v4/direction/bicycling?origin&destination`。**v4 响应结构与 v3 不同**:`{errcode: 0, data: {paths: [{distance(米), duration(秒), steps: [{polyline}]}]}}`,不能走 assertAmapOk(v3 的 status==="1")。bike 分支单独解析:errcode≠0 或空 paths → 降级估算(新 estimateBike:直线×1.3、12km/h、min 3 分钟,参照 estimateWalk:133);polyline 拼接 steps(参照 pathPolyline:139)。

### 5.2 POI 搜索多结果

`MapProvider`(lib/map/types.ts)加 `searchPois(keyword: string, city: string, limit?: number): Promise<AmapPoi[]>`(limit 默认 8,≤10)。实现:place/text `offset=limit`(改造 searchPoi:34-40 的请求构造),**不做 detail 二跳**(省配额);openHours/rating 缺省 undefined。现有 searchPoi 不动(ground 阶段仍用)。

### 5.3 搜索端点:GET /api/pois/search(新文件 app/api/pois/search/route.ts)

query:`tripId`(读 00-input.json 取 destination 作 city)+ `q`。返回 `AmapPoi[]`(≤8)。缺参 400;trip 不存在 404。测试模式沿用 globalThis override 注入 mock map 的既有模式(plan/route.ts:113-115 风格)。

## 6. PATCH op 扩展(plan/route.ts:9-12 PatchSchema 追加)

所有 op 共享:读前快照/写前比对 409(:47-49)、TripPlanSchema.parse 后写盘、返回全量 plan。itemId 匹配沿用 itemId()(:105),**可拖单位 = cluster 组**(同 clusterKey 的 items 整体移动,复用 groupItems:85 原子性防线)。

| op | 形状 | 行为 | 交通重算 |
|---|---|---|---|
| `add-item` | `{day, index?, poolItemId}` 或 `{day, index?, poi: GroundedPoi}` | 池条目(组)移入 `days[day-1].items[index ?? 末尾]`;或新 poi 经 planItemFromPoi 入位 | 入位 i:重算 (i-1,i) 与 (i,i+1) |
| `remove-item` | `{day, itemId}` | 组整体移出天、清 slot/transportToNext 后追加池尾(一律回池,无永久删除——守恒边界) | 拼接段 (i-1,i) |
| `move-item` | `{fromDay, toDay, itemId, toIndex?}` | 组整体跨天 | 源天拼接段 + 目标天两段 |
| `update-item` | `{day, itemId, set: {note?, startTime?, durationMin?}}` | 浅合并;startTime 走 HH:MM 正则(types.ts:142),durationMin 正整数 | 无 |
| `optimize-day` | `{day}` | `day.items = nearestClusterOrder(items).flatMap(g => g.items)`(plan.ts:347 需 export);随后该天段重算 | oldPair 复用(:59-69),新相邻对才调路由 |
| `add-day` | `{theme?}` | days 追加 `{index: N+1, items: []}` | 无 |
| `remove-day` | `{day}` | 该天 items 全部回池;days.splice;剩余天 index 重排为数组位+1 | 无 |
| `set-day-theme` | `{day, theme}` | 设置/清空(空串→undefined) | 无 |
| `set-transport-prefs` | `{shortKm, shortMode, longMode}` | 写 plan.transportPrefs | 无 |
| `recalc-transport` | `{day?}` | 指定天或全部天全段按 prefs 重算(fillAdjacentRoutes 模式 plan.ts:230,deadline=BUDGETS.planRoutesMs) | 范围内全段 |
| `reorder` / `set-transport` | 现有 | 不动(set-transport 的 mode enum 随 3.1 自动含 bike) | 现有 |

边界:day/index 越界 400(:32/:39 风格);remove-day 后 days 为空 → 400「至少保留一天」;add-item 的 poolItemId 不存在 → 400;update-item 三字段全缺 → 400。守恒不破例:本版不提供任何永久删除卡片的 op(池卡清理后置,由分类筛选缓解)。

### 6.1 recommendLegTransport 接 prefs(plan.ts:241)

追加可选参数 `prefs?: TransportPrefs`。逻辑:`directKm < (prefs?.shortKm ?? 0.8)` → preferred = `prefs?.shortMode ?? "walk"`;否则 preferred = `prefs?.longMode ?? input.transport ?? "public"`。保留同 cluster walk 短路(:252)与 public>90min 换 drive 比价(:259)。PATCH 各 op 调用时从 plan.transportPrefs 取值传入;管线 runPlan 路径不传(行为不变)。

### 6.2 段失败语义

route 调用抛错/超时 → 该段 `transportToNext = undefined`,op 本身仍成功返回(部分成功理念延续);前端对 undefined 段渲染「交通待计算 · 点击重试」→ 重试 = set-transport(单段)或 recalc-transport{day}。

## 7. 前端工作台

### 7.1 结构

`app/trip/[id]/page.tsx` 改薄:server 读初始 payload(readTripPayload:49 扩展返回 notes `{id,title,author,url,body}[]`——body 供详情面板引用摘录,单机本地量级 ≤10 篇无负担)传给 client 组件 `<TripWorkbench>`;GET `/api/trips/[id]`(route.ts:32)响应同步加同形状 `notes` 字段(409 刷新复用)。

新组件(components/workbench/):

- `trip-workbench.tsx` — 三栏布局 + DndContext + plan state(PATCH 返回全量 plan 直接 setState;409 → toast + GET 刷新)
- `pool-panel.tsx` — 左栏:PoiType 分类 chips(含计数)过滤 + 卡片列表(可拖出/接收)+「搜索添加」输入(调 /api/pois/search,结果一键入池或入天)
- `day-lane.tsx` — 天列(横向滚动容器内多列):天头(Day N + date + theme 行内编辑 + optimize-day 按钮 + 删除天)、SortableContext 卡片流、卡片间交通条(方式图标+距离+耗时,点击弹四方式 popover → set-transport;undefined 态「点击重试」)、列尾「+添加」;容器尾「+新增 Day」;工具栏含全局交通偏好入口(两档表单 → set-transport-prefs,保存后询问「按新偏好重算全程?」→ recalc-transport)
- `poi-card.tsx` — 名称/类型徽章/时长/备注截断;点击开详情;编辑弹层(note/startTime/durationMin → update-item)
- `workbench-map.tsx` — 由 day-map.tsx 泛化(保留 loadAmapSdk:125 与 overlay 渲染思路 :65-108):props `{days, pool, focus: "all"|dayIndex, selectedItemId, showPool, onMarkerClick}`;按天固定色板循环着色;总览=全天渲染,单天=聚焦该天;池点灰 marker 可开关;选中 item 的 marker 高亮
- `detail-drawer.tsx` — item 详情:address/openHours/rating/reason + **来源笔记引用区**(props.notes 按 `poi.sourceNoteId` 查):①推荐理由(item.reason,源自笔记提取);②笔记原文摘录——按地点名在 Note.body 纯字符串定位首个匹配位置,截取前后各 ~80 字成引用段(无 LLM 调用),未命中则提供 body 折叠全文;③标题/作者/跳原笔记链接。sourceNoteId==="manual" 显示「手动添加」且无引用区
- `workbench-reducer.ts` — 纯函数 `(plan, intent) → {optimisticPlan, patchBody}`:拖拽事件到 op 的映射全走这里(单测主战场)

### 7.2 拖拽

新依赖 `@dnd-kit/core` + `@dnd-kit/sortable`。可拖单位=cluster 组(分组逻辑参照 day-timeline.tsx:27-35 groupAdjacent);跨容器:pool↔day、day↔day、day 内 sortable。落点 → intent → reducer → 乐观 setState + fire PATCH;失败回滚到 PATCH 前快照并 toast。

### 7.3 选点页文案

candidate-list.tsx 提交按钮旁加提示:「未选中的地点会进入工作台待计划池;重新排程将覆盖已有编辑」。行为改变全在 §4.1,此处仅文案。

### 7.4 day-timeline.tsx 去留

page.tsx 重写后不再引用 DayTimeline;文件保留(MODE_LABEL:5 顺手加 `bike: "骑行"`),清理归入 ROADMAP 既有 P3 存根清理条目,本版不删。

## 8. 测试(按项目约定全 mock 外部调用)

- `plan-route.test` 扩:每个新 op 正常路径 + 越界/缺参 400 + 409 并发;**交通重算调用次数断言**(mock map.route 计数):add 中位=2/尾位=1、remove 中位=1、move=3、optimize-day=仅新相邻对、recalc-transport{day}=N-1
- 守恒性:对同一 plan 施加 op 序列(add/remove/move 混合)后,days+pool 的 itemId 多重集只增不减(add-item{poi} 搜索新增是唯一增量来源,任何 op 不得使卡片消失或重复)
- `run.test` 扩:selection 部分选中 → 未选 verified 入 pool、未验证入 filtered
- `amap-rest.test` 扩:bike v4 结构解析 + errcode 降级 + steps polyline 拼接;searchPois 多结果、无 detail 二跳、limit 生效
- `plan.test` 扩:recommendLegTransport prefs 短/长档命中、无 prefs 回退现状(0.8km/input.transport)
- `api.test` 扩:POST /api/trips 建空行程可 GET;GET /api/pois/search 缺参 400/正常返回;GET trips/[id] 响应含 notes;generate links 空数组 400
- `workbench-reducer.test`(新):池入天/天内排序/跨天/回池/删天回池的 intent→op 映射与乐观状态
- `components.test` 扩:工作台冒烟(三栏渲染、卡片计数、409 toast 出现)

## 9. 工程层不做

无 websocket/协作;无 undo 栈(409+刷新兜底);无虚拟滚动;无移动端手势;无地图圈选编辑;不改 SSE 协议;不动 fetch/extract/ground 三段;不动 budgets 常量语义(编辑期段调用套 routeCallMs,optimize/recalc 套 planRoutesMs)。

## 10. 验收

`npm test` 全绿 + `npm run build` 通过 + `npm run dev` 手动走查 brief 四场景(导入编排/手动从零/智能排程再调/失败与冲突恢复)。
