import React from "react";
import { act, render } from "@testing-library/react-native";
import { Text } from "react-native";
import { NotificationProvider } from "../NotificationProvider";
let mockUser: string | undefined = "alice";
let mockLoading = false;
const mockRegister = jest.fn();
const mockResume = jest.fn();
const mockUnsubscribe = jest.fn();
let mockTokenChanged: (token: { type: "ios"; data: string }) => void;
jest.mock("expo-router", () => { throw new Error("Registration must not import navigation"); });
jest.mock("../../profile", () => ({ useProfile: () => ({ session: mockUser ? { user: { id: mockUser } } : null, authLoading: mockLoading }) }));
jest.mock("../devices", () => ({ registerPushDevice: (...args: unknown[]) => mockRegister(...args), resumeDeviceRegistration: () => mockResume() }));
jest.mock("../platform", () => ({ subscribeToTokenChanges: (listener: () => void) => { mockTokenChanged = listener; return mockUnsubscribe; } }));
const tree = () => <NotificationProvider><Text>Normal app startup</Text></NotificationProvider>;
beforeEach(() => { mockUser = "alice"; mockLoading = false; mockRegister.mockReset().mockResolvedValue("granted"); mockResume.mockClear(); mockUnsubscribe.mockClear(); });
test("registration cannot block normal startup even while token request is unresolved", () => {
 mockRegister.mockImplementation(() => new Promise(() => {}));
 const view = render(tree());expect(view.getByText("Normal app startup")).toBeTruthy();
 expect(mockRegister).toHaveBeenCalledWith("alice",true,undefined);view.unmount();expect(mockUnsubscribe).toHaveBeenCalled();
});
test("logged-out or auth-loading startup renders unchanged without registration", () => {
 mockUser = undefined;const view = render(tree());expect(view.getByText("Normal app startup")).toBeTruthy();expect(mockRegister).not.toHaveBeenCalled();
 mockUser = "alice";mockLoading = true;view.rerender(tree());expect(mockRegister).not.toHaveBeenCalled();
 mockLoading = false;view.rerender(tree());expect(mockRegister).toHaveBeenCalledWith("alice",true,undefined);
});
test("token rotation forwards the native token without requesting permission again", async () => {
 render(tree());const token = { type: "ios" as const, data: "apns-token" };
 await act(async()=>mockTokenChanged(token));expect(mockRegister).toHaveBeenLastCalledWith("alice",false,token);
});
test("registration failure does not hide children or redirect startup", async () => {
 const warning=jest.spyOn(console,"warn").mockImplementation(()=>{});mockRegister.mockRejectedValue(new Error("offline"));
 const view=render(tree());await act(async()=>{});expect(view.getByText("Normal app startup")).toBeTruthy();expect(warning).toHaveBeenCalled();warning.mockRestore();
});
