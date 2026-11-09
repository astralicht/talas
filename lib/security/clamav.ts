import net from 'node:net';
import { getEnv } from '@/lib/env';

export type ClamAvStatus = 'clean' | 'infected' | 'unavailable';

export interface ClamAvResult {
  status: ClamAvStatus;
  signature?: string;
  detail?: string;
}

export type ClamAvScanner = (buffer: Buffer) => Promise<ClamAvResult>;

const CHUNK_SIZE = 64 * 1024;
const MAX_RESPONSE_BYTES = 16 * 1024;

export async function scanBufferWithClamAv(buffer: Buffer): Promise<ClamAvResult> {
  const env = getEnv();
  return new Promise<ClamAvResult>((resolve) => {
    let settled = false;
    let response = '';
    let responseBytes = 0;

    const socket = net.createConnection({
      host: env.CLAMAV_HOST,
      port: env.CLAMAV_PORT,
    });

    const settle = (result: ClamAvResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(30_000, () => settle({ status: 'unavailable', detail: 'scanner timeout' }));
    socket.on('error', (error) =>
      settle({ status: 'unavailable', detail: error.message }),
    );
    socket.on('close', () => {
      if (!settled) settle({ status: 'unavailable', detail: 'scanner closed connection' });
    });
    socket.on('data', (data) => {
      responseBytes += data.byteLength;
      if (responseBytes > MAX_RESPONSE_BYTES) {
        settle({ status: 'unavailable', detail: 'scanner response too large' });
        return;
      }
      response += data.toString('utf8');
      if (response.includes('\0') || response.includes('\n')) {
        parseResponse(response);
      }
    });

    const parseResponse = (value: string) => {
      const text = value.replace(/\0/g, '').trim();
      if (/\bFOUND\b/i.test(text)) {
        const signature = text.split(/\s+/).find((part) => part.endsWith('FOUND'));
        settle({ status: 'infected', signature: signature ?? 'unknown', detail: text });
        return;
      }
      if (/\bOK\b/i.test(text)) {
        settle({ status: 'clean', detail: text });
        return;
      }
      settle({ status: 'unavailable', detail: text || 'unrecognized scanner response' });
    };

    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      for (let offset = 0; offset < buffer.length; offset += CHUNK_SIZE) {
        const chunk = buffer.subarray(offset, offset + CHUNK_SIZE);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(chunk.length, 0);
        socket.write(size);
        socket.write(chunk);
      }
      const end = Buffer.alloc(4);
      end.writeUInt32BE(0, 0);
      socket.write(end);
    });
  });
}

let override: ClamAvScanner | null = null;

export function setClamAvScannerForTests(scanner: ClamAvScanner | null): void {
  override = scanner;
}

export async function scanBuffer(buffer: Buffer): Promise<ClamAvResult> {
  if (override) return override(buffer);
  const fakeVerdict = getEnv().CLAMAV_FAKE;
  if (fakeVerdict === 'clean' || fakeVerdict === 'infected' || fakeVerdict === 'unavailable') {
    return {
      status: fakeVerdict,
      ...(fakeVerdict === 'infected' ? { signature: 'Fake.EICAR.Test' } : {}),
    };
  }
  return scanBufferWithClamAv(buffer);
}

export function isClean(result: ClamAvResult): boolean {
  return result.status === 'clean';
}
