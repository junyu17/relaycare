// OCR provider abstraction.
//
// 试点期（决策 1B，2026-07-24）使用 MockOcrProvider 返回演示置信度，
// UI 已标注 "(demo)"。试点后切换 DeviceOcrProvider（on-device）；
// 复杂文档兜底用 CloudOcrProvider（需 BAA）。调用方（actions.addDocument）
// 只依赖 OcrProvider 接口，切换实现只需改 EXPO_PUBLIC_OCR_MODE，不改调用方。

export type OcrProviderName = "mock" | "device" | "cloud";

export interface OcrField {
  label: string;
  value: string;
  confidence: number; // 0-1
  sourceRect?: { x: number; y: number; width: number; height: number };
}

export interface OcrInput {
  /** 本地文件 URI（on-device provider 用，如 "file://.../doc.pdf"） */
  fileUri?: string;
  /** 文件二进制（cloud provider 上传用） */
  fileBody?: Blob;
  fileName: string;
  source: "manual_upload" | "sample";
}

export interface OcrResult {
  /** 整体置信度 0-1，写入 documents.confidence */
  confidence: number;
  /** 候选行动建议，写入 documents.suggested_action */
  suggestedAction?: string;
  /** 结构化候选字段（未来 device/cloud provider 返回） */
  fields?: OcrField[];
  /** 原始文本（调试/审计用） */
  rawText?: string;
  provider: OcrProviderName;
}

export interface OcrProvider {
  readonly name: OcrProviderName;
  extract(input: OcrInput): Promise<OcrResult>;
}
