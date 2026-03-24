# PowerDNS Center

A modern, feature-rich web interface for managing PowerDNS servers. Built as a replacement for the unmaintained [PowerDNS-Admin](https://github.com/PowerDNS-Admin/PowerDNS-Admin).

![Dashboard Preview](./docs/screenshots/dashboard.png)

## Features

### DNS Management
- **Zone Management**: Create, edit, delete, and export DNS zones
- **Record Management**: Full CRUD operations for all DNS record types (A, AAAA, CNAME, MX, TXT, NS, SRV, PTR, CAA, etc.)
- **Zone Templates**: Create reusable templates for quick zone setup
- **Bulk Operations**: Import/export zones in various formats
- **Search**: Global search across all zones and records

### DNSSEC Support
- Enable/disable DNSSEC per zone
- Key management (view, create, delete)
- DS record generation for parent zone registration

### Server Management
- Multiple PowerDNS server connections
- Server statistics and monitoring
- Configuration viewer
- Cache management

### Authentication & Authorization
- Local user authentication
- LDAP/Active Directory integration (planned)
- OAuth support: Google, GitHub, Azure (planned)
- SAML support (planned)
- Role-based access control (RBAC)
- Two-factor authentication (TOTP)

### User Experience
- Modern, responsive UI built with shadcn/ui
- Dark/light theme support
- Collapsible sidebar
- Customizable display preferences
- Activity logging

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS v3
- **UI Components**: shadcn/ui (Radix UI primitives)
- **State Management**: Zustand
- **Forms**: React Hook Form + Zod validation
- **Tables**: TanStack Table
- **Charts**: Recharts

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn or pnpm
- A PowerDNS Authoritative Server with API enabled

### PowerDNS Configuration

Ensure your PowerDNS server has the API enabled in `pdns.conf`:

```ini
api=yes
api-key=your-secret-api-key
webserver=yes
webserver-address=0.0.0.0
webserver-port=8081
webserver-allow-from=0.0.0.0/0
```

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/powerdns-center.git
   cd powerdns-center
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment** (optional)
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your settings
   ```

4. **Run development server**
   ```bash
   npm run dev
   ```

5. **Open in browser**
   Navigate to [http://localhost:3000](http://localhost:3000)

### Production Build

```bash
npm run build
npm start
```

### Docker Deployment

```bash
docker build -t powerdns-center .
docker run -p 3000:3000 powerdns-center
```

Or use Docker Compose:

```yaml
version: '3.8'
services:
  powerdns-center:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_APP_URL` | Application URL | `http://localhost:3000` |
| `PDNS_API_URL` | PowerDNS API URL | - |
| `PDNS_API_KEY` | PowerDNS API Key | - |

### Server Connections

Server connections are stored in the browser's local storage. You can configure multiple PowerDNS servers through the UI:

1. Navigate to **Servers** in the sidebar
2. Click **Add Server**
3. Enter connection details (name, URL, API key)
4. Test the connection
5. Save

## Project Structure

```
powerdns-center/
├── src/
│   ├── app/                    # Next.js App Router pages
│   │   ├── (auth)/            # Authentication pages
│   │   ├── (dashboard)/       # Main application pages
│   │   └── layout.tsx         # Root layout
│   ├── components/
│   │   ├── ui/                # shadcn/ui components
│   │   ├── layout/            # Layout components
│   │   ├── zones/             # Zone-related components
│   │   ├── records/           # Record-related components
│   │   └── dashboard/         # Dashboard components
│   ├── hooks/                 # Custom React hooks
│   ├── lib/                   # Utilities and API client
│   ├── stores/                # Zustand stores
│   └── types/                 # TypeScript type definitions
├── public/                    # Static assets
└── docs/                      # Documentation
```

## API Reference

PowerDNS Center uses the [PowerDNS Authoritative Server HTTP API](https://doc.powerdns.com/authoritative/http-api/index.html).

### Supported Endpoints

- `GET /api/v1/servers` - List servers
- `GET /api/v1/servers/{server_id}/zones` - List zones
- `POST /api/v1/servers/{server_id}/zones` - Create zone
- `GET /api/v1/servers/{server_id}/zones/{zone_id}` - Get zone details
- `PATCH /api/v1/servers/{server_id}/zones/{zone_id}` - Update records
- `DELETE /api/v1/servers/{server_id}/zones/{zone_id}` - Delete zone
- `PUT /api/v1/servers/{server_id}/zones/{zone_id}/notify` - Send NOTIFY
- `GET /api/v1/servers/{server_id}/zones/{zone_id}/cryptokeys` - List DNSSEC keys
- `GET /api/v1/servers/{server_id}/search-data` - Search

## Roadmap

- [ ] LDAP/AD authentication
- [ ] OAuth providers (Google, GitHub, Azure, OpenID)
- [ ] SAML support
- [ ] API key management
- [ ] Advanced RBAC with zone-level permissions
- [ ] DynDNS 2 protocol support
- [ ] Zone transfer logs
- [ ] Audit logging with export
- [ ] Email notifications
- [ ] Prometheus metrics export
- [ ] Multi-language support (i18n)

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [PowerDNS](https://www.powerdns.com/) for the excellent DNS server
- [PowerDNS-Admin](https://github.com/PowerDNS-Admin/PowerDNS-Admin) for inspiration
- [shadcn/ui](https://ui.shadcn.com/) for beautiful UI components
- [Next.js Admin Template](https://github.com/arhamkhnz/next-shadcn-admin-dashboard) for the dashboard foundation

## Support

- 📖 [Documentation](./docs/)
- 🐛 [Issue Tracker](https://github.com/yourusername/powerdns-center/issues)
- 💬 [Discussions](https://github.com/yourusername/powerdns-center/discussions)

---

Made with ❤️ for the DNS community
