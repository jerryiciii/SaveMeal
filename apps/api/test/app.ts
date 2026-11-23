import type { INestApplication, ModuleMetadata } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

/**
 * Boots the real AppModule (real config, real Prisma against the test database) with the same
 * global setup as main.ts. `extra` adds test-only modules/controllers; `override` swaps providers.
 */
export async function createTestApp(
  extra: Pick<ModuleMetadata, 'controllers' | 'providers'> = {},
  override?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
): Promise<INestApplication> {
  let builder = Test.createTestingModule({
    imports: [AppModule],
    controllers: extra.controllers ?? [],
    providers: extra.providers ?? [],
  });
  if (override) builder = override(builder);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ bodyParser: false, logger: ['error'] });
  configureApp(app);
  await app.init();
  return app;
}
