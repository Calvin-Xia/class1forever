import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { publicMap } from '../../../lib/api-handlers';
import { cloudflareEnvironment } from '../../../platform/cloudflare';

export const GET: APIRoute = ({ request }) => publicMap(request, cloudflareEnvironment(env, request));
