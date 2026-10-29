import createClient from 'openapi-fetch';
import type { paths } from './schema';

// Paths already include /api/v1. Same-origin in production; Vite proxy in development.
export const api = createClient<paths>({ baseUrl: '' });
