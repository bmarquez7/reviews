import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApiError } from './http-errors.js';

type RateLimitRule = {
  name: string;
  limit: number;
  windowMs: number;
  match: (request: FastifyRequest, pathname: string) => boolean;
};

const REQUEST_LOG = new Map<string, number[]>();

const RULES: RateLimitRule[] = [
  {
    name: 'auth-login',
    limit: 8,
    windowMs: 10 * 60 * 1000,
    match: (request, pathname) => request.method === 'POST' && pathname === '/v1/auth/login'
  },
  {
    name: 'auth-signup',
    limit: 6,
    windowMs: 30 * 60 * 1000,
    match: (request, pathname) => request.method === 'POST' && pathname === '/v1/auth/signup'
  },
  {
    name: 'auth-reset',
    limit: 5,
    windowMs: 30 * 60 * 1000,
    match: (request, pathname) =>
      request.method === 'POST' &&
      (pathname === '/v1/auth/password-reset/request' || pathname === '/v1/auth/password-reset/confirm')
  },
  {
    name: 'media-upload',
    limit: 20,
    windowMs: 10 * 60 * 1000,
    match: (request, pathname) => request.method === 'POST' && pathname.startsWith('/v1/media/')
  },
  {
    name: 'public-write',
    limit: 40,
    windowMs: 10 * 60 * 1000,
    match: (request, pathname) =>
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) &&
      !pathname.startsWith('/v1/admin/') &&
      !pathname.startsWith('/docs') &&
      pathname !== '/' &&
      pathname !== '/v1/health'
  }
];

const getClientKey = (request: FastifyRequest) => {
  const forwardedFor = request.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }
  return request.ip || request.socket.remoteAddress || 'unknown';
};

const pruneHits = (hits: number[], windowMs: number, now: number) => hits.filter((hit) => now - hit < windowMs);

export const registerRateLimit = (app: FastifyInstance) => {
  app.addHook('onRequest', async (request, reply) => {
    const pathname = request.raw.url?.split('?')[0] || request.url || '';
    const rule = RULES.find((candidate) => candidate.match(request, pathname));
    if (!rule) return;

    const now = Date.now();
    const key = `${rule.name}:${getClientKey(request)}`;
    const hits = pruneHits(REQUEST_LOG.get(key) ?? [], rule.windowMs, now);

    if (hits.length >= rule.limit) {
      reply.header('Retry-After', String(Math.ceil(rule.windowMs / 1000)));
      throw new ApiError(429, 'RATE_LIMITED', 'Too many requests. Please wait and try again.');
    }

    hits.push(now);
    REQUEST_LOG.set(key, hits);
    reply.header('X-RateLimit-Limit', String(rule.limit));
    reply.header('X-RateLimit-Remaining', String(Math.max(rule.limit - hits.length, 0)));
  });
};
