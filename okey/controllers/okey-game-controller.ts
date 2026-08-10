import type { useOkeyGame } from "@/okey/hooks/useOkeyGame";

/** The presentation-facing contract shared by online play and local preview. */
export type OkeyGameController = ReturnType<typeof useOkeyGame>;
