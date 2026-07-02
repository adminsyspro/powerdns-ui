'use client';

import { PageTitle } from '@/components/layout';

export default function CertificatesPage() {
  return (
    <div className="space-y-6">
      <PageTitle title="Certificats SSL" />
      <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
        <p className="text-sm">
          La gestion des certificats SSL (ACME DNS-01) arrive ici. Configuration en cours.
        </p>
      </div>
    </div>
  );
}
