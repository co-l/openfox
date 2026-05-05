# Reverse Proxy Setup

OpenFox works behind a reverse proxy. The WebSocket connection uses `wss://` (WebSocket over TLS), so the proxy just needs to forward traffic with proper upgrade headers. Unlike plain `ws://`, browsers **do** send the `Authorization` header on `wss://` upgrades, so basic auth works transparently.

The frontend auto-detects the page protocol: `https://` → `wss://`, `http://` → `ws://`.

## Nginx

```nginx
server {
    listen 443 ssl;
    server_name yourdomain.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # Basic auth (optional)
    auth_basic           "OpenFox";
    auth_basic_user_file /path/to/.htpasswd;

    location / {
        proxy_pass         http://127.0.0.1:10369;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade      $http_upgrade;
        proxy_set_header   Connection   "upgrade";
        proxy_set_header   Host         $host;
        proxy_set_header   X-Real-IP    $remote_addr;
        proxy_set_header   X-Forwarded-For  $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
```

## HAProxy

```
backend openfox
    bind *:443 ssl crt /path/to/cert.pem
    http-auth realm OpenFox
    http-auth userfile /path/to/haproxy.htpasswd

    server openfox 127.0.0.1:10369
    http-request set-header X-Forwarded-Proto https
    http-request set-header X-Forwarded-For %[src]
    http-request set-header Host %[req.hdr(Host)]
    timeout client 30d
    timeout server 30d
```

## Traefik

```yaml
http:
  routers:
    openfox:
      rule: 'Host(`yourdomain.com`)'
      service: openfox
      tls: {}
      middlewares:
        - basicAuth:
            users:
              - 'user:$hash'

  services:
    openfox:
      loadBalancer:
        servers:
          - url: 'http://127.0.0.1:10369'
        passHostHeader: true
```

## Key Points

- **Use `npm start` (not `npm run dev`) behind a proxy** — `npm run dev` uses Vite which enforces `localhost` by default
- **Set `server.host: "127.0.0.1"`** in your OpenFox config so the backend only listens locally
- The WebSocket endpoint is `/ws` — the frontend always connects to the same origin as the page (e.g. `wss://yourdomain.com/ws`)
- For local dev without a proxy, `ws://localhost:10469` is still the default

## Local Dev Behind a Proxy

If you need to run `npm run dev` while accessing via a domain (instead of `localhost`), create a local vite config:

```bash
cp web/vite.config.local.ts.example web/vite.config.local.ts
```

Edit `vite.config.local.ts` and add your domain to `allowedHosts`:

```ts
export default {
  server: {
    allowedHosts: ['yourdomain.com'],
  },
}
```

This file is gitignored — it won't be committed.
