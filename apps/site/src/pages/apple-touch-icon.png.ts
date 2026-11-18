import type { APIRoute } from 'astro';
import { themeAssetResponse } from '../lib/theme-asset';

export const GET: APIRoute = () => themeAssetResponse('logo', 180);
