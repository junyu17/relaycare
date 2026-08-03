import { describe, expect, it } from "vitest";
import { escapeCsvCell, tasksToCsv, toCsv } from "../lib/export/csv";

describe("R4 report export CSV (IOS_SUBMISSION_DEV_SPEC)", () => {
  it("prefixes formula-injection cells (= + - @) with a single quote", () => {
    expect(escapeCsvCell("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
    expect(escapeCsvCell("+cmd|'/C calc'!A0")).toBe("'+cmd|'/C calc'!A0");
    expect(escapeCsvCell("-2+3")).toBe("'-2+3");
    expect(escapeCsvCell("@SUM(1,2)")).toBe('"\'@SUM(1,2)"');
  });

  it("quotes cells containing comma, quote or newline", () => {
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("does not alter safe values", () => {
    expect(escapeCsvCell("Normal task")).toBe("Normal task");
    expect(escapeCsvCell(42)).toBe("42");
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell("2+3")).toBe("2+3"); // 非行首符号不转义
  });

  it("serializes rows with CRLF and header", () => {
    const csv = tasksToCsv([
      { date: "2026-08-03", title: "Med refill", status: "done", assignee: "Alice", priority: "normal" }
    ]);
    expect(csv).toContain("Date,Title,Status,Assignee,Priority");
    expect(csv).toContain("2026-08-03,Med refill,done,Alice,normal");
    expect(csv).toMatch(/\r\n/);
  });

  it("full injection payload is neutralized in output", () => {
    const csv = toCsv(["Title"], [['=HYPERLINK("http://evil","click")']]);
    // 公式被 ' 前缀中和（值以 "'=HYPERLINK 开头），行首不再出现裸 =HYPERLINK
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toMatch(/\r\n=HYPERLINK/);
  });
});

it("prefixes tab/carriage-return formula cells too", () => {
  expect(escapeCsvCell("\t=SUM(A1)")).toBe("'\t=SUM(A1)");
  expect(escapeCsvCell("\r=1+1")).toBe("'\r=1+1");
});
