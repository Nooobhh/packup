# xhs-trip-pipeline — Guidance Plan

> **For Codex (the executor):** Each Task below specifies WHAT must be true at completion, not HOW to write it line by line. You have autonomy over internal naming, control flow, helper extraction, and algorithm choice. You do NOT have autonomy over public interfaces, file paths in Files lists, acceptance criteria, or cross-Task invariants. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 自用网页:粘贴小红书链接 + 偏好表单 → 五段管线(Fetch→Extract→Ground→Plan→Render)→ 时间轴+地图的结构化行程。

**Architecture:** 管线各段以 zod 契约衔接、中间产物落盘支持断点/单段重跑;三个抽象接口(ContentFetcher/MapProvider/LLMRunner)隔离外部依赖(xhs-cli/高德 REST/claude -p),发布时换实现不动管线。排程质量由「三层裁决 prompt + 程序化校验修复循环 + 确定性兜底」保证。

**Tech Stack:** Next.js(App Router)+ TypeScript + Tailwind + shadcn + zod + vitest;LLM = 本机 `claude -p`(--json-schema 结构化输出);地图 = 高德 Web 服务 REST + 前端高德 JS SDK。不引入 Vercel AI SDK / 数据库。

**Spec:** `docs/ohaze/specs/2026-07-02-xhs-trip-pipeline-design.md`(下称 spec;各 Task 引用其章节)

**外部输入约定(避免执行被环境卡死):**
- 真实小红书链接样本:`data/spike/links.txt`(每行一条;不存在 → Task 3 只交付代码与 mock 测试,真实 spike 延后,在 SPIKE-NOTES 中标注 BLOCKED-BY-INPUT)
- 高德 key:`.env.local` 的 `AMAP_REST_KEY` / `NEXT_PUBLIC_AMAP_JS_KEY`(缺失 → 真实地图调用延后,同上标注)
- `claude` CLI 本机可用(已确认 2.1.195);测试一律 mock,不依赖真实调用

---

### Task 1: 项目脚手架 + 数据契约

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `vitest.config.ts`, `app/layout.tsx`, `app/globals.css`, `.env.example`
- Create: `lib/pipeline/types.ts`
- Test: `lib/pipeline/types.test.ts`

**Behavior Contract:**
- Next.js 15+ App Router + TypeScript strict + Tailwind + shadcn 初始化(shadcn 仅引入 button/input/card/badge/accordion/tabs 等基础件),vitest 可跑
- `types.ts` 导出 spec §3 全部 zod schema 与推导类型:`TripInput`(days 为可选 `{base, flex?}`,base+flex ≤ 15,links 1-10,dailyThemes 长度 ≤ days.base 且 days 缺省时不可有)、`Note`、`CandidatePoi`、`GroundedPoi`、`FilteredItem`(stage 枚举 extract|ground|plan)、`PlanItem`、`PlanDay`、`TripPlan`(含 `daysDecision?`、`filtered`、`warnings`)
- `.env.example` 列出 `AMAP_REST_KEY`、`NEXT_PUBLIC_AMAP_JS_KEY`、`PACKUP_CLAUDE_MODEL`(注释说明用途)
- npm scripts:`dev` / `build` / `test` / `stage`(stage 于 Task 10 实现,可先占位报「未实现」并退出非零)

**Acceptance Criteria:**
- [ ] Test: 合法 TripInput 样例 parse 通过;links=0 条、11 条、days.base+flex=16、days 缺省却给 dailyThemes → 各自 parse 失败
- [ ] Test: TripPlan 样例(含 filtered 三种 stage、daysDecision)parse 通过
- [ ] `npm test` 与 `npm run build` 均成功

**TDD Sequence:**
- [ ] Step 1: 写 types 失败测试(先只有空 types.ts)
- [ ] Step 2: 确认失败原因正确
- [ ] Step 3: 实现全部 schema
- [ ] Step 4: 测试全绿,build 通过
- [ ] Step 5: Commit。建议:`chore(scaffold): Next.js 项目初始化 + 管线数据契约`

**Cross-Task Dependencies:** Provides 全部类型 for Task 2-13。

---

### Task 2: 链接归一化 + ContentFetcher 接口 + ManualFetcher

**Files:**
- Create: `lib/fetchers/types.ts`, `lib/fetchers/normalize.ts`, `lib/fetchers/manual.ts`
- Test: `lib/fetchers/normalize.test.ts`, `lib/fetchers/manual.test.ts`

**Behavior Contract:**
- `lib/fetchers/types.ts`:`interface ContentFetcher { fetch(links: string[], workDir: string): Promise<Note[]> }`
- `normalizeLinks(raw: string): string[]`:从任意粘贴文本抽取小红书链接,识别三形态(完整 URL 含 xiaohongshu.com、短链 xhslink.com、分享口令中夹杂的 URL);去重、保序;非小红书 URL 与噪声文本忽略
- `ManualFetcher`:读 `<workDir>/manual/` 下 `<noteId>.md` 为正文(首行 `# 标题` 约定)、`<noteId>/` 同名目录图片为该笔记 images;返回 Note[](fetchStatus 恒 ok)。**定位 = 开发/测试 fixture,非 v0.1 验收路径**(spec §5①)
- 目录不存在或为空 → 返回空数组,不抛错

**Acceptance Criteria:**
- [ ] Test: 三种形态混合文本(含噪声行、重复链接)→ 归一化输出正确 URL 列表且去重保序
- [ ] Test: ManualFetcher 对 fixture 目录(2 篇笔记,1 篇带图)返回正确 Note[];空目录返回 []
- [ ] Interface conformance: ManualFetcher 实现 ContentFetcher

**TDD Sequence:**
- [ ] Step 1-2: 失败测试(fixture 置于 `lib/fetchers/__fixtures__/`)→ 确认失败
- [ ] Step 3-4: 实现 → 全绿
- [ ] Step 5: Commit。建议:`feat(fetchers): 链接归一化 + ContentFetcher 接口 + ManualFetcher`

**Cross-Task Dependencies:** Depends on Task 1 `Note`。Provides ContentFetcher 接口 for Task 3/10,normalizeLinks for Task 11。

---

### Task 3: XhsCliFetcher + Spike A(真实提取实测)

**Files:**
- Create: `lib/fetchers/xhs-cli.ts`, `scripts/spike-xhs.ts`, `docs/ohaze/SPIKE-NOTES.md`
- Test: `lib/fetchers/xhs-cli.test.ts`

**Behavior Contract:**
- `XhsCliFetcher` 实现 ContentFetcher:逐链接调本机 `xhs read <url>`(子进程),**串行且相邻调用间隔 ≥ 2.5s**(平台频率限制,spec §12);解析输出中的标题/正文/图片 URL;图片逐张 HTTP GET 下载到 `<workDir>/images/<noteId>/`,Note.images 存相对路径
- 单条失败(子进程非零/超时 30s/输出不可解析)→ 该 Note 标 `fetchStatus:'failed'` + failReason,继续后续链接;全部失败不抛错(由调用方判断)
- xhs 输出的具体字段结构以 Spike A 实测为准,解析器按实测调整
- `scripts/spike-xhs.ts`:读 `data/spike/links.txt` 逐条真实调用,把「链接形态 × 成功/失败 × 图片可下载性」结论 + 原始输出样本写入 `docs/ohaze/SPIKE-NOTES.md`
- **Spike A 判定规则(spec §7)**:links.txt 不存在 → SPIKE-NOTES 记 `BLOCKED-BY-INPUT`,代码按合理假设交付;真实调用失败(登录态/风控)→ SPIKE-NOTES 记失败证据,**不得静默降级 ManualFetcher 为交付路径**,标注「获取层走向需 haze 决策」

**Acceptance Criteria:**
- [ ] Test(mock 子进程与 HTTP):成功解析样例输出为 Note;失败链接标记正确且不中断;调用间隔逻辑存在(可用 fake timer 断言)
- [ ] Manual check: `data/spike/links.txt` 存在时,`npx tsx scripts/spike-xhs.ts` 产出 SPIKE-NOTES.md 实测记录;不存在时产出 BLOCKED-BY-INPUT 记录
- [ ] Interface conformance: 实现 ContentFetcher

**TDD Sequence:**
- [ ] Step 1-4: mock 测试先行 → 实现 → 全绿
- [ ] Step 5: 跑 spike 脚本(有无 links.txt 均须产出 SPIKE-NOTES.md)
- [ ] Step 6: Commit。建议:`feat(fetchers): XhsCliFetcher + Spike A 实测记录`

**Cross-Task Dependencies:** Depends on Task 2 接口。Provides 默认 fetcher for Task 10。

---

### Task 4: LLMRunner(claude -p 封装)

**Files:**
- Create: `lib/llm/types.ts`, `lib/llm/claude-cli.ts`
- Test: `lib/llm/claude-cli.test.ts`

**Behavior Contract:**
- `lib/llm/types.ts`:`interface LLMRunner { run(opts: { prompt: string; images?: string[]; jsonSchema?: object; mcpConfig?: string; allowedTools?: string[]; timeoutMs: number }): Promise<string> }`
- `ClaudeCliRunner`:组装并执行 `claude -p ... --output-format json`;jsonSchema 提供时经临时文件传 `--json-schema`;model 取 env `PACKUP_CLAUDE_MODEL` 默认 `sonnet`;images 以「prompt 内嵌绝对路径引用」方式传入(若 Spike A 发现此方式读不到图,切换为该 CLI 版本支持的替代传图方式,并在 SPIKE-NOTES.md 记录)
- 返回值 = 模型输出文本(从 CLI 的 JSON 包装中取出);超时杀子进程并抛 `LLMTimeoutError`;非零退出码抛错并附 stderr
- 临时文件写入 scratch 目录并在完成后清理

**Acceptance Criteria:**
- [ ] Test(mock 子进程):参数组装正确(含 json-schema 临时文件、model env 覆盖);超时抛 LLMTimeoutError;非零退出抛错含 stderr;正常路径返回文本
- [ ] Interface conformance: 实现 LLMRunner

**TDD Sequence:**
- [ ] Step 1-4: 失败测试 → 实现 → 全绿
- [ ] Step 5: Commit。建议:`feat(llm): claude -p 封装 LLMRunner`

**Cross-Task Dependencies:** Depends on Task 1。Provides LLMRunner for Task 5/9。

---

### Task 5: Extract 段(多模态 POI 提取)

**Files:**
- Create: `lib/pipeline/extract.ts`, `lib/prompts/extract.ts`
- Test: `lib/pipeline/extract.test.ts`

**Behavior Contract:**
- `runExtract(notes: Note[], input: TripInput, llm: LLMRunner): Promise<{pois: CandidatePoi[], filtered: FilteredItem[], failedNotes: {noteId, reason}[]}>`
- Per-note 调 llm.run(并发上限 3):正文 + 该笔记全部图片路径一并传入(纯图笔记与图文同一路径,spec §5②);jsonSchema 约束输出 `{pois, filtered}`
- prompt(`lib/prompts/extract.ts` 导出模板函数)必须要求:只提取真实地点/店铺/体验;reason 引笔记原文口吻;标 sourceType(text|image);城市不确定留空;**与目的地无关内容(异城攻略/非地点闲聊/广告)不进 pois、逐条进 filtered(带 sourceNoteId 与理由)**
- 输出聚合:pois 合并(同名不去重,Ground 阶段处理)、filtered 合并且 stage='extract';单 note LLM 失败 → 记 failedNotes 不中断;fetchStatus='failed' 的 note 跳过不计入 failedNotes
- LLM 输出 zod 校验失败 → 对该 note 重试 1 次(附校验错误),再失败进 failedNotes

**Acceptance Criteria:**
- [ ] Test(mock LLMRunner):图文/纯图笔记都发起调用且图片路径传入;并发 ≤ 3;filtered 项带 sourceNoteId 与 stage='extract';单 note 失败不中断;校验失败重试 1 次
- [ ] Test: prompt 模板包含目的地锚点过滤与 reason 原文口吻要求(字符串断言关键指令存在)

**TDD Sequence:**
- [ ] Step 1-4: 失败测试 → 实现 → 全绿
- [ ] Step 5: Commit。建议:`feat(pipeline): Extract 段多模态 POI 提取`

**Cross-Task Dependencies:** Depends on Task 1/4。Provides pois for Task 7(经编排器)。

---

### Task 6: MapProvider + 高德 REST 实现

**Files:**
- Create: `lib/map/types.ts`, `lib/map/amap-rest.ts`
- Test: `lib/map/amap-rest.test.ts`

**Behavior Contract:**
- `lib/map/types.ts`:
  - `interface MapProvider { searchPoi(name: string, city: string): Promise<AmapPoi | null>; route(from: LngLat, to: LngLat, mode: TransportMode): Promise<{durationMin: number, distanceKm: number}> }`
  - `AmapPoi { amapId, name, location: {lng,lat}, address, cityName, openHours?, rating? }`;`TransportMode = 'public'|'drive'|'walk'`
- `AmapRestProvider`:高德 Web 服务 API——searchPoi 用地点搜索(keywords=name, city, citylimit=true,取首个结果,详情补 openHours/rating,取不到留空);route 按 mode 映射公交/驾车/步行路径规划接口取时长与距离
- key 取 env `AMAP_REST_KEY`,缺失时构造函数抛 `MapKeyMissingError`(调用方决定降级);HTTP 失败/额度超限 → 抛错附高德错误码;内置并发闸 ≤ 3(spec §5③)
- searchPoi 查无结果返回 null(不抛错)

**Acceptance Criteria:**
- [ ] Test(mock HTTP):searchPoi 命中/未命中/HTTP 错各路径正确;route 三种 mode 请求参数正确;并发闸生效;key 缺失抛 MapKeyMissingError
- [ ] Interface conformance: 实现 MapProvider

**TDD Sequence:**
- [ ] Step 1-4: 失败测试 → 实现 → 全绿
- [ ] Step 5: Commit。建议:`feat(map): 高德 REST MapProvider`

**Cross-Task Dependencies:** Depends on Task 1。Provides MapProvider for Task 7/9。

---

### Task 7: Ground 段(真实性校验)

**Files:**
- Create: `lib/pipeline/ground.ts`
- Test: `lib/pipeline/ground.test.ts`

**Behavior Contract:**
- `runGround(pois: CandidatePoi[], input: TripInput, map: MapProvider): Promise<{grounded: GroundedPoi[], filtered: FilteredItem[]}>`
- 逐 POI searchPoi(name, input.destination):命中 → 回填 verified=true + amapId/location/address/openHours;未命中 → **名称简化重试一次**(去括号内容与常见后缀);仍未命中 → verified=false 保留(不丢弃、不编造坐标,spec §5③)
- 高德返回城市 ≠ 目的地城市 → 该 POI 移入 filtered(stage='ground',理由注明实际城市),不入 grounded
- 简单去重:同 amapId 只保留一个(reason 合并,来源笔记都记)
- 上游 filtered 透传合并输出

**Acceptance Criteria:**
- [ ] Test(mock MapProvider):命中回填/简化重试/未命中保留 verified=false/异城移 filtered/同 amapId 去重合并,各路径断言
- [ ] Test: 输出 grounded + filtered 总数与输入 POI 数守恒(不静默丢失)

**TDD Sequence:**
- [ ] Step 1-4: 失败测试 → 实现 → 全绿
- [ ] Step 5: Commit。建议:`feat(pipeline): Ground 段高德校验`

**Cross-Task Dependencies:** Depends on Task 1/6。Provides grounded for Task 9。

---

### Task 8: geo 纯函数工具(距离/近邻/折返)

**Files:**
- Create: `lib/pipeline/geo.ts`
- Test: `lib/pipeline/geo.test.ts`

**Behavior Contract:**
- `haversineKm(a: LngLat, b: LngLat): number`
- `distanceMatrix(pois: {id, location}[]): 结构化两两直线距离`(形状自定,供 prompt 渲染与其他函数复用)
- `nearestNeighborEdges(pois, k): Edge[]`:每 POI 取 k 近邻构成候选边集,去重(无向),按边长升序
- `nearestNeighborPathKm(points: LngLat[]): number`:最近邻启发式路径总里程(从首点贪心)
- `backtrackRatio(orderedPoints: LngLat[]): number`:按给定顺序的直线总里程 ÷ nearestNeighborPathKm(同点集);点数 < 3 返回 1
- 全部纯函数,无 IO

**Acceptance Criteria:**
- [ ] Test: haversine 已知城市对距离误差 < 1%;nearestNeighborEdges 的去重与升序;人为折返序列 backtrackRatio > 1.5 而合理序列 ≈ 1
- [ ] Test: 边界——空数组/单点/双点不抛错

**TDD Sequence:**
- [ ] Step 1-4: 失败测试 → 实现 → 全绿
- [ ] Step 5: Commit。建议:`feat(pipeline): geo 距离与折返度量工具`

**Cross-Task Dependencies:** Depends on Task 1(LngLat 类型可在本 Task 或 types.ts 定义,保持单一来源)。Provides for Task 9。

---

### Task 9: Plan 段(排程 + 修复循环 + 确定性兜底)

**Files:**
- Create: `lib/pipeline/plan.ts`, `lib/prompts/plan.ts`
- Test: `lib/pipeline/plan.test.ts`

**Behavior Contract:**
- `runPlan(grounded: GroundedPoi[], upstreamFiltered: FilteredItem[], input: TripInput, llm: LLMRunner, map: MapProvider): Promise<TripPlan>`
- **规划上下文**(spec §5④):haversine 全量矩阵(geo.distanceMatrix,标注「直线距离 ×1.4 折算」)+ **近邻候选边采样**:nearestNeighborEdges(k=2) 升序取 ≤15 条调 map.route(按 input.transport)注真实耗时;verified=false 的 POI 无坐标,不入矩阵但列入 prompt 供 LLM 斟酌安排(标注未验证)
- **裁决章程 prompt**(`lib/prompts/plan.ts`):三层优先级(客观事实 > 用户显式输入 > 笔记建议)写死;天数决策(固定照排 / 浮动 base±flex 选最优并写 daysDecision / 缺省按内容量+pace 推荐 cap 15 并写 daysDecision);dailyThemes 硬约束;pace→每日 POI 数(packed 5-7 / moderate 3-5 / relaxed 2-3);每日窗口 09:00-21:00;startDate 给定时结合星期核对 openHours;非平凡取舍写 PlanItem.note;容量装不下的 POI 输出到 filtered(stage='plan')
- LLM 输出经 jsonSchema 约束 + zod 校验,失败重试 1 次(附校验错误)
- **相邻段精算**:对产出行程每天相邻段调 map.route 回填 transportToNext(真实耗时/距离)
- **校验修复循环**:检测超载(单日游览+交通 > 12h 或单段 > 90min)与折返(geo.backtrackRatio > 1.5)→ 违规明细喂回 LLM 局部重排,**最多 2 轮**;仍违规 → **程序化兜底**:折返按最近邻重排该日顺序;超载按序砍 POI(先 verified=false、再无 timeHint)移入 filtered(stage='plan',理由「超载兜底裁剪」)直至达标;兜底动作记 warnings。**最终返回的 TripPlan 必定满足两项硬约束**
- warnings 还包括:未验证 POI 参与排程、openHours 缺失、主题数与实际天数不一致
- upstreamFiltered 与本段 filtered 合并输出

**Acceptance Criteria:**
- [ ] Test(mock llm+map):候选边采样 ≤15 且按升序;LLM 校验失败重试 1 次;相邻段精算调用数 = Σ(每日 items-1)
- [ ] Test: mock LLM 持续产出折返/超载行程 → 2 轮修复后程序兜底生效,最终 plan 断言 backtrackRatio ≤ 1.5 且单日总时长 ≤ 12h,砍掉的 POI 出现在 filtered(stage='plan')
- [ ] Test: days 缺省 → daysDecision 非空;浮动 → 实际天数在 [base-flex, base+flex] 内
- [ ] Test: prompt 模板含三层优先级、pace 数量映射、主题硬约束关键指令(字符串断言)

**TDD Sequence:**
- [ ] Step 1-4: 失败测试 → 实现 → 全绿(建议按「上下文构造 → LLM 往返 → 精算 → 校验循环 → 兜底」拆小步提交)
- [ ] Step 5: Commit(可多个)。建议:`feat(pipeline): Plan 段排程与修复循环`

**Cross-Task Dependencies:** Depends on Task 1/4/6/8。Provides TripPlan for Task 10。

---

### Task 10: 编排器 run.ts + 落盘断点 + 单段 CLI

**Files:**
- Create: `lib/pipeline/run.ts`, `scripts/run-stage.ts`
- Modify: `package.json`(scripts.stage 指向真实实现)
- Test: `lib/pipeline/run.test.ts`

**Behavior Contract:**
- `runPipeline(input: TripInput, deps: {fetcher, llm, map}, opts: {onEvent?: (e: StageEvent) => void, force?: boolean, fromStage?: StageName}): Promise<{tripId: string}>`
- `StageEvent { stage: 'fetch'|'extract'|'ground'|'plan', status: 'start'|'done'|'error', detail?: string, at: ISO时间戳 }`
- 落盘布局(spec §3):`data/trips/<id>/00-input.json / 10-notes.json / 20-pois.json / 30-grounded.json / 40-plan.json`;各段完成即写盘;段失败写 `<stage>.error.json`(错误+输入摘要)并发 error 事件后终止(已落盘成果保留)
- 断点:目标段文件已存在且非 force → 读盘跳过;force/fromStage → 重跑该段及下游(下游旧产物删除,保证一致)
- Fetch 全失败 = 段失败;部分成功继续(spec §8);`20-pois.json = {pois, filtered, failedNotes}`(failedNotes 含 noteId 与 reason;types.ts 契约相应扩展),行程页失败链接区数据 = 10-notes.json failed 项 + failedNotes(经 noteId 关联回 url)合并
- `scripts/run-stage.ts`:`npm run stage -- <tripId> <stage> [--force]`,对既有 trip 目录单段重跑,依赖注入默认实现(XhsCliFetcher/ClaudeCliRunner/AmapRestProvider)
- deps 注入设计使测试可全 mock;默认 fetcher = XhsCliFetcher(ManualFetcher 仅当 `<workDir>/manual/` 存在且 links 为空的显式测试场景使用)

**Acceptance Criteria:**
- [ ] Test(全 mock):正常流五段事件序列正确、五个 JSON 落盘且可被 zod 反解;中途失败 → error.json + 事件 + 已完成段保留
- [ ] Test: 断点(有 30-grounded.json 时从 plan 继续,fetch/extract 未被调用);force 重跑删除下游产物
- [ ] Manual check: `npm run stage -- <id> plan --force` 在 fixture trip 目录上可执行(mock 或真实依赖视 env)

**TDD Sequence:**
- [ ] Step 1-4: 失败测试 → 实现 → 全绿
- [ ] Step 5: Commit。建议:`feat(pipeline): 编排器与断点重跑`

**Cross-Task Dependencies:** Depends on Task 2/3/4/5/6/7/9。Provides runPipeline for Task 11,落盘布局 for Task 11/12。

---

### Task 11: API 层(SSE 生成 + 行程聚合)

**Files:**
- Create: `app/api/generate/route.ts`, `app/api/trips/[id]/route.ts`
- Test: `app/api/api.test.ts`(路由处理器直测)

**Behavior Contract:**
- `POST /api/generate`:body = TripInput(无 id,服务端 nanoid);zod 校验失败 → 400 + 错误详情;合法 → `text/event-stream` 流式推 StageEvent(JSON per event),终事件 `{stage:'done', tripId}`;管线错误 → error 事件后正常关流(HTTP 200,错误语义在事件里)
- `GET /api/trips/[id]`:聚合 `{plan: TripPlan, failedLinks: {url, reason}[], input: TripInput}`(spec §6:failedLinks 来自 10-notes.json failed 项 + extract 失败元信息);trip 不存在 → 404;40-plan.json 缺失但有 error.json → 409 + 错误摘要(前端可提示重跑)
- 依赖注入:route 内组装默认实现,但构造逻辑独立可换(供测试)

**Acceptance Criteria:**
- [ ] Test: 非法 body 400;合法请求(mock runPipeline)事件流含 done 与 tripId;聚合 GET 的 200/404/409 路径
- [ ] Test: failedLinks 聚合正确(fetch 失败 + extract 失败合并,含 url 与 reason)

**TDD Sequence:**
- [ ] Step 1-4: 失败测试 → 实现 → 全绿
- [ ] Step 5: Commit。建议:`feat(api): SSE 生成与行程聚合接口`

**Cross-Task Dependencies:** Depends on Task 10。Provides API for Task 12。

---

### Task 12: UI 两页(输入表单 + 行程时间轴/地图)

**Files:**
- Create: `app/page.tsx`, `app/trip/[id]/page.tsx`, `components/trip-form.tsx`, `components/progress-stream.tsx`, `components/day-timeline.tsx`, `components/day-map.tsx`, `components/filtered-section.tsx`
- Test: `components/components.test.tsx`(关键渲染逻辑;地图组件可浅测)

**Behavior Contract(spec §6,shadcn 默认样式、不追求视觉):**
- 输入页:links textarea(经 normalizeLinks 实时提示识别到 N 条)+ destination 必填 + days(number + 可选 ±flex;可空,空提示「将按内容推荐天数」)+ 折叠区(startDate、逐日主题输入 [按 days.base 联动行数,days 空则禁用并提示]、transport、pace);提交 → 消费 SSE 渲染各段进度(✓/✗/进行中 + detail);done 跳 `/trip/<id>`;error 事件展示错误与「已完成段保留,可重跑」提示
- 行程页:顶部 warnings 条 + daysDecision 说明(存在时);失败链接区(failedLinks 非空:逐条 url+原因);每日 tabs:时间轴(startTime、名称、type 徽章、address、openHours[缺失显「未知」]、durationMin、reason 引文、note 取舍标注、未验证黄标、transportToNext 小字);当日地图(高德 JS SDK,verified POI 打点连线,切天联动;`NEXT_PUBLIC_AMAP_JS_KEY` 缺失 → 地图区显占位提示,页面其余正常);底部 filtered 折叠区(名称+来源笔记+stage+why)
- 高德 JS SDK 经 script 动态加载,key 从 env 读

**Acceptance Criteria:**
- [ ] Test: 表单校验(必填/days 联动/主题禁用逻辑);时间轴渲染含 address/openHours/未验证标/取舍 note;filtered 区与失败链接区条件渲染
- [ ] Manual check: `npm run dev` 两页可交互走通(mock 数据或真实 trip 目录)
- [ ] Interface conformance: 页面数据消费 = Task 11 聚合payload 形状

**TDD Sequence:**
- [ ] Step 1-4: 组件失败测试 → 实现 → 全绿
- [ ] Step 5: Commit。建议:`feat(ui): 输入页与行程页`

**Cross-Task Dependencies:** Depends on Task 2(normalizeLinks)/11。

---

### Task 13: 端到端集成验收

**Files:**
- Create: `docs/ohaze/ACCEPTANCE.md`
- Test:(无新增单测;本 Task 是集成验证与记录)

**Behavior Contract:**
- 前置齐备时(links.txt + AMAP_REST_KEY + xhs 登录态):跑 2 组真实场景(≥1 组含纯图笔记)完整管线,记录:各段耗时(SSE 时间戳)、端到端总耗时(目标 ≤3min / 可接受 ≤5min,超出记录瓶颈段)、brief「完成的样子」checklist 逐条核对结果、生成行程的人工质量观察(POI 真实性抽查、时空合理性、reason 保留度)
- 前置不齐:用 ManualFetcher fixture + mock 依赖跑通全管线冒烟(验证段间契约与落盘),ACCEPTANCE.md 标注哪些验收 BLOCKED-BY-INPUT 待 haze 补齐后执行
- 发现的缺陷:能当场修则修(遵守各 Task 契约),不能修记入 ACCEPTANCE.md「遗留」段

**Acceptance Criteria:**
- [ ] `docs/ohaze/ACCEPTANCE.md` 存在且含:场景记录(或 BLOCKED 标注)、耗时表、checklist 核对、遗留清单
- [ ] `npm test` 全绿 + `npm run build` 成功(最终状态)

**TDD Sequence:**
- [ ] Step 1: 依 env 判定走真实/冒烟路径
- [ ] Step 2: 执行并记录
- [ ] Step 3: 修当场可修缺陷(每修一处跑全测)
- [ ] Step 4: Commit。建议:`test(e2e): 集成验收记录`

**Cross-Task Dependencies:** Depends on Task 1-12 全部。

---

## 备注

- **四件套同步由 doc-finish 收口**(CLAUDE.md/README/ROADMAP/CHANGELOG/manifest 不在任何 Task 交付物中)
- Spike A/B 结论落 `docs/ohaze/SPIKE-NOTES.md`,不回写 spec 正文(spec §7 附记职责由该文件承担,避免执行期改设计文档)
- 高德 MCP 模式(spec §5④ 可选升级)本计划不实现——默认 REST 路径已满足 v0.1;若 SPIKE-NOTES 显示必要性再入 backlog
