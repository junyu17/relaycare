// 持久化两个本地 Xcode 构建必需项：
// 1) Development Team + Automatic Signing（真机签名；模拟器不需要）。
// 2) .xcode.env.local 指向 node 绝对路径（Xcode 构建阶段 shell 用最小 PATH，
//    找不到 node -> "Bundle React Native code" 阶段 NODE_BINARY 为空 -> JS bundle
//    不打包 -> 真机红屏 "找不到 js bundle"）。
const { withXcodeProject } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const DSYM_PHASE_NAME = "[RelayCare] Include missing dSYMs";
const DSYM_OUTPUT_PATHS = [
  '"$(DWARF_DSYM_FOLDER_PATH)/ExpoCameraBarcodeScanning.framework.dSYM"',
  '"$(DWARF_DSYM_FOLDER_PATH)/React.framework.dSYM"',
  '"$(DWARF_DSYM_FOLDER_PATH)/ReactNativeDependencies.framework.dSYM"',
  '"$(DWARF_DSYM_FOLDER_PATH)/hermesvm.framework.dSYM"'
];
const DSYM_PHASE_SCRIPT = `set -e

if [ "\${EFFECTIVE_PLATFORM_NAME:-}" != "-iphoneos" ]; then
  exit 0
fi

DSYM_DIR="\${DWARF_DSYM_FOLDER_PATH:-}"
APP_FRAMEWORKS_DIR="\${TARGET_BUILD_DIR:-}/\${FRAMEWORKS_FOLDER_PATH:-Frameworks}"

if [ -z "$DSYM_DIR" ]; then
  exit 0
fi

mkdir -p "$DSYM_DIR"

copy_dsym() {
  local name="$1"
  local source="$2"
  local destination="$DSYM_DIR/$name.framework.dSYM"

  if [ -d "$source" ] && [ ! -d "$destination" ]; then
    echo "Copying dSYM for $name"
    ditto "$source" "$destination"
  fi
}

generate_dsym() {
  local name="$1"
  shift
  local destination="$DSYM_DIR/$name.framework.dSYM"
  local binary=""

  if [ -d "$destination" ]; then
    return
  fi

  for candidate in "$@"; do
    if [ -f "$candidate" ]; then
      binary="$candidate"
      break
    fi
  done

  if [ -n "$binary" ]; then
    echo "Generating dSYM for $name"
    if ! xcrun dsymutil "$binary" -o "$destination" >/dev/null 2>&1; then
      echo "warning: Could not generate dSYM for $name"
    fi
  fi
}

copy_dsym "ExpoCameraBarcodeScanning" "$PODS_ROOT/ExpoCameraBarcodeScanning/ExpoCameraBarcodeScanning.xcframework/ios-arm64/dSYMs/ExpoCameraBarcodeScanning.framework.dSYM"
generate_dsym "React" \\
  "$APP_FRAMEWORKS_DIR/React.framework/React" \\
  "$PODS_XCFRAMEWORKS_BUILD_DIR/React-Core-prebuilt/React.framework/React" \\
  "$PODS_ROOT/React-Core-prebuilt/React.xcframework/ios-arm64/React.framework/React"
generate_dsym "ReactNativeDependencies" \\
  "$APP_FRAMEWORKS_DIR/ReactNativeDependencies.framework/ReactNativeDependencies" \\
  "$PODS_XCFRAMEWORKS_BUILD_DIR/ReactNativeDependencies/ReactNativeDependencies.framework/ReactNativeDependencies" \\
  "$PODS_ROOT/ReactNativeDependencies/framework/packages/react-native/ReactNativeDependencies.xcframework/ios-arm64/ReactNativeDependencies.framework/ReactNativeDependencies"
generate_dsym "hermesvm" \\
  "$APP_FRAMEWORKS_DIR/hermesvm.framework/hermesvm" \\
  "$PODS_XCFRAMEWORKS_BUILD_DIR/hermes-engine/Pre-built/hermesvm.framework/hermesvm" \\
  "$PODS_ROOT/hermes-engine/destroot/Library/Frameworks/universal/hermesvm.xcframework/ios-arm64/hermesvm.framework/hermesvm"
`;

function unquote(value) {
  return String(value || "").replace(/^"|"$/g, "");
}

function encodeShellScriptForPbx(script) {
  return script.replace(/\n/g, "\\n");
}

function ensureDsymBuildPhase(project, targetName) {
  const targetUuid = (targetName && project.findTargetKey(targetName)) || project.getFirstTarget().uuid;
  const target = project.hash.project.objects.PBXNativeTarget[targetUuid];
  const shellPhases = project.hash.project.objects.PBXShellScriptBuildPhase || {};
  let phaseUuid = Object.keys(shellPhases).find((key) => {
    if (key.endsWith("_comment")) {
      return false;
    }
    return unquote(shellPhases[key].name) === DSYM_PHASE_NAME;
  });

  if (!phaseUuid) {
    const phase = project.addBuildPhase([], "PBXShellScriptBuildPhase", DSYM_PHASE_NAME, targetUuid, {
      inputPaths: [],
      outputPaths: DSYM_OUTPUT_PATHS,
      shellPath: "/bin/bash",
      shellScript: encodeShellScriptForPbx(DSYM_PHASE_SCRIPT)
    });
    phaseUuid = phase.uuid;
  } else {
    shellPhases[phaseUuid].inputPaths = [];
    shellPhases[phaseUuid].outputPaths = DSYM_OUTPUT_PATHS;
    shellPhases[phaseUuid].shellPath = "/bin/bash";
    shellPhases[phaseUuid].shellScript = `"${encodeShellScriptForPbx(DSYM_PHASE_SCRIPT).replace(/"/g, '\\"')}"`;
  }

  if (!target?.buildPhases) {
    return;
  }

  target.buildPhases = target.buildPhases.filter((phase) => phase.value !== phaseUuid);
  const embedPodsIndex = target.buildPhases.findIndex((phase) => phase.comment === "[CP] Embed Pods Frameworks");
  const insertAt = embedPodsIndex >= 0 ? embedPodsIndex + 1 : target.buildPhases.length;
  target.buildPhases.splice(insertAt, 0, { value: phaseUuid, comment: DSYM_PHASE_NAME });
}

module.exports = function withDevelopmentTeam(config, props) {
  const teamId = props?.teamId;
  const nodePath = props?.nodePath;
  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    if (teamId) {
      const sections = project.hash.project.objects.XCBuildConfiguration;
      for (const key of Object.keys(sections)) {
        const section = sections[key];
        const settings = section.buildSettings || (section.buildSettings = {});
        const bundleId = settings.PRODUCT_BUNDLE_IDENTIFIER;
        // 仅改 app target（含 cd.cc.relaycare），不动 Pods target。
        if (bundleId && String(bundleId).includes("cd.cc.relaycare")) {
          settings.DEVELOPMENT_TEAM = teamId;
          settings.CODE_SIGN_STYLE = "Automatic";
          delete settings.PROVISIONING_PROFILE;
          delete settings["PROVISIONING_PROFILE_SPECIFIER"];
        }
      }
    }
    if (nodePath) {
      const iosRoot = config.modRequest.platformProjectRoot;
      const dir = path.dirname(nodePath);
      fs.writeFileSync(
        path.join(iosRoot, ".xcode.env.local"),
        `# Auto-generated by with-dev-team config plugin.\n# Xcode build phase shell uses a minimal PATH; point NODE_BINARY at the absolute node path\n# so the "Bundle React Native code and images" phase can run and embed the JS bundle.\nexport PATH="${dir}:$PATH"\nexport NODE_BINARY="${nodePath}"\n`
      );
      fs.writeFileSync(
        path.join(iosRoot, ".xcode.env.updates"),
        `# Auto-generated by with-dev-team config plugin.\n# Source after the React Native build phase sets SKIP_BUNDLING=1 for Debug.\n# Keep a bundled JS fallback in all device builds so a real device does not\n# redbox with "No script URL provided" when Metro is not running.\nunset SKIP_BUNDLING\n`
      );
    }

    const iosRoot = config.modRequest.platformProjectRoot;
    const appDelegatePath = fs
      .readdirSync(iosRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(iosRoot, entry.name, "AppDelegate.swift"))
      .find((candidate) => fs.existsSync(candidate));
    if (appDelegatePath) {
      const fallback = '?? Bundle.main.url(forResource: "main", withExtension: "jsbundle")';
      const source = fs.readFileSync(appDelegatePath, "utf8");
      if (source.includes("RCTBundleURLProvider.sharedSettings().jsBundleURL") && !source.includes(fallback)) {
        fs.writeFileSync(
          appDelegatePath,
          source.replace(
            /return RCTBundleURLProvider\.sharedSettings\(\)\.jsBundleURL\(forBundleRoot: "([^"]+)"\)/,
            `return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "$1")\n      ${fallback}`
          )
        );
      }
    }
    ensureDsymBuildPhase(project, config.modRequest.projectName);
    return config;
  });
};
