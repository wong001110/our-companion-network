import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { MetaController } from '../src/meta/meta.controller';
import { ProtocolConfigService } from '../src/common/protocol-config.service';

@Module({
  imports: [ConfigModule.forRoot({ ignoreEnvFile: true, load: [() => ({ PROTOCOL_VERSION: '0.1', MINIMUM_CLIENT_VERSION: '0.1.0', SERVER_VERSION: '0.1.0' })] })],
  controllers: [MetaController],
  providers: [ProtocolConfigService],
})
class MetaE2eModule {}

describe('Meta HTTP contract (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [MetaE2eModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterAll(async () => { await app.close(); });

  it('serves health and rejects an old client through the compatibility endpoint', async () => {
    const health = await fetch(`${baseUrl}/api/meta/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok', protocolVersion: '0.1' });

    const compatibility = await fetch(`${baseUrl}/api/meta/client-compatibility`, { headers: {
      'x-our-companion-client-version': '0.0.9',
      'x-our-companion-protocol-version': '0.1',
    } });
    expect(compatibility.status).toBe(200);
    expect(await compatibility.json()).toMatchObject({ compatible: false, reason: 'CLIENT_VERSION_TOO_OLD' });
  });
});
