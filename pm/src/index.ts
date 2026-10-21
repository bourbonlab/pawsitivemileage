import { defaultDeps, main } from './main.js';

process.exitCode = await main(process.argv.slice(2), defaultDeps());
