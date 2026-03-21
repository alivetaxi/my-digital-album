import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { getApp } from 'firebase/app';
import { getFirestore, doc, onSnapshot } from 'firebase/firestore';
import { environment } from '../../../environments/environment';
import { Media, ThumbnailStatus } from '../models';
import { AuthService } from '../auth/auth.service';
import { AlbumApiError, ApiError } from './album.service';

export interface MediaPage {
  items: Media[];
  nextCursor: string | null;
}

export interface UploadItem {
  sha256: string;
  mimeType: string;
  filename: string;
  size: number;
}

export interface FileValidationError {
  file: File;
  reason: 'size' | 'format';
}

const ACCEPTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/quicktime',
]);
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB
const MULTIPART_THRESHOLD = 30 * 1024 * 1024; // 30 MB — above this, use resumable upload
const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB per chunk (must be multiple of 256 KB)
const MAX_BATCH = 50;

@Injectable({ providedIn: 'root' })
export class MediaService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  private async authHeaders(): Promise<HttpHeaders> {
    const token = await this.auth.getIdToken();
    return token
      ? new HttpHeaders({ Authorization: `Bearer ${token}` })
      : new HttpHeaders();
  }

  private handleError(err: unknown): never {
    if (err instanceof HttpErrorResponse && err.error?.error) {
      throw new AlbumApiError(err.error.error as ApiError);
    }
    throw err;
  }

  thumbnailUrl(thumbnailPath: string | null): string | null {
    if (!thumbnailPath) return null;
    return `/api/thumbnail/${thumbnailPath}`;
  }

  async listMedia(albumId: string, limit = 30, after?: string): Promise<MediaPage> {
    const headers = await this.authHeaders();
    const params: Record<string, string> = { limit: String(limit) };
    if (after) params['after'] = after;
    try {
      const raw = await firstValueFrom(
        this.http.get<{ items: Record<string, unknown>[]; nextCursor: string | null }>(
          `/api/albums/${albumId}/media`,
          { headers, params }
        )
      );
      return {
        items: raw.items.map(i => this.deserializeMedia(i)),
        nextCursor: raw.nextCursor,
      };
    } catch (err) {
      return this.handleError(err);
    }
  }

  async updateMedia(
    albumId: string,
    mediaId: string,
    data: { description: string | null }
  ): Promise<Media> {
    const headers = await this.authHeaders();
    try {
      const raw = await firstValueFrom(
        this.http.patch<Record<string, unknown>>(
          `/api/albums/${albumId}/media/${mediaId}`,
          data,
          { headers }
        )
      );
      return this.deserializeMedia(raw);
    } catch (err) {
      return this.handleError(err);
    }
  }

  async getOriginalUrl(albumId: string, mediaId: string): Promise<string> {
    const headers = await this.authHeaders();
    try {
      const result = await firstValueFrom(
        this.http.get<{ url: string }>(
          `/api/albums/${albumId}/media/${mediaId}/original-url`,
          { headers }
        )
      );
      return result.url;
    } catch (err) {
      return this.handleError(err);
    }
  }

  async deleteMedia(albumId: string, mediaId: string): Promise<void> {
    const headers = await this.authHeaders();
    try {
      await firstValueFrom(
        this.http.delete(`/api/albums/${albumId}/media/${mediaId}`, { headers })
      );
    } catch (err) {
      return this.handleError(err);
    }
  }

  /** Watch a single media doc in Firestore; calls back when thumbnailStatus changes. */
  watchThumbnailStatus(
    albumId: string,
    mediaId: string,
    onUpdate: (status: ThumbnailStatus, thumbnailPath: string | null) => void
  ): () => void {
    const db = getFirestore(getApp());
    const albumsCol = environment.production ? 'albums-prod' : 'albums-dev';
    const ref = doc(db, albumsCol, albumId, 'media', mediaId);
    return onSnapshot(ref, snapshot => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        onUpdate(
          data['thumbnailStatus'] as ThumbnailStatus,
          data['thumbnailPath'] as string | null
        );
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Upload flow
  // ---------------------------------------------------------------------------

  /** Validate and split files into accepted/rejected. Truncates accepted to MAX_BATCH. */
  validateFiles(files: File[]): {
    accepted: File[];
    rejected: FileValidationError[];
    truncated: boolean;
  } {
    const accepted: File[] = [];
    const rejected: FileValidationError[] = [];

    for (const file of files) {
      if (!ACCEPTED_MIME_TYPES.has(file.type)) {
        rejected.push({ file, reason: 'format' });
      } else if (file.size > MAX_FILE_SIZE) {
        rejected.push({ file, reason: 'size' });
      } else {
        accepted.push(file);
      }
    }

    const truncated = accepted.length > MAX_BATCH;
    return { accepted: accepted.slice(0, MAX_BATCH), rejected, truncated };
  }

  /** Upload files to an album. Returns media IDs of successfully initiated uploads. */
  async uploadFiles(
    albumId: string,
    files: File[],
    onProgress?: (done: number, total: number) => void
  ): Promise<string[]> {
    // Compute SHA-256 hashes
    const items: UploadItem[] = await Promise.all(
      files.map(async file => ({
        sha256: await this.sha256(file),
        mimeType: file.type,
        filename: file.name,
        size: file.size,
      }))
    );

    // Request upload URLs (signed PUT for small files, resumable session URI for large)
    const headers = await this.authHeaders();
    let uploadUrls: Record<string, { url: string; multipart: boolean }>;
    try {
      uploadUrls = await firstValueFrom(
        this.http.post<Record<string, { url: string; multipart: boolean }>>(
          `/api/albums/${albumId}/media/upload-url`,
          items,
          { headers }
        )
      );
    } catch (err) {
      return this.handleError(err);
    }

    // Upload files directly to GCS
    const total = files.length;
    let done = 0;
    const mediaIds: string[] = [];

    await Promise.all(
      files.map(async (file, i) => {
        const mediaId = items[i].sha256;
        const entry = uploadUrls[mediaId];
        if (!entry) return;

        if (entry.multipart) {
          await this.uploadChunked(entry.url, file);
        } else {
          await fetch(entry.url, {
            method: 'PUT',
            headers: { 'Content-Type': file.type },
            body: file,
          });
        }

        mediaIds.push(mediaId);
        done++;
        onProgress?.(done, total);
      })
    );

    return mediaIds;
  }

  /** Upload a file to a GCS resumable session URI in CHUNK_SIZE chunks. */
  private async uploadChunked(sessionUri: string, file: File): Promise<void> {
    let offset = 0;
    while (offset < file.size) {
      const end = Math.min(offset + CHUNK_SIZE, file.size);
      const isLast = end === file.size;
      const response = await fetch(sessionUri, {
        method: 'PUT',
        headers: {
          'Content-Range': `bytes ${offset}-${end - 1}/${file.size}`,
          'Content-Type': file.type,
        },
        body: file.slice(offset, end),
      });
      if (response.ok) {
        // GCS returned 200/201 — object is finalized. Stop immediately even if
        // we thought this was an intermediate chunk (e.g. GCS completed early).
        break;
      }
      if (response.status !== 308 || isLast) {
        // 308 on the last chunk means GCS hasn't received all bytes (size
        // mismatch or partial delivery). Any other non-OK status is an error.
        throw new Error(`Resumable upload failed at offset ${offset}: HTTP ${response.status}`);
      }
      // 308 Resume Incomplete on an intermediate chunk. GCS may return a Range
      // header (bytes=0-N) indicating the last byte it actually received; resume
      // from there instead of blindly assuming the full chunk was delivered.
      const range = response.headers.get('Range');
      const match = range?.match(/bytes=0-(\d+)/);
      offset = match ? parseInt(match[1], 10) + 1 : end;
    }
  }

  private async sha256(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private deserializeMedia(raw: Record<string, unknown>): Media {
    const thumbnailPath = (raw['thumbnailPath'] as string | null) ?? null;
    return {
      id: raw['id'] as string,
      type: raw['type'] as 'photo' | 'video',
      storagePath: raw['storagePath'] as string,
      thumbnailPath,
      thumbnailUrl: this.thumbnailUrl(thumbnailPath),
      originalUrl: null, // fetched on demand in viewer (Phase 3)
      uploaderId: raw['uploaderId'] as string,
      description: (raw['description'] as string | null) ?? null,
      width: (raw['width'] as number) ?? 0,
      height: (raw['height'] as number) ?? 0,
      duration: (raw['duration'] as number | null) ?? null,
      takenAt: raw['takenAt'] ? new Date(raw['takenAt'] as string) : null,
      takenPlace: (raw['takenPlace'] as Media['takenPlace']) ?? null,
      thumbnailStatus: raw['thumbnailStatus'] as ThumbnailStatus,
      createdAt: new Date(raw['createdAt'] as string),
      updatedAt: new Date(raw['updatedAt'] as string),
    };
  }
}
