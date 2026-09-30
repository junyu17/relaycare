import { describe, expect, it } from "vitest";
import { crossPromoLink, shareLink, writeReviewLink } from "../lib/attribution";
import { buildReportHtml } from "../lib/export/pdf";

describe("App Store attribution links", () => {
  it("builds campaign links with the provider token", () => {
    expect(shareLink("invite")).toBe(
      "https://apps.apple.com/app/apple-store/id6794837934?pt=129087449&ct=share_invite&mt=8"
    );
    expect(crossPromoLink("startkind")).toBe(
      "https://apps.apple.com/app/apple-store/id6799113108?pt=129087449&ct=xp_taskkin&mt=8"
    );
  });

  it("points the review link at this app", () => {
    expect(writeReviewLink()).toBe("https://apps.apple.com/app/id6794837934?action=write-review");
  });

  it("adds an escaped footer to the PDF html only when given one", () => {
    const withFooter = buildReportHtml("H", "W", [], "T", "Made with TaskKin - https://x?a=1&b=2");
    expect(withFooter).toContain("Made with TaskKin - https://x?a=1&amp;b=2");
    expect(buildReportHtml("H", "W", [], "T")).not.toContain('footer">');
  });
});
