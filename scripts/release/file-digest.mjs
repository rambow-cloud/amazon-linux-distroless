import crypto from 'node:crypto';
import fs from 'node:fs';

export function sha256File(file) {
  const digest = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.alloc(4 * 1024 * 1024);
  try {
    let length;
    while ((length = fs.readSync(fd, buffer, 0, buffer.length, null))) {
      digest.update(buffer.subarray(0, length));
    }
  } finally {
    fs.closeSync(fd);
  }
  return digest.digest('hex');
}
