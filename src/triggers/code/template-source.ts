import ts from "typescript";
import { TriggerTemplateReferenceSchema } from "./contract.js";

/** Read provenance without requiring an old project to satisfy the latest execution schema. */
export function readTemplateIdentity(source: string, filename: string) {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const declarations = new Map<string, ts.Expression>();
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer !== undefined)
        declarations.set(declaration.name.text, declaration.initializer);
    }
  }
  function resolve(expression: ts.Expression | undefined, depth = 0): ts.Expression | undefined {
    if (expression === undefined || depth > 20) return undefined;
    if (
      ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isSatisfiesExpression(expression)
    )
      return resolve(expression.expression, depth + 1);
    if (ts.isIdentifier(expression)) return resolve(declarations.get(expression.text), depth + 1);
    if (ts.isCallExpression(expression)) return resolve(expression.arguments[0], depth + 1);
    return expression;
  }
  function property(expression: ts.Expression | undefined, name: string) {
    const value = resolve(expression);
    if (value === undefined || !ts.isObjectLiteralExpression(value)) return undefined;
    const field = value.properties.find(
      (entry): entry is ts.PropertyAssignment =>
        ts.isPropertyAssignment(entry) &&
        (ts.isIdentifier(entry.name) || ts.isStringLiteral(entry.name)) &&
        entry.name.text === name,
    );
    return field === undefined ? undefined : resolve(field.initializer);
  }
  function text(expression: ts.Expression | undefined) {
    return expression !== undefined && ts.isStringLiteralLike(expression)
      ? expression.text
      : undefined;
  }
  const exported = file.statements.find(ts.isExportAssignment);
  const definition = exported === undefined ? undefined : resolve(exported.expression);
  const template = property(definition, "template");
  const name = text(property(definition, "name"));
  if (template === undefined) return { name, template: undefined };
  const reference = TriggerTemplateReferenceSchema.parse({
    id: text(property(template, "id")),
    version: text(property(template, "version")),
  });
  if (name === undefined)
    throw new Error("Keep the Trigger name statically readable to upgrade this template project.");
  return { name, template: reference };
}
