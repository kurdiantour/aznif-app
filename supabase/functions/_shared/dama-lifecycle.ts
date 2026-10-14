import { chooseBotMove } from "../../../dama/bot.ts";
import { applyMove, isTurnExpired, resolveTurnTimeout, type GameState } from "../../../dama/engine.ts";
import { scheduleAznifGameLifecycle } from "./aznif-game-lifecycle.ts";

export const DAMA_LIFECYCLE_TYPE = "dama";

export async function scheduleDamaLifecycle(input: {
  service: any;
  matchId: string;
  state: GameState | null;
  status: string;
  version: number;
  currentTurnUserId: string | null;
  players: readonly { user_id: string | null; bot_profile_id?: string | null; piece_color?: string; bot_takeover: boolean }[];
  nowMs?: number;
}): Promise<string | null> {
  if (input.status === "waiting") {
    const { data: waiting } = await input.service.from("dama_matches").select("matchmaking_deadline_at,countdown_deadline_at")
      .eq("id", input.matchId).maybeSingle();
    const deadline = waiting?.countdown_deadline_at ?? waiting?.matchmaking_deadline_at;
    if (!deadline) return null;
    const runtime = globalThis as typeof globalThis & { Deno?: { env: { get(name: string): string | undefined } } };
    const schedulerUrl = runtime.Deno?.env.get("AZNIF_GAME_LIFECYCLE_URL");
    const lifecycleSecret = runtime.Deno?.env.get("AZNIF_LIFECYCLE_SECRET");
    if (!schedulerUrl || !lifecycleSecret) throw new Error("lifecycle_not_configured");
    await scheduleAznifGameLifecycle({ schedulerUrl, lifecycleSecret, gameType: DAMA_LIFECYCLE_TYPE,
      matchId: input.matchId, expectedVersion: input.version, runAt: deadline });
    return deadline;
  }
  if (input.status !== "active" || !input.state || input.state.result) return null;
  
  // FIX 1: پرانتز درست
  const currentPlayer = input.players.find((p) => 
    p.user_id === input.currentTurnUserId ||
    (p.bot_profile_id && !input.currentTurnUserId && p.piece_color === input.state?.turn)
  );
  
  const runAt = currentPlayer?.bot_takeover || currentPlayer?.bot_profile_id
    ? new Date((input.nowMs ?? Date.now()) + 1_800 + (Math.abs(input.version * 7919) % 1_700)).toISOString()
    : input.state.turnDeadlineAtMs ? new Date(input.state.turnDeadlineAtMs).toISOString() : null;
    
  if (!runAt) throw new Error("dama_lifecycle_deadline_missing");
  const runtime = globalThis as typeof globalThis & { Deno?: { env: { get(name: string): string | undefined } } };
  const schedulerUrl = runtime.Deno?.env.get("AZNIF_GAME_LIFECYCLE_URL");
  const lifecycleSecret = runtime.Deno?.env.get("AZNIF_LIFECYCLE_SECRET");
  if (!schedulerUrl || !lifecycleSecret) throw new Error("lifecycle_not_configured");
  await scheduleAznifGameLifecycle({ schedulerUrl, lifecycleSecret, gameType: DAMA_LIFECYCLE_TYPE,
    matchId: input.matchId, expectedVersion: input.version, runAt });
  return runAt;
}

export async function executeDamaLifecycle(input: {
  service: any;
  matchId: string;
  expectedVersion: number;
  nowMs?: number;
}) {
  const now = input.nowMs ?? Date.now();
  const { data: match, error: matchError } = await input.service.from("dama_matches")
    .select("id,status,version,state,current_turn_user_id,matchmaking_deadline_at,countdown_deadline_at").eq("id", input.matchId).maybeSingle();
  if (matchError) throw matchError;
  if (!match) throw new Error("dama_match_not_found");
  
  if (match.status === "waiting") {
    if (match.countdown_deadline_at && Date.parse(match.countdown_deadline_at) <= now) {
      const { error: startError } = await input.service.rpc("dama_start_match_service", { p_match_id: input.matchId });
      if (startError) throw startError;
      const { data: started, error: startedError } = await input.service.from("dama_matches")
        .select("id,status,version,state,current_turn_user_id,matchmaking_deadline_at").eq("id", input.matchId).maybeSingle();
      if (startedError) throw startedError;
      const { data: startedPlayers, error: startedPlayersError } = await input.service.from("dama_match_players")
        .select("user_id,bot_profile_id,bot_takeover,piece_color").eq("match_id", input.matchId).is("left_at", null);
      if (startedPlayersError) throw startedPlayersError;
      const { data: startedSnapshot, error: snapshotError } = await input.service.rpc("get_dama_match_snapshot_service", { p_match_id: input.matchId });
      if (snapshotError) throw snapshotError;
      const nextRunAt = await scheduleDamaLifecycle({ service: input.service, matchId: input.matchId, state: started.state,
        status: started.status, version: Number(started.version), currentTurnUserId: started.current_turn_user_id,
        players: startedPlayers ?? [], nowMs: now });
      return { ok: true, executed: true, reason: "match_started", version: Number(started.version), nextRunAt, match: startedSnapshot };
    }
    if (match.countdown_deadline_at) {
      const { data: players, error: playersError } = await input.service.from("dama_match_players")
        .select("user_id,bot_profile_id,piece_color,bot_takeover").eq("match_id", input.matchId).is("left_at", null);
      if (playersError) throw playersError;
      const nextRunAt = await scheduleDamaLifecycle({ service: input.service, matchId: input.matchId, state: null,
        status: "waiting", version: Number(match.version), currentTurnUserId: null, players: players ?? [], nowMs: now });
      return { ok: true, executed: false, reason: "pregame_countdown", version: Number(match.version), nextRunAt, match };
    }
    const { data: assignment, error: assignmentError } = await input.service.rpc("dama_fill_waiting_with_bot", { p_match_id: input.matchId });
    if (assignmentError) throw assignmentError;
    const { data: refreshed, error: refreshError } = await input.service.from("dama_matches")
      .select("id,status,version,state,current_turn_user_id,matchmaking_deadline_at,countdown_deadline_at").eq("id", input.matchId).maybeSingle();
    if (refreshError) throw refreshError;
    if (assignment?.assigned) {
      // FIX 2: فوری نه، 500ms بعد
      const nextRunAt = new Date(now + 500).toISOString();
      const runtime = globalThis as typeof globalThis & { Deno?: { env: { get(name: string): string | undefined } } };
      const schedulerUrl = runtime.Deno?.env.get("AZNIF_GAME_LIFECYCLE_URL");
      const lifecycleSecret = runtime.Deno?.env.get("AZNIF_LIFECYCLE_SECRET");
      if (!schedulerUrl || !lifecycleSecret) throw new Error("lifecycle_not_configured");
      await scheduleAznifGameLifecycle({ schedulerUrl, lifecycleSecret, gameType: DAMA_LIFECYCLE_TYPE,
        matchId: input.matchId, expectedVersion: Number(refreshed.version), runAt: nextRunAt });
      return { ok: true, executed: true, reason: "bot_assigned", version: Number(refreshed.version), nextRunAt, match: refreshed };
    }
    return { ok: true, executed: false, reason: assignment?.reason ?? "waiting", version: Number(refreshed?.version ?? match.version),
      nextRunAt: refreshed?.matchmaking_deadline_at ?? null, match: refreshed };
  }
  
  const { data: players, error: playersError } = await input.service.from("dama_match_players")
    .select("user_id,bot_profile_id,piece_color,bot_takeover,consecutive_timeout_strikes,left_at").eq("match_id", input.matchId).is("left_at", null);
  if (playersError) throw playersError;
  const version = Number(match.version);
  if (match.status !== "active" || !match.state) {
    return { ok: true, executed: false, reason: match.status === "finished" ? "match_finished" : "match_not_active", version, nextRunAt: null, match };
  }
  if (version !== input.expectedVersion) {
    const nextRunAt = await scheduleDamaLifecycle({ service: input.service, matchId: input.matchId, state: match.state,
      status: match.status, version, currentTurnUserId: match.current_turn_user_id, players: players ?? [], nowMs: now });
    return { ok: true, executed: false, reason: "already_transitioned", version, nextRunAt, match };
  }
  const state = match.state as GameState;
  
  // FIX 1 دوباره اینجا
  const actor = (players ?? []).find((player: any) => 
    player.user_id === match.current_turn_user_id ||
    (player.bot_profile_id && player.user_id == null && player.piece_color === state.turn)
  );
  
  if (!actor) throw new Error("dama_current_player_missing");
  let next: GameState;
  let action: string;
  let payload: Record<string, unknown>;
  if (actor.bot_takeover || actor.bot_profile_id) {
    const move = chooseBotMove(state);
    if (!move) throw new Error("dama_bot_no_legal_move");
    next = applyMove(state, move, now);
    action = "bot-move";
    payload = { move, reason: "bot_takeover" };
  } else {
    if (!isTurnExpired(state, now)) {
      const nextRunAt = await scheduleDamaLifecycle({ service: input.service, matchId: input.matchId, state,
        status: match.status, version, currentTurnUserId: match.current_turn_user_id, players: players ?? [], nowMs: now });
      return { ok: true, executed: false, reason: "not_due", version, nextRunAt, match };
    }
    next = resolveTurnTimeout(state, now);
    action = "timeout-move";
    payload = { timedOutUserId: match.current_turn_user_id, deadlineAtMs: state.turnDeadlineAtMs };
  }
  const nextPlayer = (players ?? []).find((player: any) => player.piece_color === next.turn);
  const { data: committed, error: commitError } = actor.bot_profile_id
    ? await input.service.rpc("commit_dama_bot_action", {
      p_match_id: input.matchId, p_expected_version: input.expectedVersion, p_bot_profile_id: actor.bot_profile_id,
      p_state: next, p_current_turn_user_id: next.result ? null : nextPlayer?.user_id ?? null, p_payload: payload,
    })
    : await input.service.rpc("commit_dama_action", {
      p_match_id: input.matchId, p_expected_version: input.expectedVersion, p_actor_user_id: actor.user_id,
      p_state: next, p_current_turn_user_id: next.result ? null : nextPlayer?.user_id ?? null,
      p_action: action, p_payload: payload,
    });

  // FIX 3: این قسمت عامل اصلی طوفان بود
  if (commitError) {
    if (commitError.code === '40001' || commitError.message?.includes("STALE_DAMA_STATE")) {
      const { data: latest } = await input.service.from("dama_matches")
        .select("id,status,version,state,current_turn_user_id").eq("id", input.matchId).maybeSingle();
      const { data: latestPlayers } = await input.service.from("dama_match_players")
        .select("user_id,bot_profile_id,bot_takeover,piece_color").eq("match_id", input.matchId).is("left_at", null);
      
      const nextRunAt = latest ? await scheduleDamaLifecycle({ 
        service: input.service, matchId: input.matchId, state: latest.state as GameState,
        status: latest.status, version: Number(latest.version), 
        currentTurnUserId: latest.current_turn_user_id,
        players: latestPlayers ?? [], 
        nowMs: now + 1000 + Math.random() * 1000
      }) : null;

      return { ok: true, executed: false, reason: "already_transitioned", version: Number(latest?.version ?? version), nextRunAt, match: latest ?? match };
    }
    throw commitError;
  }

  const { data: latestPlayers, error: latestPlayersError } = await input.service.from("dama_match_players")
    .select("user_id,bot_profile_id,bot_takeover,piece_color").eq("match_id", input.matchId).is("left_at", null);
  if (latestPlayersError) throw latestPlayersError;
  const runAt = await scheduleDamaLifecycle({ service: input.service, matchId: input.matchId, state: committed.state,
    status: committed.status, version: Number(committed.version), currentTurnUserId: committed.current_turn_user_id,
    players: latestPlayers ?? [], nowMs: now });
  return { ok: true, executed: true, reason: action === "timeout-move" ? "timeout_executed" : "bot_executed",
    version: Number(committed.version), nextRunAt: runAt, match: committed };
}