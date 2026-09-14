import app from './app.js';
import prisma from './db.js';
import { getServerConfig } from './config.js';

const { port } = getServerConfig();

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Backend listening on port ${port}`);
});

server.on('error', (error) => {
  console.error(`Could not start the backend: ${error.message}`);
  process.exit(1);
});

// Release connections when the hosting service stops or restarts this process.
function shutdown() {
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
