export const config = { runtime: 'nodejs' };
export default async function handler(req, res) {
  try {
    const qs = req.url.split('?')[1] || '';
    const target = `https://comunicaapi.pje.jus.br/api/v1/comunicacao${qs ? '?' + qs : ''}`;
    const upstream = await fetch(target, { headers: { 'Accept': 'application/json' } });
    const body = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    res.send(body);
  } catch (err) {
    res.status(502).json({ error: 'relay_failed', message: String(err) });
  }
}
