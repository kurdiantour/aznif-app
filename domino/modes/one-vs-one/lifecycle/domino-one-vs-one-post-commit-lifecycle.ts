export type DominoOneVsOneCommittedAction = "move" | "draw" | "pass";

export async function runDominoOneVsOnePostCommitLifecycle(args: {
  client: any;
  action: DominoOneVsOneCommittedAction;
  roomId: string;
  state: any;
  status: string | null;
  actingUserId: string;
  nextUserId: string | null;
  timedOut?: boolean;
  autoPassed?: boolean;
}): Promise<void> {
  const roundFinished = Boolean(args.state?.roundWinnerPlayerId);
  const matchFinished = Boolean(args.state?.winningTeamId);

  if (!roundFinished && !matchFinished) {
    const shouldRecordStrike =
      args.action !== "draw" || !args.timedOut || Boolean(args.autoPassed);

    if (shouldRecordStrike) {
      await args.client.rpc("process_one_vs_one_turn_strikes", {
        p_room_id: args.roomId,
        p_acting_user_id: args.actingUserId,
        p_next_user_id: args.nextUserId,
        p_increment_acting:
          args.action === "pass"
            ? Boolean(args.timedOut)
            : args.action === "draw"
              ? Boolean(args.timedOut && args.autoPassed)
              : false,
      });
    }
  }

  const shouldResolveForfeits =
    roundFinished &&
    (args.action === "move"
      ? !matchFinished
      : args.action === "pass" && args.status !== "finished");

  if (shouldResolveForfeits) {
    const { error } = await args.client.rpc(
      "resolve_one_vs_one_round_leave_forfeits",
      { p_room_id: args.roomId },
    );
    if (error) throw error;
  }
}
