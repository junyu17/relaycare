import type { OcrField } from "./types";

// ============ 候选字段启发式提取（三语 EN/中文/ES） ============
// OCR 库只返回纯文本 + bounding box，不懂"药物/日期/随访"。
// 这里用正则 + 关键词从文本里识别候选字段，供 UI 人工确认。

const DATE_PATTERNS = [
  /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g,
  /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,?\s*\d{4})?\b/gi,
  /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g,
  /\d{4}年\d{1,2}月\d{1,2}日/g
];

const MEDICATION_KEYWORDS = /\b(mg|ml|tablet|capsule|take|dose|medication|prescription)\b|毫克|片|胶囊|服用|药物|处方/i;
const FOLLOWUP_KEYWORDS = /\b(follow-?up|appointment|referral|visit|clinic|discharge)\b|复诊|随访|预约|就诊|出院/i;

function firstMatchingLine(text: string, pattern: RegExp): string | undefined {
  const line = text.split("\n").find((l) => pattern.test(l));
  return line?.trim().slice(0, 80);
}

export function extractCandidateFields(text: string): OcrField[] {
  const fields: OcrField[] = [];

  for (const pattern of DATE_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      for (const value of matches.slice(0, 3)) {
        fields.push({ label: "date", value, confidence: 0.8 });
      }
    }
  }

  if (MEDICATION_KEYWORDS.test(text)) {
    const value = firstMatchingLine(text, MEDICATION_KEYWORDS);
    if (value) fields.push({ label: "medication", value, confidence: 0.7 });
  }

  if (FOLLOWUP_KEYWORDS.test(text)) {
    const value = firstMatchingLine(text, FOLLOWUP_KEYWORDS);
    if (value) fields.push({ label: "followup", value, confidence: 0.7 });
  }

  return fields;
}

// ============ 置信度计算 ============
// iOS: 元素有真实 confidence（0-1），取均值。
// Android: ML Kit 不给 confidence（恒 1.0），用启发式（字段匹配 + 文本长度）。
interface RecognizedLike {
  pages?: { elements: { confidence: number }[] }[];
  fullText?: string;
}

export function computeConfidence(result: RecognizedLike, fields: OcrField[]): number {
  const allConf = result.pages?.flatMap((p) => p.elements.map((e) => e.confidence)) ?? [];
  const hasRealConfidence = allConf.length > 0 && allConf.some((c) => c > 0 && c < 1.0);

  if (hasRealConfidence) {
    const avg = allConf.reduce((a, b) => a + b, 0) / allConf.length;
    return Math.round(Math.min(0.95, avg) * 100) / 100;
  }

  // Android 启发式：基础 + 字段奖励 + 文本量
  let c = 0.6;
  c += Math.min(0.2, fields.length * 0.07);
  c += Math.min(0.15, (result.fullText ?? "").length / 1000);
  return Math.round(Math.min(0.9, c) * 100) / 100;
}

// ============ 建议行动（候选字段 -> 候选行动文案） ============
// 存入 documents.suggested_action；UI 显示。英文固定串（与 sample 文档现状一致；
// 三语优化为后续增强）。
export function deriveSuggestedAction(fields: OcrField[]): string | undefined {
  if (fields.length === 0) return undefined;
  if (fields.some((f) => f.label === "followup")) return "Confirm follow-up appointment details";
  if (fields.some((f) => f.label === "date")) return "Confirm appointment date and required documents";
  if (fields.some((f) => f.label === "medication")) return "Review medication instructions";
  return "Review extracted candidate fields";
}
