/**
 * IT 360 — Contact form Worker
 * --------------------------------------------------------------
 * Receives the contact form POST from the website, validates it,
 * and sends the enquiry as an email via the SMTP2GO API.
 *
 * The SMTP2GO API key NEVER reaches the browser — it lives only
 * in this Worker as an encrypted secret (see README.md).
 *
 * Secrets / vars (configured in wrangler.toml + `wrangler secret`):
 *   SMTP2GO_API_KEY  (secret)  – your SMTP2GO API key
 *   TO_EMAIL         (var)     – where enquiries are delivered
 *   FROM_EMAIL       (var)     – verified SMTP2GO sender address
 *   ALLOWED_ORIGINS  (var)     – comma-separated list of allowed site origins
 */

const MAX = { name: 120, email: 200, service: 120, message: 5000 };

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);

    // ---- CORS preflight ----
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== 'POST') {
      return json({ ok: false, error: 'Method not allowed' }, 405, cors);
    }

    // ---- Origin gate (defense-in-depth) ----
    // CORS headers only stop a *browser* from reading our response; they do not
    // stop a script/curl from POSTing here and triggering an email. So we also
    // reject any request whose Origin isn't on the allowlist before doing any
    // work. Turnstile remains the primary anti-abuse gate below.
    if (!originAllowed(origin, env)) {
      return json({ ok: false, error: 'Forbidden' }, 403, cors);
    }

    // ---- Parse body (accepts JSON or form-encoded) ----
    let data;
    try {
      data = await readBody(request);
    } catch {
      return json({ ok: false, error: 'Invalid request body' }, 400, cors);
    }

    // ---- Honeypot: hidden field that only bots fill in ----
    // Return a fake success so bots can't tell they were caught.
    if (data.company) {
      return json({ ok: true }, 200, cors);
    }

    // ---- Turnstile ("I am not a robot") verification ----
    const turnstileToken = data['cf-turnstile-response'];
    const ip = request.headers.get('CF-Connecting-IP') || '';
    if (!(await verifyTurnstile(turnstileToken, ip, env))) {
      return json({ ok: false, error: 'Robot verification failed. Please try again.' }, 403, cors);
    }

    // ---- Validate ----
    const errors = validate(data);
    if (errors.length) {
      return json({ ok: false, error: errors.join(' ') }, 422, cors);
    }

    const name = clean(data.name, MAX.name);
    const email = clean(data.email, MAX.email);
    const service = clean(data.service, MAX.service);
    const message = clean(data.message, MAX.message);

    // When the enquiry was received, formatted in Sydney local time (AEST/AEDT
    // auto-handled) so the email reads correctly regardless of the mail client's
    // own timezone. The Worker runs on Cloudflare's edge (UTC) — Intl does the
    // conversion.
    const receivedAt = sydneyTime();

    // Flag enquiries that contain a link/URL in any free-text field so staff can
    // spot likely spam/phishing at a glance. We only warn — nothing is blocked.
    const flagged = containsLink(name) || containsLink(service) || containsLink(message);

    // ---- Build + send via SMTP2GO ----
    const payload = {
      sender: env.FROM_EMAIL,
      to: [env.TO_EMAIL],
      // Let the practice hit "Reply" and reach the enquirer directly.
      custom_headers: [{ header: 'Reply-To', value: `${name} <${email}>` }],
      subject: `${flagged ? '[⚠ LINK] ' : ''}Website enquiry: ${service}`,
      text_body: textBody({ name, email, service, message, receivedAt, flagged }),
      html_body: htmlBody({ name, email, service, message, receivedAt, flagged }),
    };

    try {
      const res = await fetch('https://api.smtp2go.com/v3/email/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Smtp2go-Api-Key': env.SMTP2GO_API_KEY,
        },
        body: JSON.stringify(payload),
      });

      const result = await res.json().catch(() => ({}));
      const sent = res.ok && result?.data?.succeeded >= 1;

      if (!sent) {
        // Log status only — never the enquirer's message (privacy).
        console.error('SMTP2GO send failed', res.status, JSON.stringify(result?.data?.error || result?.data || {}));
        return json({ ok: false, error: 'Email could not be sent. Please try again.' }, 502, cors);
      }

      return json({ ok: true }, 200, cors);
    } catch (err) {
      console.error('SMTP2GO request error', err?.message);
      return json({ ok: false, error: 'Email service unavailable. Please try again.' }, 502, cors);
    }
  },
};

// ---------------------------------------------------------------

function allowedOrigins(env) {
  return (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function originAllowed(origin, env) {
  return allowedOrigins(env).includes(origin);
}

function corsHeaders(origin, env) {
  const allowed = allowedOrigins(env);

  const headers = {
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
  if (allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

async function verifyTurnstile(token, ip, env) {
  if (!token || !env.TURNSTILE_SECRET_KEY) return false;
  try {
    const body = new FormData();
    body.append('secret', env.TURNSTILE_SECRET_KEY);
    body.append('response', token);
    if (ip) body.append('remoteip', ip);

    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
    });
    const result = await res.json().catch(() => ({}));
    if (result.success !== true) {
      console.error('Turnstile verify rejected', JSON.stringify(result['error-codes'] || result));
    }
    return result.success === true;
  } catch (err) {
    console.error('Turnstile verify error', err?.message);
    return false;
  }
}

async function readBody(request) {
  const type = request.headers.get('Content-Type') || '';
  if (type.includes('application/json')) {
    return await request.json();
  }
  // form-encoded or multipart fallback
  const form = await request.formData();
  const obj = {};
  for (const [k, v] of form.entries()) obj[k] = typeof v === 'string' ? v : '';
  return obj;
}

function validate(d) {
  const e = [];
  if (!d.name || !String(d.name).trim()) e.push('Name is required.');
  if (!d.email || !isEmail(String(d.email).trim())) e.push('A valid email is required.');
  if (!d.service || !String(d.service).trim()) e.push('Service is required.');
  if (!d.message || !String(d.message).trim()) e.push('Message is required.');
  // Reject absurdly long input before we trim it.
  for (const [k, limit] of Object.entries(MAX)) {
    if (d[k] && String(d[k]).length > limit * 4) e.push('Input too long.');
  }
  return e;
}

function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= MAX.email;
}

function clean(v, max) {
  return String(v).replace(/\s+/g, ' ').trim().slice(0, max);
}

// Best-effort detection of a link/URL in free text, used only to flag enquiries
// (never to block them), so leaning slightly aggressive is fine. Matches:
//   - explicit http:// or https:// URLs
//   - www.<domain> links
//   - bare domains ending in a common TLD (e.g. "cheap-pills.shop")
const LINK_TLDS = 'com|net|org|io|co|au|us|uk|info|biz|xyz|online|site|ru|cn|de|nl|top|link|click|shop|app|dev|vip|live|store|icu';
function containsLink(text) {
  const s = String(text);
  return (
    /\bhttps?:\/\//i.test(s) ||
    /\bwww\.[a-z0-9-]+\.[a-z]{2,}/i.test(s) ||
    new RegExp(`\\b[a-z0-9][a-z0-9-]*\\.(?:${LINK_TLDS})\\b`, 'i').test(s)
  );
}

// Current time in Sydney, e.g. "Fri, 13 Jun 2026, 2:30 pm AEST".
function sydneyTime() {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).format(new Date());
}

function textBody({ name, email, service, message, receivedAt, flagged }) {
  return [
    'New enquiry from the IT 360 website',
    '------------------------------------------------',
    ...(flagged ? ['⚠ This enquiry contains a link — treat with caution (possible spam/phishing).', ''] : []),
    `Received: ${receivedAt}`,
    `Name:     ${name}`,
    `Email:    ${email}`,
    `Service:  ${service}`,
    '',
    'Message:',
    message,
  ].join('\n');
}

function htmlBody({ name, email, service, message, receivedAt, flagged }) {
  const esc = (s) =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const flag = flagged
    ? `<p style="margin:0 0 12px;padding:10px 14px;background:#fdECEA;border:1px solid #E24B4A;border-radius:8px;color:#a12b2a;font-weight:600">&#9888; This enquiry contains a link &mdash; treat with caution (possible spam/phishing).</p>`
    : '';
  return `<div style="font-family:system-ui,Arial,sans-serif;font-size:15px;color:#0b1220;line-height:1.6">
  ${flag}
  <h2 style="color:#2b6bff;margin:0 0 12px">New website enquiry</h2>
  <table style="border-collapse:collapse">
    <tr><td style="padding:4px 12px 4px 0;color:#6b7a6e">Received</td><td>${esc(receivedAt)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7a6e">Name</td><td><strong>${esc(name)}</strong></td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7a6e">Email</td><td><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7a6e">Service</td><td>${esc(service)}</td></tr>
  </table>
  <p style="margin:16px 0 4px;color:#6b7a6e">Message</p>
  <div style="white-space:pre-wrap;padding:12px 16px;background:#eef3ff;border-radius:8px">${esc(message)}</div>
</div>`;
}

function json(obj, status, extra) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}
