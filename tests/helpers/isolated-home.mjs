// Run before modules cache os.homedir/default state. Every test process owns its home.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const home = mkdtempSync(join(tmpdir(), 'qling-unit-home-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.QLING_FILE_STATE_DIR = join(home, '.qling');
