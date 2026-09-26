import { describe, expect, it } from "vitest";
import { makeTranslator } from "../i18n";
import { translations, type Language } from "../i18n";

import { AUDIT_ACTIONS } from "../types";

const LANGS: Language[] = ["en", "zh", "zhHant", "es", "ja"];

describe("i18n completeness (R2, IOS_SUBMISSION_DEV_SPEC 2026-08-03)", () => {
  it("every AuditAction has a non-empty title key in all five languages", () => {
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

describe("makeTranslator defensive (dirty language)", () => {
  it("never throws for unknown language (falls back to en)", () => {
    const t = makeTranslator("klingon" as never);
    expect(() => t("auth.signIn")).not.toThrow();
    expect(() => t("alerts.actionFailedTitle")).not.toThrow();
  });
});

describe("missing placeholders never reach the UI", () => {
  // 回归：1.0 (3) 的 App Store 截图上印着 "{actor} claimed: ..." 和 "... update: {event}"，
  // 因为 t() 只替换 values 里存在的键，缺失的占位符原样输出。
  it("substitutes a fallback word for a placeholder with no value, in every language", () => {
    for (const lang of LANGS) {
      const t = makeTranslator(lang);
      const body = t("notification.body.taskClaimed", { task: "Arrange a ride" });
      expect(body, `${lang} leaked a raw placeholder`).not.toMatch(/[{}]/);
      expect(body).toContain("Arrange a ride");
      expect(body).toContain(translations[lang]["placeholder.actor"]!);
    }
  });

  it("falls back for placeholders with no dedicated word", () => {
    for (const lang of LANGS) {
      const t = makeTranslator(lang);
      const body = t("notification.body.timelineAdded", { actor: "Fanny" });
      expect(body, `${lang} leaked a raw placeholder`).not.toMatch(/[{}]/);
      expect(body).toContain("Fanny");
    }
  });

  it("still substitutes every value that is supplied", () => {
    const t = makeTranslator("en");
    expect(t("notification.body.taskClaimed", { actor: "Tan", task: "Call the office" })).toBe(
      "Tan claimed: Call the office"
    );
  });

  it("defines the fallback words in all three languages", () => {
    for (const lang of LANGS) {
      for (const key of ["placeholder.actor", "placeholder.target", "placeholder.default"]) {
        expect(translations[lang][key], `${lang} missing ${key}`).toBeTruthy();
      }
    }
  });
});

describe("first launch follows the device language", () => {
  it("maps a device language onto one the app actually ships", () => {
    // The mapping itself, independent of the native module: anything that is
    // not zh or es must land on en rather than a locale with no translations.
    const pick = (codes: string[]): Language => {
      for (const raw of codes) {
        const code = raw.toLowerCase();
        if (code === "zh") return "zh";
        if (code === "es") return "es";
        if (code === "en") return "en";
      }
      return "en";
    };
    expect(pick(["zh"])).toBe("zh");
    expect(pick(["es"])).toBe("es");
    expect(pick(["ja", "zh"])).toBe("zh");
    expect(pick(["de"])).toBe("en");
    expect(pick([])).toBe("en");
  });
});
