const { withAppDelegate } = require("expo/config-plugins");

const IMPORT = "internal import AznifGameSystemGestures";
const LEGACY_CLASS = "private final class GameSystemGesturesRootViewController: UIViewController";

function addGameSystemGesturesRootController(source) {
  // Upgrade the old inline implementation too, not just clean prebuilds.
  const legacyStart = source.indexOf(LEGACY_CLASS);
  if (legacyStart !== -1) {
    const opening = source.indexOf("{", legacyStart);
    let depth = 1;
    let end = opening + 1;
    for (; end < source.length && depth > 0; end++) {
      if (source[end] === "{") depth++;
      if (source[end] === "}") depth--;
    }
    if (opening === -1 || depth !== 0) {
      throw new Error("withIosGameSystemGestures: malformed legacy root controller");
    }
    source = source.slice(0, legacyStart) + source.slice(end);
  }

  const declaration = /class\s+ReactNativeDelegate\s*:\s*ExpoReactNativeFactoryDelegate\s*\{/;
  if (!declaration.test(source)) {
    throw new Error("withIosGameSystemGestures: Expo ReactNativeDelegate declaration was not found in AppDelegate.swift");
  }
  const override = /override\s+func\s+createRootViewController\(\)\s*->\s*UIViewController\s*\{\s*(?:return\s+)?GameSystemGesturesRootViewController\(\)\s*\}/;
  if (!override.test(source)) {
    if (/func\s+createRootViewController\s*\(/.test(source)) {
      throw new Error("withIosGameSystemGestures: an unknown root controller override already exists");
    }
    source = source.replace(declaration, `$&
  override func createRootViewController() -> UIViewController {
    GameSystemGesturesRootViewController()
  }
`);
  }
  if (!source.split(/\r?\n/).includes(IMPORT)) source = `${IMPORT}\n${source}`;
  return source;
}

module.exports = function withIosGameSystemGestures(config) {
  return withAppDelegate(config, (config) => {
    if (config.modResults.language !== "swift") {
      throw new Error("withIosGameSystemGestures requires a Swift AppDelegate");
    }
    config.modResults.contents = addGameSystemGesturesRootController(config.modResults.contents);
    return config;
  });
};
module.exports.addGameSystemGesturesRootController = addGameSystemGesturesRootController;
