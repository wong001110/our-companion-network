import { PassThrough, Readable } from 'node:stream';
import { PortalController } from './portal.controller';

describe('PortalController data export', () => {
  it('streams a private JSON attachment through the HTTP response', async () => {
    const dataExport = jest.fn().mockResolvedValue(Readable.from([
      '{"schemaVersion":2,"complete":true}',
    ]));
    const controller = new PortalController(
      { dataExport } as never,
      {} as never,
    );
    const response = new PassThrough() as PassThrough & {
      status: jest.Mock;
      setHeader: jest.Mock;
    };
    response.status = jest.fn().mockReturnValue(response);
    response.setHeader = jest.fn().mockReturnValue(response);
    const chunks: Buffer[] = [];
    response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));

    await controller.dataExport({
      id: 'user-1',
      email: 'user@example.com',
      username: 'user',
      deviceId: 'device-1',
    }, response as never);

    expect(dataExport).toHaveBeenCalledWith('user-1');
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/json; charset=utf-8',
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringMatching(/^attachment; filename="our-companion-network-export-\d{4}-\d{2}-\d{2}\.json"$/),
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store',
    );
    expect(Buffer.concat(chunks).toString('utf8'))
      .toBe('{"schemaVersion":2,"complete":true}');
  });
});
