import { defineConfig } from 'prisma/config';
import './src/config.js';

// Plain `prisma migrate deploy` uses PostgreSQL for production.
// Local SQLite scripts explicitly pass --schema prisma/schema.prisma.
export default defineConfig({ schema: 'prisma/postgresql/schema.prisma' });
