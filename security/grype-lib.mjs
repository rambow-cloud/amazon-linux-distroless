import assert from 'node:assert/strict';

export const levels = ['Critical', 'High', 'Medium', 'Low', 'Negligible', 'Unknown'];
export function grypeFindings(report) {
  const unique = new Map();
  for (const m of report.matches || []) {
    const v = m.vulnerability;
    const a = m.artifact;
    const cves = [...new Set([v.id, ...(m.relatedVulnerabilities || []).map(v => v.id)]
      .filter(id => /^CVE-/.test(id)))].sort();
    const item = { package: a.name, version: a.version, type: a.type, id: v.id,
      namespace: v.namespace || '', severity: v.severity || 'Unknown',
      fixed: v.fix?.versions || [], fixState: v.fix?.state || 'unknown', cves,
      url: v.dataSource || '', matchers: [...new Set((m.matchDetails || []).map(d => d.matcher))] };
    const key = JSON.stringify([item.type, item.package, item.version, item.id, item.namespace]);
    unique.set(key, item);
  }
  return [...unique.values()];
}
export function grypeMetrics(report, sbom) {
  const list = grypeFindings(report);
  const os = list.filter(f => ['rpm', 'deb', 'apk'].includes(f.type));
  return { distro: sbom.linuxDistribution, packages: sbom.artifacts.length,
    osPackages: sbom.artifacts.filter(a => ['rpm', 'deb', 'apk'].includes(a.type)).length,
    packageTypes: Object.fromEntries([...new Set(sbom.artifacts.map(a => a.type))].map(type =>
      [type, sbom.artifacts.filter(a => a.type === type).length])),
    rawMatches: report.matches?.length || 0, ignoredMatches: report.ignoredMatches?.length || 0,
    advisoryPairs: list.length, cvePairs: new Set(list.flatMap(f => f.cves.map(c => f.package + '|' + c))).size,
    uniqueCves: new Set(list.flatMap(f => f.cves)).size,
    osAdvisoryPairs: os.length, osUniqueCves: new Set(os.flatMap(f => f.cves)).size,
    bySeverity: Object.fromEntries(levels.map(s => [s, list.filter(f => f.severity === s).length])),
    fixListed: list.filter(f => f.fixed.length).length,
    fixStates: Object.fromEntries([...new Set(list.map(f => f.fixState))].map(state =>
      [state, list.filter(f => f.fixState === state).length])),
    namespaces: [...new Set(list.map(f => f.namespace))] };
}
export function assertSyftRpms(sbom, expected) {
  assert.equal(sbom.linuxDistribution?.id, 'amzn');
  assert.match(sbom.linuxDistribution?.versionID || '', /^2023(?:\.|$)/);
  const actual = sbom.artifacts.filter(a => a.type === 'rpm').map(a => {
    const m = a.metadata;
    const epoch = Number(m.epoch || 0);
    const canonical = (epoch ? epoch + ':' : '') + m.version + '-' + m.release;
    assert.equal(a.version.replace(/^0:/, ''), canonical, 'Syft RPM display version mismatch: ' + a.name);
    return [a.name, epoch, m.version, m.release, m.architecture, m.sourceRpm].join('|');
  }).sort();
  const wanted = expected.map(p => [p.name, Number(p.epoch || 0), p.version, p.release, p.arch, p.source_rpm].join('|')).sort();
  assert.deepEqual(actual, wanted, 'Syft native RPM identity/source coverage differs');
}
export function crossScanner(grype, trivy) {
  const ours = new Set(grypeFindings(grype).flatMap(f => f.cves.map(c => f.package + '|' + c)));
  const prior = new Set(trivy.filter(f => f.id.startsWith('CVE-')).map(f => f.package + '|' + f.id));
  return { shared: [...ours].filter(k => prior.has(k)).sort(),
    grypeOnly: [...ours].filter(k => !prior.has(k)).sort(), trivyOnly: [...prior].filter(k => !ours.has(k)).sort() };
}
export function grypeMarkdown(r) {
  let text = '# Syft and Grype Java CVE comparison\n\n' +
    'All image operations and scans ran in GitHub Actions. Reused the original runtime archive and previously exported native RPM database bytes; no runtime rebuild or Trivy rescan. All four Grype scans used one unchanged Grype database snapshot.\n\n' +
    '| Target | OS packages | All packages | Critical | High | Medium | Low | Negligible | Unknown | Advisory pairs | Unique CVEs | Fix listed | Ignored |\n' +
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n';
  for (const [name, m] of Object.entries(r.metrics)) text += '| ' + [name, m.osPackages, m.packages,
    ...levels.map(s => m.bySeverity[s]), m.advisoryPairs, m.uniqueCves, m.fixListed, m.ignoredMatches].join(' | ') + ' |\n';
  text += '\nSeverity counts are deduplicated package/advisory pairs. ALAS advisories can map to multiple CVEs; unique CVEs expand reported CVE aliases. OS and non-OS matches remain separate in JSON. Raw matches, ignored matches, namespaces, matchers and fix states are retained. Default scanner applicability rules remain active; no project ignore rules, only-fixed filter or manual suppression is added.\n\n' +
    'The original image has no RPM database; its OS package discovery cannot establish complete OS CVE coverage. Full transaction RPM metadata includes unshipped dependencies. RPM records describe complete packages even when only selected files ship. Native overlays preserve the original runtime layers/configuration.\n\n' +
    'Grype uses ALAS for Amazon RPMs and distribution feeds for Debian. Changing scanner does not guarantee complete AL2023 unfixed coverage. Binary/NVD matches, when present, require version/backport/applicability review. Java engine coverage must not be inferred from JAR dependency coverage.\n\n' +
    'Prior Trivy run: ' + r.trivyRun + '. Trivy and Grype have different databases and matching/severity policies; their CVE set differences are evidence for review, not automatic scanner errors or a security ranking.\n\n' +
    '| Target | Shared package/CVE keys | Grype only | Trivy only |\n| --- | ---: | ---: | ---: |\n';
  for (const [name, c] of Object.entries(r.crossScanner)) text += '| ' + [name, c.shared.length, c.grypeOnly.length, c.trivyOnly.length].join(' | ') + ' |\n';
  text += '\n## Images and tools\n\n';
  for (const [name, image] of Object.entries(r.images)) text += '- ' + name + ': ' + image.id + (image.ref ? '; ' + image.ref : '') + '\n';
  for (const [name, t] of Object.entries(r.tools)) text += '- ' + name + ': ' + t.ref + '; version ' + t.version.version + '\n';
  text += '\n## High and critical matches\n\n| Target | Severity | Package | Type | Advisory | Namespace | Fix |\n| --- | --- | --- | --- | --- | --- | --- |\n';
  for (const [name, list] of Object.entries(r.findings)) for (const f of list.filter(f => ['Critical', 'High'].includes(f.severity)).slice(0, 40)) {
    text += '| ' + [name, f.severity, f.package, f.type, f.id, f.namespace, f.fixed.join(', ') || 'Not listed'].join(' | ') + ' |\n';
  }
  return text;
}
