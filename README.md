# packup
> 社媒 UGC → 结构化行程转换器，3 分钟打包好你的旅行

## 安装 / 部署
```bash
npm install
cp .env.example .env.local   # 填 AMAP_REST_KEY / NEXT_PUBLIC_AMAP_JS_KEY（高德开放平台）
npm run dev                  # http://localhost:3000
```
运行前提：本机安装并登录 `claude` CLI（LLM 环节走本机订阅，零 API 费用）。当前为自用版，不部署公网。

## 架构
五段管线，段间 zod 契约衔接，中间产物落盘（`data/trips/<id>/`）可断点续跑：

```
粘贴小红书链接 + 偏好表单
  → Fetch（免登录裸 HTTP 解析笔记，正文+图片）
  → Extract（claude -p 多模态提取 POI，纯图笔记同路）
  → Ground（高德 REST 校验真实性，查无标「未验证」）
  → Plan（三层裁决排程 + 折返/超载修复循环）
  → 行程页（按天时间轴 + 高德地图路线）
```

获取 / 地图 / LLM 三层均为接口抽象（`lib/fetchers|map|llm`），发布时换实现不动管线。

## 常用命令
| 命令 | 用途 |
|---|---|
| `npm run dev` | 本地起服务 |
| `npm test` / `npm run build` | 测试 / 构建 |
| `npm run stage -- <tripId> <stage> [--force]` | 单段重跑调质量（fetch/extract/ground/plan） |

## 历史
进度路线见 [ROADMAP.md](./ROADMAP.md)，已发布版本见 [CHANGELOG.md](./CHANGELOG.md)。
