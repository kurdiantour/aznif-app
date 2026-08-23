import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { DominoTwoVsTwoCommandService } from "../../../domino/modes/two-vs-two/server/domino-two-vs-two-command-service.ts";

import move from "./move.ts";
import pass from "./pass.ts";
import start_next_hand from "./next-hand.ts";

const commandService = new DominoTwoVsTwoCommandService({
  move,
  pass,
  start_next_hand,
});

serve((request) => commandService.handle(request));
