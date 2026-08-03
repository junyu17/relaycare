import { describe, expect, it } from "vitest";
import { translations, type Language } from "../i18n";

const LANGS: Language[] = ["en", "zh", "es"];

// 与 src/types.ts 的 AuditAction 联合类型保持同步（TS 类型无法运行时遍历，
// 故维护数组；新增 action 时必须同步两处）。
const AUDIT_ACTIONS = [
  "household.created",
  "household.dissolved",
  "member.invited",
  "member.joined",
  "member.removed",
  "member.left",
  "member.role_updated",
  "task.created",
  "task.claimed",
  "task.rejected",
  "task.handoff_requested",
  "task.completed",
  "task.deleted",
  "timeline.event_added",
  "timeline.event_deleted",
  "notification.preference_updated",
  "document.uploaded",
  "document.confirmed",
  "document.task_created",
  "member.name_updated",
  "report.generated",
  "report.exported"
] as const;

describe("i18n completeness (R2, IOS_SUBMISSION_DEV_SPEC 2026-08-03)", () => {
  it("every AuditAction has a non-empty title key in all three languages", () => {
    for (const action of AUDIT_ACTIONS) {
      for (const lang of LANGS) {
        const key = `audit.${action}`;
        const value = translations[lang][key];
        expect(value, `${lang} missing audit.${action}`).toBeTruthy();
        expect(value!.trim().length, `${lang} audit.${action} is empty`).toBeGreaterThan(0);
      }
    }
  });

  it("deleted/name-updated detail templates never reference {title}", () => {
    for (const lang of LANGS) {
      expect(translations[lang]["audit.detail.task.deleted"]).not.toContain("{title}");
      expect(translations[lang]["audit.detail.timeline.event_deleted"]).not.toContain("{title}");
      expect(translations[lang]["audit.detail.member.name_updated"]).not.toContain("{title}");
    }
  });

  it("all three dictionaries have identical key sets", () => {
    const keys = (lang: Language) => Object.keys(translations[lang]).sort();
    const en = keys("en");
    expect(keys("zh")).toEqual(en);
    expect(keys("es")).toEqual(en);
  });

  it("no value equals its own key (untranslated placeholder leak)", () => {
    for (const lang of LANGS) {
      for (const [key, value] of Object.entries(translations[lang])) {
        expect(value, `${lang}:${key} equals its key`).not.toBe(key);
      }
    }
  });

  it("detail keys exist for the new audit actions", () => {
    for (const lang of LANGS) {
      expect(translations[lang]["audit.detail.task.deleted"]).toBeTruthy();
      expect(translations[lang]["audit.detail.timeline.event_deleted"]).toBeTruthy();
      expect(translations[lang]["audit.detail.member.name_updated"]).toBeTruthy();
    }
  });
});
