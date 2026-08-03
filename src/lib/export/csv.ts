// 报表导出纯模块（R4，IOS_SUBMISSION_DEV_SPEC）：CSV 序列化 + 公式注入防护。
// 防护：以 = + - @ 开头的单元格值前置单引号（OLE 公式注入，防导出后在 Excel/Sheets 执行恶意公式）。
// 导出文件只走系统分享面板（C4：禁止上传第三方）。

export function escapeCsvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(text)) {
    text = `'${text}`;
  }
  if (/[",\n\r]/.test(text)) {
    text = `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [header, ...rows].map((row) => row.map(escapeCsvCell).join(","));
  return lines.join("\r\n");
}

export interface ReportExportRow {
  date: string;
  title: string;
  status: string;
  assignee: string;
  priority: string;
}

export function tasksToCsv(tasks: ReportExportRow[]): string {
  return toCsv(
    ["Date", "Title", "Status", "Assignee", "Priority"],
    tasks.map((t) => [t.date, t.title, t.status, t.assignee, t.priority])
  );
}
