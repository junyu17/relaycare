// R4/B2（IOS_SUBMISSION_REVIEW_R2）：PDF 导出——HTML 模板（纯模块）+ expo-print 打印到文件。
// 内容仅为本家庭已授权数据（C4：不上传第三方）。

export interface PdfReportSection {
  title: string;
  lines: string[];
}

export function buildReportHtml(
  householdName: string,
  weekLabel: string,
  sections: PdfReportSection[],
  reportTitle = "Weekly report" // 本地化标题由调用方传入（R3 MEDIUM：避免硬编码英文）
): string {
  const esc = (v: string) =>
    v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const body = sections
    .map((s) => `<h2>${esc(s.title)}</h2><ul>${s.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`)
    .join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { font-family: -apple-system, "PingFang SC", sans-serif; margin: 24px; color: #1e293b; }
    h1 { font-size: 20px; } h2 { font-size: 15px; margin-top: 18px; color: #0f766e; }
    li { margin: 4px 0; font-size: 13px; } .muted { color: #64748b; font-size: 12px; }
  </style></head><body>
    <h1>${esc(householdName)} — ${esc(reportTitle)}</h1>
    <p class="muted">${esc(weekLabel)}</p>
    ${body}
  </body></html>`;
}
