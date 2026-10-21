/** Regenerate openapi.json from the route table: npm run openapi -w @pawsitivemileage/contracts */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderOpenApiDocument } from '../src/openapi.js';

const target = fileURLToPath(new URL('../openapi.json', import.meta.url));
writeFileSync(target, renderOpenApiDocument());
console.log(`wrote ${target}`);
