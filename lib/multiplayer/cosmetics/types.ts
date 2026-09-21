export type MultiplayerCosmeticsResolution = {
  /** True only for a persisted match snapshot. */
  locked?: boolean;
  /**
   * Asset key of the set selected for shared multiplayer cosmetics.
   *
   * The multiplayer layer intentionally does not know what visual pieces
   * a game derives from this set. For example, Okey uses this set for
   * the shared Table + Tiles.
   */
  sharedSetAssetKey: string;

  /**
   * Equipped set asset key for each player in the match.
   *
   * Game-specific adapters decide how these assets are rendered.
   * For example, Okey uses each player's own set for their Rack.
   */
  playerSetAssetKeys: Record<string, string>;
};

export interface MultiplayerCosmeticsResolver {
  resolveMatchCosmetics(
    matchId: string,
  ): Promise<MultiplayerCosmeticsResolution | null>;
}