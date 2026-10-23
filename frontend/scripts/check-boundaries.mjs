import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../src/', import.meta.url));
const errors = [];

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const target = path.join(directory, entry.name);
        return entry.isDirectory() ? files(target) : /\.tsx?$/.test(target) ? [target] : [];
      }),
    )
  ).flat();
}

for (const file of await files(root)) {
  const relative = path.relative(root, file).split(path.sep).join('/');
  if (/\.test\.tsx?$/.test(relative) || relative.startsWith('test/')) continue;
  const source = ts.createSourceFile(
    file,
    await readFile(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const fail = (message) => errors.push(`${relative}: ${message}`);
  const checkImport = (specifier) => {
    if (!specifier.startsWith('.')) return;
    const target = path
      .relative(root, path.resolve(path.dirname(file), specifier))
      .split(path.sep)
      .join('/');
    if (target.startsWith('../')) fail(`import escapes src/: ${specifier}`);
    if (relative.startsWith('shared/') && /^(app|features)\//.test(target))
      fail(`shared cannot depend on ${target}`);
    if (relative.startsWith('features/') && target.startsWith('app/'))
      fail(`features cannot depend on app/: ${target}`);
    const feature = relative.split('/')[1];
    const targetParts = target.split('/');
    if (
      targetParts[0] === 'features' &&
      (!relative.startsWith('features/') || targetParts[1] !== feature) &&
      targetParts.length > 2 &&
      targetParts.slice(2).join('/') !== 'index'
    ) {
      fail(`use feature public index instead of deep import: ${specifier}`);
    }
    if (target === 'shared/api/http' && relative !== 'features/workbench/api.ts') {
      fail('HTTP calls must go through the workbench API adapter');
    }
  };
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      checkImport(node.moduleSpecifier.text);
    if (ts.isCallExpression(node)) {
      if (
        ts.isIdentifier(node.expression) &&
        ['fetch', 'XMLHttpRequest'].includes(node.expression.text) &&
        relative !== 'shared/api/http.ts'
      ) {
        fail('direct network access is only allowed in shared/api/http.ts');
      }
      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        checkImport(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Frontend dependency boundaries passed.');
}
