<p align="center">
  <img src="public/powerdns-logo.png" alt="PowerDNS-UI Logo" width="120">
</p>

<h1 align="center">PowerDNS-UI</h1>

<p align="center">
  <strong>Modern web interface for PowerDNS management</strong>
</p>

---

## Overview

**PowerDNS-UI** is a modern, self-hosted web interface for managing PowerDNS Authoritative servers. Built as a lightweight alternative to PowerDNS-Admin, it provides zone and record management, bulk operations, LDAP/local authentication.

<p align="center">
  <img src="docs/screenshots/dashboard.png" alt="Dashboard" width="100%">
</p>

---

## Quick Start

```bash
docker run -d --name powerdns-ui -p 3000:3000 --restart unless-stopped ghcr.io/adminsyspro/powerdns-ui:latest
```

Then open `http://your-server:3000` — default credentials: **admin** / **admin**

---

## Features

| Feature | Description |
|---|---|
| **Zone Management** | Create, edit, delete, and export DNS zones (Native, Master, Slave) |
| **Record Editing** | Full CRUD for all record types (A, AAAA, CNAME, MX, TXT, SRV, CAA, etc.) |
| **Multi-Selection** | Bulk delete, enable, and disable records and zones |
| **Pending Changes** | Review and validate changes before applying them to the server |
| **Change History** | Track all modifications with diff view and timeline |
| **Global Search** | Search across zones, records, and IPs |
| **Zone Switcher** | Quickly navigate between zones with instant search |
| **Record Export** | Export records as text, CSV, or PDF |
| **LDAP Authentication** | Integrate with Active Directory / LDAP |
| **Local Authentication** | Built-in user management with bcrypt passwords |
| **Multi-Server** | Connect to multiple PowerDNS instances |
| **API Proxy** | Built-in PowerDNS API proxy with granular access control (drop-in replacement for [powerdns-api-proxy](https://github.com/akquinet/powerdns-api-proxy)) |
| **DNSSEC Status** | View DNSSEC status per zone |
| **Real-Time Sync** | Background sync with local SQLite cache for fast pagination |
| **Dark Mode** | Full dark/light theme support |
| **Responsive** | Works on desktop, tablet, and mobile |

---

## API Proxy

### How it works

External clients authenticate with an API token via the `X-API-Key` header. Each token (called an **API Access**) defines which zones can be accessed and which records can be modified.

```
Client (certbot) → Nginx → PowerDNS-UI Proxy → PowerDNS API
                            ↕
                    Token validation
                    Zone filtering
                    Record-level ACL
```

### API Access features

- **Token-based authentication** — SHA-512 hashed tokens, generated and displayed once
- **Per-zone permissions** — restrict which zones a token can read/write
- **Record-level rules** — allow specific records (exact match) or patterns (regex)
- **ACME support** — auto-allow `_acme-challenge.*` TXT records for Let's Encrypt
- **Request logging** — real-time logs with method, status, zone, IP, duration, and errors
- **Config import** — import existing `config.yml` from powerdns-api-proxy

### Compatible endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/servers/{id}/zones` | List zones (filtered by permissions) |
| GET | `/api/v1/servers/{id}/zones/{zone}` | Get zone details (records filtered) |
| PATCH | `/api/v1/servers/{id}/zones/{zone}` | Update records (validated against ACL) |
| PUT | `/api/v1/servers/{id}/zones/{zone}/notify` | Notify zone |
| GET | `/health/pdns` | Health check (no auth) |
| GET | `/info/allowed` | List permissions for the calling token |

### Migration from powerdns-api-proxy

1. In the UI, go to **API Proxy** and click **Import** to paste your existing `config.yml`
2. Existing `token_sha512` values are preserved — client tokens remain valid
3. Update your Nginx config to point to PowerDNS-UI (see below)

### Nginx configuration (recommended)

For security, expose only the proxy endpoints on the public-facing domain. The UI should be accessed through a separate vhost.

**Proxy vhost** (e.g., `ssl.example.com` — used by certbot and external clients):

```nginx
server {
    listen 443 ssl;
    server_name ssl.example.com;

    ssl_certificate     /etc/letsencrypt/live/ssl.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ssl.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location /api/v1/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /health/pdns {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
    }

    location /info/allowed {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location / {
        return 404;
    }
}
```

**UI vhost** (e.g., `dns-admin.example.com` — used by administrators):

```nginx
server {
    listen 443 ssl;
    server_name dns-admin.example.com;

    ssl_certificate     /etc/ssl/certs/dns-admin.pem;
    ssl_certificate_key /etc/ssl/private/dns-admin.key;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `production` | Node environment |
| `PORT` | `3000` | HTTP port |
| `HOSTNAME` | `0.0.0.0` | Listen address |

Server connections and LDAP settings are configured through the web UI at **Settings**.

### Reverse Proxy (Nginx)

```nginx
server {
    listen 443 ssl;
    server_name dns.example.com;

    ssl_certificate     /etc/ssl/certs/dns.pem;
    ssl_certificate_key /etc/ssl/private/dns.key;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## Requirements

- Docker & Docker Compose
- PowerDNS Authoritative 4.x with API enabled
- Network access to PowerDNS API (default port 8081)

---

## License

MIT — Free for personal and commercial use.

## Support

- [GitHub Issues](https://github.com/adminsyspro/powerdns-ui/issues)
