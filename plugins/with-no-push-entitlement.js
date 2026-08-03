// R9（IOS_SUBMISSION_DEV_SPEC / R3 B9）：移除 aps-environment entitlement。
// 推送 entitlement 由分发签名（App Store / EAS）按环境注入；本地 CNG 工程不应写死
// development（AC9-1）。若未来需要开发推送，用 EAS env 单独配置。
const { withEntitlementsPlist } = require("@expo/config-plugins");

module.exports = function withNoPushEntitlement(config) {
  return withEntitlementsPlist(config, (cfg) => {
    delete cfg.modResults["aps-environment"];
    return cfg;
  });
};
