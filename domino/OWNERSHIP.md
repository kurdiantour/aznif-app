# Domino mode ownership

| Concern | 1v1 owner | 2v2 owner | AI Practice owner |
| --- | --- | --- | --- |
| Mode entry point | `domino/modes/one-vs-one` | `domino/modes/two-vs-two` | `domino/modes/ai-practice` |
| Rules and transitions | mode engine + authoritative reducer | `authoritative/domino-two-vs-two-command-reducer.ts` | `authoritative/ai-practice-command-reducer.ts` |
| Commands | mode adapter + server command service | mode adapter + server command service | local controller calls |
| Auth, roster, snapshot | mode adapter/server context | mode adapter/server context | none |
| Realtime and reconnect | mode adapter + connection controller | mode adapter + connection controller | none |
| Timeout and bot | mode controllers + server policy | timeout/bot controllers + server strike policy | local bot controller |
| Round lifecycle | Domino shared lifecycle | Domino shared lifecycle + mode next-hand transition | mode lifecycle + Domino shared presentation lifecycle |
| Persistence | multiplayer commit/settlement | shared commit RPC through mode commit contract | reward adapter only |
| Edge transport | thin handlers | validation/load/commit handlers delegating transitions to mode reducer | none |

## Compatibility retained intentionally

- The zero-consumer AI Practice compatibility shims under `hooks/` and `lib/` were removed after consumer audit.
- `supabase/functions/_shared/kozel-engine.ts` remains a Deno runtime adapter for
  validation and board calculation. Match transition/scoring ownership is not there.
- Database strike, takeover and terminal-team policy remains database-owned; no SQL was
  applied remotely during this migration.
