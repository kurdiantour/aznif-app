const { withInfoPlist } = require("@expo/config-plugins");
const {
  setFacebookConfig,
} = require("react-native-fbsdk-next/plugin/build/withFacebookIOS");
const {
  withAndroidPermissions,
  withFacebookAppIdString,
  withFacebookManifest,
} = require("react-native-fbsdk-next/plugin/build/withFacebookAndroid");

// Configure the Facebook native SDK on both iOS and Android.
module.exports = function withIosFacebookLogin(config) {
  const props = {
    appID: "1414624693952489",
    clientToken: "75cbd67473d1450154270d5bd0603dbe",
    displayName: "Aznif",
    scheme: "fb1414624693952489",
    isAutoInitEnabled: false,
    autoLogAppEventsEnabled: false,
    advertiserIDCollectionEnabled: false,
  };

  config = withInfoPlist(config, (mod) => {
    mod.modResults = setFacebookConfig(props, mod.modResults);
    return mod;
  });

  config = withFacebookAppIdString(config, props);
  config = withFacebookManifest(config, props);
  config = withAndroidPermissions(config, props);

  return config;
};

