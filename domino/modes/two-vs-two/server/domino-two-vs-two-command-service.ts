export type DominoTwoVsTwoCommandAction = 'move' | 'pass' | 'start_next_hand';
export type DominoTwoVsTwoCommandHandler = (request: Request) => Promise<Response>;

export type DominoTwoVsTwoCommandHandlers = Record<
  DominoTwoVsTwoCommandAction,
  DominoTwoVsTwoCommandHandler
>;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export class DominoTwoVsTwoCommandService {
  constructor(private readonly handlers: DominoTwoVsTwoCommandHandlers) {}

  async handle(request: Request) {
    if (request.method !== 'POST') {
      return json({ error: 'Method Not Allowed' }, 405);
    }

    let action: unknown;
    try {
      action = (await request.clone().json())?.action;
    } catch {
      return json({ error: 'Missing action' }, 400);
    }

    if (action !== 'move' && action !== 'pass' && action !== 'start_next_hand') {
      return json({ error: 'Invalid action' }, 400);
    }
    return this.handlers[action](request);
  }
}
