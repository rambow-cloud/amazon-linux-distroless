const bundledNodeLibraries = {
  acorn: 'acorn',
  ada: 'ada',
  amaro: 'amaro',
  ares: 'c-ares',
  brotli: 'brotli',
  cjs_module_lexer: 'cjs-module-lexer',
  icu: 'icu',
  llhttp: 'llhttp',
  nghttp2: 'nghttp2',
  nghttp3: 'nghttp3',
  ngtcp2: 'ngtcp2',
  openssl: 'openssl',
  simdjson: 'simdjson',
  simdutf: 'simdutf',
  sqlite: 'sqlite',
  undici: 'undici',
  uv: 'libuv',
  uvwasi: 'uvwasi',
  v8: 'v8',
  zlib: 'zlib',
  zstd: 'zstd',
};

export function addUpstreamSbom(bom, config, upstream, sample) {
  const node = config.variant === 'nodejs';
  const name = node ? 'node' : 'python';
  const purl = 'pkg:generic/' + name + '@' + upstream.version;
  const product = node ? 'nodejs:node.js' : 'python:python';
  const runtime = {
    type: 'application',
    'bom-ref': purl,
    name,
    version: upstream.version,
    purl,
    cpe: 'cpe:2.3:a:' + product + ':' + upstream.version + ':*:*:*:*:*:*:*',
    externalReferences: [
      { type: 'distribution', url: upstream.url },
      { type: 'source-distribution', url: upstream.sourceUrl },
    ],
    properties: [
      { name: 'rambow:upstream-archive-sha256', value: upstream.sha256 },
      { name: 'rambow:upstream-source-sha256', value: upstream.sourceSha256 },
    ],
  };
  const observed = node ? bundledNodeLibraries : { mpdecimal: 'mpdecimal' };
  const libraries = Object.entries(observed).flatMap(([key, library]) => {
    const version = sample.versions?.[key];
    if (!version) return [];
    const purl = 'pkg:generic/' + library + '@' + encodeURIComponent(version);
    return [{ type: 'library', 'bom-ref': purl, name: library, version, purl }];
  });
  const root = bom.dependencies[0];
  root.dependsOn.push(purl);
  const runtimeDependency = { ref: purl, dependsOn: libraries.map(library => library['bom-ref']) };
  bom.components.push(runtime, ...libraries);
  bom.dependencies.push(runtimeDependency);
  return {
    ...bom,
    components: [runtime, ...libraries],
    dependencies: [{ ref: root.ref, dependsOn: [purl] }, runtimeDependency],
  };
}
