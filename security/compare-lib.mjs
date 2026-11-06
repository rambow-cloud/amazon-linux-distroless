import crypto from 'node:crypto';

export const severities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];
const property = (name, value) => ({ name: 'aquasecurity:trivy:' + name, value: String(value) });
export function isNotice(path) {
  return path.startsWith('usr/share/licenses/') || path.startsWith('usr/share/doc/') ||
    /\/legal(?:\/|$)/.test(path);
}
export function inventorySbom(inventory, lock, imageId) {
  const evidence = new Map();
  const unowned = [];
  for (const file of inventory.files) {
    if (file.kind !== 'file' || isNotice(file.path)) continue;
    if (!file.packages?.length) unowned.push({ path: file.path, generated_by: file.generated_by || null });
    for (const owner of file.packages || []) {
      if (!evidence.has(owner)) evidence.set(owner, []);
      evidence.get(owner).push({ path: file.path, sha256: file.sha256 });
    }
  }
  const inputs = new Map(inventory.packages.map(p => [p.name, p]));
  const components = [];
  const selected = [];
  for (const [name, files] of [...evidence.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const p = inputs.get(name);
    if (!p) throw new Error('File owner has no locked RPM metadata: ' + name);
    const source = lock.sources.find(s => s.filename === p.source_rpm);
    if (!source) throw new Error('Missing source metadata for ' + name);
    const version = p.version + '-' + p.release;
    const purl = 'pkg:rpm/amazon/' + encodeURIComponent(name) + '@' + encodeURIComponent(version) +
      '?arch=' + p.arch + '&distro=amazon-2023&epoch=' + p.epoch;
    components.push({ type: 'library', 'bom-ref': purl, name, version, purl,
      licenses: [{ license: { name: p.license } }],
      properties: [
        property('SrcName', source.name), property('SrcVersion', source.version),
        property('SrcRelease', source.release), property('SrcEpoch', source.epoch),
        { name: 'rambow:partial-package', value: 'true' },
        { name: 'rambow:input-rpm-sha256', value: p.sha256 },
        { name: 'rambow:runtime-file-count', value: String(files.length) },
      ] });
    selected.push({ name, epoch: p.epoch, version: p.version, release: p.release, arch: p.arch,
      source_rpm: p.source_rpm, purl, files });
  }
  if (!selected.length) throw new Error('No payload packages selected');
  const rootRef = 'rambow-java-prototype';
  const osRef = 'amazon-linux-2023';
  const bom = { bomFormat: 'CycloneDX', specVersion: '1.6',
    serialNumber: 'urn:uuid:' + crypto.randomUUID(), version: 1,
    metadata: { timestamp: new Date().toISOString(),
      tools: { components: [{ type: 'application', name: 'rambow-inventory-scan-adapter', version: '1' }] },
      component: { type: 'container', 'bom-ref': rootRef, name: 'AL2023 Java prototype',
        properties: [property('ImageID', imageId)] } },
    components: [{ type: 'operating-system', 'bom-ref': osRef, name: 'amazon', version: '2023',
      properties: [property('Type', 'amazon'), property('Class', 'os-pkgs')] }, ...components],
    dependencies: [{ ref: rootRef, dependsOn: [osRef] },
      { ref: osRef, dependsOn: components.map(c => c['bom-ref']) }] };
  return { bom, coverage: { selected, unownedGeneratedFiles: unowned,
    excludedInputs: [...inputs.keys()].filter(name => !evidence.has(name)),
    policy: 'Include owners of shipped regular non-notice files; exclude symlink-only, license-only and unshipped transaction inputs. Package-level findings still require file/function applicability review.' } };
}
export function scanPackages(report, osOnly = false) {
  const found = new Map();
  for (const result of report.Results || []) {
    if (osOnly && result.Class !== 'os-pkgs') continue;
    for (const p of result.Packages || []) {
      const version = [p.Epoch || 0, p.Version || '', p.Release || ''].join(':');
      found.set(p.Name + '@' + version, { ...p, resultType: result.Type, resultClass: result.Class });
    }
  }
  return [...found.values()];
}
export function findings(report) {
  const unique = new Map();
  for (const result of report.Results || []) {
    for (const v of result.Vulnerabilities || []) {
      const entry = { id: v.VulnerabilityID, package: v.PkgName, installed: v.InstalledVersion,
        fixed: v.FixedVersion || '', severity: v.Severity || 'UNKNOWN', status: v.Status || '',
        type: result.Type, class: result.Class, severitySource: v.SeveritySource || '',
        dataSource: v.DataSource || null, title: v.Title || '', url: v.PrimaryURL || '' };
      const key = JSON.stringify([entry.class, entry.type, entry.package, entry.installed, entry.id]);
      unique.set(key, entry);
    }
  }
  return [...unique.values()].sort((a, b) => severities.indexOf(a.severity) - severities.indexOf(b.severity) ||
    a.package.localeCompare(b.package) || a.id.localeCompare(b.id));
}
export function metrics(report) {
  const pairs = findings(report);
  const bySeverity = Object.fromEntries(severities.map(s => [s, pairs.filter(p => p.severity === s).length]));
  const osPackages = scanPackages(report, true);
  const runtimeNames = osPackages.filter(p => /temurin|corretto|openjdk|java-\d/.test(p.Name));
  return { os: report.Metadata?.OS || null, osPackages: osPackages.length,
    allPackages: scanPackages(report).length, pairCount: pairs.length,
    uniqueCves: new Set(pairs.filter(p => p.id.startsWith('CVE-')).map(p => p.id)).size,
    uniqueAdvisories: new Set(pairs.map(p => p.id)).size, bySeverity,
    fixAvailablePairs: pairs.filter(p => p.fixed).length,
    noFixListedPairs: pairs.filter(p => !p.fixed).length,
    javaRuntimePackages: runtimeNames.map(p => ({ name: p.Name, version: p.Version, release: p.Release,
      source: p.SrcName || null, type: p.resultType })),
    dataSources: [...new Set(pairs.map(p => p.dataSource?.ID || '').filter(Boolean))] };
}
export function assertCoverage(report, expected) {
  if (report.Metadata?.OS?.Family !== 'amazon' || report.Metadata?.OS?.Name !== '2023') {
    throw new Error('Inventory SBOM did not select the Amazon Linux 2023 matcher');
  }
  const actual = new Set(scanPackages(report, true).map(p => p.Name));
  const wanted = new Set(expected.map(p => p.name));
  const missing = [...wanted].filter(name => !actual.has(name));
  const unexpected = [...actual].filter(name => !wanted.has(name));
  if (missing.length || unexpected.length) {
    throw new Error('OS package coverage differs: ' + JSON.stringify({ missing, unexpected }));
  }
}
export function comparisonMarkdown(result) {
  const rows = [
    ['AL2023 direct image', result.scans.prototypeNative, 'Inspect coverage; RPM database absent'],
    ['AL2023 inventory-backed', result.scans.prototypeInventory, 'All selected payload packages enumerated'],
    ['Official Distroless direct image', result.scans.officialNative, 'Native Debian/package metadata'],
  ];
  if (result.scans.prototypeRpmFull) {
    rows.splice(2, 0,
      ['AL2023 native RPM full transaction', result.scans.prototypeRpmFull, 'Includes unshipped dependencies; not a runtime payload count'],
      ['AL2023 native RPM payload only', result.scans.prototypeRpmPayload, 'Actual RPM headers; partial packages; native release marker added']);
  }
  let text = '# Java 21 CVE comparison\n\n' +
    'One Trivy version/digest and unchanged vulnerability/Java database snapshot; linux/amd64; all severities and unfixed findings included. No application JAR was added to either runtime.\n\n' +
    '| Scan | OS packages | Critical | High | Medium | Low | Unknown | Package/advisory pairs | Unique CVEs | Fix listed | Coverage |\n' +
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |\n';
  for (const [label, m, coverage] of rows) {
    text += '| ' + [label, m.osPackages, ...severities.map(s => m.bySeverity[s]), m.pairCount, m.uniqueCves,
      m.fixAvailablePairs, coverage].join(' | ') + ' |\n';
  }
  text += '\n## Images and runtime versions\n\n' +
    '- Prototype ID: ' + result.images.prototype.id + '; ' + result.images.prototype.size + ' uncompressed bytes.\n' +
    '- Official digest: ' + result.images.official.ref + '; ' + result.images.official.size + ' uncompressed bytes.\n' +
    '- Prototype Java: ' + result.images.prototype.javaVersion.trim().replaceAll('\n', ' / ') + '\n' +
    '- Official Java: ' + result.images.official.javaVersion.trim().replaceAll('\n', ' / ') + '\n' +
    '- Scanner: ' + result.scanner.ref + '\n' +
    '- Baseline artifact: run ' + result.prototypeRun + '; original image ID checked against its verification report.\n';
  text += '\n## Coverage and interpretation\n\n' +
    '- The prototype has no RPM database. Its direct scan alone is not a valid complete OS CVE result. The supplementary scan-only CycloneDX uses owners of actual shipped regular files, excluding notices and unshipped inputs; runtime image bytes are unchanged.\n' +
    '- Selected payload RPMs: ' + result.coverage.selected.map(p => p.name).join(', ') + '.\n' +
    '- Missing from the payload package set (license-only/unshipped): ' + result.coverage.excludedInputs.join(', ') + '.\n' +
    '- The sidecar covers ' + result.coverage.selected.length + ' packages; the scanner enumerated that exact package-name set and selected Amazon Linux 2023.\n' +
    '- AL2023 and Debian use different vendor advisory feeds, backport policies, status labels and severity assignments. Counts are not a distribution-independent safety ranking.\n' +
    '- Trivy Java language analysis primarily covers application dependencies/JAR metadata. JVM engine CVE matching here depends on OS/vendor package coverage; a recognized Temurin package does not prove complete Adoptium advisory coverage. No zero-JVM-risk conclusion is made.\n' +
    '- Packages are represented by their full RPM version even when only some files ship. Findings need affected-file/function and runtime applicability review; absence of a fix string is not proof that upstream has no mitigation.\n' +
    '- No ignore file, severity suppression, ignore-unfixed option, application exploitability analysis, VEX override or release gate was applied. This is a point-in-time diagnostic.\n';
  if (result.rpmdbEvidence) {
    const e = result.rpmdbEvidence;
    const c = result.representationComparison;
    text += '\n## Native RPM database experiment\n\n' +
      'The original artifact did not preserve its disposable installed root. Its native RPM database was reconstructed in Actions by reinstalling the exact signed/checksummed locked RPM transaction offline, not copied from an unrelated AL2023 image. This is new metadata with verified package identities, not the original historical database bytes.\n\n' +
      'Both scan-only overlays add the native database at ' + e.database_path + ' and the locked system-release package file usr/lib/system-release. Trivy 0.76.2 requires this release marker for Amazon Linux recognition; the original minimal etc/os-release alone was insufficient. Original runtime layers and configuration were verified unchanged, and the original image tag still identifies the tested image.\n\n' +
      '- Full installed transaction packages: ' + e.variants.full.packages.length + '.\n' +
      '- Payload-only packages after metadata-only erasures: ' + e.variants.payload.packages.length + '.\n' +
      '- Both SQLite integrity checks: ' + e.variants.full.sqlite_integrity + ' / ' + e.variants.payload.sqlite_integrity + '.\n' +
      '- Exact native RPM package name/epoch/version/release/architecture enumeration verified for both scans.\n' +
      '- Payload native RPM findings equal inventory SBOM findings: ' + c.payloadFindingsIdentical + '.\n' +
      '- Findings attributed to non-payload packages in the full database: ' + c.fullDatabaseAdditionalNonPayloadFindings.length + '.\n\n' +
      'A pruned database still describes complete RPM packages even though the runtime ships selected files. It is scanner metadata and does not establish that every RPM-owned file is installed. The full transaction database may overstate runtime exposure by representing build-only/license-only dependencies. Removing package-manager executables does not require removing their passive metadata; choosing a supported scanner metadata contract remains release-design work.\n';
  }
  text += '\n## Findings requiring review\n\n| Image | Severity | Package | Advisory | Installed | Fix listed |\n| --- | --- | --- | --- | --- | --- |\n';
  for (const [label, list] of [['AL2023', result.findings.prototypeRpmPayload || result.findings.prototypeInventory],
    ['AL2023 full transaction (includes non-payload)', result.findings.prototypeRpmFull || []], ['Official', result.findings.officialNative]]) {
    for (const f of list.filter(p => ['CRITICAL', 'HIGH'].includes(p.severity)).slice(0, 30)) {
      const id = f.url ? '[' + f.id + '](' + f.url + ')' : f.id;
      text += '| ' + [label, f.severity, f.package, id, f.installed, f.fixed || 'Not listed'].join(' | ') + ' |\n';
    }
  }
  return text;
}
