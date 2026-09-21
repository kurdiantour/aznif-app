import { OkeyCosmeticsResolver } from "@/okey/multiplayer/cosmetics/okeyCosmeticsResolver";
import { DominoCosmeticsResolver } from "@/domino/multiplayer/cosmetics/dominoCosmeticsResolver";
const mockRpc = jest.fn();
const mockOkey = jest.fn();
jest.mock("@/lib/supabase", () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }));
jest.mock("@/okey/multiplayer/okey-room-api", () => ({ getOkeyRoomCosmetics: (...args: unknown[]) => mockOkey(...args) }));
afterEach(() => jest.restoreAllMocks());
for (const game of ["Okey", "1v1", "2v2"] as const) {
  const resolver = game === "Okey" ? new OkeyCosmeticsResolver() : new DominoCosmeticsResolver(game);
  const respond = (value: unknown) => { mockOkey.mockResolvedValue(value); mockRpc.mockResolvedValue({ data: value, error: null }); };
  test(`${game}: carries the authoritative lock marker without inventing one`, async () => {
    const data = { shared_set_asset_key: "future-set", player_set_asset_keys: { alice: "owned-set" } };
    respond(data);
    expect((await resolver.resolveMatchCosmetics("room"))?.locked).toBe(false);
    respond({ ...data, locked: true });
    expect(await resolver.resolveMatchCosmetics("room")).toEqual({ locked: true, sharedSetAssetKey: "future-set", playerSetAssetKeys: { alice: "owned-set" } });
  });
  test(`${game}: malformed or failed responses are errors, not successful Classic snapshots`, async () => {
    for (const data of [null, {}, { locked: true }, { shared_set_asset_key: "valid", player_set_asset_keys: [] }, { shared_set_asset_key: "valid", player_set_asset_keys: { alice: 123 } }]) {
      respond(data); expect(await resolver.resolveMatchCosmetics("room")).toBeNull();
    }
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockOkey.mockRejectedValue(new Error("offline"));
    mockRpc.mockResolvedValue({ data: null, error: new Error("offline") });
    expect(await resolver.resolveMatchCosmetics("room")).toBeNull();
  });
}
