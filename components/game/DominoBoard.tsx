import DominoTile from "@/components/game/DominoTile";
import { createPlacedTile } from "@/domino/core/engine/kozel-engine";
import { DominoTileData, GameState, KozelBranch } from "@/domino/types/domino-game";
import { createContext, useContext, useMemo } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";

type Direction = "right" | "left" | "down" | "up";
type BoardTile = GameState["board"]["branches"][KozelBranch]["tiles"][number];
type Boundary = { edgePadding: number; safeHorizontalPadding: number; safeVerticalPadding: number };
type Position = { tile: BoardTile; x: number; y: number; direction: Direction };
export type BoardPreviewTarget = { branch: KozelBranch; x: number; y: number; width: number; height: number; scale: number };
type Bounds = { minX: number; maxX: number; minY: number; maxY: number };
type WinningContext = { tileId: string | null; translateY: Animated.Value; scale: Animated.Value; emphasisOpacity: Animated.Value; centerProgress: Animated.Value; rotation: Animated.Value };

const TILE_GAP = 1;
const BASE_TILE_WIDTH = 46;
const BASE_TILE_HEIGHT = 80;
// Prefer the slightly larger presentation while it fits, then progressively
// shrink long chains so every played tile remains inside the board.
const ZOOM_LEVELS = [1.1, 1, 0.9, 0.86] as const;
const WinningTileAnimationContext = createContext<WinningContext | null>(null);

function isHorizontal(direction: Direction) { return direction === "left" || direction === "right"; }
function vector(direction: Direction) {
  return direction === "left" ? { x: -1, y: 0 } : direction === "right" ? { x: 1, y: 0 } : direction === "up" ? { x: 0, y: -1 } : { x: 0, y: 1 };
}
function snap(value: number) { return Math.round(value); }
function slotSize(tile: BoardTile, direction: Direction, width: number, height: number) {
  if (tile.left === tile.right) return isHorizontal(direction) ? { width, height } : { width: height, height: width };
  return isHorizontal(direction) ? { width: height, height: width } : { width, height };
}
function rotationFor(tile: DominoTileData, direction: Direction): 0 | 90 | 180 | 270 {
  if (tile.left === tile.right) return isHorizontal(direction) ? 0 : 90;
  const low = Math.min(tile.left, tile.right);
  const connected = "connectedValue" in tile ? (tile as BoardTile).connectedValue : tile.left;
  const connectedIsLow = connected === low;
  if (direction === "right") return connectedIsLow ? 270 : 90;
  if (direction === "left") return connectedIsLow ? 90 : 270;
  if (direction === "down") return connectedIsLow ? 0 : 180;
  return connectedIsLow ? 180 : 0;
}
function centerRotation(tile: GameState["board"]["centerTile"]): 0 | 90 | 270 {
  if (!tile || tile.left === tile.right) return 0;
  return tile.left < tile.right ? 270 : 90;
}
function placeFromCursor(tile: BoardTile, direction: Direction, cursor: { x: number; y: number }, width: number, height: number, previousDirection?: Direction, previousSize?: { width: number; height: number }, placeAbovePrevious = false, placeBelowPrevious = false) {
  const size = slotSize(tile, direction, width, height);
  const move = vector(direction);
  const previous = previousDirection ? vector(previousDirection) : { x: 0, y: 0 };
  const turned = previousDirection !== undefined && previousDirection !== direction;
  const previousWidth = previousSize?.width ?? 0;
  const previousHeight = previousSize?.height ?? 0;
  return {
    x: snap(placeAbovePrevious ? cursor.x + previousWidth / 2 : placeBelowPrevious ? cursor.x - previousWidth / 2 : cursor.x - previous.x * (turned ? size.width / 2 : 0) + move.x * (turned ? previousWidth / 2 + TILE_GAP + size.width / 2 : size.width / 2 + TILE_GAP)),
    y: snap(placeAbovePrevious ? cursor.y - TILE_GAP - size.height / 2 : placeBelowPrevious ? cursor.y + TILE_GAP + size.height / 2 : cursor.y - previous.y * (turned ? size.height / 2 : 0) + move.y * (turned ? previousHeight / 2 + TILE_GAP + size.height / 2 : size.height / 2 + TILE_GAP)),
    ...size,
    move,
  };
}
function fitsAxis(x: number, y: number, width: number, height: number, direction: Direction, boardWidth: number, boardHeight: number, edge: number) {
  const halfWidth = Math.max(0, boardWidth / 2 - edge);
  const halfHeight = Math.max(0, boardHeight / 2 - edge);
  return isHorizontal(direction) ? x - width / 2 >= -halfWidth && x + width / 2 <= halfWidth : y - height / 2 >= -halfHeight && y + height / 2 <= halfHeight;
}
function buildPath(branch: KozelBranch, tiles: BoardTile[], tileWidth: number, tileHeight: number, centerWidth: number, centerHeight: number, boardWidth: number, boardHeight: number, edge: number): Position[] {
  if (!tiles.length) return [];
  const horizontal = branch === "left" || branch === "right";
  const primary: Direction = branch;
  const turn: Direction = horizontal ? branch === "right" ? "down" : "up" : branch === "up" ? "right" : "left";
  const returning: Direction | null = horizontal ? branch === "right" ? "left" : "right" : null;
  const primaryVector = vector(primary);
  let cursor = { x: primaryVector.x * centerWidth / 2, y: primaryVector.y * centerHeight / 2 };
  let segment = 0;
  let tilesInSegment = 0;
  let previousDirection: Direction | undefined;
  let previousSize: { width: number; height: number } | undefined;
  let previousWasDouble = false;
  return tiles.map((tile) => {
    let direction: Direction = segment === 0 ? primary : segment === 1 ? turn : returning!;
    // A double reached immediately after a vertical leg remains on that leg;
    // the following tile starts the horizontal continuation.
    if (
      (branch === "up" || branch === "down") &&
      segment === 1 &&
      previousDirection === branch &&
      tile.left === tile.right
    ) {
      direction = branch;
    }
    const shouldPlaceAbovePrevious = branch === "up" && previousDirection === "up" && direction === "right" && tile.left !== tile.right && !previousWasDouble;
    const shouldPlaceBelowPrevious = branch === "down" && previousDirection === "down" && direction === "left" && tile.left !== tile.right && !previousWasDouble;
    let placed = placeFromCursor(tile, direction, cursor, tileWidth, tileHeight, previousDirection, previousSize, shouldPlaceAbovePrevious, shouldPlaceBelowPrevious);
    if (!fitsAxis(placed.x, placed.y, placed.width, placed.height, direction, boardWidth, boardHeight, edge)) {
      if (segment === 0) {
        segment = 1;
        tilesInSegment = 0;
      } else if (horizontal && segment === 1 && tilesInSegment >= 2) {
        // Keep two tiles on the vertical leg before the return-row bend.
        segment = 2;
        tilesInSegment = 0;
      }
      direction = segment === 0 ? primary : segment === 1 ? turn : returning!;
      placed = placeFromCursor(tile, direction, cursor, tileWidth, tileHeight, previousDirection, previousSize, branch === "up" && previousDirection === "up" && direction === "right" && tile.left !== tile.right && !previousWasDouble, branch === "down" && previousDirection === "down" && direction === "left" && tile.left !== tile.right && !previousWasDouble);
    }
    // Keep the exact exit edge. The next placement is responsible for adding
    // TILE_GAP, so turns do not inherit a stale gap from the old direction.
    cursor = { x: placed.x + placed.move.x * placed.width / 2, y: placed.y + placed.move.y * placed.height / 2 };
    previousDirection = direction;
    previousSize = { width: placed.width, height: placed.height };
    previousWasDouble = tile.left === tile.right;
    tilesInSegment += 1;

    // Vertical branches use one tile before continuing horizontally.
    if ((branch === "up" || branch === "down") && segment === 0) {
      segment = 1;
      tilesInSegment = 0;
    }
    return { tile, x: placed.x, y: placed.y, direction };
  });
}
function include(bounds: Bounds | null, x: number, y: number, width: number, height: number): Bounds {
  const next = { minX: x - width / 2, maxX: x + width / 2, minY: y - height / 2, maxY: y + height / 2 };
  return bounds ? { minX: Math.min(bounds.minX, next.minX), maxX: Math.max(bounds.maxX, next.maxX), minY: Math.min(bounds.minY, next.minY), maxY: Math.max(bounds.maxY, next.maxY) } : next;
}
function getZoom(board: GameState["board"], width: number, height: number, tileWidth: number, tileHeight: number, centerWidth: number, centerHeight: number, boundary: Boundary) {
  let bounds: Bounds | null = null;
  if (board.centerTile) {
    const size = board.centerTile.left === board.centerTile.right ? { width: tileWidth, height: tileHeight } : { width: tileHeight, height: tileWidth };
    bounds = include(bounds, 0, 0, size.width, size.height);
  }
  for (const branch of ["left", "right", "up", "down"] as const) for (const position of buildPath(branch, board.branches[branch].tiles, tileWidth, tileHeight, centerWidth, centerHeight, width, height, boundary.edgePadding)) {
    const size = slotSize(position.tile, position.direction, tileWidth, tileHeight);
    bounds = include(bounds, position.x, position.y, size.width, size.height);
  }
  if (!bounds) return 1;
  const safeWidth = Math.max(0, width / 2 - boundary.safeHorizontalPadding);
  const safeHeight = Math.max(0, height / 2 - boundary.safeVerticalPadding);
  return ZOOM_LEVELS.find((scale) => bounds!.minX * scale >= -safeWidth && bounds!.maxX * scale <= safeWidth && bounds!.minY * scale >= -safeHeight && bounds!.maxY * scale <= safeHeight) ?? ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
}
function BranchTile({ position, tileWidth, tileHeight, zIndex = 20 }: { position: Position; tileWidth: number; tileHeight: number; zIndex?: number }) {
  const winning = useContext(WinningTileAnimationContext);
  const preview = "__placementPreview" in position.tile;
  const previewTile = position.tile as BoardTile & { __previewBranch?: KozelBranch; __onPreviewPress?: (branch: KozelBranch) => void };
  const size = slotSize(position.tile, position.direction, tileWidth, tileHeight);
  return <Pressable pointerEvents={preview ? "auto" : "none"} onPress={previewTile.__previewBranch ? () => previewTile.__onPreviewPress?.(previewTile.__previewBranch!) : undefined} style={[styles.tile, preview && styles.preview, { width: size.width, height: size.height, left: "50%", top: "50%", marginLeft: position.x - size.width / 2, marginTop: position.y - size.height / 2, zIndex }]}>
    <DominoTile tile={position.tile} width={tileWidth} height={tileHeight} rotation={rotationFor(position.tile, position.direction)} />
    {winning?.tileId === position.tile.id && <Animated.View pointerEvents="none" style={[styles.winner, { width: size.width, height: size.height, opacity: winning.emphasisOpacity, transform: [{ translateX: Animated.multiply(winning.centerProgress, -position.x) }, { translateY: Animated.add(Animated.multiply(winning.centerProgress, -position.y), winning.translateY) }, { rotate: winning.rotation.interpolate({ inputRange: [0, 1080], outputRange: ["0deg", "1080deg"] }) }, { scale: winning.scale }] }]}><DominoTile tile={position.tile} width={tileWidth} height={tileHeight} rotation={rotationFor(position.tile, position.direction)} /></Animated.View>}
  </Pressable>;
}

type Props = { board: GameState["board"]; selectedTile: DominoTileData | null; selectableBranches: KozelBranch[]; onSelectBranch?: (branch: KozelBranch) => void; boardWidth: number; boardHeight: number; boundary: Boundary; winningTileId: string | null; winningTranslateY: Animated.Value; winningScale: Animated.Value; winningEmphasisOpacity: Animated.Value; winningCenterProgress: Animated.Value; winningRotation: Animated.Value; isCenterFinalTile: boolean; centerFinalTransform: any };
export function getDominoBoardTileMetrics(board: GameState["board"], boardWidth: number, boardHeight: number) {
  const estimate = (tiles: BoardTile[], direction: Direction) => tiles.reduce((total, tile) => {
    const size = slotSize(tile, direction, BASE_TILE_WIDTH, BASE_TILE_HEIGHT);
    return total + (isHorizontal(direction) ? size.width : size.height) + TILE_GAP;
  }, 0);
  const horizontalNeed = Math.max(
    BASE_TILE_HEIGHT * 4,
    Math.min(estimate(board.branches.left.tiles, "right"), BASE_TILE_HEIGHT * 6),
    Math.min(estimate(board.branches.right.tiles, "right"), BASE_TILE_HEIGHT * 6),
  );
  const verticalNeed = Math.max(
    BASE_TILE_HEIGHT * 2,
    Math.min(estimate(board.branches.up.tiles, "down"), BASE_TILE_HEIGHT * 5),
    Math.min(estimate(board.branches.down.tiles, "down"), BASE_TILE_HEIGHT * 5),
  );
  const rawScale = Math.min(
    Math.max(120, boardWidth / 2 - BASE_TILE_HEIGHT) / Math.max(horizontalNeed, 1),
    Math.max(90, boardHeight / 2 - BASE_TILE_HEIGHT) / Math.max(verticalNeed, 1),
  );
  const scale = rawScale < 0.72 ? 0.58 : rawScale < 0.9 ? 0.78 : 1.2;
  const tileWidth = Math.round(BASE_TILE_WIDTH * scale);
  const tileHeight = Math.round(BASE_TILE_HEIGHT * scale);
  const centerIsDouble = board.centerTile?.left === board.centerTile?.right;
  return { tileWidth, tileHeight, centerWidth: centerIsDouble ? tileWidth : tileHeight, centerHeight: centerIsDouble ? tileHeight : tileWidth };
}
export function getDominoBoardPreviewTargets(board: GameState["board"], selectedTile: DominoTileData | null, selectableBranches: KozelBranch[], boardWidth: number, boardHeight: number, boundary: Boundary): BoardPreviewTarget[] {
  if (!selectedTile) return [];
  const layout = getDominoBoardTileMetrics(board, boardWidth, boardHeight);
  const zoom = getZoom(board, boardWidth, boardHeight, layout.tileWidth, layout.tileHeight, layout.centerWidth, layout.centerHeight, boundary);
  const pathBoardWidth = boardWidth / zoom;
  const pathBoardHeight = boardHeight / zoom;
  return selectableBranches.flatMap((branch) => {
    const openValue = board.branches[branch].openValue;
    if (openValue === null) return [];
    const tile = createPlacedTile(selectedTile, branch, openValue, board.branches[branch].tiles.length) as BoardTile;
    const path = buildPath(branch, [...board.branches[branch].tiles, tile], layout.tileWidth, layout.tileHeight, layout.centerWidth, layout.centerHeight, pathBoardWidth, pathBoardHeight, boundary.edgePadding);
    const position = path[path.length - 1];
    if (!position) return [];
    const size = slotSize(tile, position.direction, layout.tileWidth, layout.tileHeight);
    return [{ branch, x: position.x, y: position.y, width: size.width, height: size.height, scale: zoom }];
  });
}
export default function DominoBoard(props: Props) {
  const { board, boardWidth, boardHeight, boundary } = props;
  const layout = useMemo(() => getDominoBoardTileMetrics(board, boardWidth, boardHeight), [board, boardWidth, boardHeight]);
  const zoom = useMemo(() => getZoom(board, boardWidth, boardHeight, layout.tileWidth, layout.tileHeight, layout.centerWidth, layout.centerHeight, boundary), [board, boardWidth, boardHeight, layout, boundary]);
  // Path decisions use the logical area visible after scaling. Otherwise a
  // branch bends using the unzoomed width and leaves unused space at the edge.
  const pathBoardWidth = boardWidth / zoom;
  const pathBoardHeight = boardHeight / zoom;
  const openingBranch = props.selectableBranches[0];
  const emptyOpeningTargetWidth = layout.tileHeight * 1.2;
  const emptyOpeningTargetHeight = layout.tileWidth * 1.2;
  const preview = (branch: KozelBranch) => {
    if (!props.selectedTile || board.branches[branch].openValue === null) return null;
    const tile = { ...createPlacedTile(props.selectedTile, branch, board.branches[branch].openValue!, board.branches[branch].tiles.length), __placementPreview: true, __previewBranch: branch, __onPreviewPress: props.onSelectBranch } as unknown as BoardTile;
    const path = buildPath(branch, [...board.branches[branch].tiles, tile], layout.tileWidth, layout.tileHeight, layout.centerWidth, layout.centerHeight, pathBoardWidth, pathBoardHeight, boundary.edgePadding);
    const position = path[path.length - 1];
    return position ? <BranchTile key={`preview-${branch}-${tile.id}`} position={position} tileWidth={layout.tileWidth} tileHeight={layout.tileHeight} zIndex={80} /> : null;
  };
  return <Animated.View style={[StyleSheet.absoluteFillObject, { transform: [{ scale: zoom }] }]}><WinningTileAnimationContext.Provider value={{ tileId: props.winningTileId, translateY: props.winningTranslateY, scale: props.winningScale, emphasisOpacity: props.winningEmphasisOpacity, centerProgress: props.winningCenterProgress, rotation: props.winningRotation }}>
    {!board.centerTile && <Pressable
      disabled={!props.selectedTile || !openingBranch}
      onPress={() => openingBranch && props.onSelectBranch?.(openingBranch)}
      style={[styles.openingTarget, {
        width: props.selectedTile ? layout.centerWidth : emptyOpeningTargetWidth,
        height: props.selectedTile ? layout.centerHeight : emptyOpeningTargetHeight,
        marginLeft: -(props.selectedTile ? layout.centerWidth : emptyOpeningTargetWidth) / 2,
        marginTop: -(props.selectedTile ? layout.centerHeight : emptyOpeningTargetHeight) / 2,
      }]}
    >
      {props.selectedTile ? <View style={styles.openingPreview}>
        <DominoTile tile={props.selectedTile} width={layout.tileWidth} height={layout.tileHeight} rotation={centerRotation(props.selectedTile)} />
      </View> : <>
        <Text style={styles.openingPlus}>+</Text>
      </>}
    </Pressable>}
    <View pointerEvents="none" style={[styles.center, { width: layout.centerWidth, height: layout.centerHeight, marginLeft: -layout.centerWidth / 2, marginTop: -layout.centerHeight / 2, opacity: props.isCenterFinalTile ? 0 : 1 }]}>{board.centerTile && <DominoTile tile={board.centerTile} width={layout.tileWidth} height={layout.tileHeight} rotation={centerRotation(board.centerTile)} />}</View>
    {props.isCenterFinalTile && board.centerTile && <Animated.View pointerEvents="none" style={[styles.center, styles.centerWinner, { width: layout.centerWidth, height: layout.centerHeight, marginLeft: -layout.centerWidth / 2, marginTop: -layout.centerHeight / 2, zIndex: 220, transform: props.centerFinalTransform }]}><DominoTile tile={board.centerTile} width={layout.tileWidth} height={layout.tileHeight} rotation={centerRotation(board.centerTile)} /></Animated.View>}
    {(["left", "right", "up", "down"] as const).flatMap((branch) => buildPath(branch, board.branches[branch].tiles, layout.tileWidth, layout.tileHeight, layout.centerWidth, layout.centerHeight, pathBoardWidth, pathBoardHeight, boundary.edgePadding).map((position, index) => <BranchTile key={`${branch}-${position.tile.order}-${position.tile.id}`} position={position} tileWidth={layout.tileWidth} tileHeight={layout.tileHeight} zIndex={20 + index} />))}
    {props.selectedTile && props.selectableBranches.map(preview)}
  </WinningTileAnimationContext.Provider></Animated.View>;
}
const styles = StyleSheet.create({ tile: { position: "absolute", alignItems: "center", justifyContent: "center" }, preview: { opacity: 0.5 }, center: { position: "absolute", left: "50%", top: "50%", alignItems: "center", justifyContent: "center", zIndex: 30 }, centerWinner: { elevation: 14, borderWidth: 3, borderColor: "#f6c945", borderRadius: 7, backgroundColor: "rgba(246,201,69,0.18)", shadowColor: "#f6c945", shadowOpacity: 0.9, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }, openingTarget: { position: "absolute", left: "50%", top: "50%", alignItems: "center", justifyContent: "center", zIndex: 70, borderWidth: 2, borderStyle: "dashed", borderColor: "rgba(246,201,69,0.9)", borderRadius: 8, backgroundColor: "rgba(246,201,69,0.12)" }, openingPreview: { opacity: 0.55 }, openingPlus: { color: "#f6c945", fontSize: 25, lineHeight: 26, fontFamily: "RobotoMedium" }, openingHint: { position: "absolute", top: "100%", width: 120, marginTop: 7, textAlign: "center", color: "rgba(255,255,255,0.78)", fontSize: 12, fontFamily: "RobotoMedium" }, winner: { position: "absolute", left: 0, top: 0, alignItems: "center", justifyContent: "center", zIndex: 300, elevation: 14, borderWidth: 3, borderColor: "#f6c945", borderRadius: 7, backgroundColor: "rgba(246,201,69,0.18)", shadowColor: "#f6c945", shadowOpacity: 0.9, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } } });
