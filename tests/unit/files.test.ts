import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Janitor } from '../../src/turntable-renderer/files/janitor.js';
import {
  LocalDiskStore,
  defaultFileStore,
} from '../../src/turntable-renderer/files/local-disk-store.js';
import { app } from '../../src/turntable-renderer/index.js';

const TEST_DATA_DIR = join(import.meta.dir, '../../data_test');

describe('Files API & LocalDiskStore Tests', () => {
  beforeAll(() => {
    mkdirSync(TEST_DATA_DIR, { recursive: true });
  });

  afterAll(() => {
    try {
      rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('POST /v1/files uploads raw octet-stream and returns 201 with metadata', async () => {
    const content = new TextEncoder().encode('Hello 3D Turntable World!');
    const expectedSha256 = createHash('sha256').update(content).digest('hex');

    const res = await app.request('/v1/files?filename=hello.glb', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
      },
      body: content,
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      name: string;
      size: number;
      sha256: string;
      contentType: string;
      kind: string;
      createdAt: string;
      expiresAt: string;
    };

    expect(body.id.startsWith('f_')).toBe(true);
    expect(body.name).toBe('hello.glb');
    expect(body.size).toBe(content.byteLength);
    expect(body.sha256).toBe(expectedSha256);
    expect(body.contentType).toBe('model/gltf-binary');
    expect(body.kind).toBe('input');
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('POST /v1/files validates X-Content-SHA256 and rejects mismatch with 422', async () => {
    const content = new TextEncoder().encode('Checksum test content');
    const wrongSha256 = '0000000000000000000000000000000000000000000000000000000000000000';

    const res = await app.request('/v1/files?filename=mismatch.bin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Content-SHA256': wrongSha256,
      },
      body: content,
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe('checksum_mismatch');
  });

  it('POST /v1/files supports multipart/form-data upload', async () => {
    const formData = new FormData();
    const fileContent = new Blob(['Multipart Model Data'], { type: 'model/gltf-binary' });
    formData.append('file', fileContent, 'car_model.glb');

    const res = await app.request('/v1/files', {
      method: 'POST',
      body: formData,
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; name: string; size: number };
    expect(body.name).toBe('car_model.glb');
    expect(body.size).toBe(20);
  });

  it('GET /v1/files/:id/info returns file metadata', async () => {
    const content = new TextEncoder().encode('Metadata Info Test');
    const uploaded = await defaultFileStore.saveBuffer(content, 'test.obj', 'model/obj');

    const res = await app.request(`/v1/files/${uploaded.id}/info`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { id: string; name: string; size: number };
    expect(body.id).toBe(uploaded.id);
    expect(body.name).toBe('test.obj');
    expect(body.size).toBe(content.byteLength);
  });

  it('GET /v1/files/:id streams complete file with ETag and headers', async () => {
    const content = new TextEncoder().encode('Full Stream Download Test');
    const uploaded = await defaultFileStore.saveBuffer(content, 'download.stl', 'model/stl');

    const res = await app.request(`/v1/files/${uploaded.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).toBe(`"${uploaded.sha256}"`);
    expect(res.headers.get('Content-Type')).toBe('model/stl');
    expect(res.headers.get('Content-Length')).toBe(String(content.byteLength));
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');

    const downloadedBytes = new Uint8Array(await res.arrayBuffer());
    expect(downloadedBytes).toEqual(content);
  });

  it('HEAD /v1/files/:id returns metadata headers without body', async () => {
    const content = new TextEncoder().encode('Head Method Test');
    const uploaded = await defaultFileStore.saveBuffer(
      content,
      'head.dae',
      'model/vnd.collada+xml',
    );

    const res = await app.request(`/v1/files/${uploaded.id}`, { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Length')).toBe(String(content.byteLength));
    expect(res.headers.get('ETag')).toBe(`"${uploaded.sha256}"`);

    const bodyText = await res.text();
    expect(bodyText).toBe('');
  });

  it('GET /v1/files/:id supports Range requests (206 and 416)', async () => {
    const content = new TextEncoder().encode('0123456789ABCDEF'); // 16 bytes
    const uploaded = await defaultFileStore.saveBuffer(
      content,
      'range.bin',
      'application/octet-stream',
    );

    // Valid range: bytes=0-3 (first 4 bytes: '0123')
    const rangeRes = await app.request(`/v1/files/${uploaded.id}`, {
      headers: { Range: 'bytes=0-3' },
    });
    expect(rangeRes.status).toBe(206);
    expect(rangeRes.headers.get('Content-Range')).toBe('bytes 0-3/16');
    expect(rangeRes.headers.get('Content-Length')).toBe('4');
    const rangeText = await rangeRes.text();
    expect(rangeText).toBe('0123');

    // Suffix range: bytes=-4 (last 4 bytes: 'CDEF')
    const suffixRes = await app.request(`/v1/files/${uploaded.id}`, {
      headers: { Range: 'bytes=-4' },
    });
    expect(suffixRes.status).toBe(206);
    expect(suffixRes.headers.get('Content-Range')).toBe('bytes 12-15/16');
    const suffixText = await suffixRes.text();
    expect(suffixText).toBe('CDEF');

    // Invalid range: bytes=100-200 -> 416
    const invalidRes = await app.request(`/v1/files/${uploaded.id}`, {
      headers: { Range: 'bytes=100-200' },
    });
    expect(invalidRes.status).toBe(416);
    expect(invalidRes.headers.get('Content-Range')).toBe('bytes */16');
  });

  it('DELETE /v1/files/:id returns 409 when pinned and 200 when unpinned', async () => {
    const content = new TextEncoder().encode('Pin Test File');
    const uploaded = await defaultFileStore.saveBuffer(
      content,
      'pin_test.glb',
      'model/gltf-binary',
    );

    // Pin file
    await defaultFileStore.pinFile(uploaded.id);

    // Delete should fail with 409
    const deleteResPinned = await app.request(`/v1/files/${uploaded.id}`, { method: 'DELETE' });
    expect(deleteResPinned.status).toBe(409);
    const pinnedBody = (await deleteResPinned.json()) as { code: string };
    expect(pinnedBody.code).toBe('file_in_use');

    // Unpin file
    await defaultFileStore.unpinFile(uploaded.id);

    // Delete should now succeed
    const deleteRes = await app.request(`/v1/files/${uploaded.id}`, { method: 'DELETE' });
    expect(deleteRes.status).toBe(200);

    // Further info request should 404
    const infoRes = await app.request(`/v1/files/${uploaded.id}/info`);
    expect(infoRes.status).toBe(404);
  });

  it('LocalDiskStore enforces upload limit and cleans up partial temp files', async () => {
    const smallStore = new LocalDiskStore({
      dataDir: join(TEST_DATA_DIR, 'small_store'),
      maxUploadMb: 0.001, // ~1KB max upload
    });

    const largeContent = new Uint8Array(5000); // 5KB > 1KB
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(largeContent);
        c.close();
      },
    });

    let errorCaught = false;
    try {
      await smallStore.storeFile({
        stream,
        name: 'too_large.bin',
      });
    } catch (err: unknown) {
      errorCaught = true;
      const appErr = err as { code: string; status: number };
      expect(appErr.code).toBe('upload_too_large');
      expect(appErr.status).toBe(413);
    }
    expect(errorCaught).toBe(true);
  });

  it('Janitor removes expired files and preserves pinned ones', async () => {
    const janitorStore = new LocalDiskStore({
      dataDir: join(TEST_DATA_DIR, 'janitor_store'),
      fileTtlSeconds: 0.001, // Expires almost immediately
    });

    const file1 = await janitorStore.saveBuffer(
      new Uint8Array([1, 2, 3]),
      'expiring.bin',
      'application/octet-stream',
    );
    const file2 = await janitorStore.saveBuffer(
      new Uint8Array([4, 5, 6]),
      'pinned.bin',
      'application/octet-stream',
    );

    await janitorStore.pinFile(file2.id);

    // Wait 50ms for TTL to expire
    await Bun.sleep(50);

    const janitor = new Janitor(janitorStore, 60);
    const { expiredFiles } = await janitor.runCleanup();

    expect(expiredFiles).toBeGreaterThanOrEqual(1);

    // file1 should be gone
    expect(await janitorStore.getFileMetadata(file1.id)).toBeNull();

    // file2 should still exist because it was pinned
    const pinnedMeta = await janitorStore.getFileMetadata(file2.id);
    expect(pinnedMeta).not.toBeNull();
    expect(pinnedMeta?.pinned).toBe(true);

    // Unpin and clean again
    await janitorStore.unpinFile(file2.id);
    await janitor.runCleanup();
    expect(await janitorStore.getFileMetadata(file2.id)).toBeNull();
  });
});
