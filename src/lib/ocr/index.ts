import { getOcrProvider, MockOcrProvider, DeviceOcrProvider, CloudOcrProvider } from "./providers";
import type { OcrProvider, OcrInput, OcrResult, OcrField, OcrProviderName } from "./types";

export type { OcrProvider, OcrInput, OcrResult, OcrField, OcrProviderName };
export { getOcrProvider, MockOcrProvider, DeviceOcrProvider, CloudOcrProvider };

/**
 * Current OCR provider name (module-level constant). UI uses this to decide
 * whether to show the "demo" notice (only in mock mode; device/cloud are real).
 */
export const ocrProviderName: OcrProviderName = getOcrProvider().name;
