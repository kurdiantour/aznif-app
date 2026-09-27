import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as reconcilerApi from "../okey-server-reconciler.ts";
import * as engineApi from "../okey-turn-engine.ts";

import {
  reduceAuthoritativeOkeyTransition,
} from "../okey-turn-engine.ts";

test("Okey lifecycle entry points use their current authoritative owners", () => {
  const match = readFileSync("supabase/functions/okey_match/index.ts", "utf8");
  const room = readFileSync("supabase/functions/okey_room/index.ts", "utf8");
  const reconciler = readFileSync("okey/server/okey-server-reconciler.ts", "utf8");

  assert.match(match, /reconcileAuthoritativeHumanCommand\(/);
  assert.match(room, /const result = await callRoomAction\(action\)/);
  assert.doesNotMatch(room, /executeAuthoritativeOkeyTurn/);
  assert.match(room, /event: "invalidate"/);
  assert.doesNotMatch(room, /from ["'].*domino/);
});

test("lifecycle decision has one owner in okey-turn-engine", () => {
  const engine = readFileSync("okey/server/okey-turn-engine.ts", "utf8");
  const authoritative = readFileSync("okey/server/okey-authoritative.ts", "utf8");
  const reconciler = readFileSync("okey/server/okey-server-reconciler.ts", "utf8");

  assert.match(engine, /export function evaluateOkeyServerLifecycle/);
  assert.doesNotMatch(authoritative, /export function evaluateOkeyServerLifecycle/);
  assert.doesNotMatch(authoritative, /export type OkeyLifecycleDecision/);
  assert.match(reconciler, /from ["']\.\/okey-turn-engine\.ts["']/);
});



test("authoritative transition reduction has one engine gateway", () => {
  const calls: string[] = [];
  const reducers = {
    applyHumanCommand: (state: number, actorPlayerIndex: number, command: string, now: number) => {
      calls.push(`human:${actorPlayerIndex}:${command}:${now}`);
      return state + 1;
    },
    applyManualLeave: (state: number, actorPlayerIndex: number) => {
      calls.push(`leave:${actorPlayerIndex}`);
      return state + 2;
    },
    applyTimeout: (state: number, deadlineAt: string | null, now: number) => {
      calls.push(`timeout:${deadlineAt}:${now}`);
      return state + 3;
    },
    applyEliminatedTurn: (state: number, expectedActorId: string) => {
      calls.push(`ghost:${expectedActorId}`);
      return state + 4;
    },
    startNextRound: (state: number, now: number) => {
      calls.push(`next-round:${now}`);
      return state + 5;
    },
    applyBotRoundState: (state: number, roundState: string, now: number) => {
      calls.push(`bot:${roundState}:${now}`);
      return state + 6;
    },
  };

  assert.equal(reduceAuthoritativeOkeyTransition({
    state: 0,
    transition: { type: "human-command", actorPlayerIndex: 2, command: "draw" },
    reducers,
    now: 100,
  }), 1);
  assert.equal(reduceAuthoritativeOkeyTransition({
    state: 0,
    transition: { type: "manual-leave", actorPlayerIndex: 1 },
    reducers,
    now: 100,
  }), 2);
  assert.equal(reduceAuthoritativeOkeyTransition({
    state: 0,
    transition: { type: "timeout", deadlineAt: "deadline" },
    reducers,
    now: 100,
  }), 3);
  assert.equal(reduceAuthoritativeOkeyTransition({
    state: 0,
    transition: { type: "eliminated-turn", expectedActorId: "ghost-1" },
    reducers,
    now: 100,
  }), 4);
  assert.equal(reduceAuthoritativeOkeyTransition({
    state: 0,
    transition: { type: "next-round" },
    reducers,
    now: 100,
  }), 5);
  assert.equal(reduceAuthoritativeOkeyTransition({
    state: 0,
    transition: { type: "bot-action", roundState: "round-2" },
    reducers,
    now: 100,
  }), 6);

  assert.deepEqual(calls, [
    "human:2:draw:100",
    "leave:1",
    "timeout:deadline:100",
    "ghost:ghost-1",
    "next-round:100",
    "bot:round-2:100",
  ]);
});


// Resolve named imports, namespace imports and local callable aliases using symbols,
// so comments, formatting and import renames cannot disguise a boundary violation.
function inspectSource(file: string, source = readFileSync(file, "utf8")) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const host = ts.createCompilerHost({ noResolve: true });
  host.getSourceFile = name => name === file ? ast : undefined;
  const program = ts.createProgram([file], { noResolve: true, noLib: true }, host);
  const checker = program.getTypeChecker();
  function target(expr: ts.Expression, seen = new Set<ts.Symbol>()): string {
    if (ts.isParenthesizedExpression(expr)) return target(expr.expression, seen);
    if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
    if (ts.isElementAccessExpression(expr) && ts.isStringLiteralLike(expr.argumentExpression)) {
      return expr.argumentExpression.text;
    }
    if (!ts.isIdentifier(expr)) return "";
    const symbol = checker.getSymbolAtLocation(expr);
    if (!symbol || seen.has(symbol)) return expr.text;
    seen.add(symbol);
    for (const declaration of symbol.declarations ?? []) {
      if (ts.isImportSpecifier(declaration)) return (declaration.propertyName ?? declaration.name).text;
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) return target(declaration.initializer, seen);
      if (ts.isBindingElement(declaration)) return (declaration.propertyName ?? declaration.name).getText(ast);
    }
    return expr.text;
  }
  function nodes(root: ts.Node): ts.Node[] {
    const result: ts.Node[] = [];
    function visit(node: ts.Node) { result.push(node); ts.forEachChild(node, visit); }
    visit(root);
    return result;
  }
  const calls = (root: ts.Node = ast) => nodes(root).filter(ts.isCallExpression).map(call => target(call.expression));
  function fn(name: string) {
    const result = ast.statements.find((node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(result, file + " must define " + name);
    return result;
  }
  return { ast, nodes, calls, fn };
}

function assertNoCalls(source: ReturnType<typeof inspectSource>, forbidden: string[]) {
  for (const name of forbidden) assert.ok(!source.calls().includes(name), "forbidden direct call: " + name);
}

test("architecture inspection resolves aliases and ignores formatting/comments", () => {
  const fixture = inspectSource("boundary-fixture.ts", [
    'import { reduceAuthoritativeOkeyTransition as reduce } from "./engine";',
    'import * as engine from "./engine";',
    'const invoke = reduce; invoke({});',
    'engine.reduceAuthoritativeOkeyTransition({});',
    'const { reduceAuthoritativeOkeyTransition: destructured } = engine; destructured({});',
    '// reduceAuthoritativeOkeyTransition({}) is only a comment',
  ].join("\n"));
  assert.deepEqual(fixture.calls(), Array(3).fill("reduceAuthoritativeOkeyTransition"));
  assert.throws(() => assertNoCalls(fixture, ["reduceAuthoritativeOkeyTransition"]), /forbidden direct call/);
});

test("runtime controllers delegate reduction and persistence to their authoritative owners", () => {
  const match = inspectSource("supabase/functions/okey_match/index.ts");
  const reconciler = inspectSource("okey/server/okey-server-reconciler.ts");
  const bot = inspectSource("okey/server/okey-bot-executor.ts");
  const engine = inspectSource("okey/server/okey-turn-engine.ts");
  const forbidden = [
    "executeAuthoritativeOkeyTransition", "executeAuthoritativeOkeyTurn",
    "reduceAuthoritativeOkeyTransition", "commitAuthoritativeOkeyAction",
    "applyAuthoritativeOkeyMatchCommand", "applyAuthoritativeManualLeave",
    "applyAuthoritativeOkeyEliminatedTurn", "resolveAuthoritativeMatchDeadline",
    "startAuthoritativeOkeyNextRound", "settleAuthoritativeOkeyRound",
    "reconcileAuthoritativeServerTurns",
  ];
  for (const source of [match, reconciler, bot]) assertNoCalls(source, forbidden);
  assert.ok(match.calls().includes("reconcileAuthoritativeHumanCommand"));
  assert.ok(reconciler.calls(reconciler.fn("reconcileAuthoritativeHumanCommand")).includes("executeOkeyAuthoritativePipeline"));
  assert.ok(reconciler.calls(reconciler.fn("reconcileAuthoritativeServerLifecycleAlarm")).includes("executeOkeyServerLifecycle"));
  for (const name of ["executeOkeyAuthoritativePipeline", "executeOkeyServerLifecycle", "reduceOkeyTransition", "reduceAuthoritativeOkeyTransition"]) {
    assert.ok(!reconciler.ast.statements.some(node => ts.isFunctionDeclaration(node) && node.name?.text === name),
      "Reconciler must not define " + name);
  }
  bot.fn("selectOkeyBotIntent");
  const pipeline = engine.fn("executeOkeyAuthoritativePipeline");
  assert.ok(engine.calls(pipeline).includes("reduceAuthoritativeOkeyTransition"));
  assert.ok(engine.calls(pipeline).includes("commitAuthoritativeOkeyAction"));
  for (const call of engine.nodes(engine.ast).filter(ts.isCallExpression)) {
    const name = engine.calls(call)[0];
    if (!["reduceAuthoritativeOkeyTransition", "commitAuthoritativeOkeyAction"].includes(name)) continue;
    let owner: ts.Node | undefined = call.parent;
    while (owner && !ts.isFunctionDeclaration(owner)) owner = owner.parent;
    assert.equal(owner, pipeline, name + " must only be invoked by the authoritative pipeline");
  }
  const lifecycle = engine.fn("executeOkeyServerLifecycle");
  const branches = engine.nodes(lifecycle).filter(ts.isCaseClause);
  for (const kind of ["eliminated-turn", "bot-turn", "expired-human-turn", "due-next-round"]) {
    const branch = branches.find(node => ts.isStringLiteral(node.expression) && node.expression.text === kind);
    assert.ok(branch, "missing lifecycle branch " + kind);
    assert.ok(engine.calls(branch).includes("executeOkeyAuthoritativePipeline"), kind + " must use the pipeline");
  }
  assert.ok(engine.nodes(lifecycle).some(node => ts.isPropertyAssignment(node)
    && node.name.getText(engine.ast) === "preReducedState"
    && ts.isConditionalExpression(node.initializer)
    && node.initializer.condition.getText(engine.ast) === "finishingTeamForfeit"
    && engine.calls(node.initializer.whenTrue).includes("settleAuthoritativeOkeyRound")),
    "terminal team forfeit must settle through the prepared pipeline state");
});

test("Reconciler preserves direct Turn Engine re-exports without local import bindings", () => {
  const source = inspectSource("okey/server/okey-server-reconciler.ts");
  const exports = source.ast.statements.filter(ts.isExportDeclaration)
    .filter(node => node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
      && node.moduleSpecifier.text === "./okey-turn-engine.ts")
    .flatMap(node => node.exportClause && ts.isNamedExports(node.exportClause) ? [...node.exportClause.elements] : []);
  const runtimeNames = ["evaluateOkeyServerLifecycle", "executeOkeyAuthoritativePipeline",
    "executeOkeyServerLifecycle", "generateOkeyReconcilerCommandId", "reduceAuthoritativeOkeyTransition"] as const;
  for (const name of runtimeNames) {
    assert.ok(exports.some(item => item.name.text === name && !item.isTypeOnly));
    assert.equal(reconcilerApi[name], engineApi[name], name + " must be the same function, not a wrapper");
  }
  for (const name of ["OkeyAuthoritativeExecutionInput", "OkeyAuthoritativeSnapshotBundle",
    "OkeyLifecycleDecision", "OkeyServerLifecycleInput", "OkeyServerLifecycleResult"]) {
    assert.ok(exports.some(item => item.name.text === name && item.isTypeOnly), "missing type re-export " + name);
  }
});
