import type { OcrInput, OcrResult, OcrProvider, OcrProviderName } from "./types";

// ============ Mock（试点期，演示置信度） ============
// 返回固定演示值，保持当前 UI 行为不变。UI 已标注 "(demo)"。
export class MockOcrProvider implements OcrProvider {
  readonly name = "mock" as const;
  async extract(input: OcrInput): Promise<OcrResult> {
    return {
      confidence: input.source === "manual_upload" ? 0.7 : 0.72,
      provider: "mock"
    };
  }
}

// ============ On-device（试点后，方案 A 主力） ============
// 推荐库：@zhanziyang/expo-text-extractor（Apple Vision + Google ML Kit，支持中文/日文/韩文）。
// 数据不离开设备 -> 无 PHI 合规风险、无需 BAA、离线可用（符合立项 §5.3 与韧性要求）。
// 实现要点：
//   1. textExtractor.recognize({ uri: input.fileUri }) -> 文本块 + bounding box
//   2. 启发式识别候选字段（药物名、预约日期、随访要求）+ 按文本块密度算字段置信度
//   3. 返回 OcrResult { confidence, suggestedAction, fields, rawText }
export class DeviceOcrProvider implements OcrProvider {
  readonly name = "device" as const;
  async extract(_input: OcrInput): Promise<OcrResult> {
    throw new Error(
      "DeviceOcrProvider not implemented yet (decision 1B: post-pilot). " +
        "Wire @zhanziyang/expo-text-extractor here and set EXPO_PUBLIC_OCR_MODE=device."
    );
  }
}

// ============ Cloud（兜底，复杂文档） ============
// 推荐：AWS Textract AnalyzeDocument（Forms/Tables）或 Google Document AI。
// 合规前置：必须签 BAA 才能处理含 PHI 文档；MVP 非 PHI 路径也建议带 BAA 以防边界。
// 架构要点：走 Supabase Edge Function 调用（避免 anon key 泄露 + 服务端签名请求），
//   文件已上传至 Supabase Storage，Edge Function 用 storage_path 取文件 -> 调云端 OCR ->
//   返回结构化字段 + 置信度。
export class CloudOcrProvider implements OcrProvider {
  readonly name = "cloud" as const;
  async extract(_input: OcrInput): Promise<OcrResult> {
    throw new Error(
      "CloudOcrProvider not implemented yet. Requires BAA + Supabase Edge Function. " +
        "Set EXPO_PUBLIC_OCR_MODE=cloud after legal sign-off."
    );
  }
}

// ============ 工厂 ============
// 环境变量 EXPO_PUBLIC_OCR_MODE 控制：
//   mock（默认/试点期）| device（试点后，on-device）| cloud（兜底，需 BAA）
export function getOcrProvider(): OcrProvider {
  const mode = (process.env.EXPO_PUBLIC_OCR_MODE ?? "mock") as OcrProviderName;
  switch (mode) {
    case "device":
      return new DeviceOcrProvider();
    case "cloud":
      return new CloudOcrProvider();
    case "mock":
    default:
      return new MockOcrProvider();
  }
}
