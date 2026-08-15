import { Module } from '@nestjs/common';
import { AUDIT, AUTHZ, DB, OUTBOX } from '@finapp/kernel';
import type { Audit, Authz, Db, Outbox } from '@finapp/kernel';
import type { DomainEvent } from '@finapp/contracts';
import {
  M41Emitter,
  SecurityRepository,
  SecretService,
  DlpService,
  GovernanceService,
  UnavailableSecretProvider,
  type SecretProviderPort,
} from '@finapp/m41-security';
import { ActorModule } from '../actor/actor.module.ts';
import { SecurityController } from './security.controller.ts';
import { GrcController } from './grc.controller.ts';
import { PrivacyController } from './privacy.controller.ts';

/**
 * `/api/v1/security` + `/api/v1/grc` + `/api/v1/privacy` (m41). The governed security / GRC / privacy layer + the real secret/
 * key management BOUNDARY + DLP. THE SECRET BOUNDARY: m30 owns the secretref seam; m41 owns the real backend — but there is no
 * approved KMS/HSM/Vault provider, so the crypto/secret material lives behind a fail-closed `SecretProviderPort` (default
 * `UnavailableSecretProvider` -> every operation unavailable; no material is ever produced/stored/leaked). m41 owns no outbox —
 * it publishes the security.* families through the ONE m06 outbox. It holds no secret value and runs no crypto here. The
 * `SecretService.resolveSecretMetadata` backs m30's SecretResolver and the `DlpService.evaluate` backs m24's DlpPolicyEvaluator
 * (composition-root adapters wire them without changing m30/m24 domain logic).
 */
export const M41_SECRET_PROVIDER = Symbol.for('finapp.m41.secret-provider');

@Module({
  imports: [ActorModule],
  controllers: [SecurityController, GrcController, PrivacyController],
  providers: [
    { provide: SecurityRepository, useFactory: () => new SecurityRepository() },
    {
      provide: M41Emitter,
      inject: [AUDIT, OUTBOX],
      useFactory: (audit: Audit, outbox: Outbox<DomainEvent>) => new M41Emitter(audit, outbox),
    },
    // The real crypto/secret provider (KMS/HSM/Vault) is deferred: fail-closed until a provider is approved.
    { provide: M41_SECRET_PROVIDER, useFactory: () => new UnavailableSecretProvider() },
    {
      provide: SecretService,
      inject: [DB, AUTHZ, M41Emitter, M41_SECRET_PROVIDER, SecurityRepository],
      useFactory: (
        db: Db,
        authz: Authz,
        emitter: M41Emitter,
        provider: SecretProviderPort,
        repo: SecurityRepository,
      ) => new SecretService(db, authz, emitter, provider, repo),
    },
    {
      provide: DlpService,
      inject: [DB, AUTHZ, M41Emitter, SecurityRepository],
      useFactory: (db: Db, authz: Authz, emitter: M41Emitter, repo: SecurityRepository) =>
        new DlpService(db, authz, emitter, repo),
    },
    {
      provide: GovernanceService,
      inject: [DB, AUTHZ, M41Emitter, SecurityRepository],
      useFactory: (db: Db, authz: Authz, emitter: M41Emitter, repo: SecurityRepository) =>
        new GovernanceService(db, authz, emitter, repo),
    },
  ],
  exports: [SecretService, DlpService],
})
export class SecurityModule {}
