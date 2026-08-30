import { StyleSheet } from "react-native";
import { RACK_BOTTOM_BASE, RACK_DEFAULT_PADDING_HORIZONTAL, RACK_HEIGHT, RACK_TURN_TIMER_HEIGHT, RACK_TURN_TIMER_LEFT, RACK_TURN_TIMER_RIGHT, RACK_TURN_TIMER_TOP } from "../layout/uiPositions";

export const RACK_ROW_CAPACITY = 12;
export const RACK_TILE_WIDTH = 45;
export const RACK_TILE_HEIGHT = 57;
export const RACK_TILE_ASPECT_RATIO = RACK_TILE_HEIGHT / RACK_TILE_WIDTH;
export const RACK_TILE_GAP = 0;
export const RACK_TILE_MIN_STRIDE = 18;
export const RACK_TILE_SIDE_PADDING = 0;

export const styles = StyleSheet.create({
  screen: { flex: 1, position: "relative", marginHorizontal: -24, marginTop: -56, marginBottom: -12, paddingHorizontal: 10, paddingTop: 4, paddingBottom: 8 },
  tableArea: { flex: 1, paddingTop: 0 },
  activeDiscardDragTableLayer: { zIndex: 10000, elevation: 10000 },
tableSurface: {
  flex: 1,
  borderRadius: 30,
  overflow: "visible",
},  feltTexture: { ...StyleSheet.absoluteFillObject, opacity: 0.2, borderWidth: 8, borderColor: "rgba(255,255,255,0.025)" },
  opponentSeat: { position: "absolute", alignItems: "center", gap: 0, zIndex: 500, elevation: 500 },
  topSeat: { top: 8, alignSelf: "center" },


leftSeat: {
  left: -20,
  top: "42%",
  transform: [
    { rotate: "-90deg" },
    { translateY: -30 },
  ],
},

rightSeat: {
  right: -20,
  top: "42%",
  transform: [
    { rotate: "90deg" },
    { translateY: -30 },
  ],
},
opponentRack: {
  height: 26,
  minWidth: 112,
  paddingHorizontal: 8,
  borderRadius: 8,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "flex-start",
  backgroundColor: "rgba(76,40,17,0.72)",
  borderWidth: 1,
  borderColor: "rgba(255,220,150,0.24)",
},

namePlate: {
  width: 96,
  maxWidth: 96,
  minWidth: 0,
  overflow: "hidden",
  height: 20,
  paddingHorizontal: 12,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  backgroundColor: "rgba(0,0,0,0.32)"
},

nameText: {
  flexShrink: 1,
  width: "100%",
  color: "#f8edd0",
  fontSize: 13,
  textAlign: "center",
},
  countText: { color: "#f8d774", fontSize: 11, fontFamily: "SpedaRegular" },
  tableMeldLayer: { ...StyleSheet.absoluteFillObject, zIndex: 7 },
meldArea: {
  alignItems: "flex-start",
},
  leftMeldArea: {
    direction: "ltr",
    alignItems: "flex-start",
  },
  topMeldContent: {
    alignItems: "flex-end",
  },
  meldPlacementGuide: {
    minHeight: 54,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(248,215,116,0.58)",
    borderRadius: 8,
    backgroundColor: "rgba(248,215,116,0.10)",
  },



meldContent: {
  position: "relative",
  width: "100%",
  minHeight: 50,
  flexDirection: "column",
  alignItems: "flex-start",
  justifyContent: "flex-start",
  rowGap: 2,
},

eliminatedMeldOverlay: {
  ...StyleSheet.absoluteFillObject,
  zIndex: 100,
  borderRadius: 8,
  backgroundColor: "rgba(255,255,255,0.42)",
},

meldRow: {
  flexDirection: "row",
  alignItems: "flex-end",
  columnGap: 4,
},

meldPreview: {
  flexDirection: "row",
  alignItems: "flex-end",
  position: "relative",
  gap: 0,
},
  meldDropHighlight: { ...StyleSheet.absoluteFillObject, left: -5, right: -5, top: -5, bottom: -5, borderWidth: 2, borderColor: "#f8d774", borderRadius: 7, backgroundColor: "rgba(248,215,116,0.12)", shadowColor: "#f8d774", shadowOpacity: 0.95, shadowRadius: 8, zIndex: 40, elevation: 40 },
  jokerEndpointChoice: { position: "absolute", top: "50%", marginTop: -13, minWidth: 26, height: 26, paddingHorizontal: 6, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "#f8d774", borderWidth: 1, borderColor: "#fff4bd", zIndex: 80, elevation: 80, shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 3 },
  jokerEndpointChoiceStart: { left: -34 },
  jokerEndpointChoiceEnd: { right: -34 },
  jokerEndpointChoiceText: { color: "#2b2106", fontSize: 12, fontFamily: "RobotoBold" },
  humanMeldDropZone: { zIndex: 90, elevation: 90, justifyContent: "flex-start" },
  previewMeldContent: { zIndex: 91, elevation: 91, width: "100%", minHeight: 50, flexDirection: "column", alignItems: "flex-start", justifyContent: "flex-start", rowGap: 2 },
  stagingArea: { position: "absolute", left: "38%", right: "38%", bottom: 116, height: 40, alignItems: "center", justifyContent: "flex-end" },
  stagingRail: { width: "100%", height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.34)" },
  okeyMiniScoreBoard: { position: "absolute", left: 25, top: 22, zIndex: 230, elevation: 230, minWidth: 128, height: 34, flexDirection: "row", alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: "rgba(255,255,255,0.12)", borderWidth: 1, borderColor: "rgba(248, 243, 223, 0.22)", overflow: "hidden" },
  okeyMiniScoreItem: { width: 62, height: "100%", alignItems: "center", justifyContent: "center" },
  okeyMiniScoreLabel: { color: "rgba(255,247,218,0.62)", fontSize: 7, fontFamily: "SpedaRegular" },
  okeyMiniScoreValue: { color: "#f8d774", fontSize: 14, lineHeight: 17, fontFamily: "SpedaRegular" },
  okeyMiniScoreDivider: { width: 1, height: 22, backgroundColor: "rgba(255,247,218,0.18)" },
  playerSetScoreWrap: { position: "absolute", right: 42, bottom: 22, zIndex: 220, elevation: 220, alignItems: "center", gap: 6 },
  openSetsButton: { minWidth: 82, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(248,215,116,0.92)", borderWidth: 1, borderColor: "rgba(255,247,218,0.72)" },
  openSetsButtonText: { color: "#182012", fontSize: 12, fontFamily: "SpedaRegular" },
  playerSetScore: { minWidth: 82, height: 42, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(8,17,12,0.58)", borderWidth: 1, borderColor: "rgba(248,215,116,0.34)" },
  playerSetScoreLabel: { color: "rgba(255,247,218,0.68)", fontSize: 8, fontFamily: "SpedaRegular" },
  playerSetScoreValue: { color: "#f8d774", fontSize: 18, lineHeight: 21, fontFamily: "SpedaRegular" },

playerSetScoreValueRow: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  direction: "ltr",
},

playerSetScoreTarget: {
  color: "#f8d774",
  fontSize: 18,
  lineHeight: 21,
  fontFamily: "SpedaRegular",
},

playerSetScoreSlash: {
  color: "rgba(255,255,255,0.38)",
  fontSize: 16,
  lineHeight: 21,
  fontFamily: "SpedaRegular",
},

playerSetScoreCurrent: {
  color: "rgba(255,255,255,0.70)",
  fontSize: 18,
  lineHeight: 21,
  fontFamily: "SpedaRegular",
},

  centerPiles: { position: "absolute", left: 0, right: 0, top: "34%", height: 140, flexDirection: "row", alignItems: "flex-start", justifyContent: "center", gap: 54, zIndex: 180, elevation: 180 },
  activeDiscardDragLayer: { zIndex: 10000, elevation: 10000 },
  indicatorTileSpot: { position: "absolute", left: 4, top: -30, width: 42, height: 58, alignItems: "center", justifyContent: "center", zIndex: 0, elevation: 0 },

  drawStackNatural: { width: 50, height: 72, alignItems: "center", justifyContent: "flex-start" },
  drawStackLayer: { position: "absolute", left: 4, transform: [{ rotate: "0deg" }] },
  
deckCount: {
  position: "absolute",
  bottom: -10,
  left: 4,
  width: 42,
  textAlign: "center",
  color: "rgba(255,247,218,0.78)",
  fontSize: 10,
  fontFamily: "SpedaRegular",
},
  discardCount: { position: "absolute", bottom: -8, minWidth: 18, height: 14, borderRadius: 7, textAlign: "center", color: "#1b1426", backgroundColor: "rgba(248,215,116,0.92)", overflow: "hidden", fontSize: 9, lineHeight: 14, fontFamily: "SpedaRegular" },
  discardPileNatural: { width: 92, height: 82, alignItems: "center", justifyContent: "center" },
  discardUnderTile: { position: "absolute", opacity: 0.96 },
  discardUnderLeft: { left: 15, top: 20, transform: [{ rotate: "-24deg" }] },
  discardUnderRight: { right: 14, top: 19, transform: [{ rotate: "22deg" }] },
  discardUnderBottom: { left: 29, bottom: 12, transform: [{ rotate: "8deg" }] },
  emptyDiscard: { width: 42, height: 58, borderRadius: 5, borderWidth: 1, borderColor: "rgba(255,247,218,0.14)" },
  disabled: { opacity: 0.42 },
  rackWrap: { position: "absolute", left: 0, right: 0, bottom: RACK_BOTTOM_BASE, height: RACK_HEIGHT, paddingHorizontal: RACK_DEFAULT_PADDING_HORIZONTAL, alignItems: "center", zIndex: 50 },
  playerRack: { width: "100%", maxWidth: 575, aspectRatio: 2014 / 510, position: "relative", overflow: "visible", direction: "ltr", shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 20 },
  rackImage: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  rackTileViewport: {
  position: "absolute",
  left: "3%",
  right: "3%",
  top: "6%",
  height: "88%",
  overflow: "visible",
  zIndex: 4,
  elevation: 4,
  direction: "ltr",
},
  activeRackDragViewport: { zIndex: 200, elevation: 200 },
  flippingJokerRackViewport: { zIndex: 6000, elevation: 6000 },
  activeRackDragLayer: {
  zIndex: 10000,
  elevation: 10000,
},
  rackScroll: { width: "100%", minWidth: "100%", alignItems: "stretch", justifyContent: "center", paddingHorizontal: RACK_TILE_SIDE_PADDING, direction: "ltr" },
  rackRows: { width: "100%", height: "100%", justifyContent: "space-between", direction: "ltr" },
  rackRail: { width: "100%", height: "47%", overflow: "visible", justifyContent: "flex-end", direction: "ltr" },
  rackRow: { width: "100%", height: "100%", flexDirection: "row", alignItems: "flex-end", columnGap: RACK_TILE_GAP, direction: "ltr" },
  rackSlot: { position: "relative", alignItems: "center", justifyContent: "flex-end" },
  hiddenRackTile: { opacity: 0 },
  draggedTileOverlay: { position: "absolute", left: 0, top: 0, zIndex: 5000, elevation: 5000 },
tileFlightOverlay: {
  position: "absolute",
  zIndex: 800,
  elevation: 800,
}, 
 
turnTimerTrack: {
  position: "absolute",
  overflow: "hidden",
  backgroundColor: "rgba(36,8,8,0.62)",
  borderRadius: 999,
  borderWidth: 1,
  borderColor: "rgba(255,180,180,0.28)",

  zIndex: 3,
  elevation: 3,
},
  turnTimerTrackHorizontal: { flexDirection: "row", alignItems: "stretch" },
  turnTimerTrackVertical: { flexDirection: "column", justifyContent: "flex-end", alignItems: "stretch" },
  turnTimerReverseHorizontal: { flexDirection: "row-reverse" },
  turnTimerReverseVertical: { justifyContent: "flex-start" },
  turnTimerFill: { backgroundColor: "#ef2424", shadowColor: "#ef2424", shadowOpacity: 0.7, shadowRadius: 6, overflow: "hidden" },
  turnTimerFillDraw: { backgroundColor: "#168a45", shadowColor: "#35d06f" },
  rackTurnTimer: { left: RACK_TURN_TIMER_LEFT, right: RACK_TURN_TIMER_RIGHT, top: RACK_TURN_TIMER_TOP, height: RACK_TURN_TIMER_HEIGHT },
  opponentTimerTop: { left: 0, right: 0, top: -7, height: 4 },
  
opponentTimerLeft: {
  left: 0,
  right: 0,
  top: -7,
  height: 4,
},

opponentTimerRight: {
  left: 0,
  right: 0,
  top: -7,
  height: 4,
},
rackSlotIndicator: {
  position: "absolute",
  left: 2,
  right: 2,
  top: 2,
  bottom: 2,

  borderRadius: 8,

  borderWidth: 1,
backgroundColor: "rgba(248,215,116,0.12)",
borderColor: "rgba(248,215,116,0.20)",

  zIndex: 40,
  elevation: 40,
},  tileShadow: { width: 46, height: 60, borderRadius: 6, shadowColor: "#000", shadowOpacity: 0.34, shadowRadius: 4, shadowOffset: { width: 0, height: 3 }, elevation: 5 },
  tileShadowCompact: { width: 42, height: 58 },
  selectedTile: { zIndex: 20, elevation: 20 },
  tileImage: { width: "100%", height: "100%" },
  okeyChip: { position: "absolute", top: 2, right: 2, width: 13, height: 13, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: "#facc15" },
  okeyChipText: { color: "#221309", fontSize: 8, fontFamily: "SpedaRegular" },
tileBack: {
  width: 42,
  height: 58,
  borderRadius: 6,
  alignItems: "center",
  justifyContent: "center"
},
  tileBackSmall: { width: 20, height: 28, marginHorizontal: -2, borderRadius: 4 },
});

















