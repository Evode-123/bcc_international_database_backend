import { AppDataSource } from './config/data-source';
import { createApp } from './app';
import { env } from './config/env';
import { runSeed } from './services/seed.service';

async function main(): Promise<void> {
  // AppDataSource.initialize() connects to PostgreSQL and, because
  // synchronize: true is set on the DataSource, creates/updates every
  // table, enum, index, and foreign key to match the entity classes in
  // src/entities/ -- this is what gives you "tables are created
  // automatically when the server starts."
  console.log('[startup] Connecting to PostgreSQL and syncing schema...');
  await AppDataSource.initialize();
  console.log('[startup] Database schema is up to date.');

  await runSeed();

  const app = createApp();

  app.listen(env.port, () => {
    console.log(`[startup] BCC disciples backend listening on port ${env.port}`);
  });
}

main().catch((err) => {
  console.error('[startup] Failed to start server:', err);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
  process.exit(0);
});
