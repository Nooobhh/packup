# SPIKE-NOTES

## Spike A — xhs-cli

BLOCKED-BY-INPUT: data/spike/links.txt 不存在,真实小红书提取实测延后。

## Spike B — unauthenticated HTTP SSR path

本机 2026-07-02 使用真实分享链接验证:

- 分享短链 `http://xhslink.com/o/<code>` 跟随重定向后落地 `https://www.xiaohongshu.com/discovery/item/<noteId>?...&xsec_token=<token>&...`,分享链接自带 `xsec_token` 访问凭证。
- 未登录、仅带桌面 Chrome User-Agent 的 GET 返回 HTTP 200 完整 SSR 页面,约 860KB。
- 笔记数据位于 `window.__INITIAL_STATE__ = {...}`;状态文本中可能含 `undefined` 字面量,解析前需转为 `null`,并以 `</script>` 截断。
- 数据路径为 `state.note.noteDetailMap[<noteId>].note`,包含 `title`、`desc`、`type`、`imageList[].urlDefault`、`tagList[].name`。
- 图片 CDN `sns-webpic-qc.xhscdn.com` 未发现 referer 防盗链,可直接 GET 下载。

实现结论:`XhsHttpFetcher` 作为默认获取路径;`PACKUP_FETCHER=cli` 可切回 `XhsCliFetcher` 备选路径。
