import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ url }) => {
  const lines = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /admin',
    'Disallow: /dasbor',
    'Disallow: /profil',
    'Disallow: /kredit',
    'Disallow: /pustaka',
    'Disallow: /jalur',
    'Disallow: /keluar',
    '',
    `Sitemap: ${new URL('/sitemap.xml', url.origin).href}`,
    '',
  ];
  return new Response(lines.join('\n'), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
};
