import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

import draw from './draw.ts';
import move from './move.ts';
import pass from './pass.ts';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  let action: unknown;
  try {
    action = (await req.clone().json())?.action;
  } catch {
    return json({ error: 'Missing action' }, 400);
  }

  switch (action) {
    case 'move':
      return move(req);
    case 'pass':
      return pass(req);
    case 'draw':
      return draw(req);
    default:
      return json({ error: 'Invalid action' }, 400);
  }
});
