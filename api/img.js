// GET /api/img?url=...&ref=...  -> the image bytes (proxied to avoid CORS)
const { assertPublicUrl, UA } = require('./_safe');

const MAX = 25 * 1024 * 1024;

module.exports = async (req, res) => {
  try {
    const u = await assertPublicUrl(String(req.query.url || ''));
    const headers = { 'User-Agent': UA, 'Accept': 'image/avif,image/webp,image/*,*/*;q=0.8' };
    if (req.query.ref) headers.Referer = String(req.query.ref);

    const r = await fetch(u, { headers, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error('status ' + r.status);
    const type = (r.headers.get('content-type') || '').split(';')[0].trim();
    if (type && !type.startsWith('image/') && type !== 'application/octet-stream') throw new Error('not an image');
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX) throw new Error('too big');

    res.setHeader('Content-Type', type || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).send(buf);
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
};
