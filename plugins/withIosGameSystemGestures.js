const { withAppDelegate } = require("expo/config-plugins");

const ROOT_CONTROLLER_CLASS = `

private final class GameSystemGesturesRootViewController: UIViewController {
  private weak var lastPolicyController: UIViewController?
  private var lastDefersBottomEdge = false

  private func activeController(from controller: UIViewController) -> UIViewController {
    if let presented = controller.presentedViewController, !presented.isBeingDismissed {
      return activeController(from: presented)
    }
    if let navigationController = controller as? UINavigationController,
       let visible = navigationController.visibleViewController {
      return activeController(from: visible)
    }
    if let tabController = controller as? UITabBarController,
       let selected = tabController.selectedViewController {
      return activeController(from: selected)
    }
    if let delegated = controller.childForHomeIndicatorAutoHidden,
       delegated !== controller {
      return activeController(from: delegated)
    }
    if let visibleChild = controller.children.reversed().first(where: { $0.viewIfLoaded?.window != nil }) {
      return activeController(from: visibleChild)
    }
    return controller
  }

  private var activeContentController: UIViewController? {
    if let presented = presentedViewController, !presented.isBeingDismissed {
      return activeController(from: presented)
    }
    guard let visibleChild = children.reversed().first(where: { $0.viewIfLoaded?.window != nil }) else {
      return nil
    }
    return activeController(from: visibleChild)
  }

  private var gameScreenPrefersHiddenHomeIndicator: Bool {
    activeContentController?.prefersHomeIndicatorAutoHidden ?? false
  }

  override var childForHomeIndicatorAutoHidden: UIViewController? {
    activeContentController
  }

  override var childForScreenEdgesDeferringSystemGestures: UIViewController? {
    gameScreenPrefersHiddenHomeIndicator ? nil : activeContentController
  }

  override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge {
    gameScreenPrefersHiddenHomeIndicator ? .bottom : []
  }

  override func setNeedsUpdateOfHomeIndicatorAutoHidden() {
    super.setNeedsUpdateOfHomeIndicatorAutoHidden()
    setNeedsUpdateOfScreenEdgesDeferringSystemGestures()
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    let controller = activeContentController
    let defersBottomEdge = controller?.prefersHomeIndicatorAutoHidden ?? false
    if controller !== lastPolicyController || defersBottomEdge != lastDefersBottomEdge {
      lastPolicyController = controller
      lastDefersBottomEdge = defersBottomEdge
      setNeedsUpdateOfHomeIndicatorAutoHidden()
    }
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    setNeedsUpdateOfHomeIndicatorAutoHidden()
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