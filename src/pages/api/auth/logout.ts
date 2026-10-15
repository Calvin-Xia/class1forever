import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { logout } from '../../../lib/api-handlers';
import { cloudflareEnvironment } from '../../../platform/cloudflare';

export const POST: APIRoute = ({ request }) => logout(request, cloudflareEnvironment(env, request));
