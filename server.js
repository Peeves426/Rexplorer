const express = require('express');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const path = require('path');

const app = express();
const PORT = 3000;

// Serve static frontend files
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/styles.css', (req, res) => res.sendFile(path.join(__dirname, 'styles.css')));
app.get('/script.js', (req, res) => res.sendFile(path.join(__dirname, 'script.js')));
app.get('/rex.png', (req, res) => res.sendFile(path.join(__dirname, 'rex.png')));

// Rewrite a URL to route through our proxy
function rewriteUrl(url, baseUrl) {
  if (!url || url.startsWith('data:') || url.startsWith('javascript:') || url.startsWith('#') || url.startsWith('/proxy?url=')) {
    return url;
  }
  try {
    const absolute = new URL(url, baseUrl).href;
    return '/proxy?url=' + encodeURIComponent(absolute);
  } catch {
    return url;
  }
}

// Rewrite srcset attribute (comma-separated list of url + size)
function rewriteSrcset(srcset, baseUrl) {
  if (!srcset) return srcset;
  return srcset.split(',').map(part => {
    const trimmed = part.trim();
    const spaceIdx = trimmed.search(/\s/);
    if (spaceIdx === -1) return rewriteUrl(trimmed, baseUrl);
    const url = trimmed.substring(0, spaceIdx);
    const descriptor = trimmed.substring(spaceIdx);
    return rewriteUrl(url, baseUrl) + descriptor;
  }).join(', ');
}

// Rewrite CSS url(...) references
function rewriteCss(css, baseUrl) {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, quote, url) => {
    return `url(${quote}${rewriteUrl(url.trim(), baseUrl)}${quote})`;
  });
}

// Main proxy handler
app.get('/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Missing ?url= parameter');

  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    return res.status(400).send('Invalid URL');
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Referer': parsedUrl.origin,
      },
      redirect: 'follow',
    });

    const contentType = response.headers.get('content-type') || '';

    // Rewrite CSS files
    if (contentType.includes('text/css')) {
      const css = await response.text();
      res.set('Content-Type', 'text/css; charset=utf-8');
      res.send(rewriteCss(css, response.url));
      return;
    }

    // Rewrite JS files minimally (just pass through — full JS rewriting is very complex)
    if (contentType.includes('javascript')) {
      const js = await response.text();
      res.set('Content-Type', contentType);
      res.send(js);
      return;
    }

    // For non-HTML/CSS/JS resources (images, fonts, etc.), stream directly
    if (!contentType.includes('text/html')) {
      res.set('Content-Type', contentType);
      // Forward useful headers
      const cl = response.headers.get('content-length');
      if (cl) res.set('Content-Length', cl);
      response.body.pipe(res);
      return;
    }

    // It's HTML — rewrite it
    const html = await response.text();
    const $ = cheerio.load(html);
    const base = response.url;

    // Standard attributes
    $('a[href]').each((_, el) => $(el).attr('href', rewriteUrl($(el).attr('href'), base)));
    $('link[href]').each((_, el) => $(el).attr('href', rewriteUrl($(el).attr('href'), base)));
    $('script[src]').each((_, el) => $(el).attr('src', rewriteUrl($(el).attr('src'), base)));
    $('form[action]').each((_, el) => $(el).attr('action', rewriteUrl($(el).attr('action'), base)));

    // All image-like elements: src, srcset, data-src, data-srcset (lazy loading)
    $('img, source, video, picture').each((_, el) => {
      const $el = $(el);
      if ($el.attr('src'))         $el.attr('src',         rewriteUrl($el.attr('src'), base));
      if ($el.attr('srcset'))      $el.attr('srcset',      rewriteSrcset($el.attr('srcset'), base));
      if ($el.attr('data-src'))    $el.attr('data-src',    rewriteUrl($el.attr('data-src'), base));
      if ($el.attr('data-srcset')) $el.attr('data-srcset', rewriteSrcset($el.attr('data-srcset'), base));
      if ($el.attr('poster'))      $el.attr('poster',      rewriteUrl($el.attr('poster'), base));
    });

    // Rewrite inline style attributes with url()
    $('[style]').each((_, el) => {
      const $el = $(el);
      const style = $el.attr('style');
      if (style && style.includes('url(')) {
        $el.attr('style', rewriteCss(style, base));
      }
    });

    // Rewrite <style> blocks
    $('style').each((_, el) => {
      const $el = $(el);
      $el.html(rewriteCss($el.html(), base));
    });

    // Remove blocking meta tags
    $('meta[http-equiv="Content-Security-Policy"]').remove();
    $('meta[http-equiv="X-Frame-Options"]').remove();
    $('base[href]').remove(); // remove <base> tag so our relative URLs work

    // Inject Rexplorer top bar
    $('body').prepend(`
      <div style="
        position: fixed;
        top: 0; left: 0; right: 0;
        height: 36px;
        background: #111;
        border-bottom: 1px solid #333;
        display: flex;
        align-items: center;
        padding: 0 14px;
        z-index: 2147483647;
        font-family: Verdana, sans-serif;
        font-size: 13px;
        color: white;
        gap: 10px;
      ">
        <img src="/rex.png" style="height:22px; width:22px; object-fit:contain;" />
        <span style="font-weight:bold; letter-spacing:1px;">Rexplorer</span>
        <a href="/" style="margin-left:auto; color:white; font-size:12px; text-decoration:none; background:#333; border:1px solid #555; padding:4px 10px; border-radius:5px;">&#8592; Home</a>
      </div>
      <div style="height:36px;"></div>
    `);

    // Inject runtime interceptor for fetch, XHR, and dynamic image loading
    $('head').prepend(`
      <script>
        (function() {
          const PROXY = '/proxy?url=';
          const origin = location.origin;

          function wrap(url) {
            if (!url || url.startsWith('data:') || url.startsWith(origin)) return url;
            try {
              const abs = new URL(url, location.href).href;
              if (abs.startsWith(origin)) return url;
              return PROXY + encodeURIComponent(abs);
            } catch(e) { return url; }
          }

          // Intercept XHR
          const _open = XMLHttpRequest.prototype.open;
          XMLHttpRequest.prototype.open = function(method, url, ...args) {
            return _open.call(this, method, wrap(url), ...args);
          };

          // Intercept fetch
          const _fetch = window.fetch;
          window.fetch = function(input, init) {
            if (typeof input === 'string') input = wrap(input);
            else if (input instanceof Request) input = new Request(wrap(input.url), input);
            return _fetch.call(this, input, init);
          };

          // Intercept dynamic src assignment on images
          const imgSrcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
          if (imgSrcDesc) {
            Object.defineProperty(HTMLImageElement.prototype, 'src', {
              set(val) { imgSrcDesc.set.call(this, wrap(val)); },
              get() { return imgSrcDesc.get.call(this); }
            });
          }
        })();
      </script>
    `);

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send($.html());

  } catch (err) {
    console.error('Proxy error:', err.message);
    res.status(502).send(`
      <!DOCTYPE html><html>
      <head><title>rexplorer - Error</title>
      <style>
        body { background:#111; color:#fff; font-family:Verdana;
               display:flex; align-items:center; justify-content:center; height:100vh; margin:0; }
        .box { text-align:center; }
        a { color:#aaa; font-size:13px; }
      </style></head>
      <body><div class="box">
        <h2>⚠️ Could not connect</h2>
        <p>${err.message}</p>
        <p><a href="/">← Back to rexplorer</a></p>
      </div></body></html>
    `);
  }
});

app.listen(PORT, () => console.log(`rexplorer running at http://localhost:${PORT}`));
