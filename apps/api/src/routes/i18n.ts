import type { FastifyPluginAsync } from 'fastify';

const SUPPORTED = ['en', 'es', 'fr', 'sq', 'el', 'it'] as const;

export const i18nRoutes: FastifyPluginAsync = async (app) => {
  app.get('/i18n/languages', async () => ({
    data: {
      supported: SUPPORTED,
      fallback: 'en',
      extendable: true
    }
  }));
};
