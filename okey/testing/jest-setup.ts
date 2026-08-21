/// <reference types="jest" />

import { AppState } from "react-native";

if (!Object.getOwnPropertyDescriptor(AppState, "currentState")?.get) {
  let currentState = AppState.currentState;

  Object.defineProperty(AppState, "currentState", {
    configurable: true,
    get: () => currentState,
    set: (value) => {
      currentState = value;
    },
  });
}

import mockAsyncStorage from "@react-native-async-storage/async-storage/jest/async-storage-mock";

jest.mock(
  "@react-native-async-storage/async-storage",
  () => mockAsyncStorage,
);

jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  },
  useLocalSearchParams: () => ({}),
}));

beforeEach(() => {
  mockAsyncStorage.clear();
  jest.clearAllMocks();
});