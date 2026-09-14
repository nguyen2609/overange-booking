import { getDatabaseProvider } from './config.js';

// The models and queries are identical; only the database client changes.
const provider = getDatabaseProvider(process.env.DATABASE_URL);
const { PrismaClient } = provider === 'sqlite'
  ? await import('@prisma/client')
  : await import('../generated/postgresql/index.js');

// Import this shared instance wherever the backend needs database access.
const prisma = new PrismaClient();

export default prisma;
