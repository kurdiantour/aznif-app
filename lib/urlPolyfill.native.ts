import "react-native-url-polyfill/auto";

if (
  typeof globalThis.URL !== "undefined" &&
  typeof globalThis.URL.canParse !== "function"
) {
  Object.defineProperty(globalThis.URL, "canParse", {
    value: function canParse(url: string) {
      try {
        new globalThis.URL(url);
        return true;
      } catch {
        return false;
      }
    },
    writable: true,
    configurable: true,
  });
}
