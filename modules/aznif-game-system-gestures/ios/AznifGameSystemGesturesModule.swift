import ExpoModulesCore
import UIKit

// Main queue only. An old JS runtime may only release its own requests.
enum GameSystemGesturePolicy {
  private static var requests: [UUID: Set<String>] = [:]
  static let didChange = Notification.Name("AznifGameSystemGesturePolicyDidChange")
  static var isProtected: Bool { !requests.isEmpty }

  static func setProtected(_ enabled: Bool, owner: UUID, token: String) {
    dispatchPrecondition(condition: .onQueue(.main))
    var tokens = requests[owner] ?? []
    if enabled { tokens.insert(token) } else { tokens.remove(token) }
    requests[owner] = tokens.isEmpty ? nil : tokens
    NotificationCenter.default.post(name: didChange, object: nil)
  }

  static func removeOwner(_ owner: UUID) {
    dispatchPrecondition(condition: .onQueue(.main))
    requests.removeValue(forKey: owner)
    NotificationCenter.default.post(name: didChange, object: nil)
  }
}

public final class AznifGameSystemGesturesModule: Module {
  private let owner = UUID()

  public func definition() -> ModuleDefinition {
    Name("AznifGameSystemGestures")

    AsyncFunction("setProtected") { (token: String, enabled: Bool) in
      GameSystemGesturePolicy.setProtected(enabled, owner: self.owner, token: token)
    }.runOnQueue(.main)

    OnDestroy { [owner] in
      DispatchQueue.main.async {
        GameSystemGesturePolicy.removeOwner(owner)
      }
    }
  }
}

public final class GameSystemGesturesRootViewController: UIViewController {
  public override func viewDidLoad() {
    super.viewDidLoad()
    NotificationCenter.default.addObserver(
      self, selector: #selector(refreshSystemGesturePolicy),
      name: GameSystemGesturePolicy.didChange, object: nil)
    NotificationCenter.default.addObserver(
      self, selector: #selector(refreshSystemGesturePolicy),
      name: UIApplication.didBecomeActiveNotification, object: nil)
  }

  deinit { NotificationCenter.default.removeObserver(self) }

  // UIKit owns the dimmed/armed state and its timeout. Never toggle protection
  // for individual touches, drags, or the first/second swipe.
  public override var prefersHomeIndicatorAutoHidden: Bool { false }

  public override var childForHomeIndicatorAutoHidden: UIViewController? {
    GameSystemGesturePolicy.isProtected ? nil : children.last
  }

  public override var childForScreenEdgesDeferringSystemGestures: UIViewController? { nil }

  public override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge {
    GameSystemGesturePolicy.isProtected ? .bottom : []
  }

  @objc private func refreshSystemGesturePolicy() {
    setNeedsUpdateOfHomeIndicatorAutoHidden()
    setNeedsUpdateOfScreenEdgesDeferringSystemGestures()
  }

  public override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    refreshSystemGesturePolicy()
  }

  public override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    refreshSystemGesturePolicy()
  }
}
