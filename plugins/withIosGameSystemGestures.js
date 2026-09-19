const { withAppDelegate } = require("expo/config-plugins");

const ROOT_CONTROLLER_CLASS = `

private final class GameSystemGesturesRootViewController: UIViewController {

  private var activeContentController: UIViewController? {

    func resolve(_ controller: UIViewController) -> UIViewController {

      if let presented = controller.presentedViewController,
         !presented.isBeingDismissed {
        return resolve(presented)
      }

      if let navigationController = controller as? UINavigationController,
         let visible = navigationController.visibleViewController {
        return resolve(visible)
      }

      if let tabController = controller as? UITabBarController,
         let selected = tabController.selectedViewController {
        return resolve(selected)
      }

      if let delegated = controller.childForHomeIndicatorAutoHidden,
         delegated !== controller {
        return resolve(delegated)
      }

      if let visibleChild = controller.children.reversed().first(
        where: { $0.viewIfLoaded?.window != nil }
      ) {
        return resolve(visibleChild)
      }

      return controller
    }

    if let presented = presentedViewController,
       !presented.isBeingDismissed {
      return resolve(presented)
    }

    guard let visibleChild = children.reversed().first(
      where: { $0.viewIfLoaded?.window != nil }
    ) else {
      return nil
    }

    return resolve(visibleChild)
  }

  private var shouldProtectBottomEdge: Bool {
    activeContentController?.prefersHomeIndicatorAutoHidden ?? false
  }

  override var childForHomeIndicatorAutoHidden: UIViewController? {
    activeContentController
  }

  override var childForScreenEdgesDeferringSystemGestures: UIViewController? {
    shouldProtectBottomEdge ? nil : activeContentController
  }

  override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge {
    shouldProtectBottomEdge ? .bottom : []
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    setNeedsUpdateOfHomeIndicatorAutoHidden()
    setNeedsUpdateOfScreenEdgesDeferringSystemGestures()
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    setNeedsUpdateOfHomeIndicatorAutoHidden()
    setNeedsUpdateOfScreenEdgesDeferringSystemGestures()
  }
}
`;

function addGameSystemGesturesRootController(source) {
  if (source.includes("GameSystemGesturesRootViewController")) {
    return source;
  }

  const delegateDeclaration =
    /class\s+ReactNativeDelegate\s*:\s*ExpoReactNativeFactoryDelegate\s*\{/;

  if (!delegateDeclaration.test(source)) {
    throw new Error(
      "withIosGameSystemGestures: Expo ReactNativeDelegate declaration was not found in AppDelegate.swift"
    );
  }

  const rootControllerOverride = `class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {

  override func createRootViewController() -> UIViewController {
    GameSystemGesturesRootViewController()
  }
`;

  return (
    source.replace(delegateDeclaration, rootControllerOverride) +
    ROOT_CONTROLLER_CLASS
  );
}

module.exports = function withIosGameSystemGestures(config) {
  return withAppDelegate(config, (appDelegateConfig) => {
    if (appDelegateConfig.modResults.language !== "swift") {
      throw new Error(
        "withIosGameSystemGestures requires a Swift AppDelegate"
      );
    }

    appDelegateConfig.modResults.contents =
      addGameSystemGesturesRootController(
        appDelegateConfig.modResults.contents
      );

    return appDelegateConfig;
  });
};

module.exports.addGameSystemGesturesRootController =
  addGameSystemGesturesRootController;