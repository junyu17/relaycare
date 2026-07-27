import { recognizeText } from "@dariyd/react-native-text-recognition";
import { extractCandidateFields, computeConfidence, deriveSuggestedAction } from "./heuristics";
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

// ============ On-device（已实施，方案 A 主力） ============
// 用 @dariyd/react-native-text-recognition（iOS Apple Vision + Android Google ML Kit；
// 支持 image + PDF + 100+ 语言含中文）。数据不离开设备 -> 无 PHI 合规风险、无需 BAA、
// 离线可用（符合立项 §5.3 与韧性要求）。需 prebuild/EAS Build（原生模块，Expo Go 不可用）。
// 候选字段 + 置信度由 heuristics.ts 启发式生成（OCR 库只返回纯文本 + bounding box）。
export class DeviceOcrProvider implements OcrProvider {
  readonly name = "device" as const;
  async extract(input: OcrInput): Promise<OcrResult> {
    if (!input.fileUri) {
      // sample 无文件（演示按钮），回退演示值
      return { confidence: 0.72, provider: "device" };
    }
    const result = await recognizeText(input.fileUri, {
      languages: ["en", "zh", "es"],
      recognitionLevel: "line",
      maxPages: 5
    });
    if (!result.success || !result.fullText) {
      return { confidence: 0.3, provider: "device", rawText: result.errorMessage ?? "" };
    }
    const fields = extractCandidateFields(result.fullText);
    const confidence = computeConfidence(result, fields);
    const suggestedAction = deriveSuggestedAction(fields);
    return {
      confidence,
      suggestedAction,
      fields,
      rawText: result.fullText,
      provider: "device"
    };
  }
}

// ============ Cloud（兜底，复杂文档） ============
// 推荐：AWS Textract AnalyzeDocument（Forms/Tables）或 Google Document AI。
// 合规前置：必须签 BAA 才能处理含 PHI 文档；非 PHI 路径也建议带 BAA 以防边界。
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
//   device（默认/生产）| mock（Expo Go 开发期回退，无原生模块时用）| cloud（兜底，需 BAA）
// 生产构建（.env / .env.example）显式设为 device；未设置时默认 device，
// 保证上架包真正走 on-device 识别（Apple Vision + Google ML Kit），不回退演示值。
// 仅 Expo Go 开发（无原生模块）需显式设 EXPO_PUBLIC_OCR_MODE=mock。
export function getOcrProvider(): OcrProvider {
  const mode = (process.env.EXPO_PUBLIC_OCR_MODE ?? "device") as OcrProviderName;
  switch (mode) {
    case "mock":
      return new MockOcrProvider();
    case "cloud":
      return new CloudOcrProvider();
    case "device":
    default:
      return new DeviceOcrProvider();
  }
}
