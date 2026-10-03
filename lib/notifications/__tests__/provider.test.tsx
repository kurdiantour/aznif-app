import React from "react";
import { act, render } from "@testing-library/react-native";
import { Text } from "react-native";
import { NotificationProvider } from "../NotificationProvider";
let mockUser: string | undefined = "alice";
let mockLoading = false;
const mockRegister = jest.fn();
const mockResume = jest.fn();
const mockUnsubscribe = jest.fn();
const mockPushUnsubscribe = jest.fn();
const mockRecordOpen = jest.fn(async(_user:string,_campaign:string,_device:string)=>true);
const mockPush = jest.fn();
let mockSegments: string[] = ['play'];
let mockResponse: ((response: any)=>void) | undefined;
let mockLastResponse: any = null;
let mockTokenChanged: (token: { type: "ios"; data: string }) => void;
jest.mock("expo-router", () => ({ useRouter: () => ({push: mockPush}), useSegments: () => mockSegments }));
jest.mock("../../profile", () => ({ useProfile: () => ({ session: mockUser ? { user: { id: mockUser } } : null, authLoading: mockLoading }) }));
jest.mock("../devices", () => ({ registerPushDevice: (...args: unknown[]) => mockRegister(...args), resumeDeviceRegistration: () => mockResume(),recordPushOpen:(user:string,campaign:string,device:string)=>mockRecordOpen(user,campaign,device) }));
jest.mock("../platform", () => ({ subscribeToTokenChanges: (listener: () => void) => { mockTokenChanged = listener; return mockUnsubscribe; },subscribeToPushResponses:(listener:(response:any)=>void)=>{mockResponse=listener;return mockPushUnsubscribe;},lastPushResponse:async()=>mockLastResponse,clearPushResponse:async()=>{} }));
const tree = () => <NotificationProvider><Text>Normal app startup</Text></NotificationProvider>;
beforeEach(() => { mockUser = "alice"; mockLoading = false; mockSegments=['play'];mockLastResponse=null;mockPush.mockClear();mockRecordOpen.mockClear();mockRegister.mockReset().mockResolvedValue("granted"); mockResume.mockClear(); mockUnsubscribe.mockClear(); });
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
const response=(id:string,route='/profile')=>({actionIdentifier:'expo.modules.notifications.actions.DEFAULT',notification:{request:{identifier:id,content:{data:{campaign_id:'11111111-1111-4111-8111-111111111111',device_id:'22222222-2222-4222-8222-222222222222',deep_link:route}}}}});
test('live tap records an open and navigates once',async()=>{
 render(tree());await act(async()=>{mockResponse?.(response('live-1'));await Promise.resolve();});
 expect(mockRecordOpen).toHaveBeenCalledTimes(1);expect(mockPush).toHaveBeenCalledWith('/profile');
 await act(async()=>{mockResponse?.(response('live-1'));await Promise.resolve();});expect(mockRecordOpen).toHaveBeenCalledTimes(1);
});
test('cold-start response is recovered and queued while index is displayed',async()=>{
 mockSegments=['index'];mockLastResponse=response('cold-1','/settings');
 render(tree());await act(async()=>{await Promise.resolve();await Promise.resolve();});
 expect(mockRecordOpen).toHaveBeenCalledTimes(1);expect(mockPush).not.toHaveBeenCalled();
 const {takePushRoute}=require('../routes');expect(takePushRoute()).toBe('/settings');
});
