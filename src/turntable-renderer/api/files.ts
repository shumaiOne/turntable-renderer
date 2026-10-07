import { Hono } from 'hono';
import { defaultFileStore } from '../files/local-disk-store.js';
import { AppError } from '../render/errors.js';

export const filesApi = new Hono();

// Helper to parse HTTP Range header
function parseRangeHeader(
  rangeHeader: string,
  fileSize: number,
): { start: number; end: number } | null {
  const match = rangeHeader.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;

  const startStr = match[1];
  const endStr = match[2];

  let start: number;
  let end: number;

  if (startStr === '' && endStr !== '') {
    // Suffix range: bytes=-500 (last 500 bytes)
    const suffix = Number.parseInt(endStr, 10);
    start = Math.max(0, fileSize - suffix);
    end = fileSize - 1;
  } else if (startStr !== '' && endStr === '') {
    // Prefix range: bytes=500- (from 500 to end)
    start = Number.parseInt(startStr, 10);
    end = fileSize - 1;
  } else if (startStr !== '' && endStr !== '') {
    start = Number.parseInt(startStr, 10);
    end = Number.parseInt(endStr, 10);
  } else {
    return null;
  }

  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= fileSize || start < 0) {
    return null;
  }

  return { start, end: Math.min(end, fileSize - 1) };
}

// POST /v1/files - Upload file
filesApi.post('/', async (c) => {
  const contentTypeHeader = c.req.header('content-type') || '';
  const expectedSha256 = c.req.header('x-content-sha256') || undefined;

  let stream: ReadableStream<Uint8Array>;
  let filename = 'file.bin';
  let explicitContentType: string | undefined;

  if (contentTypeHeader.includes('multipart/form-data')) {
    const formData = await c.req.formData();
    const file = formData.get('file');
    if (!file || !(file instanceof File)) {
      throw new AppError('bad_request', 'Multipart upload requires a "file" form field', 400);
    }
    filename = file.name || 'file.bin';
    explicitContentType = file.type || undefined;
    stream = file.stream();
  } else {
    // Raw octet-stream / direct body stream
    const rawBody = c.req.raw.body;
    if (!rawBody) {
      throw new AppError('bad_request', 'Missing upload request body', 400);
    }
    filename = c.req.query('filename') || c.req.header('x-filename') || 'file.bin';
    explicitContentType =
      contentTypeHeader !== 'application/octet-stream' ? contentTypeHeader : undefined;
    stream = rawBody;
  }

  const metadata = await defaultFileStore.storeFile({
    stream,
    name: filename,
    contentType: explicitContentType,
    expectedSha256,
  });

  return c.json(metadata, 201);
});

// GET /v1/files/:id/info - File metadata info
filesApi.get('/:id/info', async (c) => {
  const id = c.req.param('id');
  const metadata = await defaultFileStore.getFileMetadata(id);
  if (!metadata) {
    throw new AppError('input_not_found', `File '${id}' not found`, 404);
  }
  return c.json(metadata, 200);
});

// GET /v1/files/:id - Download file (streaming with Range support)
filesApi.get('/:id', async (c) => {
  const id = c.req.param('id');
  const metadata = await defaultFileStore.getFileMetadata(id);
  if (!metadata) {
    throw new AppError('input_not_found', `File '${id}' not found`, 404);
  }

  const rangeHeader = c.req.header('range');

  if (rangeHeader) {
    const range = parseRangeHeader(rangeHeader, metadata.size);
    if (!range) {
      c.header('Content-Range', `bytes */${metadata.size}`);
      throw new AppError('bad_request', 'Requested Range Not Satisfiable', 416);
    }

    const { stream } = await defaultFileStore.getFileStream(id, range);
    const contentLength = range.end - range.start + 1;

    c.header('Content-Range', `bytes ${range.start}-${range.end}/${metadata.size}`);
    c.header('Content-Length', String(contentLength));
    c.header('Content-Type', metadata.contentType);
    c.header('ETag', `"${metadata.sha256}"`);
    c.header('Accept-Ranges', 'bytes');
    c.header('Content-Disposition', `inline; filename="${metadata.name}"`);
    c.header('X-Content-Type-Options', 'nosniff');

    return c.body(stream, 206);
  }

  const { stream } = await defaultFileStore.getFileStream(id);

  c.header('Content-Length', String(metadata.size));
  c.header('Content-Type', metadata.contentType);
  c.header('ETag', `"${metadata.sha256}"`);
  c.header('Accept-Ranges', 'bytes');
  c.header('Content-Disposition', `inline; filename="${metadata.name}"`);
  c.header('X-Content-Type-Options', 'nosniff');

  return c.body(stream, 200);
});

// HEAD /v1/files/:id - Metadata headers only
filesApi.on('HEAD', '/:id', async (c) => {
  const id = c.req.param('id');
  const metadata = await defaultFileStore.getFileMetadata(id);
  if (!metadata) {
    throw new AppError('input_not_found', `File '${id}' not found`, 404);
  }

  c.header('Content-Length', String(metadata.size));
  c.header('Content-Type', metadata.contentType);
  c.header('ETag', `"${metadata.sha256}"`);
  c.header('Accept-Ranges', 'bytes');
  c.header('Content-Disposition', `inline; filename="${metadata.name}"`);
  c.header('X-Content-Type-Options', 'nosniff');

  return c.body(null, 200);
});

// DELETE /v1/files/:id - Delete file
filesApi.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const deleted = await defaultFileStore.deleteFile(id);
  if (!deleted) {
    throw new AppError('input_not_found', `File '${id}' not found`, 404);
  }
  return c.json({ status: 'deleted', id }, 200);
});
