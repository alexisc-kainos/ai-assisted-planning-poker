import { loadConfig } from './config.js';
import { createAppServer } from './server.js';

const config = loadConfig();
const app = createAppServer(config);
const port = await app.listen();
console.log(`Planning poker backend listening on port ${port}`);

let stopping = false;
const stop = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} received, shutting down`);
  await app.shutdown();
  process.exit(0);
};

process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('SIGINT', () => void stop('SIGINT'));
