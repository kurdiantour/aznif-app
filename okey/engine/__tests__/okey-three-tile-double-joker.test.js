const { canDeclareBasicWin } = require("../okey-engine.ts");
const { getMeldScore, getOrderedMeldScore } = require("../okeyengine-melds.ts");

function tile(color, value, copy = 1) {
  return { id: `${color}-${value}-${copy}`, color, value, copy };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const okeyTile = tile("red", 7, 1);
const secondJoker = tile("red", 7, 2);

assert(
  getMeldScore([tile("blue", 11), okeyTile, secondJoker], okeyTile) === null,
  "A three-tile group with two Jokers must be rejected.",
);

assert(
  getMeldScore([tile("blue", 6), okeyTile, secondJoker], okeyTile) === null,
  "A three-tile run with two Jokers must be rejected.",
);

assert(
  getOrderedMeldScore([okeyTile, tile("blue", 6), secondJoker], okeyTile) === null,
  "An ordered three-tile run with two Jokers must be rejected.",
);

assert(
  getMeldScore([tile("blue", 11), tile("black", 11), okeyTile, secondJoker], okeyTile) !== null,
  "The three-tile restriction must not reject a four-tile group with two Jokers.",
);

assert(
  getMeldScore([tile("blue", 5), tile("blue", 6), okeyTile, secondJoker], okeyTile) !== null,
  "The three-tile restriction must not reject a four-tile run with two Jokers.",
);

const winningHandWithForbiddenGroup = [
  tile("blue", 5),
  okeyTile,
  secondJoker,
  tile("red", 10),
  tile("blue", 10),
  tile("black", 10),
  tile("red", 11),
  tile("blue", 11),
  tile("black", 11),
  tile("yellow", 11),
  tile("red", 12),
  tile("blue", 12),
  tile("black", 12),
  tile("yellow", 12),
];

assert(
  canDeclareBasicWin(winningHandWithForbiddenGroup, okeyTile) === false,
  "Basic-win partitioning must reject a hand that depends on a three-tile Meld with two Jokers.",
);

