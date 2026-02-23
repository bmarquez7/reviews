import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { env } from './lib/env.js';
import { toErrorResponse } from './lib/http-errors.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { i18nRoutes } from './routes/i18n.js';
import { userRoutes } from './routes/users.js';
import { directoryRoutes } from './routes/directory.js';
import { ratingRoutes } from './routes/ratings.js';
import { businessRoutes } from './routes/business.js';
import { adminRoutes } from './routes/admin.js';
export const buildApp = () => {
    const app = Fastify({ logger: true });
    app.register(cors, {
        origin: [env.APP_ORIGIN],
        credentials: true
    });
    app.register(swagger, {
        openapi: {
            info: {
                title: 'Directory API',
                version: '0.1.0'
            }
        }
    });
    app.register(swaggerUi, {
        routePrefix: '/docs'
    });
    app.setErrorHandler((error, _request, reply) => {
        const shaped = toErrorResponse(error);
        void reply.code(shaped.statusCode).send(shaped.body);
    });
    app.register(healthRoutes, { prefix: '/v1' });
    app.register(authRoutes, { prefix: '/v1' });
    app.register(i18nRoutes, { prefix: '/v1' });
    app.register(userRoutes, { prefix: '/v1' });
    app.register(directoryRoutes, { prefix: '/v1' });
    app.register(ratingRoutes, { prefix: '/v1' });
    app.register(businessRoutes, { prefix: '/v1' });
    app.register(adminRoutes, { prefix: '/v1' });
    return app;
};
