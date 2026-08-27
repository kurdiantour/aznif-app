import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const search = (text) => {
  try {
    return execFileSync('rg', ['-n', '-F', text, 'app', 'components', 'hooks'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
  } catch (error) {
    if (error.status === 1) return '';
    throw error;
  }
};

test('WalletProvider is mounted above app navigation', () => {
  const layout = read('app/_layout.tsx');
  assert.ok(layout.indexOf('<ProfileProvider>') < layout.indexOf('<WalletProvider>'));
  assert.ok(layout.indexOf('<WalletProvider>') < layout.indexOf('<Stack'));
});

test('UI never fetches Wallet independently', () => {
  assert.equal(search('getBalance('), '');
});

test('loading and errors never write artificial Wallet zero', () => {
  for (const call of ['setCoinBalance(0', 'setGemBalance(0', 'setMcBalance(0', 'setAznifBalance(0', 'setWallet(0']) {
    assert.equal(search(call), '');
  }
});

test('shared Wallet keeps its last valid snapshot on refresh failure', () => {
  const provider = read('lib/wallet-context.tsx');
  const catchStart = provider.indexOf('.catch((reason: unknown)');
  const finallyStart = provider.indexOf('.finally(', catchStart);
  const catchBlock = provider.slice(catchStart, finallyStart);
  assert.equal(catchBlock.includes('publishWallet(null)'), false);
  assert.equal(catchBlock.includes('setWallet(null)'), false);
  assert.ok(provider.includes("walletRef.current ? 'refreshing' : 'loading'"));
});
