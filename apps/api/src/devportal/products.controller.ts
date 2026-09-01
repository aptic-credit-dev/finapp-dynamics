import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Endpoint } from '@finapp/kernel';
import { ProductService, M35_PERMISSIONS, M35_AUDIT_CODES } from '@finapp/m35-devportal';
import { ActorContextFactory } from '@finapp/m02-identity';
import { requireString, requireTenantScope, requireVersion } from '../identity/http.ts';
import { productView, scopeView, productDetailView } from './views.ts';

/**
 * API PRODUCTS under `/api/v1/developer` — the governed gateway facade. Authoring + declaring exposed operations (each
 * carrying the m02 permission it requires) are unprivileged; product PUBLICATION (a controlled maker-checker action; a
 * PUBLIC product needs the control-plane permission and the source must be published upstream in m33/m34) is privileged and
 * audited. Reads carry no `@Endpoint` — the read permission is enforced in-service.
 */
function optStr<K extends string>(v: unknown, k: K): Partial<Record<K, string>> {
  return typeof v === 'string' ? ({ [k]: v } as Record<K, string>) : {};
}

@Controller('developer')
export class DevportalProductsController {
  private readonly products: ProductService;
  private readonly actors: ActorContextFactory;
  constructor(products: ProductService, actors: ActorContextFactory) {
    this.products = products;
    this.actors = actors;
  }
  private scoped(h: Record<string, string>, r: string) {
    return this.actors.forRequest(h, r).then(requireTenantScope);
  }

  @Endpoint({
    permission: M35_PERMISSIONS.productAuthor,
    auditCode: M35_AUDIT_CODES.productDefined,
    description: 'Define an API product (over an internal API, an m33 connector or an m34 listing).',
  })
  @Post('products')
  async defineProduct(@Body() b: Record<string, unknown>, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'define API product (m35)');
    const p = await this.products.defineProduct(s.ctx, s.actor.identityId, {
      productKey: requireString(b['productKey'], 'productKey', s.correlationId),
      title: requireString(b['title'], 'title', s.correlationId),
      ...optStr(b['scope'], 'scope'),
      ...optStr(b['category'], 'category'),
      ...optStr(b['visibility'], 'visibility'),
      ...optStr(b['sourceKind'], 'sourceKind'),
      ...optStr(b['sourceRef'], 'sourceRef'),
      ...optStr(h['idempotency-key'], 'idempotencyKey'),
    });
    return productView(p);
  }

  @Get('products')
  async listProducts(@Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'browse API products (m35)');
    const rows = await this.products.listProducts(s.ctx, {});
    return { products: rows.map(productView) };
  }

  @Get('products/:id')
  async getProduct(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'read API product (m35)');
    const p = await this.products.getProductRead(s.ctx, id);
    return { product: p === null ? null : productDetailView(p) };
  }

  /** The allow-listed operations a product exposes + the m02 permission each requires (the facade rule, read-only). */
  @Get('products/:id/scopes')
  async listScopes(@Param('id') id: string, @Headers() h: Record<string, string>) {
    const s = await this.scoped(h, 'browse product scopes (m35)');
    const rows = await this.products.listScopes(s.ctx, id);
    return { scopes: rows.map(scopeView) };
  }

  @Endpoint({
    permission: M35_PERMISSIONS.productAuthor,
    auditCode: M35_AUDIT_CODES.scopeAdded,
    description: 'Declare an allow-listed exposed operation + the m02 permission it requires.',
  })
  @Post('products/:id/scopes')
  async addScope(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'add product scope (m35)');
    const scope = await this.products.addScope(s.ctx, s.actor.identityId, id, {
      operationRef: requireString(b['operationRef'], 'operationRef', s.correlationId),
      requiredPermission: requireString(b['requiredPermission'], 'requiredPermission', s.correlationId),
    });
    return scopeView(scope);
  }

  @Endpoint({
    permission: M35_PERMISSIONS.productAuthor,
    auditCode: M35_AUDIT_CODES.productValidated,
    description: 'Validate an API product (the facade rule: every exposed operation carries a permission).',
  })
  @Post('products/:id/validate')
  async validateProduct(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'validate API product (m35)');
    const out = await this.products.validateProductById(
      s.ctx,
      s.actor.identityId,
      id,
      requireVersion(b['expectedVersion'], s.correlationId),
    );
    return { passed: out.passed, findings: out.findings };
  }

  @Endpoint({
    permission: M35_PERMISSIONS.productAuthor,
    auditCode: M35_AUDIT_CODES.reviewRequested,
    description: 'Send a validated product for review.',
  })
  @Post('products/:id/review')
  async reviewProduct(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'request product review (m35)');
    const p = await this.products.requestReview(
      s.ctx,
      s.actor.identityId,
      id,
      requireVersion(b['expectedVersion'], s.correlationId),
    );
    return productView(p);
  }

  @Endpoint({
    permission: M35_PERMISSIONS.productPublish,
    auditCode: M35_AUDIT_CODES.productPublished,
    description: 'Publish a product (maker-checker; public exposure needs the control-plane permission).',
  })
  @Post('products/:id/publish')
  async publishProduct(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @Headers() h: Record<string, string>,
  ) {
    const s = await this.scoped(h, 'publish API product (m35)');
    const p = await this.products.publishProduct(
      s.ctx,
      s.actor.identityId,
      id,
      requireVersion(b['expectedVersion'], s.correlationId),
    );
    return productView(p);
  }
}
