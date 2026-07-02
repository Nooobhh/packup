# packup v0.1 MVP — Design Spec
> 读者:Codex(执行者)。产品语言与验收标准见同日 brief(`docs/ohaze/briefs/2026-07-02-xhs-trip-pipeline-brief.md`)。
> 项目:全新代码库(仅四件套 docs),无历史代码 ref;外部依赖接口引用见 §12。

## 0. 上下文与目标

自用网页(不发布),跑通:粘贴小红书链接 + 偏好表单 → 解析笔记(图文+纯图) → POI 提取 → 地图校验 → LLM 排每日行程 → 时间轴+地图展示。

核心哲学:
- **正确性优先**:客观事实(营业时间/距离/耗时)不可违反;无「幻觉 POI」不加标注混入。
- **中间产物落盘**:管线每段输出 JSON 落 `data/trips/<id>/`,可单段重跑。
- **三个抽象接口**:ContentFetcher / MapProvider / LLMRunner——v0.1 用本地实现(xhs-cli / 高德 / claude -p),发布时换实现不动管线。

## 1. 全局架构与数据流

```
TripInput(链接[]+目的地+天数+可选偏好)
  │ ① Fetch    ContentFetcher → Note[](正文+图片本地路径)
  │ ② Extract  LLMRunner(多模态,并发 per-note)→ CandidatePoi[]
  │ ③ Ground   MapProvider.searchPoi 逐个校验 → GroundedPoi[](未命中标 verified=false)
  │ ④ Plan     LLMRunner(带地图工具/距离矩阵)+ 裁决章程 prompt → TripPlan
  │ ⑤ Render   行程页:每日时间轴 + 高德 JS 地图当日路线
进度经 SSE 流式推送(每段 start/done/error 事件)。
```

技术栈:Next.js(App Router)+ TypeScript + Tailwind + shadcn(默认样式,不追求视觉)+ zod。包管理 npm。**不引入** Vercel AI SDK / 数据库 / ORM(v0.1 用不上)。

## 2. 目录结构

```
app/
  page.tsx                 # 输入页:链接 textarea + 偏好表单
  trip/[id]/page.tsx       # 行程页:时间轴 + 地图
  api/generate/route.ts    # POST 启动管线,SSE 返回进度
  api/trips/[id]/route.ts  # GET 聚合行程页数据:40-plan.json + 10-notes.json 失败项
lib/
  pipeline/
    types.ts               # 全部 zod schema(§3)
    run.ts                 # 编排器:顺序执行、落盘、断点重跑
    fetch.ts extract.ts ground.ts plan.ts
  fetchers/
    types.ts               # ContentFetcher 接口
    xhs-cli.ts             # XhsCliFetcher(exec xhs read)
    manual.ts              # ManualFetcher(读本地目录,兜底+测试)
  map/
    types.ts               # MapProvider 接口
    amap-rest.ts           # 高德 Web 服务 REST 实现
  llm/
    types.ts               # LLMRunner 接口
    claude-cli.ts          # exec claude -p 封装
  prompts/
    extract.ts plan.ts     # prompt 模板(裁决章程在 plan.ts)
data/trips/<id>/           # gitignored: 00-input.json 10-notes.json 20-pois.json
                           #   30-grounded.json 40-plan.json images/<noteId>/*.jpg
scripts/
  spike-xhs.ts             # Spike A 实测脚本
  run-stage.ts             # CLI 单段重跑:npm run stage -- <id> <stage>
```

## 3. 数据契约(zod,`lib/pipeline/types.ts`)

```ts
TripInput { id: string; links: string[](1-10); destination: string;
  days?: {base: number; flex?: number}(可选;flex=±n 浮动,默认 0;base+flex ≤ 15 质量护栏;
    缺省 = 由 Plan 按笔记内容量推荐天数);
  startDate?: string(ISO date); dailyThemes?: (string|null)[](长度≤days.base,days 缺省时不可用);
  transport?: 'public'|'drive'|'walk'(默认 public); pace?: 'packed'|'moderate'|'relaxed'(默认 moderate) }

Note { id; url; title; body; images: string[](本地相对路径); author?;
  fetchStatus: 'ok'|'failed'; failReason?: string }

CandidatePoi { name; type: 'sight'|'food'|'shop'|'stay'|'experience'|'other';
  city?: string; reason: string(引自笔记的推荐理由/tips,保留原文口吻);
  suggestedDuration?: string; timeHint?: string(如"清晨人少");
  sourceNoteId: string; sourceType: 'text'|'image' }

GroundedPoi extends CandidatePoi { verified: boolean; amapId?; location?: {lng,lat};
  address?; openHours?: string; rating?: string }

FilteredItem { name: string; sourceNoteId?: string;
  stage: 'extract'|'ground'|'plan'; why: string }
  // 过滤发生在三处:Extract(无关/非地点内容)、Ground(城市不符)、Plan(容量取舍)。
  // 各段产出后向下游累积传递,最终全量落入 TripPlan.filtered。

TripPlan { days: PlanDay[]; filtered: FilteredItem[](全管线累积,页面折叠区);
  daysDecision?: string(输入为浮动/缺省时必填:实际选定天数的理由,行程页顶部展示);
  warnings: string[] }
PlanDay { index: number; date?: string; theme?: string; items: PlanItem[] }
PlanItem { poi: GroundedPoi; startTime: string("09:00"); durationMin: number;
  transportToNext?: {mode: string; durationMin: number; distanceKm: number};
  note?: string(取舍理由:覆盖笔记建议/冲突折中时必填) }
```

落盘文件结构:`10-notes.json = Note[]`;`20-pois.json = {pois: CandidatePoi[], filtered: FilteredItem[]}`;`30-grounded.json = {grounded: GroundedPoi[], filtered: FilteredItem[]}`(含上游累积);`40-plan.json = TripPlan`(filtered 为全量累积)。`run.ts` 断点逻辑:若 `<stage>.json` 已存在且未传 `--force`,跳过该段直接读盘。

## 4. 三个抽象接口

```ts
interface ContentFetcher { fetch(links: string[], workDir: string): Promise<Note[]> }
interface MapProvider {
  searchPoi(name: string, city: string): Promise<AmapPoi | null>;   // Ground 用
  route(from: LngLat, to: LngLat, mode: TransportMode): Promise<{durationMin, distanceKm}>; // 仅相邻段精算与修复校验用(≤~30 次/行程)
}
interface LLMRunner {
  run(opts: { prompt: string; images?: string[]; jsonSchema?: object;
    mcpConfig?: string; allowedTools?: string[]; timeoutMs: number }): Promise<string>
}
```

## 5. 管线各段实现要点

### ① Fetch(`fetchers/xhs-cli.ts`)
- 链接归一化:识别三种形态——完整 URL(xiaohongshu.com/explore/... 含 xsec_token)、短链(xhslink.com/...)、App 分享口令(文本中夹链接,正则抽 URL)。
- 逐条 `exec xhs read <url>`(xhs-cli,machine 本机已 `xhs login`),**串行 + 每条间隔 2.5s**(平台频率限制,见 §12 social.md:41)。
- 解析输出:标题/正文/图片 URL;图片下载到 `data/trips/<id>/images/<noteId>/`(串行,普通 HTTP GET)。
- 单条失败不中断:标 `fetchStatus: 'failed'` + failReason,继续下一条。全部失败则管线报错终止。
- 具体输出格式依 Spike A 实测结果调整(见 §7)。
- `ManualFetcher`(`fetchers/manual.ts`):从 `data/trips/<id>/manual/` 读取 `<noteId>.md`(正文)+ 同名图片目录。**定位:开发解阻塞与测试 fixture 工具,不是 v0.1 的验收路径**——brief 核心承诺「粘链接→行程」必须经真实链接获取达成(见 §7 Spike A 失败预案)。

### ② Extract(`pipeline/extract.ts`)
- Per-note 调 `LLMRunner.run`,**并发上限 3**。
- 输入:笔记正文 + 该笔记全部图片(本地路径传给 claude -p 的多模态读图);**纯图笔记(正文 < 50 字)与图文笔记走同一条路**,prompt 要求从图片中读出 POI 名称/tips(九宫格攻略图是重点场景)。
- 输出:`{pois: CandidatePoi[], filtered: FilteredItem[]}`,`--json-schema` 强约束。
- prompt 要点(`prompts/extract.ts`):只提取真实地点/店铺/体验;`reason` 引用笔记原文口吻;标注 `sourceType`(该 POI 信息主要来自 text 还是 image);不确定的城市留空;**与目的地无关的内容(其他城市攻略、穿搭/探店闲聊等非地点信息、明显广告)不得进 pois,逐条输出到 filtered(带 sourceNoteId 与一句话理由)**——brief Scenario 3 的「知道丢了什么、为什么」由此保证。

### ③ Ground(`pipeline/ground.ts`)
- 逐 POI 调 `MapProvider.searchPoi(name, destination城市)`(高德地点搜索 REST,keywords=POI名, city=目的地, citylimit=true)。
- 命中:回填 amapId/坐标/地址/营业时间(高德详情接口的 business 字段,取不到则留空)。
- 未命中:重试一次「名称简化」(去括号/后缀);仍未命中标 `verified=false` **保留进管线**(不丢弃、不编造坐标)。
- 城市过滤:POI 的高德返回城市 ≠ 目的地城市 → 移入 `filtered`(`stage:'ground'`,理由注明实际城市),与 Extract 累积的 filtered 合并落盘。QPS 限制:并发 ≤ 3,单 key 免费额度足够自用。

### ④ Plan(`pipeline/plan.ts`)——核心环节
- **规划上下文 = haversine 矩阵 + 远对采样精算**:对已 Ground 的 POI 用坐标算 haversine 两两直线距离矩阵(纯计算,瞬时、零外部调用),注入 prompt,并注明「直线距离,规划时按 ×1.4 折算路面距离,公共交通/步行按城市常识估速」。**不做全量两两路线 API 预计算**(40 POI 会产生上千次调用,延迟与失败面失控);但对**可能成为行程相邻边的候选边**采样真实路线:每个 POI 取 k=2 haversine 最近邻构成候选边集,去重后按边长升序取 ≤15 条调 `MapProvider.route` 注入真实耗时——「直线近但实际慢」(跨江/山体阻隔)的坑恰恰藏在这些近邻边里,而它们正是 LLM 大概率排成相邻的边,预算花在刀刃上(≤15 次调用)。
- 调 `LLMRunner.run` 排程;`--mcp-config` 挂高德 MCP 作为可选升级(Spike B 验证后再切),默认纯矩阵注入。
- prompt = 裁决章程(`prompts/plan.ts`),三层优先级写死:
  1. 客观事实不可违反:营业时间(结合 startDate 推星期)、距离与耗时;
  2. 用户显式输入硬约束:transport / pace / dailyThemes(指定主题的天,POI 类型必须贴合);
  3. 笔记建议(reason/timeHint)填补空隙;冲突时让位并在 `PlanItem.note` 写取舍理由(如「笔记推荐步行,按你偏好改打车;XX 步道保留步行——它是体验本体」)。
- **天数决策**(prompt 首段):days 固定值照排;浮动(base±flex)由 LLM 在范围内选最优天数并在 `daysDecision` 说明;缺省时按 POI 数量/地理分布/pace 推荐天数(cap 15)并在 `daysDecision` 说明依据。dailyThemes 数与实际天数不一致时:多余忽略、缺的天无主题,记 warning。
- pace → 每日 POI 数约束:packed 5-7 / moderate 3-5 / relaxed 2-3;每日窗口 09:00-21:00,总时长(游览+交通)不得超载;Plan 阶段的容量取舍(装不下的 POI)输出到 `filtered`(`stage:'plan'`,理由如「天数装不下,优先级低于同类」)。
- 输出 `TripPlan`,`--json-schema` 强约束;zod 校验失败自动重试 1 次(重试 prompt 附上校验错误)。
- **相邻段精算回填**:LLM 产出行程后,仅对每天实际相邻段调 `MapProvider.route`(按 transport 模式;5 天×~6 段 ≈ 30 次调用)拿真实耗时/距离回填 `transportToNext`。
- **程序化校验 + 修复循环(阻断式,brief「不能折返/超载」是硬约束)**:
  - 超载检测:单日 Σ(durationMin + 真实 transportToNext.durationMin) > 12h;单段真实耗时 > 90min;
  - 折返检测:当日按行程顺序的直线总里程 ÷ 该日 POI 集合最近邻启发式路径里程 > 1.5;
  - 任一违规 → 将违规明细(哪天、哪段、超了多少)+ 真实耗时数据喂回 LLM 重排该部分,**最多 2 轮修复**;
  - **2 轮未果 → 程序化兜底(确定性,保证「不能」是硬约束)**:折返 → 该日 POI 按最近邻启发式重排顺序(消折返确定可解);超载 → 砍该日最低优先级 POI(优先砍 verified=false、再砍无 timeHint 的)移入 `filtered`(`stage:'plan'`,理由「超载兜底裁剪」),直到达标;兜底动作记入 warnings 说明。
  - warnings 仅保留给非阻断的不确定性:未验证 POI 参与排程、营业时间缺失、兜底裁剪说明。展示在行程页顶部。**最终交付的行程必定满足超载/折返硬约束**。

### ⑤ SSE 与编排(`api/generate/route.ts` + `pipeline/run.ts`)
- POST body = TripInput(不含 id,服务端生成 nanoid);ReadableStream 推 `{stage, status, detail}` 事件;结束事件带 tripId,前端跳 `/trip/<id>`。
- `run.ts` 可被 API route 和 `scripts/run-stage.ts` 复用(单段重跑от CLI:`npm run stage -- <id> extract --force`)。

### LLM 封装(`llm/claude-cli.ts`)
- `exec claude -p <prompt> --output-format json [--json-schema <file>] [--mcp-config ...] [--allowedTools ...] --model sonnet`,子进程 timeout(Extract 120s/note,Plan 600s),stderr 与非零退出码原样抛出。
- 图片传入:prompt 内引用本地绝对路径,claude 自行 Read(实测确认;不行则改用 stdin/附件方式,Spike A 一并验证)。
- 模型可通过 env `PACKUP_CLAUDE_MODEL` 覆盖(默认 sonnet,质量不够升 opus)。

## 6. Web UI(两页,shadcn 默认样式)

- **输入页 `/`**:links textarea(每行一条,自动抽 URL)+ destination + days(可空;number 输入 + 可选「± n」浮动输入;空 = 推荐天数)+ 可选折叠区(startDate、per-day theme 输入(按 days.base 联动行数,days 为空时禁用并提示「填天数后可指定每日主题」)、transport、pace)。提交后页面内显示 SSE 进度列表(每段 ✓/✗/进行中),完成跳行程页。startDate 给定时与 days 联动仅作展示(days 仍为唯一真源)。
- **行程页 `/trip/[id]`**(数据源 = `api/trips/[id]` 聚合payload `{plan: TripPlan, failedLinks: {url, reason}[]}`):
  - 每日 tab/分节:时间轴列表(startTime、POI 名、type 徽章、**address、openHours**(缺失显「未知」)、durationMin、reason 引文、note 取舍标注、verified=false 显「未验证」黄标、transportToNext 一行小字);
  - 高德 JS SDK 地图:当日 POI 打点连线(verified 的才上图),切天联动;
  - 顶部 warnings 条 + `daysDecision` 说明(存在时显示,如「按内容量推荐 4 天:…」);**失败链接区**(failedLinks 非空才显示:逐条 url + 失败原因,brief Scenario 4 要求生成完成后仍可见);底部 filtered 折叠区(FilteredItem:名称 + 来源笔记 + stage + why)。
- 地图 key:`NEXT_PUBLIC_AMAP_JS_KEY`(JS SDK)+ `AMAP_REST_KEY`(服务端 REST),`.env.local`。

## 7. 前置 Spike(实现的第一批任务,结论写回本 spec 再继续)

- **Spike A — xhs 提取实测**(`scripts/spike-xhs.ts` + 手动):
  1. 三种链接形态 × `xhs read` 直读是否成功(重点:分享链接自带 xsec_token 是否绕过「裸 note_id 拦截」);
  2. 输出结构:正文/图片 URL 字段位置;图片可否直接 GET 下载;
  3. 纯图笔记样本:图片喂 claude -p 能否读出 POI(验证 §5② 的多模态路径与图片传入方式);
  4. 结论落 `docs/ohaze/specs/` 本文件 §7 附记。**失败预案:xhs-cli 走不通不允许静默降级 ManualFetcher 交付**——升级评估备选获取方案(Airtap 真机方案 / xhs-cli 降版本 / 其他),连同实测证据回 haze 决策获取层走向;期间管线后半段开发用 ManualFetcher fixture 继续,不被阻塞。
- **Spike B — 地图接口选型**:高德 REST(地点搜索/路径规划/详情)直接可用性 + 高德 MCP Server 在 claude -p 非交互下的稳定性;默认走 §5④(haversine 矩阵注入 + 相邻段 REST 精算),MCP 稳则 Plan 可切 MCP 模式。

## 8. 错误处理与重跑

- 每段 try/catch:失败落 `<stage>.error.json`(错误+输入摘要),SSE 推 error 事件,管线终止(已落盘段成果保留)。
- 重跑:同 tripId re-POST 或 CLI 单段 `--force`;幂等(重跑覆盖该段及下游产物)。
- Fetch 部分失败(≥1 成功)不算段失败(§5①);Extract 单 note 失败同理(该 note 计入 failed 列表,行程页可见)。

## 9. 验收(对应 brief checklist)

- 单元测试(vitest):链接归一化(3 形态)、zod 契约 parse、run.ts 断点/force 逻辑、pace→数量约束映射、haversine 与折返比值计算、超载/折返校验触发修复的判定逻辑。LLM/网络调用一律 mock。
- 端到端人工验收:2 组真实场景(haze 真实收藏笔记,含 ≥1 纯图笔记),对照 brief「完成的样子」逐条勾;记录端到端耗时(SSE 事件带时间戳),目标 ≤3min、可接受 ≤5min——软目标,超出不算验收失败但须记录瓶颈段。
- 程序化校验兜底:§5④ 后置校验的 warnings 机制。

## 10. 人工前置(haze 动作,P0)

1. 高德开放平台注册 + 建应用,拿 **Web 服务 key**(REST)与 **JS API key**(前端),填 `.env.local`;
2. 本机确认 `xhs login` 有效(浏览器已登录小红书);
3. 准备 2 组真实笔记链接(含纯图笔记)供 Spike A 与验收。

## 11. Out of Scope(同 brief)

不发布/无登录支付分享/不做其他平台(接口留位)/无 DB/不追求视觉/无手动编辑导出。

## 12. 引用

- xhs-cli 命令与限制:`~/.claude/skills/agent-reach/references/social.md:5-43`(xsec_token 机制 :39、频率 :41)
- claude CLI 2.1.195(本机实测):`-p` / `--output-format json` / `--json-schema` / `--mcp-config` / `--allowedTools` 均可用
- 高德 Web 服务 API(地点搜索/路径规划):https://lbs.amap.com/api/webservice/summary ;高德 MCP:https://lbs.amap.com/api/mcp-server/summary
- 项目内:全新模块,无历史代码 ref;四件套见根目录(CLAUDE.md/README/ROADMAP/CHANGELOG)
