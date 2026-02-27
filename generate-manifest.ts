type Module =
  | { kind: 'external'; specifier: string }
  | {
    kind: 'esm';
    dependencies?: { specifier: string; code?: { specifier: string } }[];
    specifier: string;
  };

type Graph = {
  version: number;
  roots: string[];
  modules: Module[];
};

type SourceManifest = {
  name: string;
  version: string;
  description: string;
  license: string;
  author?: string;
  repository?: unknown;
  exports?: string | Record<string, string>;
  imports?: Record<string, string>;
};

function assert(value: boolean): asserts value {
  if (value !== true) {
    throw new Error('Assertion failed');
  }
}

function ensure<T>(value: T | undefined | null): T {
  assert(value !== undefined && value !== null);
  return value;
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number';
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isObject(value)) return false;
  for (const v of Object.values(value)) {
    if (typeof v !== 'string') return false;
  }
  return true;
}

function parseGraph(graph: unknown): Graph {
  assert(isObject(graph));
  assert('version' in graph && isNumber(graph.version));
  const version = graph.version;
  assert('roots' in graph && Array.isArray(graph.roots));
  const roots = graph.roots.map((root) => {
    assert(isString(root));
    return root;
  });
  assert('modules' in graph && Array.isArray(graph.modules));
  const modules = graph.modules.map((module: unknown): Module => {
    assert(isObject(module));
    assert('kind' in module && (module.kind === 'external' || module.kind === 'esm'));
    const kind = module.kind;
    if (kind === 'external') {
      assert('specifier' in module && isString(module.specifier));
      const specifier = module.specifier;
      return { kind, specifier };
    }
    if (kind === 'esm') {
      assert('specifier' in module && isString(module.specifier));
      const specifier = module.specifier;
      const dependencies = (() => {
        if ('dependencies' in module) {
          assert(Array.isArray(module.dependencies));
          return module.dependencies.map((dependency) => {
            assert(isObject(dependency));
            assert('specifier' in dependency && isString(dependency.specifier));
            const specifier = dependency.specifier;
            const code = (() => {
              if ('code' in dependency) {
                assert(isObject(dependency.code));
                assert('specifier' in dependency.code && isString(dependency.code.specifier));
                return { specifier: dependency.code.specifier };
              }
            })();
            return { specifier, code };
          });
        }
      })();
      return { kind, dependencies, specifier };
    }
    throw new Error(`Invalid module kind ${module.kind}`);
  });
  return { version, roots, modules };
}

function parseSourceManifest(manifest: unknown): SourceManifest {
  assert(isObject(manifest));
  assert('name' in manifest && isString(manifest.name));
  const name = manifest.name;
  assert('version' in manifest && isString(manifest.version));
  const version = manifest.version;
  assert('description' in manifest && isString(manifest.description));
  const description = manifest.description;
  assert('license' in manifest && isString(manifest.license));
  const license = manifest.license;
  const author = (() => {
    if ('author' in manifest) {
      assert(isString(manifest.author));
      return manifest.author;
    }
  })();
  const repository = (() => {
    if ('repository' in manifest) {
      return manifest.repository;
    }
  })();
  const exports = (() => {
    if ('exports' in manifest) {
      assert(typeof manifest.exports === 'string' || isStringRecord(manifest.exports));
      return manifest.exports;
    }
  })();
  const imports = (() => {
    if ('imports' in manifest) {
      assert(isStringRecord(manifest.imports));
      return manifest.imports;
    }
  })();
  return { name, version, description, license, author, repository, exports, imports };
}

function parsePackageSpecifier(specifier: string) {
  // deno-fmt-ignore
  const regex = /^(:?(?<registry>jsr|npm):\/?)?(?<name>(?:@[a-zA-Z0-9_\-]+\/)?[a-zA-Z0-9_\-]+)(?:@(?<version>(?:\*|(?:\^|~|[<>]=?)?\d+(?:\.\d+)*)))?(?<path>(\/[^\/]+)+)?$/;
  const match = specifier.match(regex);
  if (match !== null) {
    const groups = ensure(match.groups);
    const registry = groups.registry;
    const name = ensure(groups.name);
    const version = groups.version;
    const path = groups.path;
    return { registry, name, version, path };
  }
  return undefined;
}

class GraphAnalyzer {
  readonly #graph: Graph;
  readonly #specifiers: Set<string>;

  constructor(graph: Graph, specifiers: Set<string>) {
    this.#graph = graph;
    this.#specifiers = specifiers;
  }

  analyze(specifier: string) {
    const module = ensure(this.#graph.modules.find((module) => module.specifier === specifier));
    if (module.kind === 'esm' && module.dependencies !== undefined) {
      for (const dependency of module.dependencies) {
        const parsedPackageSpecifier = parsePackageSpecifier(dependency.specifier);
        if (parsedPackageSpecifier !== undefined) {
          this.#specifiers.add(parsedPackageSpecifier.name);
        } else if (dependency.code !== undefined) {
          this.analyze(dependency.code.specifier);
        }
      }
    }
  }
}

export default async function getExportsDependencies(manifest: SourceManifest) {
  const exports = ensure(manifest.exports);
  const exportedPaths = (typeof exports === 'string') ? [exports] : Object.values(exports);
  const specifiers = new Set<string>();
  for (const path of exportedPaths) {
    const command = new Deno.Command('deno', { args: ['info', '--json', path] });
    const { code, stdout, stderr } = await command.output();
    if (code !== 0) {
      throw new Error(new TextDecoder().decode(stderr));
    }
    const graph = parseGraph(JSON.parse(new TextDecoder().decode(stdout)));
    const analyzer = new GraphAnalyzer(graph, specifiers);
    analyzer.analyze(ensure(graph.roots[0]));
  }
  if (specifiers.size > 0) {
    const imports = manifest.imports;
    assert(imports !== undefined);
    return Array.from(specifiers).toSorted().map((specifier) => {
      const parsedPackageSpecifier = ensure(parsePackageSpecifier(ensure(imports[specifier])));
      const { registry, name, version } = parsedPackageSpecifier;
      assert(registry !== undefined);
      assert(version !== undefined);
      return { registry, name, version };
    });
  }
  return [];
}

function generateManifest({ type, sourceManifest, dependencies }: {
  type: 'jsr' | 'npm';
  sourceManifest: SourceManifest;
  dependencies: { registry: string; name: string; version: string }[];
}) {
  if (type === 'jsr') {
    return {
      name: ensure(sourceManifest.name),
      version: ensure(sourceManifest.version),
      license: ensure(sourceManifest.license),
      exports: ensure(sourceManifest.exports),
      publish: { include: ['src', 'README.md'], exclude: ['**/*.test.ts'] },
      imports: dependencies.length > 0
        ? Object.fromEntries(dependencies.map(({ name, registry, version }) => {
          return [name, `${registry}:${name}@${version}`];
        }))
        : undefined,
    };
  }
  if (type === 'npm') {
    return {
      name: ensure(sourceManifest.name),
      version: ensure(sourceManifest.version),
      description: ensure(sourceManifest.description),
      license: ensure(sourceManifest.license),
      author: sourceManifest.author,
      repository: sourceManifest.repository,
      type: 'module',
      exports: ((exports) => {
        const replaceFn = (path: string) => path.replace(/^\.\/src\//, './dist/').replace(/\.ts$/, '.js');
        if (typeof exports === 'string') {
          return replaceFn(exports);
        } else {
          return Object.fromEntries(Object.entries(exports).map(([key, value]) => [key, replaceFn(value)]));
        }
      })(ensure(sourceManifest.exports)),
      files: ['src', 'dist', 'README.md', '!**/*.test.ts'],
      dependencies: dependencies.length > 0
        ? Object.fromEntries(dependencies.map(({ name, version }) => [name, version]))
        : undefined,
    };
  }
  throw new Error(`Invalid type ${type}`);
}

const type = (() => {
  try {
    const type = ensure(ensure(ensure(Deno.args[0]).match(/^--type=(jsr|npm)$/))[1]);
    assert(type === 'jsr' || type === 'npm');
    return type;
  } catch {
    throw new Error('Missing or invalid "type" argument');
  }
})();

const sourceManifest = await (async () => {
  if (Deno.stdin.isTerminal()) {
    throw new Error('Missing input from stdin');
  }
  const input = await new Response(Deno.stdin.readable).text();
  if (input === '') {
    throw new Error('Missing input from stdin');
  }
  try {
    return parseSourceManifest(JSON.parse(input));
  } catch (error) {
    throw new Error('Invalid manifest', { cause: error });
  }
})();

const dependencies = await getExportsDependencies(sourceManifest);

const generatedManifest = generateManifest({ type, sourceManifest, dependencies });

console.log(JSON.stringify(generatedManifest, null, 2));
