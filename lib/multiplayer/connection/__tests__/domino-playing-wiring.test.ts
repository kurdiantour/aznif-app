import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("Domino 1v1 Playing independently joins on boot and foreground", () => {
  const source = read("domino/modes/one-vs-one/controllers/use-domino-one-vs-one-connection-controller.ts");
  assert.equal(source.match(/gameRoomConnection\.joinRoom\("domino_1v1", args\.roomId!\)/g)?.length, 2);
  assert.match(source, /const boot = async \(\) =>[\s\S]*joinRoom\("domino_1v1"/);
  assert.match(source, /AppState\.addEventListener[\s\S]*joinRoom\("domino_1v1"/);
});

test("Domino 2v2 Playing independently joins on boot and foreground", () => {
  const source = read("domino/modes/two-vs-two/controllers/domino-two-vs-two-connection-controller.ts");
  assert.equal(source.match(/gameRoomConnection\.joinRoom\('domino_2v2', input\.roomId!\)/g)?.length, 2);
  assert.match(source, /const boot = async \(\) =>[\s\S]*joinRoom\('domino_2v2'/);
  assert.match(source, /AppState\.addEventListener[\s\S]*joinRoom\('domino_2v2'/);
});
