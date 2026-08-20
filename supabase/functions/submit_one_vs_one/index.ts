import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import { DominoOneVsOneCommandService } from "../../../domino/modes/one-vs-one/server/domino-one-vs-one-command-service.ts";
import draw from "./draw.ts";
import move from "./move.ts";
import pass from "./pass.ts";

const commandService = new DominoOneVsOneCommandService({
  move,
  draw,
  pass,
});

serve((request) => commandService.handle(request));