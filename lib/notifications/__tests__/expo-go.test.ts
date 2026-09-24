jest.mock("expo-constants", () => ({ appOwnership: "expo" }));
jest.mock("expo-device", () => ({ isDevice: true }));
jest.mock("expo-notifications", () => { throw new Error("Expo Go must never load notifications native module"); });
import { obtainToken, subscribeToTokenChanges } from "../platform.native";
test("Expo Go does not load expo-notifications or crash", async () => {
 expect(await obtainToken(true)).toEqual({ token:null,permission:"development_build_required" });
 expect(()=>subscribeToTokenChanges(jest.fn())()).not.toThrow();
});
