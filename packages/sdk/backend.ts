// Backend side of the module contract, PC part (`@hub/sdk/backend`): the
// portable part (`@hub/sdk/core`) plus the types of the PC's server
// (Fastify). The modules that must also run on the phone (Courses, Sport,
// To-do, Timer, Boîte à idées) import `@hub/sdk/core` only (ESLint checks
// it, ADR 0044); the others may keep this one. See docs/MODULES.md.
export * from './core';
export type { FastifyReply, FastifyRequest } from 'fastify';
