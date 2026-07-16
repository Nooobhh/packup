# packup
> 社媒 UGC → 结构化行程转换器，3 分钟打包好你的旅行

## 安装 / 部署
```bash
npm install
cp .env.example .env.local   # 填 AMAP_REST_KEY / NEXT_PUBLIC_AMAP_JS_KEY（高德开放平台）
npm run dev                  # http://localhost:3000
```
运行前提：配 `PACKUP_PPTOKEN_API_KEY`（parse-query / extract / plan 三段走 pptoken 中转站调 gpt-5.6，OpenAI 兼容 API）。DeepSeek / 本机 `claude` CLI 为备用 provider，默认不需要。当前为自用版，不部署公网。

## 架构
两段式管线，段间 zod 契约衔接，中间产物落盘（`data/trips/<id>/`）可断点续跑：

```
一句话需求（「香港3天2晚 city walk+美食」）+ 小红书链接
  → 解析目的地/天数/偏好（规则先行，LLM 兜底）
  → Fetch（免登录裸 HTTP 解析笔记，正文+图片）
  → Extract（gpt-5.6 多模态提取 POI，纯图笔记同路）
  → Ground（高德 REST 校验真实性，查无标「未验证」）
  → 【选点确认页】勾选要排入行程的 POI（已验证默认勾选，落选自动进待计划池）
  → Plan（一次 LLM 分天 + 算法排序 + 确定性兜底，邻近点聚合）
  → 画布工作台（左待计划池 | 中按天泳道 | 右多天地图，编辑只重算受影响交通段）
```

行程页即编辑工作台：卡片拖拽编排（池↔天/跨天/天内，相邻组为最小单位）、一键智能排程（就近优化后可再手调）、增删天/天主题、卡片备注与时段、交通四方式（步行/骑行/驾车/公交）段级切换 + 全局长短途两档偏好、高德 POI 搜索加点、地点详情带来源笔记原文引用；不导入笔记也可「手动从零」建空行程。结构编辑核心为前后端共享纯函数（`lib/pipeline/plan-edit.ts`），编辑走 PATCH op 集 + 乐观并发（409 冲突自动刷新）。

获取 / 地图 / LLM 三层均为接口抽象（`lib/fetchers|map|llm`），发布时换实现不动管线。全管线时间预算集中在 `lib/pipeline/budgets.ts`（机器耗时正常路径 ≤300 秒），各段超时走「部分成功」而非中断。

## 常用命令
| 命令 | 用途 |
|---|---|
| `npm run dev` | 本地起服务 |
| `npm test` / `npm run build` | 测试 / 构建 |
| `npm run stage -- <tripId> <stage> [--force]` | 单段重跑调质量（fetch/extract/ground/plan） |

## 历史
进度路线见 [ROADMAP.md](./ROADMAP.md)，已发布版本见 [CHANGELOG.md](./CHANGELOG.md)。
