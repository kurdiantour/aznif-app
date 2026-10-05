import { supabase } from '@/lib/supabase';
import {
  getDominoTwoVsTwoProfiles,
  getDominoTwoVsTwoRoster,
  getDominoTwoVsTwoSnapshot,
  processDominoTwoVsTwoBotTurn,
  submitDominoTwoVsTwoMove,
  submitDominoTwoVsTwoPass,
  startDominoTwoVsTwoNextHand,
} from './domino-two-vs-two-supabase-api';
import type {
  DominoTwoVsTwoAdapter,
  DominoTwoVsTwoCommand,
  DominoTwoVsTwoSubscription,
} from './domino-two-vs-two-adapter';

export class SupabaseDominoTwoVsTwoAdapter implements DominoTwoVsTwoAdapter {
  constructor(private readonly roomId: string) {}

  async getSnapshot() {
    const { data, error } = await getDominoTwoVsTwoSnapshot(this.roomId);
    if (error) throw error;
    return data;
  }

  async getRoster(includeProfiles = true) {
    const { data, error } = await getDominoTwoVsTwoRoster(this.roomId);
    if (error) throw error;
    const rows = data ?? [];
    if (!includeProfiles) return { rows, profiles: null };
    const userIds = rows.map((row: any) => row.user_id).filter(Boolean);
    if (!userIds.length) return { rows, profiles: [] };
    const { data: profiles, error: profileError } =
      await getDominoTwoVsTwoProfiles(userIds);
    if (profileError) throw profileError;
    return { rows, profiles: profiles ?? [] };
  }

  dispatch(command: DominoTwoVsTwoCommand) {
    if (command.type === 'play') {
      return submitDominoTwoVsTwoMove(this.roomId, command.tile, command.branch);
    }
    if (command.type === 'timeout-pass') {
      return submitDominoTwoVsTwoPass(this.roomId, true, command.claim);
    }
    return submitDominoTwoVsTwoPass(this.roomId);
  }

  startNextHand(completedRoundId: string) {
    return startDominoTwoVsTwoNextHand(this.roomId, completedRoundId);
  }

  processBotTurn() {
    return processDominoTwoVsTwoBotTurn(this.roomId);
  }

  subscribe(observer: DominoTwoVsTwoSubscription) {
    const roomChannel = supabase
      .channel(`two_vs_two_rooms:${this.roomId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'two_vs_two_rooms',
        filter: `id=eq.${this.roomId}`,
      }, (payload) => observer.onRoomInvalidated(payload.new))
      .subscribe((status, error) => observer.onStatus?.('rooms', status, error));

    const playersChannel = supabase
      .channel(`two_vs_two_players:${this.roomId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'two_vs_two_players',
        filter: `room_id=eq.${this.roomId}`,
      }, () => observer.onRosterInvalidated())
      .subscribe((status, error) => observer.onStatus?.('players', status, error));

    return () => {
      void supabase.removeChannel(roomChannel);
      void supabase.removeChannel(playersChannel);
    };
  }
}
