export type ResumableMatch = {
  game: string;
  matchId: string;
  route: string;
  params: Record<string, string>;
};

/** A game supplies only server discovery and validation; the UI lifecycle is shared. */
export type MultiplayerResumeAdapter = {
  game: string;
  isGameRoute: (pathname: string) => boolean;
  findActive: (userId: string) => Promise<ResumableMatch | null>;
  validate: (match: ResumableMatch, userId: string) => Promise<boolean>;
  watch: (match: ResumableMatch, onInvalidated: () => void) => () => void;
  returnToMatch: (match: ResumableMatch, userId: string) => Promise<boolean>;
  reject: (match: ResumableMatch) => Promise<void>;
};
