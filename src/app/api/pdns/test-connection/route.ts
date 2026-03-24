import { NextRequest, NextResponse } from 'next/server';

// POST /api/pdns/test-connection - Test a PowerDNS server connection
export async function POST(request: NextRequest) {
  try {
    const { url, apiKey } = await request.json();

    if (!url || !apiKey) {
      return NextResponse.json(
        { error: 'URL and API key are required' },
        { status: 400 }
      );
    }

    const baseUrl = url.replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/api/v1/servers/localhost`, {
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        { success: false, message: `Server returned ${response.status}: ${text}` },
        { status: 200 }
      );
    }

    const data = await response.json();
    return NextResponse.json({
      success: true,
      message: `Connection successful! PowerDNS ${data.daemon_type} v${data.version}`,
      server: {
        type: data.daemon_type,
        version: data.version,
        id: data.id,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, message: `Failed to connect: ${message}` },
      { status: 200 }
    );
  }
}
