import fs from 'node:fs';

export function dockerfile(config) {
  const python = config.variant === 'python';
  const environment = python
    ? 'ENV PYTHONUTF8=1 PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/opt/python/site-packages'
    : 'ENV NODE_OPTIONS=--use-openssl-ca NODE_DISABLE_COMPILE_CACHE=1';
  return fs.readFileSync('images/upstream/Dockerfile', 'utf8')
    .replace('@RUNTIME_ENV@', environment)
    .replaceAll('@EXECUTABLE@', config.executable)
    .replace('@PROBE@', python ? '/fixture/probe.py' : '/app/probe.mjs');
}
