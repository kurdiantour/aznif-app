import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

test('AI Practice has mode-owned engine, presentation, and reward adapter', () => {
  for (const path of [
    'domino/modes/ai-practice/engine/ai-practice-engine.ts',
    'domino/modes/ai-practice/controllers/use-domino-ai-practice-controller.ts',
    'domino/modes/ai-practice/adapters/ai-practice-reward-adapter.ts',
    'domino/modes/ai-practice/authoritative/ai-practice-command-reducer.ts',
    'domino/modes/ai-practice/controllers/ai-practice-bot-controller.ts',
    'domino/modes/ai-practice/lifecycle/ai-practice-lifecycle.ts',
    'domino/modes/ai-practice/index.ts',
  ]) assert.equal(existsSync(path), true, path);
});

test('legacy AI Practice shims are removed after consumer migration', () => {
  for (const path of [
    'hooks/useAiPracticeGame.ts',
    'hooks/aiPracticeLocal.ts',
    'lib/aiPracticeRewards.ts',
  ]) assert.equal(existsSync(path), false, path);
});

test('AI Practice stays local and does not acquire multiplayer ownership', () => {
  const presentation = readFileSync(
    'domino/modes/ai-practice/controllers/use-domino-ai-practice-controller.ts',
    'utf8',
  );
  assert.doesNotMatch(presentation, /supabase\.(channel|auth|getUser)/);
  assert.doesNotMatch(presentation, /commit_multiplayer_action|process_bot_turns/);
});

test('AI Practice controller delegates authoritative, bot, and lifecycle ownership', () => {
  const source = readFileSync(
    'domino/modes/ai-practice/controllers/use-domino-ai-practice-controller.ts',
    'utf8',
  );
  assert.match(source, /reduceAiPracticePlay/);
  assert.match(source, /reduceAiPracticePass/);
  assert.match(source, /reduceAiPracticeHumanDraw/);
  assert.match(source, /reduceAiPracticeBotDraw/);
  assert.match(source, /decideAiPracticeBotTurn/);
  assert.match(source, /createAiPracticeNextRound/);
  assert.doesNotMatch(source, /findBestBotMove/);
});