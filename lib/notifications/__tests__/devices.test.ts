import { registerPushDevice, resumeDeviceRegistration, unregisterPushDevice } from "../devices";
const mockRpc = jest.fn<Promise<{ error: Error | null }>, []>(
  async () => ({ error: null })
);
let mockUser = "alice";
let mockToken = "ExpoPushToken[x]";
let mockPermission = "granted";
const mockStore: Record<string,string> = {};
jest.mock("../../supabase", () => ({ supabase: {
  rpc: (...args: unknown[]) => mockRpc(...args as []),
  auth: { getSession: async () => ({ data: { session: { user: { id: mockUser } } } }) },
} }));
jest.mock("../platform", () => ({ obtainToken: async () => ({ token: mockToken || null, permission: mockPermission }) }));
jest.mock("expo-crypto", () => ({ randomUUID: () => "33333333-3333-4333-8333-333333333333" }));
jest.mock("expo-constants", () => ({ expoConfig: { version: "1.3.0", extra: { pushEnvironment: "development" } } }));
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: async (key: string) => mockStore[key] ?? null,
  setItem: async (key: string, value: string) => { mockStore[key] = value; },
}));
beforeEach(async () => { await unregisterPushDevice(); mockUser = "alice"; mockToken = "ExpoPushToken[x]"; mockPermission = "granted"; mockRpc.mockReset().mockResolvedValue({ error: null }); resumeDeviceRegistration(); });
test("registers installation proof and selected build environment", async () => {
  await registerPushDevice("alice");
  expect(mockRpc).toHaveBeenCalledWith("push_register_device", expect.objectContaining({ p_environment: "development", p_token: mockToken, p_secret: expect.any(String) }));
});
test("does not repeat a successful registration for the same user and token", async () => {
  await registerPushDevice("alice");
  await registerPushDevice("alice");
  expect(mockRpc).toHaveBeenCalledTimes(1);
  mockToken = "ExpoPushToken[y]";
  await registerPushDevice("alice");
  expect(mockRpc).toHaveBeenCalledTimes(2);
});
test("retries after a failed registration and registers again after logout", async () => {
  mockRpc.mockResolvedValueOnce({ error: new Error("offline") });
  await expect(registerPushDevice("alice")).rejects.toThrow("offline");
  await registerPushDevice("alice");
  expect(mockRpc).toHaveBeenCalledTimes(2);
  await unregisterPushDevice();
  resumeDeviceRegistration();
  await registerPushDevice("alice");
  expect(mockRpc).toHaveBeenCalledTimes(4);
});
test("stale account registration is discarded", async () => {
  mockUser = "bob"; await registerPushDevice("alice"); expect(mockRpc).not.toHaveBeenCalled();
});
test("revoked permission detaches device instead of retaining an active token", async () => {
  mockToken = ""; mockPermission = "denied"; await registerPushDevice("alice");
  expect(mockRpc).toHaveBeenCalledWith("push_unregister_device", expect.any(Object));
});
test("logout pauses token-refresh work until next authenticated session", async () => {
  await unregisterPushDevice(); mockRpc.mockClear(); await registerPushDevice("alice"); expect(mockRpc).not.toHaveBeenCalled();
  resumeDeviceRegistration(); await registerPushDevice("alice"); expect(mockRpc).toHaveBeenCalledTimes(1);
});

test("Expo Go does not register or deactivate a native build installation", async () => {
  mockToken = ""; mockPermission = "development_build_required";
  await registerPushDevice("alice"); expect(mockRpc).not.toHaveBeenCalled();
});
