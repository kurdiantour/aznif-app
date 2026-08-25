import { getOkeyCountdownStartCheckDelay } from "../okey-room-api";

test("countdown start-check is scheduled at the deadline instead of the periodic heartbeat", () => {
  const now = Date.parse("2026-08-13T12:00:00.000Z");
  expect(getOkeyCountdownStartCheckDelay("2026-08-13T12:00:05.000Z", now)).toBe(5_075);
});

test("an already elapsed countdown retries promptly after resume or a late snapshot", () => {
  const now = Date.parse("2026-08-13T12:00:05.500Z");
  expect(getOkeyCountdownStartCheckDelay("2026-08-13T12:00:05.000Z", now)).toBe(500);
  expect(getOkeyCountdownStartCheckDelay("invalid", now)).toBeNull();
});
