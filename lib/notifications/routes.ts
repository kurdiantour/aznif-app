const allowed = new Set(["/(tabs)/play", "/(tabs)/aznif", "/profile", "/settings", "/domino/fun", "/domino/aznif", "/okey/fun", "/okey/aznif"]);
let pending: string | null = null;
export function validPushRoute(value: unknown): value is string { return typeof value === "string" && allowed.has(value); }
export function queuePushRoute(route: string) { if (validPushRoute(route)) pending = route; }
export function takePushRoute() { const route = pending; pending = null; return route; }
