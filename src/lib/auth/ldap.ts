import ldap from 'ldapjs';
import type { UserRole } from '@/types/powerdns';

export interface LDAPConfig {
  url: string;
  baseDN: string;
  bindDN?: string;
  bindPassword?: string;
  userSearchFilter: string;
  adminGroup?: string;
  operatorGroup?: string;
}

export interface LDAPUser {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  groups: string[];
  dn: string;
  avatar?: string; // base64 data URI
}

export class LDAPClient {
  private config: LDAPConfig;

  constructor(config: LDAPConfig) {
    this.config = config;
  }

  /**
   * Authenticate a user against the LDAP directory.
   * 1. Bind with service account (if configured) to search for the user DN
   * 2. Bind as the user with their password to verify credentials
   * 3. Search for the user's groups
   */
  async authenticate(username: string, password: string): Promise<LDAPUser | null> {
    if (!password) return null;

    const client = ldap.createClient({
      url: this.config.url,
      connectTimeout: 5000,
      timeout: 10000,
    });

    try {
      // Step 1: Bind with service account to search for user
      if (this.config.bindDN && this.config.bindPassword) {
        await this.bind(client, this.config.bindDN, this.config.bindPassword);
      }

      // Step 2: Search for the user
      const searchFilter = this.config.userSearchFilter.replace(/\{\{username\}\}/g, username);
      const entries = await this.search(client, this.config.baseDN, searchFilter);

      if (entries.length === 0) {
        return null;
      }

      const entry = entries[0];
      const userDN = entry.dn;

      // Step 3: Bind as the user to verify password
      const userClient = ldap.createClient({
        url: this.config.url,
        connectTimeout: 5000,
        timeout: 10000,
      });

      try {
        await this.bind(userClient, userDN, password);
      } catch {
        return null;
      } finally {
        userClient.unbind(() => {});
      }

      // Step 4: Get user attributes
      const attrs = entry.attributes;
      const ldapUser: LDAPUser = {
        username: this.getAttr(attrs, 'uid') || this.getAttr(attrs, 'sAMAccountName') || username,
        email: this.getAttr(attrs, 'mail') || `${username}@localhost`,
        firstName: this.getAttr(attrs, 'givenName') || '',
        lastName: this.getAttr(attrs, 'sn') || '',
        groups: [],
        dn: userDN,
      };

      // Step 4b: Extract avatar (jpegPhoto or thumbnailPhoto)
      // Use raw buffers — ldapjs .values decodes binary as UTF-8 which corrupts image data
      const photoBuf = this.getAttrBuffer(attrs, 'jpegPhoto') || this.getAttrBuffer(attrs, 'thumbnailPhoto');
      if (photoBuf && photoBuf.length > 0) {
        const b64 = photoBuf.toString('base64');
        ldapUser.avatar = `data:image/jpeg;base64,${b64}`;
      }

      // Step 5: Get groups (memberOf attribute or group search)
      const memberOf = this.getAttrArray(attrs, 'memberOf');
      if (memberOf.length > 0) {
        // Extract CN from DN: "cn=admins,ou=groups,dc=..." -> "admins"
        ldapUser.groups = memberOf.map((dn) => {
          const match = dn.match(/^cn=([^,]+)/i);
          return match ? match[1] : dn;
        });
      }

      return ldapUser;
    } catch (error) {
      console.error('[LDAP] Authentication error:', error);
      return null;
    } finally {
      client.unbind(() => {});
    }
  }

  private bind(client: ldap.Client, dn: string, password: string): Promise<void> {
    return new Promise((resolve, reject) => {
      client.bind(dn, password, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private search(
    client: ldap.Client,
    baseDN: string,
    filter: string
  ): Promise<Array<{ dn: string; attributes: Array<{ type: string; values: string[]; buffers: Buffer[] }> }>> {
    return new Promise((resolve, reject) => {
      const results: Array<{ dn: string; attributes: Array<{ type: string; values: string[]; buffers: Buffer[] }> }> = [];

      client.search(baseDN, { filter, scope: 'sub' }, (err, res) => {
        if (err) return reject(err);

        res.on('searchEntry', (entry) => {
          results.push({
            dn: entry.dn.toString(),
            attributes: (entry.attributes as Array<{ type: string; values: string[]; buffers: Buffer[] }>).map((a) => ({
              type: a.type,
              values: a.values,
              buffers: a.buffers,
            })),
          });
        });
        res.on('error', (err) => reject(err));
        res.on('end', () => resolve(results));
      });
    });
  }

  private getAttr(attrs: Array<{ type: string; values: string[]; buffers: Buffer[] }>, name: string): string {
    const attr = attrs.find((a) => a.type.toLowerCase() === name.toLowerCase());
    return attr?.values?.[0] || '';
  }

  private getAttrBuffer(attrs: Array<{ type: string; values: string[]; buffers: Buffer[] }>, name: string): Buffer | null {
    const attr = attrs.find((a) => a.type.toLowerCase() === name.toLowerCase());
    return attr?.buffers?.[0] || null;
  }

  private getAttrArray(attrs: Array<{ type: string; values: string[]; buffers: Buffer[] }>, name: string): string[] {
    const attr = attrs.find((a) => a.type.toLowerCase() === name.toLowerCase());
    return attr?.values || [];
  }

  getUserRole(groups: string[]): UserRole {
    if (this.config.adminGroup && groups.some((g) => g.toLowerCase() === this.config.adminGroup!.toLowerCase())) {
      return 'Administrator';
    }
    if (this.config.operatorGroup && groups.some((g) => g.toLowerCase() === this.config.operatorGroup!.toLowerCase())) {
      return 'Operator';
    }
    return 'User';
  }
}

/**
 * Create an LDAP client from config stored in the database.
 */
export function createLDAPClientFromConfig(config: LDAPConfig): LDAPClient {
  return new LDAPClient(config);
}
