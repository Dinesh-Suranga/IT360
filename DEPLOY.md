# IT 360 — Deployment

Same pattern as figtree: static site on the VPS (nginx + Cloudflare Origin cert),
contact form handled by a Cloudflare Worker that sends through SMTP2GO.

## 1. SMTP2GO
1. Sending → Verified Senders → Sender Domains → add `itthreesixty.com.au`.
2. Add the CNAME records it gives you in Cloudflare DNS (set to **DNS only**, grey cloud).
3. Settings → API Keys → create a key for this site (send-only permission).
4. Add DMARC: `_dmarc` TXT `v=DMARC1; p=quarantine; rua=mailto:contact@itthreesixty.com.au`

## 2. Turnstile
Cloudflare → Turnstile → Add site → `itthreesixty.com.au` (+ `www`). Managed mode.
- Site key → `data-sitekey` in `index.html` (currently Cloudflare's test key).
- Secret key → Worker secret (below).

## 3. Worker (from `worker/`)
```
npm install
npx wrangler login
npx wrangler secret put SMTP2GO_API_KEY
npx wrangler secret put TURNSTILE_SECRET_KEY
npm run deploy
```
Creates `contact.itthreesixty.com.au` automatically.

## 4. VPS
```
sudo mkdir -p /var/www/itthreesixty && sudo chown $USER: /var/www/itthreesixty
rsync -avz --delete --exclude worker --exclude nginx.conf --exclude DEPLOY.md --exclude .git ./ user@vps:/var/www/itthreesixty/
```
Cloudflare → SSL/TLS → Origin Server → create cert for `itthreesixty.com.au, *.itthreesixty.com.au`:
```
sudo nano /etc/ssl/cloudflare/itthreesixty.pem   # certificate
sudo nano /etc/ssl/cloudflare/itthreesixty.key   # private key
sudo chmod 600 /etc/ssl/cloudflare/itthreesixty.key
sudo cp nginx.conf /etc/nginx/sites-available/itthreesixty.com.au
sudo ln -s /etc/nginx/sites-available/itthreesixty.com.au /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```
DNS (Cloudflare, proxied/orange): `A @` and `A www` → VPS IP. SSL/TLS mode: **Full (strict)**.
