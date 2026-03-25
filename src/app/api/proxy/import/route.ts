import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/cache/db';
import yaml from 'js-yaml';

interface ProxyConfigZone {
  name: string;
  description?: string;
  records?: string[];
  regex_records?: string[];
  services?: { acme?: boolean };
}

interface ProxyConfigEnvironment {
  name: string;
  token_sha512: string;
  zones?: ProxyConfigZone[];
}

interface ProxyConfig {
  environments?: ProxyConfigEnvironment[];
}

// POST /api/proxy/import
export async function POST(request: NextRequest) {
  const role = request.headers.get('x-user-role');
  if (role !== 'Administrator') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const { configYaml } = body;

  if (!configYaml) {
    return NextResponse.json({ error: 'configYaml is required' }, { status: 400 });
  }

  const db = getDb();

  let config: ProxyConfig;
  try {
    config = yaml.load(configYaml) as ProxyConfig;
  } catch (e) {
    return NextResponse.json({ error: `Invalid YAML: ${(e as Error).message}` }, { status: 400 });
  }

  if (!config?.environments || !Array.isArray(config.environments)) {
    return NextResponse.json({ error: 'No environments found in config' }, { status: 400 });
  }

  const insertEnv = db.prepare(
    `INSERT INTO proxy_environments (id, name, description, token_sha512)
     VALUES (?, ?, ?, ?)`
  );
  const insertZone = db.prepare(
    `INSERT INTO proxy_zone_permissions (id, environment_id, zone_name, acme_enabled)
     VALUES (?, ?, ?, ?)`
  );
  const insertRule = db.prepare(
    `INSERT INTO proxy_record_rules (id, zone_perm_id, rule_type, pattern)
     VALUES (?, ?, ?, ?)`
  );

  const summary = {
    environments: 0,
    zones: 0,
    recordRules: 0,
    skipped: [] as string[],
  };

  const transaction = db.transaction(() => {
    for (const env of config.environments!) {
      if (!env.name || !env.token_sha512) {
        summary.skipped.push(`Environment missing name or token_sha512`);
        continue;
      }

      // Skip if already exists
      const existing = db.prepare('SELECT id FROM proxy_environments WHERE name = ?').get(env.name);
      if (existing) {
        summary.skipped.push(`Environment "${env.name}" already exists`);
        continue;
      }

      const envId = crypto.randomUUID();
      insertEnv.run(envId, env.name, '', env.token_sha512);
      summary.environments++;

      if (env.zones && Array.isArray(env.zones)) {
        for (const zone of env.zones) {
          if (!zone.name) continue;

          const zonePermId = crypto.randomUUID();
          const acmeEnabled = zone.services?.acme ? 1 : 0;
          insertZone.run(zonePermId, envId, zone.name, acmeEnabled);
          summary.zones++;

          if (zone.records && Array.isArray(zone.records)) {
            for (const record of zone.records) {
              insertRule.run(crypto.randomUUID(), zonePermId, 'exact', record);
              summary.recordRules++;
            }
          }

          if (zone.regex_records && Array.isArray(zone.regex_records)) {
            for (const pattern of zone.regex_records) {
              insertRule.run(crypto.randomUUID(), zonePermId, 'regex', pattern);
              summary.recordRules++;
            }
          }
        }
      }
    }
  });

  try {
    transaction();
  } catch (e) {
    return NextResponse.json({ error: `Import failed: ${(e as Error).message}` }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    summary,
  });
}
