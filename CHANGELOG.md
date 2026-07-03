# Changelog

格式: [Keep a Changelog 1.1.0](https://keepachangelog.com/zh-CN/1.1.0/)
版本号: [SemVer 2.0.0](https://semver.org/lang/zh-CN/)
写作风格: 单条目一行 ≤ 200 字符 + 视角面向消费者（详见 hazeflow/_shared/versioning.md）

## [Unreleased]
### Added
### Changed
### Fixed
### Removed

## [0.2.0] - 2026-07-03 — 小红书链接 → 结构化行程全管线
### Added
- 小红书链接 → 结构化行程全管线网页:粘 1-10 条链接 + 偏好表单(目的地/天数可浮动/每日主题/交通/节奏),生成按天时间轴 + 高德地图行程页(2dd1ba8)
- 免登录裸 HTTP 获取笔记为主路径(分享链接自带凭证,正文+图片全量),xhs-cli 作备选(e684f68)
- 排程三层裁决(客观事实 > 用户偏好 > 笔记建议)+ 折返/超载修复循环与确定性兜底 + 幻觉地点 rehydration 防线(a4a3b38)
- 管线中间产物落盘,支持断点续跑与单段重跑 npm run stage(95c25c4)
### Changed
- 排程前按行程容量预筛候选 POI(超额自动归入过滤区),把真实笔记的生成耗时压到可用区间(8d790a9)
### Fixed
- 真实小红书链接端到端验证:修复获取/提取/校验/排程各段在真实网络与地图服务下的稳定性,图文与纯图笔记均可完整生成多日行程(dd061f4)

## [0.1.0] - 2026-07-02 — initial
### Added
- initial scaffold：四件套 + git 仓库初始化
