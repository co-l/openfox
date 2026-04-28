# Reverse Proxy Setup

OpenFox works behind a reverse proxy. The key consideration is that the WebSocket connection must be upgraded properly and **must not be intercepted by the proxy's own authentication**

## How It Works

- **HTTP traffic**: proxied via `https://` → backend serves the frontend
- **WebSocket traffic**: `wss://` (HTTPS → WebSocket) → backend handles the socket
- Backend binds to a single port (default `10369`), so the proxy just forwards all traffic there

---

### Nginx

```nginx
server {
    listen 443 ssl;
    server_name yourdomain.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # Basic auth (optional) — protects HTTP endpoints but NOT websocket
    auth_basic "OpenFox";
    auth_basic_user_file /path/to/.htpasswd;

    # WebSocket — auth_basic off so the connection isn't blocked
    location /ws {
        auth_basic off;

        proxy_pass         http://127.0.0.1:10369;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }

    # Everything else (HTTP/REST/frontend)
    location / {
        proxy_pass         http://127.0.0.1:10369;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
```

---

### HAProxy

```
backend openfox
    bind *:443 ssl crt /path/to/cert.pem
    acl is_ws hdr(Upgrade) -i websocket
    use_backend openfox if is_ws

backend openfox-websocket
    server openfox 127.0.0.1:10369
    http-request set-header X-Forwarded-Proto https
    http-request set-header X-Real-IP %[src]
    http-request set-header X-Forwarded-For %[src]
    http-request set-header Host %[req.hdr(Host)]
    timeout client 30d
    timeout server 30d

backend openfox-http
    http-auth realm OpenFox
    http-auth userfile /path/to/haproxy.htpasswd
    server openfox 127.0.0.1:10369
    http-request set-header X-Forwarded-Proto https
    http-request set-header X-Real-IP %[src]
    http-request set-header X-Forwarded-For %[src]
    http-request set-header Host %[req.hdr(Host)]
```

---

### Traefik

```yaml
http:
  routers:
    openfox-socket:
      rule: "Host(`yourdomain.com`) && Path(`/ws`)"
      service: openfox
      tls: {}
    openfox-http:
      rule: "Host(`yourdomain.com`) && !Path(`/ws`)"
      service: openfox
      tls: {}
      middlewares:
        - basicauth:
            users:
              - "user:$base64_hash"

  services:
    openfox:
      loadBalancer:
        servers:
          - url: "http://127.0.0.1:10369"
        passHostHeader: true
```

## Key Points

- **WebSocket must use `wss://`** — the proxy terminates TLS, then passes a plain socket downstream
- **auth_basic must be disabled for `/ws`** — browsers don't send `Authorization` headers on WebSocket upgrade, so the socket will fail
- The frontend detects `https://` → `wss://` automatically and uses port `443` (or your custom port)
- For local dev, `ws://` + port `10469` is still the default — no proxy needed there
- Set `server.host: "127.0.0.1"` in your OpenFox config if running behind a proxy
