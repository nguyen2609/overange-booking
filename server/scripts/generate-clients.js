import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const serverDirectory = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const clientVersion = require('@prisma/client/package.json').version;
const clients = [
  { schema: 'prisma/schema.prisma', output: 'node_modules/.prisma/client' },
  { schema: 'prisma/postgresql/schema.prisma', output: 'generated/postgresql' },
];
const normalize = (text) => text.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n').trim();

for (const { schema, output } of clients) {
  const source = await readFile(new URL('../' + schema, import.meta.url), 'utf8');
  const generated = await readFile(new URL('../' + output + '/schema.prisma', import.meta.url), 'utf8').catch(() => '');
  const generatedVersion = await readFile(new URL('../' + output + '/package.json', import.meta.url), 'utf8')
    .then((text) => JSON.parse(text).version).catch(() => undefined);
  // Avoid replacing an unchanged engine DLL while a local Windows server uses it.
  if (normalize(source) === normalize(generated) && generatedVersion === clientVersion) {
    console.log(`Prisma Client already generated: ${schema}`);
    continue;
  }
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'generate', '--schema', schema], {
    cwd: serverDirectory, env: process.env, stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
