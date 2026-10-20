// GET /api/scan?url=...  -> { page, title, images: [{url, source}] }
const { assertPublicUrl, UA } = require('./_safe');

const IMG_EXT = /\.(jpe?g|png|gif|webp|avif|svg|bmp|ico|heic|tiff?)(\?|#|$)/i;

function decode(s) {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\\\//g, '/');
}

function attr(tag, name) {
  const m = tag.match(new RegExp('\\s' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i'));
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? '') : null;
}

function fromSrcset(v) {
  return v.split(/,\s+(?=\S)/).map(p => p.trim().split(/\s+/)[0]).filter(Boolean);
}

function extract(html) {
  const found = [];
  const add = (u, source) => { if (u && !u.startsWith('data:') && !u.startsWith('blob:')) found.push({ u: u.trim(), source }); };

  // <img> and <source>
  for (const m of html.matchAll(/<(img|source)\b[^>]*>/gi)) {
    const tag = m[0];
    for (const a of ['src', 'data-src', 'data-lazy-src', 'data-original', 'data-url', 'data-full', 'data-large', 'data-image']) {
      const v = attr(tag, a); if (v) add(v, 'img');
    }
    for (const a of ['srcset', 'data-srcset']) {
      const v = attr(tag, a); if (v) fromSrcset(v).forEach(x => add(x, 'img'));
    }
  }
  // og / twitter images
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const p = (attr(m[0], 'property') || attr(m[0], 'name') || '').toLowerCase();
    if (/^(og:image|twitter:image)/.test(p)) add(attr(m[0], 'content'), 'meta');
  }
  // icons
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (attr(m[0], 'rel') || '').toLowerCase();
    if (/icon|image_src/.test(rel)) add(attr(m[0], 'href'), 'icon');
  }
  // links pointing straight at images
  for (const m of html.matchAll(/<a\b[^>]*>/gi)) {
    const h = attr(m[0], 'href'); if (h && IMG_EXT.test(h)) add(h, 'link');
  }
  // CSS backgrounds
  for (const m of html.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) {
    if (IMG_EXT.test(m[1])) add(decode(m[1]), 'css');
  }
  // image URLs hidden in scripts/JSON
  for (const m of html.matchAll(/https?:\\?\/\\?\/[^\s"'<>()]+?\.(?:jpe?g|png|gif|webp|avif)(?:\?[^\s"'<>()]*)?/gi)) {
    add(decode(m[0]), 'script');
  }
  return found;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    let raw = String(req.query.url || '').trim();
    if (!raw) throw new Error('חסרה כתובת');
    if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
    const u = await assertPublicUrl(raw);

    const r = await fetch(u, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*', 'Accept-Language': 'he,en;q=0.8' },
      redirect: 'follow', signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error('האתר החזיר שגיאה ' + r.status);
    const html = (await r.text()).slice(0, 8_000_000);
    const base = new URL(r.url || u.href);
    const baseTag = html.match(/<base\b[^>]*href\s*=\s*["']([^"']+)/i);
    const resolveBase = baseTag ? new URL(decode(baseTag[1]), base) : base;

    const seen = new Set(); const images = [];
    for (const { u: x, source } of extract(html)) {
      let abs;
      try { abs = new URL(x, resolveBase).href; } catch { continue; }
      if (!/^https?:/.test(abs)) continue;
      const key = abs.split('#')[0];
      if (seen.has(key)) continue;
      seen.add(key); images.push({ url: key, source });
    }
    const title = (html.match(/<title[^>]*>([^<]*)/i) || [])[1] || base.hostname;
    res.status(200).json({ page: base.href, title: decode(title).trim(), images });
  } catch (e) {
    res.status(400).json({ error: e.name === 'TimeoutError' ? 'האתר לא ענה בזמן' : e.message });
  }
};
