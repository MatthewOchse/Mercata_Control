/** Client-safe server constants — importing queries.ts would pull mysql2 in. */

/** Provision the next box before a server is urgent, not after. */
export const CAPACITY_WARN_PCT = 80;

/** Tenants per box unless a server overrides it. */
export const DEFAULT_SERVER_CAPACITY = 14;
