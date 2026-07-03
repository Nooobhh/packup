# xhs-trip-pipeline Acceptance

Date: 2026-07-02

## Environment Gate

- `data/spike/links.txt`: BLOCKED-BY-INPUT, file missing.
- `.env.local` map keys: BLOCKED-BY-INPUT, `AMAP_REST_KEY` / `NEXT_PUBLIC_AMAP_JS_KEY` not present.
- `claude` CLI: available, `2.1.195`.

Because real XHS links and Amap keys are absent, full real-scene acceptance is blocked. The fallback smoke path used `ManualFetcher` with mocked LLM/map dependencies to verify contracts, checkpoint layout, and UI rendering.

## Smoke Scenario

- Data root: `/tmp/packup-acceptance.ytgoyg`
- Trip id: `acceptance-smoke`
- Input: one manual note for 上海 / 外滩.
- Result: `40-plan.json` generated with 1 day and 1 item.

## Timing

| Stage | Start | Done | Duration |
| --- | --- | --- | --- |
| fetch | 2026-07-02T10:10:20.084Z | 2026-07-02T10:10:20.086Z | ~2ms |
| extract | 2026-07-02T10:10:20.086Z | 2026-07-02T10:10:20.087Z | ~1ms |
| ground | 2026-07-02T10:10:20.087Z | 2026-07-02T10:10:20.087Z | ~0ms |
| plan | 2026-07-02T10:10:20.087Z | 2026-07-02T10:10:20.088Z | ~1ms |
| end-to-end | - | - | 6ms |

Mock timing is not representative of real xhs/AMAP/LLM latency.

## Checklist

- [x] Pipeline emits start/done events for Fetch, Extract, Ground, Plan.
- [x] Checkpoints are written in `00-input.json`, `10-notes.json`, `20-pois.json`, `30-grounded.json`, `40-plan.json`.
- [x] Segment contracts parse through zod in unit tests.
- [x] ManualFetcher fixture path can drive the full pipeline with mocked dependencies.
- [x] `npm run stage -- acceptance-smoke plan --force` executed successfully with `PACKUP_STAGE_MOCK=1`.
- [x] Input page renders and `/trip/mock-trip` renders timeline + missing map-key placeholder under `npm run dev`.
- [x] Real XHS extraction: 已验证(2026-07-03,免登录裸 HTTP 主路径,见下)。
- [x] Real Amap grounding/routing: 已验证(POI 搜索/详情/路径规划真实调用)。
- [x] Two real scenarios, including pure-image note: 已验证(见下)。

## Real Acceptance — 2026-07-03(补齐,原 BLOCKED 项全部解除)

前置:高德双 key 配置、真实分享链接。获取层从 xhs-cli 切换为免登录裸 HTTP(分享链接自带 xsec_token;curl 子进程绕 TLS 指纹 soft-block)。

### Scenario 1 — 图文笔记「香港三天两晚攻略」(trip 3MOpSJ6CuR)

- 输入:1 链接 + 目的地香港 + 固定 3 天 + public/moderate
- Fetch 正文 995 字 + 6 图;Extract 42-44 POI(reason 保留原文口吻);Ground 43/43 verified;Plan 排 3 天(D1 九龙 / D2 迪士尼全天 / D3 港岛),交通衔接实测回填
- 端到端 ~14.5min(fetch 20s / extract ~3min / ground ~19s / plan 含修复循环 ~11min)
- 行程页时间轴 + 高德地图(Marker/Polyline)在真实浏览器验证正常

### Scenario 2 — 纯图笔记「香港一日游」(trip tw75BHhr0V)

- 输入:1 链接 + 目的地香港 + **天数缺省**(验证推荐天数路径)
- 笔记正文 161 字全为话题标签(实质零信息),攻略全在 8 张图内
- Extract 13 POI **全部 sourceType=image**(含避坑 tips 与住宿区建议)→ 纯图多模态提取实测成立
- Ground 12/13 verified;未验证项(落日飞车)按契约保留标注并在 warning 说明
- Plan 推荐 2 天(daysDecision 给出地理分组推理,未被标题「一日游」误导);住宿类 POI 正确排除出时间轴
- 端到端 ~11.7min

### 验收期修复(11 项,全部带测试锁定,75 单测绿)

TLS 指纹绕过 / 传输重试 / 单图容错 / json-schema 内联 / structured_output 解析 / SIGKILL 硬超时 / usage-limit 错误透出 / extract 枚举约束 / 空路线降级 / QPS 退避 / plan prompt 瘦身 + POI 预算裁剪(44→23,plan 713s→347s)。

## Quality Observations

- reason 原文口吻保留度高(「其实去拍了也没get到,挺一般」级别的原话进入行程理由)
- 排程时间语义强:日落配天星小轮并提示季节浮动;太平山顶独占夜间窗口;迪士尼自动独占全天
- 三层裁决可审计:笔记 timeHint 与地理冲突时的取舍在 warning 中说明理由

## Residuals

- `npm run stage` 不加载 `.env.local`(已记 ROADMAP Bug)
- plan 段耗时(含修复循环 8-11min)可优化:违规时只重排受影响天(已记 Backlog P2)
- 预览浏览器(WebGL 受限环境)地图空白;真实浏览器正常,非代码缺陷
