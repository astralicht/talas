import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Routes the Mongo memory server's temp files and downloaded binaries away from
 * the small system drive into gitignored directories. The memory server can
 * write hundreds of megabytes per instance.
 *
 * - Windows: TEMP/TMP point at the repo-local .data/test-tmp (the system temp
 *   usually lives on the small C: drive). The mongod binaries stay in the
 *   package's default cache (where the postinstall script pre-downloads them);
 *   only override MONGOMS_DOWNLOAD_DIR deliberately.
 * - POSIX: TMPDIR defaults to the home-local ~/.local/tmp (avoids /tmp on
 *   machines where the root filesystem is nearly full).
 *
 * Call this before any mongodb-memory-server import (see tests/setup.ts and
 * tests/helpers/app-server.ts).
 */
export function routeTestTempDirs(): void {
  if (process.platform === 'win32') {
    const tmp = path.join(process.cwd(), '.data', 'test-tmp');
    mkdirSync(tmp, { recursive: true });
    process.env.TEMP = tmp;
    process.env.TMP = tmp;
  } else {
    const tmp = path.join(os.homedir(), '.local', 'tmp');
    mkdirSync(tmp, { recursive: true });
    process.env.TMPDIR = process.env.TMPDIR ?? tmp;
  }
}
