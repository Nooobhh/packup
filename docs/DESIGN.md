# packup 设计语言 · Sparkles 风

> 提取自 [sparkles.dev](https://sparkles.dev)（2026-07-16 实测）+ Claude Design `packup-ui` 项目定稿 token。
> 本文件是 packup 前端视觉的**唯一权威**：新组件一律按此实现，旧蓝色系 token（`--primary 214 78% 36%`）废弃。

## 0. 一句话

**白纸上的手绘贴纸**：大面积暖白留白 + 胖衬线标题 + 细灰边框卡片，视觉趣味全部来自「厚黑描边的涂鸦贴纸」和克制的色块，绝不使用渐变 / 玻璃拟态 / 大面积阴影。

## 1. 设计原则（从 sparkles.dev 观察）

1. **留白即布局**——版面 70% 以上是背景白，内容自然分组，不靠分割线硬切。
2. **一种衬线负责性格**——只有标题用胖衬线（Gelica；中文栈用 Georgia + Songti SC 近似），正文/UI 一律系统无衬线，反差即层级。
3. **涂鸦承载情绪**——插画是「小孩画的几何形状」：色块 + 厚黑描边（3~4px）+ 手绘抖动 + 拟人眼睛；宁拙勿巧。
4. **贴纸物理感**——重要图形做 die-cut 贴纸：图形外一圈白色裁切边 + 硬投影（offset 2~3px、零模糊或微模糊），像贴在纸上。
5. **色彩预算制**——界面 95% 是白/灰/墨，彩色只出现在：贴纸涂鸦、Day 色签、状态徽章。强调色唯一（森林绿）。
6. **边框轻、圆角大**——1px 浅灰边框 + 8~16px 圆角是卡片的全部装饰；阴影仅 hover 时轻微出现。

## 2. 色板

### 基底（中性）

| token | 值 | 用途 |
|---|---|---|
| `--paper` | `#FDFCFA` | 页面底色（暖白） |
| `--card` | `#FFFFFF` | 卡面 |
| `--ink` | `#1B1B1F` | 主文字 / 涂鸦描边 |
| `--ink-soft` | `#6E6E76` | 次级文字 |
| `--line` | `#E7E5E0` | 边框（sparkles 实测 `#ECECEC`，取暖调） |
| `--line-strong` | `#1B1B1F` | 贴纸/文件夹厚描边 |

### 强调（唯一）

| token | 值 | 用途 |
|---|---|---|
| `--accent` | `#2A6942` 森林绿 | 主按钮 / 选中态 / 链接 |
| `--accent-soft` | `#E3F4E9` mint | 徽章底 / hover 底 |
| `--accent-bright` | `#54B16C` | 涂鸦里的绿色块（sparkles 实测） |

### Day 色签（按天循环，涂鸦色块同源）

| Day | token | 值 |
|---|---|---|
| 1 | `--day-tan` | `#D9A86B` |
| 2 | `--day-blue` | `#7D95C9` |
| 3 | `--day-sage` | `#6F9B62` |
| 4 | `--day-brick` | `#C96A5B` |
| 5 | `--day-cream` | `#F4D8AE` |

> 第 6 天起循环。Day 色只用于：文件夹签条、路线线条、地图 marker/线、卡片角标——不给大面积底色。

### 状态

| token | 值 | 用途 |
|---|---|---|
| `--warn` | `#FBC2B9` coral | 「未验证」徽章底 |
| `--warn-ink` | `#8C3B2E` | 未验证文字 |

## 3. 字体

| 层级 | 栈 | 规格 |
|---|---|---|
| Display（行程名/H1） | `"Fraunces", "LXGW WenKai Screen", "Kaiti SC", Georgia, serif` | 拉丁 600~700，中文原生 400，40~60px，line-height 1.15 |
| 标题（卡片名/文件夹名） | 同上（`.font-display`） | 16~22px |
| 正文/UI | `ui-sans-serif, system-ui, -apple-system, "PingFang SC", sans-serif` | 400/500，13~16px |
| 徽章/标签 | 同正文 | 500，11~12px，微 letter-spacing |

- 拉丁 = **Fraunces**（开源软衬线，Gelica 的近亲；自托管可变字体 `public/fonts/fraunces-var.woff2`，轴 `SOFT 60 / WONK 1 / opsz 40`）。
- 中文 = **霞鹜文楷 Screen**（`lxgw-wenkai-screen-webfont` npm 包，388 片 unicode-range 按需加载），兜底系统楷体。
- `.font-display` 锁 `font-synthesis: none`：文楷仅 400，禁伪加粗保楷书笔意；Fraunces 走可变轴真加粗。
- sparkles 原站的 Gelica / Articulat CF 均为商业字体，不引入；logo 不用字体，见 §5 的 wordmark 贴纸。

## 4. 形状语言

- **圆角**：按钮/输入 `8px`；卡片 `10~14px`；大容器 `16px`；徽章/胶囊 `999px`。
- **边框**：普通卡片 `1px solid var(--line)`；贴纸元素 `3px solid var(--ink)`（厚描边）。
- **贴纸 die-cut**：`filter: drop-shadow(0 0 0 2px #fff) drop-shadow(2px 3px 0 rgba(27,27,31,.18))` 近似；PNG 素材自带白边时只加硬投影。
- **阴影**：默认无。hover/拖起 `0 6px 20px rgba(27,27,31,.10)`。文件夹/贴纸用**硬投影**（`2px 3px 0`，不模糊）强化手绘感。
- **旋转**：贴纸/卡片带 `-4°~4°` 伪随机旋转（以 id hash 决定，非随机数），营造「随手贴的」散布感；hover 转正。

## 5. 插画 / 贴图规范（生图 prompt 契约）

风格关键词（中文语境下生成一律英文 prompt）：

```
naive hand-drawn doodle, flat color blocks, thick uneven black outline (3-4px),
slightly wobbly lines, muted palette (tan #D9A86B, dusty blue #7D95C9,
sage green #6F9B62, brick red #C96A5B, cream #F4D8AE), white background or transparent,
die-cut sticker with white border, minimal, childlike, no gradient, no texture, no text
```

- 每张贴纸单主体、构图居中、透明底 PNG。
- 现有素材落 `public/stickers/`：`folder.png`（合）/ `folder-open.png`（开）/ `poi-{sight,food,shop,stay,experience,other}.png` / `logo-wordmark.png`（手绘 lettering logo，主页与画布顶栏共用，不走字体渲染）。
- 生成走 pptoken（`PPTOKEN_IMAGE_API_KEY` @ `https://api.pptoken.cc/v1`），品红底色键抠图（gpt-image-2 不吐透明底）；SVG 手绘可作等价替代，描边统一 `--ink` 3px + 圆头。

## 6. 组件规范（工作台 · 无限画布）

### 画布
- 底：`--paper` + 极淡点阵（`radial-gradient(#E7E5E0 1px, transparent 1px)`，间距 24px，随缩放）。
- 交互:空白处拖拽平移；滚轮/触板缩放（0.35~2.5x，以指针为中心）；双击空白回整体视图。
- 右上角胶囊工具组：缩放 %、重置视图、+新增 Day。

### 地点贴纸卡（PoiSticker）
- 结构：类型涂鸦贴纸（die-cut）+ 下方名称签（白底 1px 边框圆角 8px，名称 + 时长/未验证徽章）。
- 未排程（池）卡：完整体散布画布；已排程卡：缩小叠进文件夹。
- 拖拽：跟手 1:1（除以画布 scale），拖起时 scale 1.05 + 阴影，落在文件夹上归入该天。

### 日程文件夹（DayFolder）
- 视觉：manila 文件夹贴纸（厚描边 + Day 色签条「Day N + 主题」+ 硬投影）。
- 收起态：当天卡片以扇形微错位叠在文件夹上（最多露 3~4 张，多余的「+N」角标）。
- 展开态：点击后当天卡片按行程顺序弧线摊开，卡片间手绘虚线 + 交通标签（模式图标 + 分钟/公里）；再点文件夹收起。同屏只展开一个文件夹。
- drop 反馈：卡片悬于其上时文件夹微放大 + mint 底光晕。

### 地图小窗（MapDock)
- 位置：视口右下角 fixed（不随画布变换），默认 320×240。
- 包装：白底 3px `--ink` 描边 + 12px 圆角 + 硬投影，顶部小把手写「地图」（衬线）+ 展开/收起按钮；点击展开至 55vw×60vh。
- 高德样式：`amap://styles/whitesmoke`，隐默认控件；marker 用 Day 色圆点白描边，路线 Day 色 4px。
- 联动：点 marker = 选中卡片；展开某天文件夹时地图聚焦该天。

### 按钮
- 主：森林绿底白字胶囊；次：白底 1px 灰边胶囊；图标钮：32px 圆形白底灰边。均 hover 轻微上浮 1px。

## 7. 动效

- 统一 `180ms ease-out`（transform/opacity）；文件夹展开摊牌 `240ms` 逐张 `30ms` stagger。
- 画布平移缩放**不加过渡**（跟手），只有「回整体视图」用 `300ms ease-in-out`。
- 禁用：弹簧过冲、模糊转场、视差。

## 8. 反面清单（一票否决）

- 渐变底、玻璃拟态、霓虹光晕、大面积深色块
- 照片直接平铺当卡片底（照片只出现在详情抽屉，裁圆角小图）
- 超过一种强调色；Day 色用于大面积填充
- 无描边的「扁平贴纸」（贴纸必须有厚描边或白裁切边其一）
