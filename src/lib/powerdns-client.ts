import type {
  Zone,
  ZoneListItem,
  Server,
  ServerConfig,
  ServerStatistic,
  RRSet,
  CryptoKey,
  TSIGKey,
  Metadata,
  SearchResult,
  ApiResponse,
  CreateZoneForm,
} from '@/types/powerdns';

export class PowerDNSClient {
  private baseUrl: string;
  private apiKey: string;
  private serverId: string;

  constructor(baseUrl: string, apiKey: string, serverId = 'localhost') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.serverId = serverId;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}/api/v1${endpoint}`;
    
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'X-API-Key': this.apiKey,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage: string;
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error || errorJson.message || errorText;
        } catch {
          errorMessage = errorText;
        }
        return {
          error: errorMessage,
          status: response.status,
        };
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return { status: response.status };
      }

      const data = await response.json();
      return { data, status: response.status };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        status: 0,
      };
    }
  }

  // Server endpoints
  async getServers(): Promise<ApiResponse<Server[]>> {
    return this.request<Server[]>('/servers');
  }

  async getServer(): Promise<ApiResponse<Server>> {
    return this.request<Server>(`/servers/${this.serverId}`);
  }

  async getServerConfig(): Promise<ApiResponse<ServerConfig[]>> {
    return this.request<ServerConfig[]>(`/servers/${this.serverId}/config`);
  }

  async getServerStatistics(): Promise<ApiResponse<ServerStatistic[]>> {
    return this.request<ServerStatistic[]>(`/servers/${this.serverId}/statistics`);
  }

  // Zone endpoints
  async getZones(): Promise<ApiResponse<ZoneListItem[]>> {
    return this.request<ZoneListItem[]>(`/servers/${this.serverId}/zones`);
  }

  async getZone(zoneId: string): Promise<ApiResponse<Zone>> {
    return this.request<Zone>(`/servers/${this.serverId}/zones/${zoneId}`);
  }

  async createZone(zone: CreateZoneForm): Promise<ApiResponse<Zone>> {
    return this.request<Zone>(`/servers/${this.serverId}/zones`, {
      method: 'POST',
      body: JSON.stringify(zone),
    });
  }

  async updateZone(zoneId: string, zone: Partial<Zone>): Promise<ApiResponse<void>> {
    return this.request<void>(`/servers/${this.serverId}/zones/${zoneId}`, {
      method: 'PUT',
      body: JSON.stringify(zone),
    });
  }

  async deleteZone(zoneId: string): Promise<ApiResponse<void>> {
    return this.request<void>(`/servers/${this.serverId}/zones/${zoneId}`, {
      method: 'DELETE',
    });
  }

  async notifyZone(zoneId: string): Promise<ApiResponse<void>> {
    return this.request<void>(`/servers/${this.serverId}/zones/${zoneId}/notify`, {
      method: 'PUT',
    });
  }

  async axfrRetrieve(zoneId: string): Promise<ApiResponse<void>> {
    return this.request<void>(`/servers/${this.serverId}/zones/${zoneId}/axfr-retrieve`, {
      method: 'PUT',
    });
  }

  async rectifyZone(zoneId: string): Promise<ApiResponse<{ result: string }>> {
    return this.request<{ result: string }>(
      `/servers/${this.serverId}/zones/${zoneId}/rectify`,
      { method: 'PUT' }
    );
  }

  async exportZone(zoneId: string): Promise<ApiResponse<string>> {
    return this.request<string>(`/servers/${this.serverId}/zones/${zoneId}/export`);
  }

  // Record endpoints
  async updateRecords(zoneId: string, rrsets: RRSet[]): Promise<ApiResponse<void>> {
    return this.request<void>(`/servers/${this.serverId}/zones/${zoneId}`, {
      method: 'PATCH',
      body: JSON.stringify({ rrsets }),
    });
  }

  // DNSSEC / Cryptokeys
  async getCryptokeys(zoneId: string): Promise<ApiResponse<CryptoKey[]>> {
    return this.request<CryptoKey[]>(
      `/servers/${this.serverId}/zones/${zoneId}/cryptokeys`
    );
  }

  async createCryptokey(
    zoneId: string,
    key: Partial<CryptoKey>
  ): Promise<ApiResponse<CryptoKey>> {
    return this.request<CryptoKey>(
      `/servers/${this.serverId}/zones/${zoneId}/cryptokeys`,
      {
        method: 'POST',
        body: JSON.stringify(key),
      }
    );
  }

  async getCryptokey(zoneId: string, keyId: number): Promise<ApiResponse<CryptoKey>> {
    return this.request<CryptoKey>(
      `/servers/${this.serverId}/zones/${zoneId}/cryptokeys/${keyId}`
    );
  }

  async updateCryptokey(
    zoneId: string,
    keyId: number,
    key: Partial<CryptoKey>
  ): Promise<ApiResponse<void>> {
    return this.request<void>(
      `/servers/${this.serverId}/zones/${zoneId}/cryptokeys/${keyId}`,
      {
        method: 'PUT',
        body: JSON.stringify(key),
      }
    );
  }

  async deleteCryptokey(zoneId: string, keyId: number): Promise<ApiResponse<void>> {
    return this.request<void>(
      `/servers/${this.serverId}/zones/${zoneId}/cryptokeys/${keyId}`,
      { method: 'DELETE' }
    );
  }

  // Metadata
  async getMetadata(zoneId: string): Promise<ApiResponse<Metadata[]>> {
    return this.request<Metadata[]>(
      `/servers/${this.serverId}/zones/${zoneId}/metadata`
    );
  }

  async getMetadataKind(zoneId: string, kind: string): Promise<ApiResponse<Metadata>> {
    return this.request<Metadata>(
      `/servers/${this.serverId}/zones/${zoneId}/metadata/${kind}`
    );
  }

  async setMetadata(
    zoneId: string,
    kind: string,
    metadata: string[]
  ): Promise<ApiResponse<Metadata>> {
    return this.request<Metadata>(
      `/servers/${this.serverId}/zones/${zoneId}/metadata/${kind}`,
      {
        method: 'PUT',
        body: JSON.stringify({ kind, metadata }),
      }
    );
  }

  async deleteMetadata(zoneId: string, kind: string): Promise<ApiResponse<void>> {
    return this.request<void>(
      `/servers/${this.serverId}/zones/${zoneId}/metadata/${kind}`,
      { method: 'DELETE' }
    );
  }

  // TSIG Keys
  async getTSIGKeys(): Promise<ApiResponse<TSIGKey[]>> {
    return this.request<TSIGKey[]>(`/servers/${this.serverId}/tsigkeys`);
  }

  async createTSIGKey(key: Partial<TSIGKey>): Promise<ApiResponse<TSIGKey>> {
    return this.request<TSIGKey>(`/servers/${this.serverId}/tsigkeys`, {
      method: 'POST',
      body: JSON.stringify(key),
    });
  }

  async getTSIGKey(keyId: string): Promise<ApiResponse<TSIGKey>> {
    return this.request<TSIGKey>(`/servers/${this.serverId}/tsigkeys/${keyId}`);
  }

  async updateTSIGKey(keyId: string, key: Partial<TSIGKey>): Promise<ApiResponse<TSIGKey>> {
    return this.request<TSIGKey>(`/servers/${this.serverId}/tsigkeys/${keyId}`, {
      method: 'PUT',
      body: JSON.stringify(key),
    });
  }

  async deleteTSIGKey(keyId: string): Promise<ApiResponse<void>> {
    return this.request<void>(`/servers/${this.serverId}/tsigkeys/${keyId}`, {
      method: 'DELETE',
    });
  }

  // Search
  async search(query: string, max = 100, objectType?: 'all' | 'zone' | 'record' | 'comment'): Promise<ApiResponse<SearchResult[]>> {
    const params = new URLSearchParams({
      q: query,
      max: max.toString(),
    });
    if (objectType && objectType !== 'all') {
      params.set('object_type', objectType);
    }
    return this.request<SearchResult[]>(
      `/servers/${this.serverId}/search-data?${params}`
    );
  }

  // Cache
  async flushCache(domain: string): Promise<ApiResponse<{ count: number; result: string }>> {
    return this.request<{ count: number; result: string }>(
      `/servers/${this.serverId}/cache/flush?domain=${encodeURIComponent(domain)}`,
      { method: 'PUT' }
    );
  }

  // Autoprimaries
  async getAutoprimaries(): Promise<ApiResponse<Array<{ ip: string; nameserver: string; account: string }>>> {
    return this.request(`/servers/${this.serverId}/autoprimaries`);
  }

  async addAutoprimary(ip: string, nameserver: string, account = ''): Promise<ApiResponse<void>> {
    return this.request(`/servers/${this.serverId}/autoprimaries`, {
      method: 'POST',
      body: JSON.stringify({ ip, nameserver, account }),
    });
  }

  async deleteAutoprimary(ip: string, nameserver: string): Promise<ApiResponse<void>> {
    return this.request(`/servers/${this.serverId}/autoprimaries/${ip}/${nameserver}`, {
      method: 'DELETE',
    });
  }
}

// Singleton instance management
let clientInstance: PowerDNSClient | null = null;

export function initializeClient(baseUrl: string, apiKey: string, serverId = 'localhost'): PowerDNSClient {
  clientInstance = new PowerDNSClient(baseUrl, apiKey, serverId);
  return clientInstance;
}

export function getClient(): PowerDNSClient {
  if (!clientInstance) {
    throw new Error('PowerDNS client not initialized. Call initializeClient first.');
  }
  return clientInstance;
}

export function resetClient(): void {
  clientInstance = null;
}
