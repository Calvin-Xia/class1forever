import { spawnSync } from 'node:child_process';
import { localToolEnvironment } from './local-tool-env.cjs';
const result = spawnSync(process.execPath, ['--test', 'tests/api-contract.test.mjs'], { stdio: 'inherit', env: localToolEnvironment({ API_TARGET: 'edgeone' }) });
process.exit(result.status ?? 1);
