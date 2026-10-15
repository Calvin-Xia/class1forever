import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { detailsMap } from '../../../lib/api-handlers';
import { cloudflareEnvironment } from '../../../platform/cloudflare';

export const GET: APIRoute = ({ request }) => detailsMap(request, cloudflareEnvironment(env, request));
