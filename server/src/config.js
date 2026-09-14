import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

// Hosting environment variables take priority over the optional local .env.
dotenv.config({
  path: fileURLToPath(new URL('../.env', import.meta.url)),
  quiet: true,
});

export function getDatabaseProvider(databaseUrl) {
  if (typeof databaseUrl === 'string' && databaseUrl.startsWith('file:')) return 'sqlite';
  if (typeof databaseUrl === 'string' && /^postgres(ql)?:\/\//.test(databaseUrl)) return 'postgresql';
  throw new Error('DATABASE_URL must be a SQLite file: URL or a PostgreSQL connection URL.');
}

export function getFrontendOrigin(value, production = false) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)
      || (production && url.protocol !== 'https:')
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('Invalid frontend origin.');
    }
    return url.origin;
  } catch {
    throw new Error('FRONTEND_URL must be a frontend origin without a path; production requires HTTPS.');
  }
}

export function getServerConfig(environment = process.env) {
  const production = environment.NODE_ENV === 'production';
  const databaseProvider = getDatabaseProvider(environment.DATABASE_URL);
  const portValue = environment.PORT ?? '3000';
  const port = Number(portValue);
  if (!/^\d+$/.test(String(portValue)) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535.');
  }
  if (production && databaseProvider !== 'postgresql') {
    throw new Error('Production requires a PostgreSQL DATABASE_URL.');
  }
  if (production && (!environment.JWT_SECRET || !environment.JWT_SECRET.trim())) {
    throw new Error('JWT_SECRET is required in production.');
  }
  const frontendOrigin = getFrontendOrigin(
    environment.FRONTEND_URL || (production ? '' : 'http://localhost:5173'), production,
  );
  return { port, databaseProvider, frontendOrigin };
}
