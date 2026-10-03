// Web does not register mobile push tokens. Metro selects platform.native.ts on devices.
export function subscribeToPushResponses(_listener: (response: import("expo-notifications").NotificationResponse) => void): () => void { return () => {}; }
export async function lastPushResponse(): Promise<import("expo-notifications").NotificationResponse | null> { return null; }
export async function clearPushResponse(): Promise<void> {}
export function subscribeToTokenChanges(_listener: (token: import("expo-notifications").DevicePushToken) => void): () => void { return () => {}; }
export async function obtainToken(_requestPermission: boolean, _devicePushToken?: import("expo-notifications").DevicePushToken): Promise<{ token: string | null; permission: string }> {
  return { token: null, permission: "web" };
}
