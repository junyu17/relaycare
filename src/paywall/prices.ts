// 订阅价格 fallback（服务端/IAP 价格未就绪时展示；与 ASC 订阅披露一致）。
// 单一来源：付费墙与一致性测试均引用，禁止散落硬编码金额。
export const PLAN_FALLBACK_PRICES = {
  monthly: "$9.99",
  yearly: "$99.99"
} as const;
