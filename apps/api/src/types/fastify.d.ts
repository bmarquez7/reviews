import 'fastify';

export type AppRole = 'consumer' | 'business_owner' | 'moderator' | 'admin';

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: {
      id: string;
      email?: string;
      role: AppRole;
      isSuspended: boolean;
      policiesAcceptedVersion: string | null;
    };
  }
}
