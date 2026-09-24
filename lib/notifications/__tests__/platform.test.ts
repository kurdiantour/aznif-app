jest.mock("expo-constants", () => ({ appOwnership: "standalone", easConfig: { projectId: "project" } }));
jest.mock("expo-device", () => ({ isDevice: true }));
jest.mock("expo-notifications", () => ({
 setNotificationHandler: jest.fn(), addNotificationResponseReceivedListener: jest.fn(), getLastNotificationResponse: jest.fn(),
 addPushTokenListener: jest.fn(()=>({remove:jest.fn()})), setNotificationChannelAsync: jest.fn(async()=>{}),
 getPermissionsAsync: jest.fn(async()=>({granted:true,status:"granted",canAskAgain:true})), requestPermissionsAsync: jest.fn(async()=>({granted:true,status:"granted"})),
 getExpoPushTokenAsync: jest.fn(async()=>({data:"ExpoPushToken[x]"})), AndroidImportance: {HIGH:4}, IosAuthorizationStatus:{PROVISIONAL:3},
}));
import { Platform } from "react-native";
import { obtainToken } from "../platform.native";
const notifications=jest.requireMock("expo-notifications");
const handler=notifications.setNotificationHandler.mock.calls[0][0];
test("visible notifications never install a tap handler or read pending responses", async () => {
 expect(await handler.handleNotification()).toEqual({shouldShowBanner:true,shouldShowList:true,shouldPlaySound:true,shouldSetBadge:false});
 expect(notifications.addNotificationResponseReceivedListener).not.toHaveBeenCalled();expect(notifications.getLastNotificationResponse).not.toHaveBeenCalled();
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
