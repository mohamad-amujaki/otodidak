import type { APIRoute } from 'astro';

const routes = ['/', '/masuk', '/privasi', '/ketentuan'];

export const GET: APIRoute = ({ url }) => {
  const urls = routes
    .map((path) => {
      const loc = new URL(path, url.origin).href;
      const priority = path === '/' ? '1.0' : '0.4';
      return [
        '  <url>',
        `    <loc>${loc}</loc>`,
        '    <changefreq>weekly</changefreq>',
        `    <priority>${priority}</priority>`,
        '  </url>',
      ].join('\n');
    })
    .join('\n');
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    '</urlset>',
    '',
  ].join('\n');
  return new Response(xml, {
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
};
