import { NextRequest, NextResponse } from 'next/server';
import dns from 'dns/promises';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// GET /api/pdns/lookup?domain=example.com
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const domain = searchParams.get('domain')?.replace(/\.$/, '');

  if (!domain) {
    return NextResponse.json({ error: 'domain parameter required' }, { status: 400 });
  }

  const result: {
    ns: string[];
    expiration: string | null;
    registrar: string | null;
  } = {
    ns: [],
    expiration: null,
    registrar: null,
  };

  // NS lookup
  try {
    const nsRecords = await dns.resolveNs(domain);
    result.ns = nsRecords.sort();
  } catch {
    // Domain might not have public NS records
  }

  // WHOIS lookup for expiration
  try {
    // Extract the registrable domain (last 2 parts for most TLDs)
    const parts = domain.split('.');
    const registrable = parts.length >= 2 ? parts.slice(-2).join('.') : domain;

    const { stdout } = await execAsync(`whois ${registrable} 2>/dev/null`, {
      timeout: 10000,
    });

    // Parse expiration date — try common WHOIS field names
    const expiryPatterns = [
      /Registry Expiry Date:\s*(.+)/i,
      /Expir(?:y|ation) Date:\s*(.+)/i,
      /Expir(?:y|ation):\s*(.+)/i,
      /paid-till:\s*(.+)/i,
      /Renewal Date:\s*(.+)/i,
      /expire:\s*(.+)/i,
    ];

    for (const pattern of expiryPatterns) {
      const match = stdout.match(pattern);
      if (match) {
        const dateStr = match[1].trim();
        const parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime())) {
          result.expiration = parsed.toISOString();
          break;
        }
      }
    }

    // Parse registrar
    const registrarMatch = stdout.match(/Registrar:\s*(.+)/i);
    if (registrarMatch) {
      result.registrar = registrarMatch[1].trim();
    }
  } catch {
    // whois command might not be available or domain not found
  }

  return NextResponse.json(result);
}
