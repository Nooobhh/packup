import type { Note, TripInput } from "@/lib/pipeline/types";

export function buildExtractPrompt(note: Note, input: TripInput, validationError?: string) {
  return [
    `目的地: ${input.destination}`,
    `笔记ID: ${note.id}`,
    `标题: ${note.title}`,
    "",
    "请只提取真实地点、店铺、住宿或可定位体验,不要提取泛泛建议。",
    "每个 POI 必须含字段: name(地点名) / type / reason / sourceType,缺一不可。",
    "type 只能取以下英文枚举之一: sight(景点) / food(餐饮) / shop(购物) / stay(住宿) / experience(体验) / other(其他)。不要用中文或其他值。",
    "reason 必须尽量保留笔记原文口吻,引用推荐理由或 tips。",
    "sourceType 取 text 或 image(该 POI 信息主要来自正文还是图片); 城市不确定时 city 留空。",
    "filtered 每条含 name 与 why(被过滤原因)。与目的地无关内容、异城攻略、非地点闲聊、广告放入 filtered。",
    validationError ? `上次输出未通过校验: ${validationError}` : "",
    "",
    "笔记正文:",
    note.body || "(无正文,请结合图片识别 POI)"
  ]
    .filter(Boolean)
    .join("\n");
}
