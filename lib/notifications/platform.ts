// Web does not register mobile push tokens. Metro selects platform.native.ts on devices.
export function subscribeToTokenChanges(_listener: (token: import("expo-notifications").DevicePushToken) => void): () => void { return () => {}; }
export async function obtainToken(_requestPermission: boolean, _devicePushToken?: import("expo-notifications").DevicePushToken): Promise<{ token: string | null; permission: string }> {
  return { token: null, permission: "web" };
}
