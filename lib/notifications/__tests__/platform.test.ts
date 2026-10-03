jest.mock("expo-constants", () => ({ appOwnership: "standalone", easConfig: { projectId: "project" } }));
jest.mock("expo-device", () => ({ isDevice: true }));
jest.mock("expo-notifications", () => ({
 setNotificationHandler: jest.fn(), addNotificationResponseReceivedListener: jest.fn(()=>({remove:jest.fn()})), getLastNotificationResponseAsync: jest.fn(async()=>null), clearLastNotificationResponseAsync: jest.fn(async()=>{}),
 addPushTokenListener: jest.fn(()=>({remove:jest.fn()})), setNotificationChannelAsync: jest.fn(async()=>{}),
 getPermissionsAsync: jest.fn(async()=>({granted:true,status:"granted",canAskAgain:true})), requestPermissionsAsync: jest.fn(async()=>({granted:true,status:"granted"})),
 getExpoPushTokenAsync: jest.fn(async()=>({data:"ExpoPushToken[x]"})), AndroidImportance: {HIGH:4}, IosAuthorizationStatus:{PROVISIONAL:3},
}));
import { Platform } from "react-native";
import { obtainToken, subscribeToTokenChanges, subscribeToPushResponses, lastPushResponse, clearPushResponse } from "../platform.native";
const notifications=jest.requireMock("expo-notifications");
const handler=notifications.setNotificationHandler.mock.calls[0][0];
test("visible notifications and live/cold-start response APIs", async () => {
 expect(await handler.handleNotification()).toEqual({shouldShowBanner:true,shouldShowList:true,shouldPlaySound:true,shouldSetBadge:false});
 const listener=jest.fn();const stop=subscribeToPushResponses(listener);expect(notifications.addNotificationResponseReceivedListener).toHaveBeenCalledWith(listener);stop();
 expect(await lastPushResponse()).toBeNull();await clearPushResponse();expect(notifications.clearLastNotificationResponseAsync).toHaveBeenCalled();
});
test("Android uses one Aznif channel and EAS token", async () => {
 const original=Platform.OS;Object.defineProperty(Platform,"OS",{value:"android",configurable:true});
 try {expect((await obtainToken(false)).token).toBe("ExpoPushToken[x]");expect(notifications.setNotificationChannelAsync).toHaveBeenCalledTimes(1);expect(notifications.setNotificationChannelAsync).toHaveBeenCalledWith("general",{name:"Aznif",importance:4,sound:"default"});}
 finally {Object.defineProperty(Platform,"OS",{value:original,configurable:true});}
});
test("iOS can request the OS permission and acquire a token", async () => {
 const original=Platform.OS;Object.defineProperty(Platform,"OS",{value:"ios",configurable:true});
 notifications.getPermissionsAsync.mockResolvedValueOnce({granted:false,status:"undetermined",canAskAgain:true});
 try {expect((await obtainToken(true)).permission).toBe("granted");expect(notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);expect(notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({projectId:"project"});}
 finally {Object.defineProperty(Platform,"OS",{value:original,configurable:true});}
});
test("iOS token-change path uses the supplied native token without fetching it again", async () => {
 const nativeToken = { type: "ios" as const, data: "apns-token" };
 const subscription = { remove: jest.fn() };
 notifications.addPushTokenListener.mockReturnValueOnce(subscription);
 const listener = jest.fn(
  async (token: import("expo-notifications").DevicePushToken) =>
    obtainToken(false, token)
);
 const stop = subscribeToTokenChanges(listener);
 const calls = notifications.addPushTokenListener.mock.calls;
 const callback = calls[calls.length - 1][0];
 await callback(nativeToken);
 expect(notifications.getExpoPushTokenAsync).toHaveBeenLastCalledWith({ projectId: "project", devicePushToken: nativeToken });
 expect(listener).toHaveBeenCalledTimes(1);
 stop();
 expect(subscription.remove).toHaveBeenCalledTimes(1);
});
