import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { login } from '../../../lib/api-handlers';
import { cloudflareEnvironment } from '../../../platform/cloudflare';

export const POST: APIRoute = ({ request }) => login(request, cloudflareEnvironment(env, request));
