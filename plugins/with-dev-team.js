// 持久化设置 iOS Development Team + Automatic Signing。
// 真机构建需要 Development Team；模拟器不用签名所以能过。
// 通过 config plugin 在 prebuild 时写入 pbxproj，避免每次重新 prebuild 后丢失。
const { withXcodeProject } = require("@expo/config-plugins");

module.exports = function withDevelopmentTeam(config, props) {
  const teamId = props?.teamId;
  if (!teamId) return config;
  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    const sections = project.hash.project.objects.XCBuildConfiguration;
    for (const key of Object.keys(sections)) {
      const section = sections[key];
      const settings = section.buildSettings || (section.buildSettings = {});
      const bundleId = settings.PRODUCT_BUNDLE_IDENTIFIER;
      // 仅改 app target（含 cd.cc.relaycare），不动 Pods target。
      if (bundleId && String(bundleId).includes("cd.cc.relaycare")) {
        settings.DEVELOPMENT_TEAM = teamId;
        settings.CODE_SIGN_STYLE = "Automatic";
        // 清掉可能残留的硬编码 profile，交给自动签名。
        delete settings.PROVISIONING_PROFILE;
        delete settings["PROVISIONING_PROFILE_SPECIFIER"];
      }
    }
    return config;
  });
};
