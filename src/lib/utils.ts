import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Generate a UUID that works in non-secure contexts (HTTP). */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTTL(seconds: number): string {
  if (seconds < 3600) return `${seconds}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (m === 0) return `${h}h`;
  return `${h}h${m}m`;
}

export function formatDate(date: Date | string | number): string {
  const d = new Date(date);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(date: Date | string | number): string {
  const d = new Date(date);
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelativeTime(date: Date | string | number): string {
  const d = new Date(date);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'Just now';
}

export function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-US').format(num);
}

export function formatSerial(serial: number): string {
  const str = serial.toString();
  if (str.length === 10) {
    // YYYYMMDDnn format
    return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)} #${str.slice(8)}`;
  }
  return str;
}

export function generateSerial(): number {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return parseInt(`${year}${month}${day}01`);
}

export function validateDomainName(domain: string): boolean {
  const domainRegex = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}\.?$/;
  return domainRegex.test(domain);
}

export function validateIPv4(ip: string): boolean {
  const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  return ipv4Regex.test(ip);
}

export function validateIPv6(ip: string): boolean {
  const ipv6Regex = /^(?:[A-Fa-f0-9]{1,4}:){7}[A-Fa-f0-9]{1,4}$|^::(?:[A-Fa-f0-9]{1,4}:){0,6}[A-Fa-f0-9]{1,4}$|^(?:[A-Fa-f0-9]{1,4}:){1,6}::(?:[A-Fa-f0-9]{1,4}:)?[A-Fa-f0-9]{1,4}$/;
  return ipv6Regex.test(ip);
}

export function ensureTrailingDot(name: string): string {
  return name.endsWith('.') ? name : `${name}.`;
}

export function removeTrailingDot(name: string): string {
  return name.endsWith('.') ? name.slice(0, -1) : name;
}

export function getRecordTypeColor(type: string): string {
  const colors: Record<string, string> = {
    A: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
    AAAA: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
    CNAME: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300',
    MX: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    TXT: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    NS: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300',
    SOA: 'bg-slate-100 text-slate-800 dark:bg-slate-900/40 dark:text-slate-300',
    SRV: 'bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-300',
    PTR: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
    CAA: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
    DS: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300',
    DNSKEY: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300',
  };
  return colors[type] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';
}

export function getRecordTypeRowColor(type: string): string {
  const colors: Record<string, string> = {
    A: 'bg-blue-200 text-blue-900 dark:bg-blue-900/60 dark:text-blue-100',
    AAAA: 'bg-indigo-200 text-indigo-900 dark:bg-indigo-900/60 dark:text-indigo-100',
    CNAME: 'bg-violet-200 text-violet-900 dark:bg-violet-900/60 dark:text-violet-100',
    MX: 'bg-amber-200 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100',
    TXT: 'bg-emerald-200 text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-100',
    NS: 'bg-cyan-200 text-cyan-900 dark:bg-cyan-900/60 dark:text-cyan-100',
    SOA: 'bg-slate-300 text-slate-900 dark:bg-slate-700/60 dark:text-slate-100',
    SRV: 'bg-pink-200 text-pink-900 dark:bg-pink-900/60 dark:text-pink-100',
    PTR: 'bg-orange-200 text-orange-900 dark:bg-orange-900/60 dark:text-orange-100',
    CAA: 'bg-rose-200 text-rose-900 dark:bg-rose-900/60 dark:text-rose-100',
    DS: 'bg-teal-200 text-teal-900 dark:bg-teal-900/60 dark:text-teal-100',
    DNSKEY: 'bg-teal-200 text-teal-900 dark:bg-teal-900/60 dark:text-teal-100',
  };
  return colors[type] || '';
}

export function getZoneKindColor(kind: string): string {
  const colors: Record<string, string> = {
    Native: 'zone-native',
    Master: 'zone-master',
    Slave: 'zone-slave',
    Producer: 'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200',
    Consumer: 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900 dark:text-fuchsia-200',
  };
  return colors[kind] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';
}

export function parseSOA(content: string): {
  mname: string;
  rname: string;
  serial: number;
  refresh: number;
  retry: number;
  expire: number;
  minimum: number;
} | null {
  const parts = content.split(/\s+/);
  if (parts.length >= 7) {
    return {
      mname: parts[0],
      rname: parts[1],
      serial: parseInt(parts[2]),
      refresh: parseInt(parts[3]),
      retry: parseInt(parts[4]),
      expire: parseInt(parts[5]),
      minimum: parseInt(parts[6]),
    };
  }
  return null;
}

export function buildSOA(params: {
  mname: string;
  rname: string;
  serial: number;
  refresh: number;
  retry: number;
  expire: number;
  minimum: number;
}): string {
  return `${params.mname} ${params.rname} ${params.serial} ${params.refresh} ${params.retry} ${params.expire} ${params.minimum}`;
}

export function parseMX(content: string): { priority: number; server: string } | null {
  const parts = content.split(/\s+/);
  if (parts.length >= 2) {
    return {
      priority: parseInt(parts[0]),
      server: parts[1],
    };
  }
  return null;
}

export function parseSRV(content: string): {
  priority: number;
  weight: number;
  port: number;
  target: string;
} | null {
  const parts = content.split(/\s+/);
  if (parts.length >= 4) {
    return {
      priority: parseInt(parts[0]),
      weight: parseInt(parts[1]),
      port: parseInt(parts[2]),
      target: parts[3],
    };
  }
  return null;
}

export function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}

export function downloadAsFile(content: string, filename: string, mimeType = 'text/plain'): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportZoneFile(zoneName: string, records: Array<{ name: string; ttl: number; type: string; content: string }>): string {
  const lines: string[] = [
    `; Zone file for ${zoneName}`,
    `; Exported from PowerDNS-UI`,
    `; Date: ${new Date().toISOString()}`,
    '',
    `$ORIGIN ${ensureTrailingDot(zoneName)}`,
    `$TTL 3600`,
    '',
  ];
  
  for (const record of records) {
    const name = record.name === zoneName || record.name === ensureTrailingDot(zoneName)
      ? '@'
      : record.name.replace(zoneName, '').replace(/\.$/, '') || '@';
    lines.push(`${name}\t${record.ttl}\tIN\t${record.type}\t${record.content}`);
  }
  
  return lines.join('\n');
}

export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

export function throttle<T extends (...args: unknown[]) => unknown>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;
  
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}
