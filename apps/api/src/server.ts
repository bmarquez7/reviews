import { buildApp } from './app.js';
import { env } from './lib/env.js';

const app = buildApp();

const start = async () => {
  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(`Directory API listening on ${env.PORT}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

void start();
