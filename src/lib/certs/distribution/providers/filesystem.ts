import fs from 'node:fs';
import path from 'node:path';
import { materializeCert, removeMaterializedCert, sanitizeCertName } from '../../materialize';
import { getCertsDir } from '../../config';
import type { DistributionProvider, ConnectionConfig, TargetSpec, ResolvedTarget } from '../types';

/**
 * Filesystem provider: the historical `materializeCert` behaviour
 * (`<dir>/live/<name>/{privkey,cert,chain,fullchain}.pem`, optional
 * group-shared mode for NFS export via CERTS_GID/CERTS_UID).
 *
 * Connection config: `{ dir?: string }` — empty means CERTS_DIR (resolved at
 * publish time, so an env change is picked up as a target move).
 * Target: none (always `live/<cert name>`).
 */
function dirOf(config: ConnectionConfig): string {
  const d = typeof config.dir === 'string' ? config.dir.trim() : '';
  return d || getCertsDir();
}

export const filesystemProvider: DistributionProvider = {
  type: 'filesystem',
  label: 'Filesystem / NFS',
  needsSecret: false,

  normalizeConfig(input: unknown): ConnectionConfig {
    const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const dir = typeof o.dir === 'string' ? o.dir.trim() : '';
    if (dir && !path.isAbsolute(dir)) throw new Error('dir must be an absolute path');
    return dir ? { dir } : {};
  },

  normalizeTarget(): TargetSpec {
    return {};
  },

  resolveTarget(_target, cert, config): ResolvedTarget {
    return { dir: dirOf(config), name: sanitizeCertName(cert.name) };
  },

  async publish(_ctx, target, material) {
    materializeCert({
      name: String(target.name),
      leafPem: material.leafPem,
      chainPem: material.chainPem,
      privkeyPem: material.privkeyPem,
      certsDir: String(target.dir),
    });
  },

  async unpublish(_ctx, target) {
    removeMaterializedCert(String(target.name), String(target.dir));
  },

  async test(ctx) {
    // Read-only: never create anything here.
    const dir = dirOf(ctx.config);
    try {
      if (!fs.existsSync(dir)) return { ok: false, error: `${dir} does not exist` };
      fs.accessSync(dir, fs.constants.W_OK);
      return { ok: true, detail: `${dir} (writable)` };
    } catch (e) {
      return { ok: false, error: `${dir}: ${(e as Error).message}` };
    }
  },
};
