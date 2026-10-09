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
- Synchronously extracts model metadata and renders a 1-frame poster image, then enqueues an asynchronous background video render task.
- Request Body:
  ```json
  {
    "input": {
      "fileId": "f_abc123"
    },
    "options": {
      "width": 1080,
      "height": 1080,
      "frames": 24,
      "fps": 6,
      "lighting": "studio-dark",
      "engine": "cycles",
      "format": "mp4",
      "poster": {
        "angle": 0,
        "width": 300,
        "height": 300
      }
    }
  }
  ```
- Response (`200 OK`):
  ```json
  {
    "taskId": "t_9a2f7c4b1e8d3a01",
    "status": "queued",
    "positionInQueue": 1,
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
    "poster": {
      "fileId": "f_poster123",
      "size": 42100,
      "contentType": "image/png",
      "width": 300,
      "height": 300
    }
  }
  ```

### 5. Render Task Status (`GET /v1/render/tasks/:id`)
- Query the status and output of an asynchronous video render task.
- Response when Queued / Rendering (`200 OK`):
  ```json
  {
    "taskId": "t_9a2f7c4b1e8d3a01",
    "status": "queued",
    "positionInQueue": 1,
    "createdAt": "2026-10-08T11:00:00.000Z"
  }
  ```
- Response when Completed (`200 OK`):
  ```json
  {
    "taskId": "t_9a2f7c4b1e8d3a01",
    "status": "completed",
    "createdAt": "2026-10-08T11:00:00.000Z",
    "startedAt": "2026-10-08T11:00:01.000Z",
    "completedAt": "2026-10-08T11:02:15.000Z",
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
      "elapsedMs": 134000
    },
    "video": {
      "fileId": "f_xyz789",
      "size": 2850000,
      "contentType": "video/mp4",
      "width": 1080,
      "height": 1080
    }
  }
  ```
- Response when Failed (`200 OK`):
  ```json
  {
    "taskId": "t_9a2f7c4b1e8d3a01",
    "status": "failed",
    "createdAt": "2026-10-08T11:00:00.000Z",
    "startedAt": "2026-10-08T11:00:01.000Z",
    "failedAt": "2026-10-08T11:00:05.000Z",
    "error": {
      "code": "render_failed",
      "message": "Blender render process crashed",
      "details": {}
    }
  }
  ```

### 6. Delete Render Task (`DELETE /v1/render/tasks/:id`)
- Deletes a completed or queued render task and automatically deletes its associated input model file, rendered poster file, rendered video file, and task record.
- Returns `409 file_in_use` if task is actively rendering.
- Response (`200 OK`):
  ```json
  {
    "status": "deleted",
    "id": "t_9a2f7c4b1e8d3a01"
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
