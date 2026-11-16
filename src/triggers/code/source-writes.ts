/* oxlint-disable complexity, max-depth -- assignment walk mirrors the source inspector: aliases, imports, destructuring and calls share one object */
import ts from "typescript";
import type { SourceValue } from "./source-values.js";

/** A path key that means every member. A spread or a loop hands each of them on. */
const EVERY = "\u0000every";
const MAX_NODES = 50_000;
const MAX_WRITES = 100_000;
const MAX_ALIASES = 100;
/** Methods that change the array, map or set they are called on. */
const MUTATING = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "set",
  "delete",
  "clear",
  "fill",
  "copyWithin",
]);
const LOGICAL = new Set([
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
]);
const RESULT_ON_RIGHT = new Set([ts.SyntaxKind.EqualsToken, ts.SyntaxKind.CommaToken]);

export interface Write {
  path: readonly string[];
  /** True when the member is replaced. False when code this reader does not run may change inside it. */
  replaced: boolean;
}
interface Origin {
  node: ts.Expression;
  path: string[];
  exact: boolean;
}

/**
 * Writes that reach a const binding after its initializer, including through aliases and imports.
 * `unstable` means a write may have been missed; callers must not trust any fixed object.
 */
export function collectWrites(
  files: readonly ts.SourceFile[],
  symbolFor: (node: ts.Node) => ts.Symbol | undefined,
  declaredSymbol: (node: ts.Node) => ts.Symbol | undefined = symbolFor,
): { writes: Map<ts.Symbol, Write[]>; unstable: boolean } {
  const writes = new Map<ts.Symbol, Map<string, Write>>();
  let nodes = 0;
  let count = 0;
  let unstable = false;
  const record = (symbol: ts.Symbol, path: readonly string[], replaced: boolean) => {
    const recorded = writes.get(symbol) ?? new Map<string, Write>();
    writes.set(symbol, recorded);
    const key = JSON.stringify([replaced, ...path]);
    if (recorded.has(key)) return false;
    recorded.set(key, { path, replaced });
    return true;
  };
  const fail = () => {
    unstable = true;
  };
  const change = (
    node: ts.Expression,
    path: readonly string[],
    replaced: boolean,
    chain = new Set<ts.Symbol>(),
  ) => {
    if (unstable) return;
    if (++count > MAX_WRITES || chain.size > MAX_ALIASES) return fail();
    const target = skip(node);
    if (ts.isConditionalExpression(target)) {
      change(target.whenTrue, path, replaced, chain);
      change(target.whenFalse, path, replaced, chain);
      return;
    }
    if (ts.isBinaryExpression(target)) {
      const operator = target.operatorToken.kind;
      if (LOGICAL.has(operator)) change(target.left, path, replaced, chain);
      if (LOGICAL.has(operator) || RESULT_ON_RIGHT.has(operator))
        change(target.right, path, replaced, chain);
      return;
    }
    if (ts.isObjectLiteralExpression(target) || ts.isArrayLiteralExpression(target)) {
      changeLiteral(target, path, replaced, chain);
      return;
    }
    if (ts.isCallExpression(target)) {
      changeResult(target, path, replaced, chain);
      return;
    }
    if (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) {
      const key = ts.isPropertyAccessExpression(target)
        ? target.name.text
        : literalKey(target.argumentExpression);
      if (key === undefined) change(target.expression, [], false, chain);
      else change(target.expression, [key, ...path], replaced, chain);
      return;
    }
    if (ts.isIdentifier(target)) changeBinding(target, path, replaced, chain);
  };
  const changeBinding = (
    node: ts.Identifier,
    path: readonly string[],
    replaced: boolean,
    chain: Set<ts.Symbol>,
  ) => {
    const symbol = symbolFor(node);
    if (!symbol || !record(symbol, path, replaced) || chain.has(symbol)) return;
    // Replacing the binding leaves the object it used to hold alone.
    if (replaced && path.length === 0) return;
    chain.add(symbol);
    for (const origin of origins(symbol.valueDeclaration)) {
      if (origin.exact) change(origin.node, [...origin.path, ...path], replaced, chain);
      else change(origin.node, origin.path, false, chain);
    }
    chain.delete(symbol);
  };
  const changeLiteral = (
    node: ts.ObjectLiteralExpression | ts.ArrayLiteralExpression,
    path: readonly string[],
    replaced: boolean,
    chain: Set<ts.Symbol>,
  ) => {
    if (replaced && path.length <= 1) return;
    const [key, ...rest] = path;
    const object = ts.isObjectLiteralExpression(node);
    let shifted = false;
    for (const [index, item] of (object ? node.properties : node.elements).entries()) {
      if (ts.isSpreadAssignment(item) || ts.isSpreadElement(item)) {
        shifted = true;
        if (key === undefined) change(item.expression, [EVERY], false, chain);
        else change(item.expression, [object ? key : EVERY, ...rest], replaced, chain);
        continue;
      }
      const value = memberValue(item);
      const name = object || shifted ? memberName(item) : String(index);
      if (value === undefined) continue;
      if (key === undefined) change(value, [], false, chain);
      else if (key === EVERY || name === undefined || name === key)
        change(value, rest, replaced, chain);
    }
  };
  const changeResult = (
    node: ts.CallExpression,
    path: readonly string[],
    replaced: boolean,
    chain: Set<ts.Symbol>,
  ) => {
    const callee = skip(node.expression);
    if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
      change(callee.expression, [], false, chain);
      return;
    }
    const symbol = ts.isIdentifier(callee) ? symbolFor(callee) : undefined;
    const fn = symbol && callable(symbol);
    if (!symbol || !fn || chain.has(symbol)) return;
    chain.add(symbol);
    for (const result of exits(fn)) if (result) change(result, path, replaced, chain);
    chain.delete(symbol);
  };
  const assigned = (target: ts.Expression) => {
    const node = skip(target);
    if (ts.isObjectLiteralExpression(node)) {
      for (const item of node.properties) {
        if (ts.isPropertyAssignment(item)) assigned(item.initializer);
        else if (ts.isShorthandPropertyAssignment(item)) assigned(item.name);
        else if (ts.isSpreadAssignment(item)) assigned(item.expression);
      }
      return;
    }
    if (ts.isArrayLiteralExpression(node)) {
      for (const item of node.elements) assigned(ts.isSpreadElement(item) ? item.expression : item);
      return;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      assigned(node.left);
      return;
    }
    if (!ts.isOmittedExpression(node)) change(node, [], true);
  };
  const recordCall = (node: ts.CallExpression | ts.NewExpression) => {
    // defineTrigger returns its argument and does not write to it. Other calls may.
    if (ts.isCallExpression(node) && (agentCall(node) || sdkDefineTrigger(node, declaredSymbol)))
      return;
    for (const argument of node.arguments ?? []) {
      if (ts.isSpreadElement(argument)) change(argument.expression, [EVERY], false);
      else change(argument, [], false);
    }
    const callee = node.expression;
    if (!ts.isPropertyAccessExpression(callee) && !ts.isElementAccessExpression(callee)) return;
    const name = ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : literalKey(callee.argumentExpression);
    change(callee.expression, name === undefined || MUTATING.has(name) ? [] : [EVERY], false);
  };
  const visit = (node: ts.Node) => {
    if (unstable) return;
    if (++nodes > MAX_NODES) return fail();
    if (ts.isBinaryExpression(node) && isAssignment(node.operatorToken.kind)) {
      assigned(node.left);
      change(node.right, [], false);
    } else if (isStep(node)) change(node.operand, [], true);
    else if (ts.isDeleteExpression(node)) change(node.expression, [], true);
    else if (ts.isCallExpression(node) || ts.isNewExpression(node)) recordCall(node);
    else if (ts.isForOfStatement(node)) {
      change(node.expression, [EVERY], false);
      if (!ts.isVariableDeclarationList(node.initializer)) assigned(node.initializer);
    } else if (ts.isForInStatement(node) && !ts.isVariableDeclarationList(node.initializer)) {
      assigned(node.initializer);
    } else if (ts.isTaggedTemplateExpression(node) && ts.isTemplateExpression(node.template)) {
      for (const span of node.template.templateSpans) change(span.expression, [], false);
    }
    ts.forEachChild(node, visit);
  };
  for (const file of files) visit(file);
  return {
    writes: new Map([...writes].map(([symbol, recorded]) => [symbol, [...recorded.values()]])),
    unstable,
  };
}

/** Drops members a write reaches. Scalars stay when code only receives them and does not replace them. */
export function applyWrite(
  value: SourceValue,
  path: readonly string[],
  replaced: boolean,
): SourceValue {
  if (value.value === undefined) return value;
  if (path.length === 0)
    return replaced || value.value instanceof Map || Array.isArray(value.value)
      ? { node: value.node, value: undefined }
      : value;
  const [key, ...rest] = path;
  if (key === undefined) return value;
  if (value.value instanceof Map) {
    const next = new Map(value.value);
    for (const name of key === EVERY ? [...value.value.keys()] : [key]) {
      const current = value.value.get(name);
      const updated = applyWrite(current ?? { node: value.node, value: undefined }, rest, replaced);
      if (current !== undefined || updated.value !== undefined) next.set(name, updated);
    }
    return { node: value.node, value: next };
  }
  if (!Array.isArray(value.value)) return value;
  if (key === EVERY)
    return {
      node: value.node,
      value: value.value.map((item) => applyWrite(item, rest, replaced)),
    };
  if (!/^(?:0|[1-9]\d*)$/u.test(key))
    return replaced ? { node: value.node, value: undefined } : value;
  const index = Number(key);
  const item = value.value[index];
  if (item === undefined) return replaced ? { node: value.node, value: undefined } : value;
  const items = [...value.value];
  items[index] = applyWrite(item, rest, replaced);
  return { node: value.node, value: items };
}

/** The SDK helper is an identity. A local function with the same name is not. */
function sdkDefineTrigger(
  node: ts.CallExpression,
  declaredSymbol: (node: ts.Node) => ts.Symbol | undefined,
) {
  const callee = skip(node.expression);
  if (!ts.isIdentifier(callee)) return false;
  const declaration = declaredSymbol(callee)?.declarations?.[0];
  return (
    declaration !== undefined &&
    ts.isImportSpecifier(declaration) &&
    (declaration.propertyName ?? declaration.name).text === "defineTrigger" &&
    ts.isImportDeclaration(declaration.parent.parent.parent) &&
    ts.isStringLiteral(declaration.parent.parent.parent.moduleSpecifier) &&
    declaration.parent.parent.parent.moduleSpecifier.text === "@mikoagents/hub/triggers"
  );
}
function agentCall(node: ts.CallExpression) {
  const callee = node.expression;
  return (
    (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) &&
    member(callee, "run") &&
    member(callee.expression, "agent")
  );
}
function member(node: ts.Expression, name: string) {
  return (
    (ts.isPropertyAccessExpression(node) && node.name.text === name) ||
    (ts.isElementAccessExpression(node) &&
      ts.isStringLiteral(node.argumentExpression) &&
      node.argumentExpression.text === name)
  );
}
function skip(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isAwaitExpression(node)
    ? skip(node.expression)
    : node;
}
function isAssignment(operator: ts.SyntaxKind) {
  return operator >= ts.SyntaxKind.FirstAssignment && operator <= ts.SyntaxKind.LastAssignment;
}
function isStep(node: ts.Node): node is ts.PrefixUnaryExpression | ts.PostfixUnaryExpression {
  return (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    (node.operator === ts.SyntaxKind.PlusPlusToken ||
      node.operator === ts.SyntaxKind.MinusMinusToken)
  );
}
function literalKey(node: ts.Expression) {
  if (ts.isStringLiteralLike(node)) return node.text;
  return ts.isNumericLiteral(node) ? String(Number(node.text)) : undefined;
}
function propertyKey(name: ts.PropertyName) {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  return literalKey(ts.isComputedPropertyName(name) ? name.expression : name);
}
function bindingKey(element: ts.BindingElement) {
  if (element.dotDotDotToken) return undefined;
  if (ts.isArrayBindingPattern(element.parent))
    return String(element.parent.elements.indexOf(element));
  const name = element.propertyName ?? element.name;
  return ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)
    ? undefined
    : propertyKey(name);
}
function memberValue(item: ts.ObjectLiteralElementLike | ts.Expression) {
  if (ts.isPropertyAssignment(item)) return item.initializer;
  if (ts.isShorthandPropertyAssignment(item)) return item.name;
  if (
    ts.isMethodDeclaration(item) ||
    ts.isGetAccessorDeclaration(item) ||
    ts.isSetAccessorDeclaration(item) ||
    ts.isSpreadAssignment(item) ||
    ts.isSpreadElement(item) ||
    ts.isOmittedExpression(item)
  )
    return undefined;
  return item;
}
function memberName(item: ts.ObjectLiteralElementLike | ts.Expression) {
  return ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item)
    ? propertyKey(item.name)
    : undefined;
}
function origins(declaration: ts.Node | undefined): Origin[] {
  if (declaration && (ts.isVariableDeclaration(declaration) || ts.isParameter(declaration)))
    return declaration.initializer
      ? [{ node: declaration.initializer, path: [], exact: true }]
      : [];
  if (!declaration || !ts.isBindingElement(declaration)) return [];
  const key = bindingKey(declaration);
  const found = origins(declaration.parent.parent).map(
    (origin): Origin =>
      origin.exact && key !== undefined
        ? { node: origin.node, path: [...origin.path, key], exact: true }
        : { node: origin.node, path: origin.path, exact: false },
  );
  if (declaration.initializer) found.push({ node: declaration.initializer, path: [], exact: true });
  return found;
}
function callable(symbol: ts.Symbol) {
  for (const declaration of symbol.declarations ?? []) {
    if (ts.isFunctionDeclaration(declaration) && declaration.body) return declaration;
    const initializer =
      ts.isVariableDeclaration(declaration) &&
      declaration.parent.flags & ts.NodeFlags.Const &&
      declaration.initializer
        ? skip(declaration.initializer)
        : undefined;
    if (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)))
      return initializer;
  }
  return undefined;
}
function exits(fn: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction) {
  if (!fn.body) return [];
  if (!ts.isBlock(fn.body)) return [fn.body];
  const results: ts.Expression[] = [];
  const collect = (node: ts.Node) => {
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression) results.push(node.expression);
    ts.forEachChild(node, collect);
  };
  ts.forEachChild(fn.body, collect);
  return results;
}
