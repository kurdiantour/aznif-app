import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function compiled(path, jsx = false) {
  return ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: jsx ? ts.JsxEmit.ReactJSX : undefined,
  } }).outputText;
}
function evaluate(source, imports) {
  const exports = {};
  vm.runInNewContext(source, { exports, require: name => {
    if (!(name in imports)) throw Error('Unexpected import: ' + name);
    return imports[name];
  }, console, Set, Promise });
  return exports;
}
const response = (id, route) => ({ actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
  notification: { request: { identifier: id, content: { data: {
    campaign_id: '11111111-1111-4111-8111-111111111111', device_id: '22222222-2222-4222-8222-222222222222', deep_link: route,
  } } } } });

test('native adapter exposes live response and cold-start recovery', async () => {
  let listener, cleared = 0;
  const pending = response('cold-adapter', '/profile');
  const notifications = {
    setNotificationHandler() {}, addNotificationResponseReceivedListener(fn) { listener = fn; return { remove() {} }; },
    getLastNotificationResponseAsync: async () => pending, clearLastNotificationResponseAsync: async () => { cleared++; },
  };
  const platform = evaluate(compiled('../lib/notifications/platform.native.ts'), {
    'expo-device': { isDevice: true }, 'expo-constants': { appOwnership: 'standalone' },
    'react-native': { Platform: { OS: 'ios' } }, 'expo-notifications': notifications,
  });
  const seen = [];
  platform.subscribeToPushResponses(value => seen.push(value));
  listener(pending);
  assert.equal(seen[0], pending);
  assert.equal(await platform.lastPushResponse(), pending);
  await platform.clearPushResponse();assert.equal(cleared, 1);
});

test('provider records cold-start open and queues its allowed route once', async () => {
  const effects = [], recorded = [], pushed = [];
  const routes = evaluate(compiled('../lib/notifications/routes.ts'), {});
  const pending = response('cold-provider', '/profile');
  const provider = evaluate(compiled('../lib/notifications/NotificationProvider.tsx', true), {
    react: { useEffect: fn => effects.push(fn) }, 'react/jsx-runtime': { jsx: () => null },
    'react-native': { AppState: { addEventListener: () => ({ remove() {} }) } },
    'expo-router': { useRouter: () => ({ push: route => pushed.push(route) }), useSegments: () => ['index'] },
    '../profile': { useProfile: () => ({ session: { user: { id: 'user' } }, authLoading: false }) },
    './devices': { recordPushOpen: async (...args) => { recorded.push(args); return true; }, registerPushDevice: async () => {}, resumeDeviceRegistration() {} },
    './platform': { subscribeToPushResponses: () => () => {}, lastPushResponse: async () => pending, clearPushResponse: async () => {}, subscribeToTokenChanges: () => () => {} },
    './routes': routes,
  });
  provider.NotificationProvider({ children: null });
  const cleanups = effects.map(effect => effect());
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(recorded.length, 1);
  assert.equal(routes.takePushRoute(), '/profile');
  assert.equal(pushed.length, 0);
  cleanups.forEach(cleanup => cleanup?.());
});

test('deep-link allowlist rejects external and auth routes', () => {
  const routes = evaluate(compiled('../lib/notifications/routes.ts'), {});
  assert.equal(routes.validPushRoute('/profile'), true);
  assert.equal(routes.validPushRoute('https://example.com'), false);
  assert.equal(routes.validPushRoute('/auth-callback'), false);
});
