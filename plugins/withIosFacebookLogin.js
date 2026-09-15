const { withInfoPlist } = require("@expo/config-plugins");
const {
  setFacebookConfig,
} = require("react-native-fbsdk-next/plugin/build/withFacebookIOS");

// Keep the Facebook SDK configuration on iOS; Android retains its OAuth flow.
module.exports = function withIosFacebookLogin(config) {
  return withInfoPlist(config, (mod) => {
    const appID = "1414624693952489";
    const clientToken = "75cbd67473d1450154270d5bd0603dbe";

    mod.modResults = setFacebookConfig(
      {
        appID,
        clientToken,
        displayName: "Aznif",
        scheme: `fb${appID}`,
        isAutoInitEnabled: false,
        autoLogAppEventsEnabled: false,
        advertiserIDCollectionEnabled: false,
      },
      mod.modResults,
    );

    return mod;
  });
};