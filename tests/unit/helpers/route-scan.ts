import ts from "typescript";

/**
 * Escáner de rutas por AST (no por texto). Para cada handler HTTP exportado
 * de un `route.ts` dice QUÉ función lo protege, y de qué módulo viene:
 * `export const PUT = withAdminAuth(...)` con `withAdminAuth` importado de
 * `@/lib/api`. Comentarios, cadenas y nombres de propiedad no cuentan: un
 * `session.role` devuelto en un JSON o un "withAdminAuth" en un comentario no
 * convierten un handler en "controlado". Cualquier forma que no se sepa leer
 * se devuelve como `unresolved` y el guardarraíl la rechaza (fail-closed).
 */

export const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

export type Call = { name: string; module: string };

export type Guard =
  /** `export const X = fn(...)`: `fn` importado de `module` (con su nombre original). */
  | { kind: "wrapper"; name: string; module: string }
  /** Función propia (`export async function X` o flecha): llamadas a funciones importadas en su cuerpo. */
  | { kind: "body"; calls: Call[] }
  /** `export { X } from "./otra"`: el handler vive en otro archivo. */
  | { kind: "reexport"; from: string; as: string }
  | { kind: "unresolved"; why: string };

type Imported = { module: string; imported: string };

function unwrap(node: ts.Node): ts.Node {
  let n = node;
  while (
    ts.isParenthesizedExpression(n) ||
    ts.isAsExpression(n) ||
    ts.isNonNullExpression(n) ||
    ts.isSatisfiesExpression(n) ||
    ts.isTypeAssertionExpression(n)
  ) {
    n = n.expression;
  }
  return n;
}

export function scanHandlers(source: string, fileName = "route.ts"): Record<string, Guard> {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);

  // Importaciones: nombre local → módulo y nombre original (cubre `import { a as b }`).
  const imports = new Map<string, Imported>();
  const locals = new Map<string, ts.Node>();
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const modulo = st.moduleSpecifier.text;
      const bindings = st.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          imports.set(el.name.text, { module: modulo, imported: (el.propertyName ?? el.name).text });
        }
      } else if (bindings && ts.isNamespaceImport(bindings)) {
        imports.set(bindings.name.text, { module: modulo, imported: "*" });
      }
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer) locals.set(d.name.text, d.initializer);
      }
    } else if (ts.isFunctionDeclaration(st) && st.name) {
      locals.set(st.name.text, st);
    }
  }

  /** Resuelve el destino de una llamada a una función importada (o `ns.fn`). */
  function resolveCallee(callee: ts.Expression): Call | null {
    const c = unwrap(callee);
    if (ts.isIdentifier(c)) {
      const imp = imports.get(c.text);
      return imp && imp.imported !== "*" ? { name: imp.imported, module: imp.module } : null;
    }
    if (ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.expression)) {
      const imp = imports.get(c.expression.text);
      return imp?.imported === "*" ? { name: c.name.text, module: imp.module } : null;
    }
    return null;
  }

  function callsIn(node: ts.Node): Call[] {
    const found: Call[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        const r = resolveCallee(n.expression);
        if (r) found.push(r);
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
    return found;
  }

  function analyze(node: ts.Node, depth = 0): Guard {
    const n = unwrap(node);
    if (ts.isCallExpression(n)) {
      const r = resolveCallee(n.expression);
      return r
        ? { kind: "wrapper", name: r.name, module: r.module }
        : { kind: "unresolved", why: "llamada a una función que no viene de un import" };
    }
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n)) {
      return { kind: "body", calls: callsIn(n) };
    }
    if (ts.isIdentifier(n) && depth < 5) {
      const target = locals.get(n.text);
      return target
        ? analyze(target, depth + 1)
        : { kind: "unresolved", why: `identificador ${n.text} sin definición local` };
    }
    return { kind: "unresolved", why: `forma no reconocida (${ts.SyntaxKind[n.kind]})` };
  }

  const out: Record<string, Guard> = {};
  const hasExport = (st: ts.Node) =>
    ts.canHaveModifiers(st) &&
    (ts.getModifiers(st) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

  for (const st of sf.statements) {
    if (ts.isVariableStatement(st) && hasExport(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && HTTP_METHODS.includes(d.name.text)) {
          out[d.name.text] = d.initializer
            ? analyze(d.initializer)
            : { kind: "unresolved", why: "sin inicializador" };
        }
      }
    } else if (ts.isFunctionDeclaration(st) && st.name && hasExport(st)) {
      if (HTTP_METHODS.includes(st.name.text)) out[st.name.text] = analyze(st);
    } else if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) {
        const exported = el.name.text;
        if (!HTTP_METHODS.includes(exported)) continue;
        const local = (el.propertyName ?? el.name).text;
        if (st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
          out[exported] = { kind: "reexport", from: st.moduleSpecifier.text, as: local };
        } else {
          const target = locals.get(local);
          out[exported] = target
            ? analyze(target)
            : { kind: "unresolved", why: `export { ${local} } sin definición local` };
        }
      }
    }
  }
  return out;
}
