# HTTP API Documentation

## Overview
turntable-renderer provides a clean, synchronous HTTP API for uploading 3D models and rendering animated turntables, poster frames, and converted formats.

Base URL: `http://localhost:3000`

---

## Endpoints

### 1. Health Check
`GET /health`
- Unauthenticated
- Response:
  ```json
  { "status": "ok" }
  ```

### 2. Version Information
`GET /version`
- Unauthenticated
- Response:
  ```json
  {
    "app": "turntable-renderer",
    "version": "0.1.0",
    "blender": "5.2.2",
    "runtime": "bun"
  }
  ```

### 3. File Operations (`/v1/files`)
- `POST /v1/files`: Upload model file directly to disk.
- `GET /v1/files/:id`: Stream file bytes with `Range` support.
- `HEAD /v1/files/:id`: Retrieve headers and metadata without body.
- `GET /v1/files/:id/info`: Retrieve file metadata.
- `DELETE /v1/files/:id`: Delete file (`409 file_in_use` if pinned by a running render).

### 4. Render Execution (`POST /v1/render`)
- Synchronous rendering endpoint.
- Request Body:
  ```json
  {
    "input": {
      "fileId": "f_abc123"
    },
    "outputs": ["video", "poster"],
    "options": {
      "width": 1080,
      "height": 1080,
      "frames": 24,
      "fps": 6,
      "lighting": "studio-dark",
      "engine": "cycles"
    }
  }
  ```
- Response:
  ```json
  {
    "metadata": {
      "format": "glb",
      "upAxis": "Y",
      "unit": "m",
      "dimensions": [1.2, 0.8, 2.1],
      "meshCount": 4,
      "materialCount": 3,
      "textureCount": 2,
      "polygonCount": 8500,
      "triangleCount": 16200
    },
    "render": {
      "width": 1080,
      "height": 1080,
      "frames": 24,
      "fps": 6,
      "durationSeconds": 4.0,
      "degreesPerFrame": 15,
      "startAngle": 0,
      "direction": "cw",
      "includeEndFrame": false,
      "engine": "cycles",
      "elapsedMs": 4200
    },
    "outputs": [
      {
        "name": "video",
        "fileId": "f_xyz789",
        "size": 275000,
        "contentType": "video/mp4",
        "width": 1080,
        "height": 1080
      }
    ]
  }
  ```

---

## Error Response Format
All errors follow a unified structure:
```json
{
  "code": "error_code",
  "message": "Human readable explanation",
  "details": {}
}
```
