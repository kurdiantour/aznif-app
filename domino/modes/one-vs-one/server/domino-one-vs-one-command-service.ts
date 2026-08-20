export type DominoOneVsOneCommandAction = "move" | "draw" | "pass";
export type DominoOneVsOneCommandHandler = (request: Request) => Promise<Response>;

export type DominoOneVsOneCommandHandlers = Record<
  DominoOneVsOneCommandAction,
  DominoOneVsOneCommandHandler
>;

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Stable HTTP boundary for Domino 1v1 commands. Game transitions remain in
 * the authoritative reducer; transport handlers remain injectable for safe
 * migration and rollback.
 */
export class DominoOneVsOneCommandService {
  private readonly handlers: DominoOneVsOneCommandHandlers;

  constructor(handlers: DominoOneVsOneCommandHandlers) {
    this.handlers = handlers;
  }

  async handle(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return json({ error: "Method Not Allowed" }, 405);
    }

    let action: unknown;
    try {
      action = (await request.clone().json())?.action;
    } catch {
      return json({ error: "Missing action" }, 400);
    }

    if (action !== "move" && action !== "draw" && action !== "pass") {
      return json({ error: "Invalid action" }, 400);
    }

    return this.handlers[action](request);
  }
}
