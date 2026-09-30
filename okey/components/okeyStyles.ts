import { StyleSheet } from "react-native";

import {
  OPPONENT_TILE_HEIGHT,
  OPPONENT_TILE_WIDTH,
  PLAYER_TILE_ASPECT_RATIO,
  PLAYER_TILE_WIDTH,
  RACK_TURN_TIMER_HEIGHT,
  RACK_TURN_TIMER_LEFT,
  RACK_TURN_TIMER_RIGHT,
  RACK_TURN_TIMER_TOP,
} from "../layout/uiPositions";

export const RACK_ROW_CAPACITY = 12;
export const RACK_TILE_WIDTH = PLAYER_TILE_WIDTH;
export const RACK_TILE_ASPECT_RATIO = PLAYER_TILE_ASPECT_RATIO;
export const RACK_TILE_GAP = 0;
export const RACK_TILE_SIDE_PADDING = 0;

export const styles = StyleSheet.create({
  screen: {
    flex: 1,
    position: "relative",
  },

  tableArea: {
    flex: 1,
    paddingTop: 0,
  },

  activeDiscardDragTableLayer: {
    zIndex: 10000,
    elevation: 10000,
  },

  tableSurface: {
    flex: 1,
    borderRadius: 30,
    overflow: "visible",
  },

  feltTexture: {
    ...StyleSheet.absoluteFill,
    opacity: 0.2,
    borderWidth: 8,
    borderColor: "rgba(255,255,255,0.025)",
  },

  tableMeldLayer: {
    ...StyleSheet.absoluteFill,
    zIndex: 7,
  },

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
    ...StyleSheet.absoluteFill,
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

  meldDropHighlight: {
    ...StyleSheet.absoluteFill,
    left: -5,
    right: -5,
    top: -5,
    bottom: -5,
    borderWidth: 2,
    borderColor: "#f8d774",
    borderRadius: 7,
    backgroundColor: "rgba(248,215,116,0.12)",
    shadowColor: "#f8d774",
    shadowOpacity: 0.95,
    shadowRadius: 8,
    zIndex: 40,
    elevation: 40,
  },

  jokerEndpointChoice: {
    position: "absolute",
    top: "50%",
    marginTop: -13,
    minWidth: 26,
    height: 26,
    paddingHorizontal: 6,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8d774",
    borderWidth: 1,
    borderColor: "#fff4bd",
    zIndex: 80,
    elevation: 80,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 3,
  },

  jokerEndpointChoiceStart: {
    left: -34,
  },

  jokerEndpointChoiceEnd: {
    right: -34,
  },

  jokerEndpointChoiceText: {
    color: "#2b2106",
    fontSize: 12,
    fontFamily: "RobotoBold",
  },

  humanMeldDropZone: {
    zIndex: 90,
    elevation: 90,
    justifyContent: "flex-start",
  },

  previewMeldContent: {
    zIndex: 91,
    elevation: 91,
    width: "100%",
    minHeight: 50,
    flexDirection: "column",
    alignItems: "flex-start",
    justifyContent: "flex-start",
    rowGap: 2,
  },

  okeyMiniScoreBoard: {
    position: "absolute",
    left: 25,
    top: 22,
    zIndex: 230,
    elevation: 230,
    minWidth: 128,
    height: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(248, 243, 223, 0.22)",
    overflow: "hidden",
  },

  okeyMiniScoreItem: {
    width: 62,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },

  okeyMiniScoreLabel: {
    color: "rgba(255,247,218,0.62)",
    fontSize: 7,
    fontFamily: "SpedaRegular",
  },

  okeyMiniScoreValue: {
    color: "#f8d774",
    fontSize: 14,
    lineHeight: 17,
    fontFamily: "RobotoMedium",
  },

  okeyMiniScoreDivider: {
    width: 1,
    height: 22,
    backgroundColor: "rgba(255,247,218,0.18)",
  },

  playerSetScoreWrap: {
    position: "absolute",
    right: 42,
    bottom: 22,
    zIndex: 220,
    elevation: 220,
    alignItems: "center",
    gap: 6,
  },

  openSetsButton: {
    minWidth: 82,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(248,215,116,0.92)",
    borderWidth: 1,
    borderColor: "rgba(255,247,218,0.72)",
  },

  openSetsButtonText: {
    color: "#182012",
    fontSize: 12,
    fontFamily: "SpedaRegular",
  },

  playerSetScore: {
    minWidth: 82,
    height: 42,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(8,17,12,0.58)",
    borderWidth: 1,
    borderColor: "rgba(248,215,116,0.34)",
  },

  playerSetScoreLabel: {
    color: "rgba(255,247,218,0.68)",
    fontSize: 8,
    fontFamily: "SpedaRegular",
  },

  playerSetScoreValue: {
    color: "#f8d774",
    fontSize: 18,
    lineHeight: 21,
    fontFamily: "SpedaRegular",
  },

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
    fontFamily: "RobotoMedium",
  },

  playerSetScoreSlash: {
    color: "rgba(255,255,255,0.38)",
    fontSize: 16,
    lineHeight: 21,
    fontFamily: "RobotoMedium",
  },

  playerSetScoreCurrent: {
    color: "rgba(255,255,255,0.70)",
    fontSize: 18,
    lineHeight: 21,
    fontFamily: "RobotoMedium",
  },

  rackWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 50,
  },

  playerRack: {
    position: "relative",
    overflow: "visible",
    direction: "ltr",
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: {
      width: 0,
      height: 8,
    },
    elevation: 20,
  },

  rackImage: {
    ...StyleSheet.absoluteFill,
    width: "100%",
    height: "100%",
  },

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

  activeRackDragViewport: {
    zIndex: 200,
    elevation: 200,
  },

  flippingJokerRackViewport: {
    zIndex: 6000,
    elevation: 6000,
  },

  activeRackDragLayer: {
    zIndex: 10000,
    elevation: 10000,
  },

  rackScroll: {
    width: "100%",
    minWidth: "100%",
    alignItems: "stretch",
    justifyContent: "center",
    paddingHorizontal: RACK_TILE_SIDE_PADDING,
    direction: "ltr",
  },

  rackRows: {
    width: "100%",
    height: "100%",
    justifyContent: "space-between",
    direction: "ltr",
  },

  rackRail: {
    width: "100%",
    height: "47%",
    overflow: "visible",
    justifyContent: "flex-end",
    direction: "ltr",
  },

  rackRow: {
    width: "100%",
    height: "100%",
    flexDirection: "row",
    alignItems: "flex-end",
    columnGap: RACK_TILE_GAP,
    direction: "ltr",
  },

  rackSlot: {
    position: "relative",
    alignItems: "center",
    justifyContent: "flex-end",
  },

  hiddenRackTile: {
    opacity: 0,
  },

  draggedTileOverlay: {
    position: "absolute",
    left: 0,
    top: 0,
    zIndex: 5000,
    elevation: 5000,
  },

  tileFlightOverlay: {
    position: "absolute",
    zIndex: 800,
    elevation: 800,
  },

  rackTurnTimer: {
    left: RACK_TURN_TIMER_LEFT,
    right: RACK_TURN_TIMER_RIGHT,
    top: RACK_TURN_TIMER_TOP,
    height: RACK_TURN_TIMER_HEIGHT,
  },

  tileShadow: {
    width: 46,
    height: 60,
    borderRadius: 6,
    shadowColor: "#000",
    shadowOpacity: 0.34,
    shadowRadius: 4,
    shadowOffset: {
      width: 0,
      height: 3,
    },
    elevation: 5,
  },

  tileShadowCompact: {
    width: 42,
    height: 58,
  },

  selectedTile: {
    zIndex: 20,
    elevation: 20,
  },

  tileImage: {
    width: "100%",
    height: "100%",
  },

  tileBack: {
    width: 42,
    height: 58,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },

  tileBackSmall: {
    width: OPPONENT_TILE_WIDTH,
    height: OPPONENT_TILE_HEIGHT,
  },
});