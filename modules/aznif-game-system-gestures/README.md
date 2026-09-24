# iOS game system gesture protection

Local, Apple-only Expo module, autolinked from `modules/`. The config plugin
imports this pod in AppDelegate and installs its root view controller.
Domino and Okey request bottom edge protection for each focused screen using
unique tokens. Cleanup releases only that focus owner; runtime destruction
releases only that runtime's requests.

The root returns `.bottom` and disables home indicator auto-hide while protected.
UIKit controls dimming, the first swipe, the armed interval and the second swipe.
There are no timers, gesture recognizers, swizzling, or tile/rack changes.
The policy is refreshed on changes, root appearance, and application activation.
An actual presented native controller can own UIKit policy separately; this
module does not override system-owned sheets. In-game View overlays retain
the game screen's policy.

## Build and validate

A new native iOS build is required; Expo Go and an OTA to the previous binary
cannot add the module. iOS runtime version is separated from the old binary.
When app version changes, update the explicit iOS runtime version accordingly.
The plugin upgrades an existing legacy inline controller as well as a clean
AppDelegate. Review the generated AppDelegate for the module import and root
override. No inline legacy controller should remain.

Run `node --test scripts/ios-game-system-gestures.test.cjs` and
`npm run typecheck`. Autolinking must resolve AznifGameSystemGestures on Apple
and omit it on Android. These checks do not compile Swift or prove UIKit behavior.

On a physical iPhone with the new build, test both Domino (including AI) and Okey:

1. Enter the game and allow the indicator to become dim/protected.
2. Swipe up once at the bottom edge: the game stays open and the indicator arms.
3. Swipe again promptly: iOS permits leaving the app.
4. Return, repeat the first swipe, let iOS's armed interval expire, and swipe:
   that swipe arms the indicator again instead of leaving.
5. Repeat after background/foreground, navigating away and back, and opening
   and closing in-game overlays and settings/profile presentations.
6. Repeat while dragging tiles near the bottom, in both landscape orientations.
7. Confirm ordinary Home gesture behavior outside the two game screens.

In Xcode, verify the window root class and put a breakpoint on
`preferredScreenEdgesDeferringSystemGestures`: it must return bottom during
focused gameplay and none after leaving. During gameplay the home indicator
query must terminate at the root with auto-hide false.
