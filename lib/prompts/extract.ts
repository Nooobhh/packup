import type { Note, TripInput } from "@/lib/pipeline/types";

export function buildExtractPrompt(note: Note, input: TripInput, validationError?: string) {
  return [
    `目的地: ${input.destination}`,
    `笔记ID: ${note.id}`,
    `标题: ${note.title}`,
    "",
    "请只提取真实地点、店铺、住宿或可定位体验,不要提取泛泛建议。",
    "reason 必须尽量保留笔记原文口吻,引用推荐理由或 tips。",
    "标注 sourceType 为 text 或 image; 城市不确定时 city 留空。",
    "与目的地无关内容、异城攻略、非地点闲聊、广告不要放入 pois,逐条放入 filtered,说明无关内容原因。",
    validationError ? `上次输出未通过校验: ${validationError}` : "",
    "",
    "笔记正文:",
    note.body || "(无正文,请结合图片识别 POI)"
  ]
    .filter(Boolean)
    .join("\n");
}
