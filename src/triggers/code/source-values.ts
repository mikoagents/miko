/* oxlint-disable complexity, max-depth -- bounded syntax interpreter enumerates supported expression and declaration kinds without executing code */
import { posix } from "node:path";
import ts from "typescript";
import type { TriggerArtifact } from "./contract.js";

export interface SourceValue {
  node: ts.Expression;
  value: string | number | boolean | null | SourceValue[] | Map<string, SourceValue> | undefined;
}
const ROOT = "/project";

/** A bounded syntax interpreter. It never imports, evaluates or calls project code. */
export class SourceValues {
  readonly files: readonly ts.SourceFile[];
  readonly checker: ts.TypeChecker;
  private steps = 0;
  private resolving = new Set<ts.Symbol>();

  constructor(sources: TriggerArtifact["sources"]) {
    if (sources.reduce((sum, file) => sum + Buffer.byteLength(file.content), 0) > 2 * 1024 * 1024)
      throw new Error(
        "This project is too large for the configuration editor. Edit and deploy it locally.",
      );
    const files = new Map(sources.map((file) => [posix.join(ROOT, file.path), file.content]));
    const host: ts.CompilerHost = {
      getSourceFile: (path, language) => {
        const content = files.get(path);
        return content === undefined
          ? undefined
          : ts.createSourceFile(path, content, language, true);
      },
      getDefaultLibFileName: () => "",
      writeFile: () => {},
      getCurrentDirectory: () => ROOT,
      getDirectories: () => [],
      fileExists: (path) => files.has(path),
      readFile: (path) => files.get(path),
      getCanonicalFileName: (path) => path,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => "\n",
      resolveModuleNames: (names, containing) =>
        names.map((name) => {
          if (!name.startsWith(".")) return undefined;
          const base = posix.resolve(posix.dirname(containing), name).replace(/\.[cm]?jsx?$/u, "");
          const path = [".ts", ".tsx", ".js", ".mts", ".cts", "/index.ts", "/index.js"]
            .map((ext) => base + ext)
            .find((candidate) => files.has(candidate));
          return path === undefined ? undefined : { resolvedFileName: path };
        }),
    };
    const program = ts.createProgram(
      [...files.keys()].filter((path) => /\.[cm]?[jt]sx?$/u.test(path)),
      {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        allowJs: true,
        noLib: true,
      },
      host,
    );
    if (program.getSyntacticDiagnostics().length > 0)
      throw new Error("Fix the project syntax before editing its configuration.");
    this.checker = program.getTypeChecker();
    this.files = program.getSourceFiles();
  }

  path(node: ts.Node) {
    return posix.relative(ROOT, node.getSourceFile().fileName);
  }

  symbol(node: ts.Node) {
    const symbol = ts.isShorthandPropertyAssignment(node.parent)
      ? this.checker.getShorthandAssignmentValueSymbol(node.parent)
      : this.checker.getSymbolAtLocation(node);
    return symbol && symbol.flags & ts.SymbolFlags.Alias
      ? this.checker.getAliasedSymbol(symbol)
      : symbol;
  }

  /** Configuration must be declarative at module scope; function bodies remain ordinary code. */
  assertDeclarative() {
    for (const file of this.files)
      for (const statement of file.statements) {
        if (
          ts.isImportDeclaration(statement) ||
          ts.isExportDeclaration(statement) ||
          ts.isFunctionDeclaration(statement) ||
          ts.isInterfaceDeclaration(statement) ||
          ts.isTypeAliasDeclaration(statement) ||
          ts.isEmptyStatement(statement)
        )
          continue;
        if (
          ts.isVariableStatement(statement) &&
          statement.declarationList.flags & ts.NodeFlags.Const
        ) {
          for (const declaration of statement.declarationList.declarations) {
            if (
              !ts.isIdentifier(declaration.name) ||
              !declaration.initializer ||
              !this.complete(this.read(declaration.initializer))
            )
              throw new Error(
                "Module-level configuration must use fixed const values. Edit this project's dynamic setup locally.",
              );
          }
        } else if (ts.isExportAssignment(statement)) {
          // Reading the default definition ignores method bodies, including run(ctx).
          if (!this.object(this.read(statement.expression)))
            throw new Error("The default Trigger definition cannot be read statically.");
        } else
          throw new Error(
            "This project has executable module-level setup. Edit and deploy it locally.",
          );
      }
  }

  definition(entrypoint: string | undefined) {
    const file =
      this.files.find((candidate) => this.path(candidate) === entrypoint) ??
      this.files.find((candidate) => /(?:^|\/)trigger\.[cm]?[jt]sx?$/u.test(candidate.fileName));
    const exported = file?.statements.find(ts.isExportAssignment);
    if (!exported) throw new Error("The Trigger entrypoint has no default definition.");
    const result = this.read(exported.expression);
    if (!this.object(result)) throw new Error("The Trigger definition cannot be read statically.");
    return result;
  }

  object(value: SourceValue): value is { node: ts.Expression; value: Map<string, SourceValue> } {
    return value.value instanceof Map;
  }
  complete(value: SourceValue): boolean {
    if (value.value === undefined) return false;
    if (value.value instanceof Map)
      return [...value.value.values()].every((item) => this.complete(item));
    if (Array.isArray(value.value)) return value.value.every((item) => this.complete(item));
    return true;
  }
  json(value: SourceValue): unknown {
    if (value.value instanceof Map)
      return Object.fromEntries([...value.value].map(([key, item]) => [key, this.json(item)]));
    if (Array.isArray(value.value)) return value.value.map((item) => this.json(item));
    if (value.value === undefined)
      throw new Error("This value is computed by code. Edit and deploy it locally.");
    return value.value;
  }

  read(input: ts.Expression, locals = new Map<ts.Symbol, SourceValue>(), depth = 0): SourceValue {
    if (++this.steps > 200_000 || depth > 100)
      throw new Error("Configuration parsing exceeded its limit.");
    const node = unwrap(input);
    const unknown = { node, value: undefined };
    const read = (value: ts.Expression) => this.read(value, locals, depth + 1);
    if (ts.isStringLiteralLike(node)) return { node, value: node.text };
    if (ts.isNumericLiteral(node)) return { node, value: Number(node.text) };
    if (node.kind === ts.SyntaxKind.TrueKeyword) return { node, value: true };
    if (node.kind === ts.SyntaxKind.FalseKeyword) return { node, value: false };
    if (node.kind === ts.SyntaxKind.NullKeyword) return { node, value: null };
    if (ts.isIdentifier(node)) {
      const symbol = this.symbol(node);
      if (!symbol) return unknown;
      const local = locals.get(symbol);
      if (local) return local;
      const declaration = symbol.valueDeclaration;
      if (
        !declaration ||
        !ts.isVariableDeclaration(declaration) ||
        !declaration.initializer ||
        this.resolving.has(symbol)
      )
        return unknown;
      if (!(declaration.parent.flags & ts.NodeFlags.Const)) return unknown;
      this.resolving.add(symbol);
      try {
        return read(declaration.initializer);
      } finally {
        this.resolving.delete(symbol);
      }
    }
    if (ts.isObjectLiteralExpression(node)) {
      const properties = new Map<string, SourceValue>();
      for (const item of node.properties) {
        if (ts.isMethodDeclaration(item)) continue;
        if (ts.isSpreadAssignment(item)) {
          const spread = read(item.expression);
          if (!this.object(spread)) return unknown;
          for (const [key, value] of spread.value) properties.set(key, value);
        } else {
          const key = item.name && propertyName(item.name);
          if (key === undefined) return unknown;
          if (key === "__proto__") return unknown;
          if (ts.isPropertyAssignment(item)) properties.set(key, read(item.initializer));
          else if (ts.isShorthandPropertyAssignment(item)) properties.set(key, read(item.name));
          else return unknown;
        }
      }
      return { node, value: properties };
    }
    if (ts.isArrayLiteralExpression(node)) {
      const items: SourceValue[] = [];
      for (const item of node.elements) {
        if (ts.isSpreadElement(item)) {
          const spread = read(item.expression);
          if (!Array.isArray(spread.value)) return unknown;
          items.push(...spread.value);
        } else items.push(read(item));
      }
      return { node, value: items };
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const object = read(node.expression);
      const key = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : read(node.argumentExpression).value;
      if (object.value instanceof Map && typeof key === "string")
        return object.value.get(key) ?? unknown;
      if (Array.isArray(object.value) && typeof key === "number")
        return object.value[key] ?? unknown;
      if (Array.isArray(object.value) && key === "length")
        return { node, value: object.value.length };
      return unknown;
    }
    if (ts.isConditionalExpression(node)) {
      const condition = read(node.condition);
      return this.complete(condition)
        ? read(condition.value ? node.whenTrue : node.whenFalse)
        : unknown;
    }
    if (ts.isBinaryExpression(node)) {
      const left = read(node.left),
        right = read(node.right);
      if (!this.complete(left) || !this.complete(right)) return unknown;
      if (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken)
        return { node, value: left.value === right.value };
      if (
        node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
        (typeof left.value === "string" || typeof left.value === "number") &&
        (typeof right.value === "string" || typeof right.value === "number")
      )
        return {
          node,
          value:
            typeof left.value === "number" && typeof right.value === "number"
              ? left.value + right.value
              : String(left.value) + String(right.value),
        };
      return unknown;
    }
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
      const operand = read(node.operand);
      if (typeof operand.value === "number") return { node, value: -operand.value };
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && this.isDefineTrigger(callee) && node.arguments.length === 1)
        return read(node.arguments[0]!);
      if (!ts.isPropertyAccessExpression(callee)) return unknown;
      if (
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "Object" &&
        !this.symbol(callee.expression)?.valueDeclaration &&
        callee.name.text === "fromEntries"
      ) {
        const entries = node.arguments[0] && read(node.arguments[0]);
        if (!entries || !Array.isArray(entries.value)) return unknown;
        const result = new Map<string, SourceValue>();
        for (const entry of entries.value) {
          if (
            !Array.isArray(entry.value) ||
            typeof entry.value[0]?.value !== "string" ||
            !entry.value[1]
          )
            return unknown;
          result.set(entry.value[0].value, entry.value[1]);
        }
        return { node, value: result };
      }
      const receiver = read(callee.expression);
      if (!Array.isArray(receiver.value) || receiver.value.length > 1000) return unknown;
      if (
        callee.name.text === "join" &&
        receiver.value.every((item) => typeof item.value === "string")
      ) {
        const separator = node.arguments[0] ? read(node.arguments[0]).value : ",";
        if (typeof separator === "string")
          return {
            node,
            value: receiver.value
              .map((item) => (typeof item.value === "string" ? item.value : ""))
              .join(separator),
          };
      }
      const callback = node.arguments[0];
      if (
        callee.name.text === "map" &&
        callback &&
        ts.isArrowFunction(callback) &&
        !ts.isBlock(callback.body)
      ) {
        const body = callback.body;
        return {
          node,
          value: receiver.value.map((item, index) => {
            const environment = new Map(locals);
            for (const [position, parameter] of callback.parameters.entries()) {
              const symbol = this.symbol(parameter.name);
              if (!symbol || !ts.isIdentifier(parameter.name) || position > 1) return unknown;
              environment.set(symbol, position === 0 ? item : { node, value: index });
            }
            return this.read(body, environment, depth + 1);
          }),
        };
      }
    }
    return unknown;
  }

  private isDefineTrigger(node: ts.Identifier) {
    const symbol = this.checker.getSymbolAtLocation(node);
    const declaration = symbol?.declarations?.[0];
    return (
      declaration &&
      ts.isImportSpecifier(declaration) &&
      (declaration.propertyName ?? declaration.name).text === "defineTrigger" &&
      ts.isImportDeclaration(declaration.parent.parent.parent) &&
      ts.isStringLiteral(declaration.parent.parent.parent.moduleSpecifier) &&
      declaration.parent.parent.parent.moduleSpecifier.text === "@mikoagents/hub/triggers"
    );
  }
}

export function unwrap(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node)
    ? unwrap(node.expression)
    : node;
}

function propertyName(node: ts.PropertyName) {
  return ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)
    ? node.text
    : undefined;
}
