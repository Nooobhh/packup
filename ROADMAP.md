# packup Roadmap
> 项目 overview（现在 + 未来）。已发布历史看 CHANGELOG.md，agent 指令看 CLAUDE.md。

## 当前主线
0.5.0（待发版）：LLM 换轨 pptoken gpt-5.6（三段全切、识图直连）+ 待计划池与营业信息修复

## Backlog
<!-- 待开发功能池，按优先级倒序，置顶 = 下一步。单条目 ≤ 3 行：「优先级 + 一句话描述 + 触发线索」-->
- P2 地点聚合（画布卡片 + 地图 marker 双侧）：画布现按每 POI 一张卡片、地图每 POI 一个 marker；恢复方案 = 真实距离 <500m 完全链 + 屏幕距离 <120px 下限，pipeline clusterKey 数据保留（canvas-layout.ts:itemKey/groupAdjacent、map-dock.tsx:clusterMapPoints 有注释起来的备用实现）。触发：卡片/marker 密度反噬体验时
- P2 导出长图：行程导出竖版分享图（竞品仅朴素文字单，我方有地图/图片/笔记素材可超车）。触发：画布稳定后
- P2 UI 美化阶段：工作台视觉正式化（POI 卡片配图/marker 按天着色/焦点按钮选中态/布局精修），对标圆周旅迹。触发：0.4.0 发版后
- P1 地图 SDK 加载失败韧性：失败文案与 key 缺失区分 + script 竞态清理重试。触发：day-map SDK 失败场景
- P2 生成期兜底裁剪路线预算收窄到段级：fallbackPlan 每裁一点仍整天重算，目标只重算被裁点前后两段。触发：高德免费额度告警
- P3 工作台小项清理：重复入池去重、断网时乐观状态回滚、组内单卡编辑语义、warnings 去重、拖拽映射分组副本收编进 plan-edit、day-timeline 存留清理。触发：下次动工作台代码
- P3 无笔记智能规划：城市+天数+偏好直接生成（LLM 候选+ground 幻觉过滤），复用选点/画布链路。触发：0.4.0 用稳后
- P3 协作与分享：账号+云端存储+只读链接/共同编辑（依赖部署与 LLM 上云决策）。触发：多用户需求明确
- P3 卡片照片上传（5张/卡）与旅行相册：存本地 data/trips，详情与导出可用。触发：导出长图之后
- P2 获取韧性：单图下载失败不废整篇笔记（per-image 容错）。触发：真实批量使用
- P3 超时请求真实取消：段超时目前只放弃等待，在途请求仍占用并发通道与本机进程。触发：网络差场景变慢
- P3 生成侧小项清理：选点页过滤计数重复、含「行程」等词的输入被迫走慢解析、单次地图请求无显式超时、死代码与未引用样例文件。触发：下次动生成侧代码时
- P3 清理未使用的 shadcn 存根组件与依赖。触发：UI 正式化时
- P3 高德 MCP 模式排程试验（claude -p --mcp-config）。触发：REST 矩阵方案遇质量瓶颈

## Bug
<!-- 已知 bug：「一句话描述 + 复现条件」-->
- `npm run stage` 不加载 .env.local,报 AMAP_REST_KEY is required。复现:配好 .env.local 后直接跑 stage CLI
- 工作台 dnd-kit SSR hydration 告警（aria-describedby 的 DndDescribedBy id 服务端/客户端不一致），仅 dev overlay 噪音不影响功能。复现:dev 模式打开 /trip/<id>

## 长期目标
<!-- 项目愿景，bullet 形式 -->
