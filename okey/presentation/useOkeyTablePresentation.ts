import { useCallback, useRef, useState } from "react";

import type { PlayerProfileTarget } from "@/components/game/player-profile-target";
import type { MeldOffset } from "@/okey/presentation/okey-game-presentation";
import type { OkeyMeld, OkeyTile } from "@/okey/types/okey";

/** Local, disposable UI state. Nothing returned by this hook is authoritative. */
export function useOkeyTablePresentation() {
  const [konkanRevealData, setKonkanRevealData] = useState<{
    visible: boolean;
    runTiles: OkeyTile[];
    completionMeldTiles: OkeyTile[];
  }>({ visible: false, runTiles: [], completionMeldTiles: [] });
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [rackSetScore, setRackSetScore] = useState(0);
  const [openableRackMelds, setOpenableRackMelds] = useState<{
    melds: OkeyMeld[];
    score: number;
    contiguousGroups: OkeyTile[][];
  }>({ melds: [], score: 0, contiguousGroups: [] });
  const [droppedMelds, setDroppedMelds] = useState<OkeyMeld[]>([]);
  const [pendingNormalMeld, setPendingNormalMeld] = useState<{
    meld: OkeyMeld;
    signature: string;
    tileIds: string[];
  } | null>(null);
  const [localDragCommittedMeldSignatures, setLocalDragCommittedMeldSignatures] = useState<string[]>([]);
  const [tableMeldOffsets, setTableMeldOffsets] = useState<Record<string, MeldOffset>>({});
  const [showScoreDetails, setShowScoreDetails] = useState(false);
  const [showDiscardHistory, setShowDiscardHistory] = useState(false);
  const [showFinalTileCelebration, setShowFinalTileCelebration] = useState(false);
  const [turnWarningToastVisible, setTurnWarningToastVisible] = useState(false);
  const [dealOrigin, setDealOrigin] = useState<{ x: number; y: number } | null>(null);
  const [profilePlayer, setProfilePlayer] = useState<PlayerProfileTarget | null>(null);
  const [discardDropPlacement, setDiscardDropPlacement] = useState<{
    tileId: string;
    point: { x: number; y: number };
    nonce: number;
  } | null>(null);
  const [optimisticRackTile, setOptimisticRackTile] = useState<OkeyTile | null>(null);
  const [isDiscardDragActive, setIsDiscardDragActive] = useState(false);
  const [hoveredMeldTarget, setHoveredMeldTarget] = useState<{ playerId: string; meldId: string } | null>(null);
  const pendingDrawRef = useRef<{
    tileId: string;
    source: "deck" | "discard";
  } | null>(null);

  const closeKonkanReveal = useCallback(() => {
    setKonkanRevealData({ visible: false, runTiles: [], completionMeldTiles: [] });
  }, []);  const showKonkanReveal = useCallback((runTiles: OkeyTile[], completionMeldTiles: OkeyTile[]) => {
    setKonkanRevealData({ visible: true, runTiles, completionMeldTiles });
  }, []);
  const completeKonkanRevealEntrance = useCallback(() => {
    setShowFinalTileCelebration(false);
  }, []);
  const resetPresentationOverlays = useCallback(() => {
    setShowScoreDetails(false);
    setShowDiscardHistory(false);
    setShowFinalTileCelebration(false);
    setTurnWarningToastVisible(false);
    setKonkanRevealData({ visible: false, runTiles: [], completionMeldTiles: [] });
    setProfilePlayer(null);
  }, []);
  const finishKonkanReveal = useCallback((complete: () => void) => {
    setKonkanRevealData({ visible: false, runTiles: [], completionMeldTiles: [] });
    complete();
  }, []);
  const finishFinalTilePresentation = useCallback((complete: () => void) => {
    setShowFinalTileCelebration(false);
    complete();
  }, []);
  const moveTableMeld = useCallback((_playerId: string, meldId: string, offset: MeldOffset) => {
    setTableMeldOffsets((current) => ({ ...current, [meldId]: offset }));
  }, []);
  const removeStagedMeld = useCallback((meldId: string) => {
    setDroppedMelds((current) => current.filter((entry) => entry.id !== meldId));
  }, []);
  const handleExternalDropPlaced = useCallback((tileId: string, _targetIndex: number) => {
    setSelectedTileId(tileId);
    setDiscardDropPlacement(null);
  }, []);
  const resetTablePresentation = useCallback(() => {
    setTableMeldOffsets({});
    setSelectedTileId(null);
    setRackSetScore(0);
    setDroppedMelds([]);
    setPendingNormalMeld(null);
    setLocalDragCommittedMeldSignatures([]);
    setOpenableRackMelds({ melds: [], score: 0, contiguousGroups: [] });
    setOptimisticRackTile(null);
    setDiscardDropPlacement(null);
    setIsDiscardDragActive(false);
    setHoveredMeldTarget(null);
    setShowScoreDetails(false);
    setShowDiscardHistory(false);
    setShowFinalTileCelebration(false);
    setTurnWarningToastVisible(false);
    setKonkanRevealData({ visible: false, runTiles: [], completionMeldTiles: [] });
    setProfilePlayer(null);
  }, []);

  return {
    konkanRevealData, setKonkanRevealData, closeKonkanReveal, showKonkanReveal,
    completeKonkanRevealEntrance, resetPresentationOverlays, finishKonkanReveal,
    finishFinalTilePresentation, resetTablePresentation,
    selectedTileId, setSelectedTileId,
    rackSetScore, setRackSetScore,
    openableRackMelds, setOpenableRackMelds,
    droppedMelds, setDroppedMelds, removeStagedMeld,
    pendingNormalMeld, setPendingNormalMeld,
    localDragCommittedMeldSignatures, setLocalDragCommittedMeldSignatures,
    tableMeldOffsets, setTableMeldOffsets, moveTableMeld,
    showScoreDetails, setShowScoreDetails,
    showDiscardHistory, setShowDiscardHistory,
    showFinalTileCelebration, setShowFinalTileCelebration,
    turnWarningToastVisible, setTurnWarningToastVisible,
    dealOrigin, setDealOrigin,
    profilePlayer, setProfilePlayer,
    discardDropPlacement, setDiscardDropPlacement,
    optimisticRackTile, setOptimisticRackTile,
    isDiscardDragActive, setIsDiscardDragActive,
    hoveredMeldTarget, setHoveredMeldTarget,
    pendingDrawRef, handleExternalDropPlaced,
  };
}
