const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const { addGameSystemGesturesRootController: transform } = require("../plugins/withIosGameSystemGestures");

const clean = `import Expo
import React
class AppDelegate: ExpoAppDelegate {}
class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  override func bundleURL() -> URL? { nil }
}
`;

test("clean AppDelegate gains one module import and root override; reruns are stable", () => {
  const output = transform(clean);
  assert.equal(transform(output), output);
  assert.equal(output.match(/internal import AznifGameSystemGestures/g).length, 1);
  assert.equal(output.match(/override func createRootViewController/g).length, 1);
  assert.match(output, /GameSystemGesturesRootViewController\(\)/);
  assert.match(output, /override func bundleURL\(\) -> URL\? \{ nil \}/);
});

test("upgrades inline legacy controller and preserves surrounding declarations", () => {
  const legacy = clean.replace(
    "class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {",
    `class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
      override func createRootViewController() -> UIViewController {
        GameSystemGesturesRootViewController()
      }`
  ) + `
private final class GameSystemGesturesRootViewController: UIViewController {
  private var active: Bool { if true { return true }; return false }
  override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge {
    active ? .bottom : []
  }
}
class UnrelatedController: UIViewController {}
`;
  const output = transform(legacy);
  assert.doesNotMatch(output, /private final class GameSystemGesturesRootViewController/);
  assert.match(output, /class UnrelatedController: UIViewController \{\}/);
  assert.equal(output.match(/override func createRootViewController/g).length, 1);
  assert.equal(transform(output), output);
});

test("fails explicitly for unsupported delegates and conflicting root overrides", () => {
  assert.throws(() => transform("class UnknownDelegate {}"), /declaration was not found/);
  assert.throws(() => transform(clean.replace(
    "override func bundleURL()",
    "override func createRootViewController() -> UIViewController { OtherController() }\n override func bundleURL()"
  )), /unknown root controller override/);
});

function loadHook(platform, missing = false) {
  let focus;
  let nextToken = 0;
  let loads = 0;
  const requests = [];
  const source = ts.transpileModule(
    readFileSync(require.resolve("../hooks/useGameSystemGestureProtection.ts"), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
  ).outputText;
  const exports = {};
  vm.runInNewContext(source, {
    exports,
    console,
    require(name) {
      if (name === "expo") return { requireNativeModule() {
        loads++;
        if (missing) throw new Error("Native rebuild required");
        return { setProtected(token, enabled) {
          requests.push({ token, enabled });
          return Promise.resolve();
        } };
      } };
      if (name === "expo-crypto") return { randomUUID: () => `test-owner-${++nextToken}` };
      if (name === "expo-router") return { useFocusEffect(callback) { focus = callback; } };
      if (name === "react") return { useCallback: (callback) => callback };
      if (name === "react-native") return { Platform: { OS: platform } };
      throw new Error("Unexpected import: " + name);
    },
  });
  exports.useGameSystemGestureProtection();
  return { focus: () => focus(), requests, loads: () => loads };
}

test("focus owners are independent: old cleanup cannot release a newer screen", () => {
  const hook = loadHook("ios");
  const leaveFirst = hook.focus();
  const leaveSecond = hook.focus();
  leaveFirst();
  const active = new Set();
  for (const { token, enabled } of hook.requests) {
    if (enabled) active.add(token); else active.delete(token);
  }
  assert.equal(active.size, 1);
  assert.equal(active.has(hook.requests[1].token), true);
  leaveSecond();
  assert.equal(hook.requests[3].token, hook.requests[1].token);
  assert.equal(hook.requests[3].enabled, false);
});

test("refocusing obtains a fresh owner and releases it on blur", () => {
  const hook = loadHook("ios");
  hook.focus()();
  hook.focus()();
  assert.notEqual(hook.requests[0].token, hook.requests[2].token);
  assert.deepEqual(hook.requests.map((request) => request.enabled), [true, false, true, false]);
});

test("Android and web never request the iOS native module", () => {
  for (const platform of ["android", "web"]) {
    const hook = loadHook(platform, true);
    assert.equal(hook.focus(), undefined);
    assert.equal(hook.loads(), 0);
    assert.equal(hook.requests.length, 0);
  }
});

test("old iOS binaries cannot silently pretend protection is active", () => {
  assert.throws(() => loadHook("ios", true).focus(), /Native rebuild required/);
});
