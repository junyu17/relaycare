// iOS 27 kills apps that have not adopted the UIScene lifecycle on launch
// (_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdopt). Expo SDK 57 /
// React Native 0.86 still generate an AppDelegate that owns the window, so
// this plugin does three things during prebuild:
//   1. declares the scene manifest in Info.plist,
//   2. writes a SceneDelegate that creates the window and starts React Native,
//   3. rewrites the generated AppDelegate so it builds the factory but leaves
//      the window to the scene.
// Everything here edits generated files, so it must live in a plugin: `expo
// prebuild --clean` wipes ios/ and this runs again.
const { withInfoPlist, withDangerousMod, withXcodeProject } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const SCENE_DELEGATE = `import UIKit
import React

// Created by the with-scene-lifecycle config plugin. iOS 27 requires scene
// adoption; the window is owned here rather than by AppDelegate.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
    guard let windowScene = scene as? UIWindowScene else { return }
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.startReactNative(in: window)

    // A launch that came from a deep link hands the URL over here instead of
    // through application(_:open:options:).
    if let url = connectionOptions.urlContexts.first?.url {
      RCTLinkingManager.application(UIApplication.shared, open: url, options: [:])
    }
    if let activity = connectionOptions.userActivities.first {
      RCTLinkingManager.application(UIApplication.shared, continue: activity, restorationHandler: { _ in })
    }
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let url = URLContexts.first?.url else { return }
    RCTLinkingManager.application(UIApplication.shared, open: url, options: [:])
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    RCTLinkingManager.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
  }
}
`;

function patchAppDelegate(contents) {
  // Move window creation out of didFinishLaunching and expose it to the scene.
  const windowBlock = /#if os\(iOS\) \|\| os\(tvOS\)\s*\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\s*\n\s*factory\.startReactNative\(\s*\n\s*withModuleName: "main",\s*\n\s*in: window,\s*\n\s*launchOptions: launchOptions\)\s*\n\s*#endif\n/;
  if (!windowBlock.test(contents)) {
    if (contents.includes("func startReactNative(in window: UIWindow)")) return contents; // already patched
    throw new Error("with-scene-lifecycle: AppDelegate no longer matches the expected template — update the plugin");
  }
  let out = contents.replace(
    windowBlock,
    "    // The window is created by SceneDelegate (iOS 27 requires scene adoption).\n    launchOptionsForScene = launchOptions\n"
  );
  out = out.replace(
    "  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?",
    "  var launchOptionsForScene: [UIApplication.LaunchOptionsKey: Any]?\n  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?"
  );
  // Append the scene entry point.
  out = out.replace(
    /^(@main\nclass AppDelegate: ExpoAppDelegate \{)/m,
    "$1"
  );
  const startFn = `
  /// Called by SceneDelegate once the scene hands us its window.
  func startReactNative(in window: UIWindow) {
    guard let factory = reactNativeFactory else { return }
    factory.startReactNative(withModuleName: "main", in: window, launchOptions: launchOptionsForScene)
  }
`;
  // The file declares AppDelegate *and* ReactNativeDelegate, so append inside
  // AppDelegate's own braces rather than at the end of the file.
  const classStart = out.indexOf("class AppDelegate: ExpoAppDelegate {");
  if (classStart === -1) throw new Error("with-scene-lifecycle: AppDelegate class not found");
  let depth = 0;
  let classEnd = -1;
  for (let i = out.indexOf("{", classStart); i < out.length; i += 1) {
    if (out[i] === "{") depth += 1;
    else if (out[i] === "}") {
      depth -= 1;
      if (depth === 0) { classEnd = i; break; }
    }
  }
  if (classEnd === -1) throw new Error("with-scene-lifecycle: could not find the end of AppDelegate");
  out = out.slice(0, classEnd) + startFn + out.slice(classEnd);
  return out;
}

module.exports = function withSceneLifecycle(config) {
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: "Default Configuration",
            UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).SceneDelegate",
          },
        ],
      },
    };
    return cfg;
  });

  config = withDangerousMod(config, [
    "ios",
    (cfg) => {
      const name = cfg.modRequest.projectName;
      const dir = path.join(cfg.modRequest.platformProjectRoot, name);
      fs.writeFileSync(path.join(dir, "SceneDelegate.swift"), SCENE_DELEGATE);
      const appDelegatePath = path.join(dir, "AppDelegate.swift");
      const patched = patchAppDelegate(fs.readFileSync(appDelegatePath, "utf8"));
      fs.writeFileSync(appDelegatePath, patched);
      return cfg;
    },
  ]);

  // Add SceneDelegate.swift to the Xcode target, or it is never compiled.
  config = withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const name = cfg.modRequest.projectName;
    const filePath = `${name}/SceneDelegate.swift`;
    if (!project.hasFile(filePath)) {
      const group = project.pbxGroupByName(name);
      const groupKey = Object.keys(project.hash.project.objects.PBXGroup || {}).find(
        (key) => project.hash.project.objects.PBXGroup[key] === group
      );
      project.addSourceFile(filePath, { target: project.getFirstTarget().uuid }, groupKey);
    }
    return cfg;
  });

  return config;
};
