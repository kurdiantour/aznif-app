import { dominoResumeAdapter } from "../domino-resume-adapter";

const mockFrom = jest.fn();
const mockRpc = jest.fn();
const mockChannel = jest.fn();
const mockRemoveChannel = jest.fn();
const mockOn = jest.fn();

jest.mock("@/lib/supabase", () => ({ supabase: {
  from: (...args: unknown[]) => mockFrom(...args),
  rpc: (...args: unknown[]) => mockRpc(...args),
  channel: (...args: unknown[]) => mockChannel(...args),
  removeChannel: (...args: unknown[]) => mockRemoveChannel(...args),
} }));

let room = { id: "room", status: "active", state: { status: "started", matchFinished: false }, currency: "aznif", entry_fee: 3 };
let seat = { room_id: "room", abandoned: false, left_at: null, bot_takeover: true, connected: false };

function query(table: string) {
  const result = table.endsWith("_rooms") ? room : seat;
  const chain: Record<string, any> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.is = () => chain;
  chain.maybeSingle = async () => ({ data: result, error: null });
  chain.order = async () => ({ data: [seat], error: null });
  return chain;
}

beforeEach(() => {
  room = { id: "room", status: "active", state: { status: "started", matchFinished: false }, currency: "aznif", entry_fee: 3 };
  seat = { room_id: "room", abandoned: false, left_at: null, bot_takeover: true, connected: false };
  mockFrom.mockImplementation(query);
  mockRpc.mockResolvedValue({ data: { status: "ok" }, error: null });
  mockChannel.mockImplementation(() => ({ on(...args: unknown[]) { mockOn(...args); return this; }, subscribe() { return this; } }));
});

test("does not offer a server finished match", async () => {
  room.state.matchFinished = true;
  expect(await dominoResumeAdapter.findActive("human")).toBeNull();
});

test("discovers Aznif using room currency and entry fee", async () => {
  const found = await dominoResumeAdapter.findActive("human");
  expect(found).toMatchObject({
    game: "domino", matchId: "room",
    params: { mode: "1v1", playMode: "aznif", entryFee: "3" },
  });
});

test("watches published moves for 1v1 and player rows for 2v2", () => {
  const base = { game: "domino", matchId: "room", route: "/domino/game", params: { mode: "1v1" } };
  const stopOne = dominoResumeAdapter.watch(base, jest.fn());
  expect(mockChannel).toHaveBeenCalledWith("resume:1v1:roster:room");
  expect(mockOn).toHaveBeenCalledWith("postgres_changes", expect.objectContaining({ table: "one_vs_one_moves" }), expect.any(Function));
  stopOne();
  const stopTwo = dominoResumeAdapter.watch({ ...base, params: { mode: "2v2" } }, jest.fn());
  expect(mockChannel).toHaveBeenCalledWith("resume:2v2:roster:room");
  expect(mockOn).toHaveBeenCalledWith("postgres_changes", expect.objectContaining({ table: "two_vs_two_players" }), expect.any(Function));
  stopTwo();
  expect(mockRemoveChannel).toHaveBeenCalledTimes(4);
});

test("reclaims a bot seat before returning", async () => {
  const match = { game: "domino", matchId: "room", route: "/domino/game", params: { mode: "1v1" } };
  expect(await dominoResumeAdapter.returnToMatch(match, "human")).toBe(true);
  expect(mockRpc).toHaveBeenCalledWith("restore_one_vs_one_human_control", { p_room_id: "room" });
});
