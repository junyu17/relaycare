// App Store 归因：所有指向 App Store 的链接都从这里生成，不要在别处手写字面量。
// pt 是开发者的 provider token，缺了它 Apple 会忽略 ct（campaign）。
const PROVIDER_TOKEN = "129087449";

export const APP_IDS = {
  taskkin: "6794837934",
  startkind: "6799113108",
  maren: "6795029983",
  platepace: "6799087226",
  livepet: "6794836674",
  vpets: "6784545568",
  dogcat: "6800743305"
} as const;

export type AppSlug = keyof typeof APP_IDS;

const OWN_SLUG: AppSlug = "taskkin";

function campaignLink(appId: string, campaign: string): string {
  // ct 最长 40 个字符
  return `https://apps.apple.com/app/apple-store/id${appId}?pt=${PROVIDER_TOKEN}&ct=${campaign.slice(0, 40)}&mt=8`;
}

/** 本 App 内容被分享出去时的链接：share_app / share_invite / share_pdf 等。 */
export function shareLink(artefact: "app" | "invite" | "pdf" | "clip" | "card"): string {
  return campaignLink(APP_IDS[OWN_SLUG], `share_${artefact}`);
}

/** 交叉推广：从本 App 指向同门兄弟 App。 */
export function crossPromoLink(target: AppSlug): string {
  return campaignLink(APP_IDS[target], `xp_${OWN_SLUG}`);
}

/** 直接打开"写评价"页（不受系统每年 3 次评分弹窗上限的限制）。 */
export function writeReviewLink(): string {
  return `https://apps.apple.com/app/id${APP_IDS[OWN_SLUG]}?action=write-review`;
}
