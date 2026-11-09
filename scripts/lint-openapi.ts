import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

interface OpenApiDocument {
  openapi?: string;
  info?: { title?: string; version?: string };
  paths?: Record<string, Record<string, unknown>>;
  components?: Record<string, unknown>;
}

const contractPath = resolve(
  process.cwd(),
  'specs/001-material-lesson-flow/contracts/openapi.yaml',
);

const httpMethods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

function collectRefs(value: unknown, refs: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, refs);
    return refs;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref' && typeof child === 'string') refs.push(child);
      else collectRefs(child, refs);
    }
  }
  return refs;
}

function resolveRef(document: OpenApiDocument, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined;
  return ref
    .slice(2)
    .split('/')
    .reduce<unknown>((current, segment) => {
      if (!current || typeof current !== 'object') return undefined;
      return (current as Record<string, unknown>)[segment.replace(/~1/g, '/').replace(/~0/g, '~')];
    }, document);
}

function main(): void {
  const raw = readFileSync(contractPath, 'utf8');
  const document = parse(raw) as OpenApiDocument;
  const problems: string[] = [];

  if (!document.openapi?.startsWith('3.')) {
    problems.push(`Unsupported or missing openapi version: ${document.openapi ?? 'none'}`);
  }
  if (!document.info?.title || !document.info?.version) {
    problems.push('info.title and info.version are required');
  }
  if (!document.paths || Object.keys(document.paths).length === 0) {
    problems.push('No paths defined');
  }

  for (const [path, operations] of Object.entries(document.paths ?? {})) {
    if (!path.startsWith('/')) problems.push(`Path must start with "/": ${path}`);
    const entries = Object.entries(operations ?? {});
    if (entries.length === 0) problems.push(`Path ${path} has no operations`);
    for (const [method, operation] of entries) {
      if (!httpMethods.has(method)) continue;
      const op = operation as Record<string, unknown>;
      if (!op.responses || Object.keys(op.responses as object).length === 0) {
        problems.push(`${method.toUpperCase()} ${path} has no responses`);
      }
      if (!op.summary) problems.push(`${method.toUpperCase()} ${path} has no summary`);
    }
  }

  const refs = collectRefs(document);
  for (const ref of refs) {
    if (ref.startsWith('#/') && resolveRef(document, ref) === undefined) {
      problems.push(`Unresolved local reference: ${ref}`);
    }
  }

  if (problems.length > 0) {
    console.error(`OpenAPI lint failed with ${problems.length} problem(s):`);
    for (const problem of problems) console.error(` - ${problem}`);
    process.exit(1);
  }

  const pathCount = Object.keys(document.paths ?? {}).length;
  console.log(
    `OpenAPI lint passed: ${pathCount} paths, ${refs.length} local references resolved.`,
  );
}

main();
