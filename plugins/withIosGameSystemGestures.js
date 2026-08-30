const { withAppDelegate } = require("expo/config-plugins");

const ROOT_CONTROLLER_CLASS = `

private final class GameSystemGesturesRootViewController: UIViewController {
  private func homeIndicatorController(from controller: UIViewController) -> UIViewController {
    if let presented = controller.presentedViewController, !presented.isBeingDismissed {
      return homeIndicatorController(from: presented)
    }
    if let child = controller.childForHomeIndicatorAutoHidden {
      return homeIndicatorController(from: child)
    }
    if let navigationController = controller as? UINavigationController,
       let visible = navigationController.visibleViewController {
      return homeIndicatorController(from: visible)
    }
    if let tabController = controller as? UITabBarController,
       let selected = tabController.selectedViewController {
      return homeIndicatorController(from: selected)
    }
    if let visibleChild = controller.children.reversed().first(where: { $0.viewIfLoaded?.window != nil }) {
      return homeIndicatorController(from: visibleChild)
    }
    return controller
  }

  private var gameScreenPrefersHiddenHomeIndicator: Bool {
    let controller = homeIndicatorController(from: self)
    return controller !== self && controller.prefersHomeIndicatorAutoHidden
  }

  override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge {
    gameScreenPrefersHiddenHomeIndicator ? .bottom : []
  }

  override func setNeedsUpdateOfHomeIndicatorAutoHidden() {
    super.setNeedsUpdateOfHomeIndicatorAutoHidden()
    setNeedsUpdateOfScreenEdgesDeferringSystemGestures()
  }
}
`;

function addGameSystemGesturesRootController(source) {
  if (source.includes("GameSystemGesturesRootViewController")) return source;
  const delegateDeclaration = /class ReactNativeDelegate:\s*ExpoReactNativeFactoryDelegate\s*\{/;
  if (!delegateDeclaration.test(source)) {
    throw new Error("withIosGameSystemGestures: Expo ReactNativeDelegate declaration was not found in AppDelegate.swift");
  }
  const rootControllerOverride = `class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
    override func createRootViewController() -> UIViewController {
      GameSystemGesturesRootViewController()
    }
`;
  return source.replace(delegateDeclaration, rootControllerOverride) + ROOT_CONTROLLER_CLASS;
}

module.exports = function withIosGameSystemGestures(config) {
  return withAppDelegate(config, (appDelegateConfig) => {
    if (appDelegateConfig.modResults.language !== "swift") {
      throw new Error("withIosGameSystemGestures requires a Swift AppDelegate");
    }
    appDelegateConfig.modResults.contents = addGameSystemGesturesRootController(appDelegateConfig.modResults.contents);
    return appDelegateConfig;
  });
};
module.exports.addGameSystemGesturesRootController = addGameSystemGesturesRootController;
