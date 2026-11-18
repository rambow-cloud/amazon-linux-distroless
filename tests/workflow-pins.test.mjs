import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

test('external Actions and reusable workflows use full release version tags', () => {
  const directory = new URL('../.github/workflows/', import.meta.url);
  for (const file of fs.readdirSync(directory).filter(name => /\.ya?ml$/.test(name))) {
    const workflow = fs.readFileSync(new URL(file, directory), 'utf8');
    for (const [line, text] of workflow.split(/\r?\n/).entries()) {
      const use = /^\s*(?:-\s+)?uses:\s*["']?([^\s"'#]+)/.exec(text)?.[1];
      if (!use || use.startsWith('./')) continue;
      const pin = use.startsWith('docker://') ? /@sha256:[a-f0-9]{64}$/ : /@v?\d+\.\d+\.\d+$/;
      assert.match(use, pin, `${file}:${line + 1} requires a full release version or an OCI digest`);
    }
  }
});
