const { withAndroidManifest } = require("@expo/config-plugins");

const compatibilityProperty =
  "android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY";

module.exports = function withAndroidGameOrientation(config) {
  return withAndroidManifest(config, (mod) => {
    const application = mod.modResults.manifest.application?.[0];
    if (!application) {
      throw new Error("AndroidManifest.xml has no application element");
    }

    application.$["android:appCategory"] = "game";
    application.property = application.property || [];
    const property = application.property.find(
      (item) => item.$?.["android:name"] === compatibilityProperty,
    );
    if (property) {
      property.$["android:value"] = "true";
    } else {
      application.property.push({
        $: {
          "android:name": compatibilityProperty,
          "android:value": "true",
        },
      });
    }

    return mod;
  });
};
