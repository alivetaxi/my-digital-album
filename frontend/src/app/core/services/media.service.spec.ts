import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { MediaService } from './media.service';
import { AuthService } from '../auth/auth.service';

/** Flush the 2-tick async chain inside authHeaders(): getIdToken() → authHeaders() resolve. */
const flushAuth = () => Promise.resolve().then(() => Promise.resolve());

const MOCK_MEDIA_RAW = {
  id: 'm1',
  type: 'photo',
  storagePath: 'media/u1/a1/m1.jpg',
  thumbnailPath: 'media/u1/a1/m1/thumbnail.jpg',
  uploaderId: 'u1',
  description: null,
  width: 800,
  height: 600,
  duration: null,
  takenAt: '2024-01-01T00:00:00Z',
  takenPlace: null,
  thumbnailStatus: 'ready',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

describe('MediaService', () => {
  let service: MediaService;
  let http: HttpTestingController;

  beforeEach(() => {
    const authSpy = jasmine.createSpyObj<AuthService>('AuthService', ['getIdToken']);
    authSpy.getIdToken.and.resolveTo('test-token');

    TestBed.configureTestingModule({
      providers: [
        MediaService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: authSpy },
      ],
    });

    service = TestBed.inject(MediaService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('thumbnailUrl', () => {
    it('returns null for null path', () => {
      expect(service.thumbnailUrl(null)).toBeNull();
    });

    it('builds /api/thumbnails/ URL from path', () => {
      const url = service.thumbnailUrl('media/u1/a1/m1/thumbnail.jpg');
      expect(url).toBe('/api/thumbnail/media/u1/a1/m1/thumbnail.jpg');
    });
  });

  describe('validateFiles', () => {
    // Use Object.defineProperty to spoof file sizes without allocating large buffers.
    const makeFile = (name: string, type: string, size: number) => {
      const f = new File([], name, { type });
      Object.defineProperty(f, 'size', { value: size, configurable: true });
      return f;
    };

    it('accepts valid JPEG files', () => {
      const file = makeFile('photo.jpg', 'image/jpeg', 1024);
      const { accepted, rejected, truncated } = service.validateFiles([file]);
      expect(accepted.length).toBe(1);
      expect(rejected.length).toBe(0);
      expect(truncated).toBeFalse();
    });

    it('rejects unsupported format', () => {
      const file = makeFile('doc.pdf', 'application/pdf', 1024);
      const { accepted, rejected } = service.validateFiles([file]);
      expect(accepted.length).toBe(0);
      expect(rejected[0].reason).toBe('format');
    });

    it('accepts files between 30 MB and 500 MB (multipart threshold)', () => {
      const file = makeFile('video.mp4', 'video/mp4', 100 * 1024 * 1024);
      const { accepted, rejected } = service.validateFiles([file]);
      expect(accepted.length).toBe(1);
      expect(rejected.length).toBe(0);
    });

    it('rejects files over 500 MB', () => {
      const file = makeFile('huge.mp4', 'video/mp4', 501 * 1024 * 1024);
      const { accepted, rejected } = service.validateFiles([file]);
      expect(accepted.length).toBe(0);
      expect(rejected[0].reason).toBe('size');
    });

    it('truncates to 50 files and sets truncated flag', () => {
      const files = Array.from({ length: 55 }, (_, i) =>
        makeFile(`photo${i}.jpg`, 'image/jpeg', 1024)
      );
      const { accepted, truncated } = service.validateFiles(files);
      expect(accepted.length).toBe(50);
      expect(truncated).toBeTrue();
    });
  });

  describe('listMedia', () => {
    it('returns deserialized media items', async () => {
      const promise = service.listMedia('a1');
      await flushAuth();
      http.expectOne('/api/albums/a1/media?limit=30').flush({
        items: [MOCK_MEDIA_RAW],
        nextCursor: null,
      });

      const result = await promise;
      expect(result.items.length).toBe(1);
      expect(result.items[0].id).toBe('m1');
      expect(result.items[0].thumbnailUrl).toContain('thumbnail.jpg');
      expect(result.nextCursor).toBeNull();
    });

    it('passes after cursor as query param', async () => {
      const promise = service.listMedia('a1', 10, 'cursor123');
      await flushAuth();
      const req = http.expectOne('/api/albums/a1/media?limit=10&after=cursor123');
      expect(req.request.params.get('after')).toBe('cursor123');
      req.flush({ items: [], nextCursor: null });
      await promise;
    });

    it('throws AlbumApiError on 404', async () => {
      const promise = service.listMedia('missing');
      await flushAuth();
      http.expectOne('/api/albums/missing/media?limit=30').flush(
        { error: { code: 'ALBUM_NOT_FOUND', message: 'Album not found.', status: 404 } },
        { status: 404, statusText: 'Not Found' }
      );

      await expectAsync(promise).toBeRejectedWith(
        jasmine.objectContaining({ message: 'Album not found.' })
      );
    });

    it('throws AlbumApiError on 403 for non-member', async () => {
      const promise = service.listMedia('a1');
      await flushAuth();
      http.expectOne('/api/albums/a1/media?limit=30').flush(
        { error: { code: 'NOT_GROUP_MEMBER', message: 'Not a group member.', status: 403 } },
        { status: 403, statusText: 'Forbidden' }
      );

      await expectAsync(promise).toBeRejectedWith(
        jasmine.objectContaining({ message: 'Not a group member.' })
      );
    });
  });

  describe('updateMedia', () => {
    it('PATCHes description and returns updated media', async () => {
      const promise = service.updateMedia('a1', 'm1', { description: 'Hello' });
      await flushAuth();
      http.expectOne('/api/albums/a1/media/m1').flush({
        ...MOCK_MEDIA_RAW,
        description: 'Hello',
      });

      const result = await promise;
      expect(result.description).toBe('Hello');
    });

    it('throws AlbumApiError on 403', async () => {
      const promise = service.updateMedia('a1', 'm1', { description: 'X' });
      await flushAuth();
      http.expectOne('/api/albums/a1/media/m1').flush(
        { error: { code: 'PERMISSION_DENIED', message: 'Permission denied.', status: 403 } },
        { status: 403, statusText: 'Forbidden' }
      );

      await expectAsync(promise).toBeRejectedWith(
        jasmine.objectContaining({ message: 'Permission denied.' })
      );
    });

    it('throws AlbumApiError on 404', async () => {
      const promise = service.updateMedia('a1', 'missing', { description: 'X' });
      await flushAuth();
      http.expectOne('/api/albums/a1/media/missing').flush(
        { error: { code: 'MEDIA_NOT_FOUND', message: 'Media not found.', status: 404 } },
        { status: 404, statusText: 'Not Found' }
      );

      await expectAsync(promise).toBeRejectedWith(
        jasmine.objectContaining({ message: 'Media not found.' })
      );
    });
  });

  describe('getOriginalUrl', () => {
    it('returns signed URL string', async () => {
      const promise = service.getOriginalUrl('a1', 'm1');
      await flushAuth();
      http.expectOne('/api/albums/a1/media/m1/original-url').flush({ url: 'https://signed' });

      const result = await promise;
      expect(result).toBe('https://signed');
    });

    it('throws AlbumApiError on 404', async () => {
      const promise = service.getOriginalUrl('a1', 'missing');
      await flushAuth();
      http.expectOne('/api/albums/a1/media/missing/original-url').flush(
        { error: { code: 'MEDIA_NOT_FOUND', message: 'This item no longer exists.', status: 404 } },
        { status: 404, statusText: 'Not Found' }
      );

      await expectAsync(promise).toBeRejectedWith(
        jasmine.objectContaining({ message: 'This item no longer exists.' })
      );
    });
  });

  describe('deleteMedia', () => {
    it('sends DELETE request', async () => {
      const promise = service.deleteMedia('a1', 'm1');
      await flushAuth();
      http.expectOne('/api/albums/a1/media/m1').flush(null);

      await expectAsync(promise).toBeResolved();
    });

    it('throws AlbumApiError on 400 when media is cover', async () => {
      const promise = service.deleteMedia('a1', 'm1');
      await flushAuth();
      http.expectOne('/api/albums/a1/media/m1').flush(
        { error: { code: 'MEDIA_IS_COVER', message: 'Cannot delete the cover media.', status: 400 } },
        { status: 400, statusText: 'Bad Request' }
      );

      await expectAsync(promise).toBeRejectedWith(
        jasmine.objectContaining({ message: 'Cannot delete the cover media.' })
      );
    });

    it('throws AlbumApiError on 403', async () => {
      const promise = service.deleteMedia('a1', 'm1');
      await flushAuth();
      http.expectOne('/api/albums/a1/media/m1').flush(
        { error: { code: 'PERMISSION_DENIED', message: 'Permission denied.', status: 403 } },
        { status: 403, statusText: 'Forbidden' }
      );

      await expectAsync(promise).toBeRejectedWith(
        jasmine.objectContaining({ message: 'Permission denied.' })
      );
    });

    it('throws AlbumApiError on 404', async () => {
      const promise = service.deleteMedia('a1', 'missing');
      await flushAuth();
      http.expectOne('/api/albums/a1/media/missing').flush(
        { error: { code: 'MEDIA_NOT_FOUND', message: 'Media not found.', status: 404 } },
        { status: 404, statusText: 'Not Found' }
      );

      await expectAsync(promise).toBeRejectedWith(
        jasmine.objectContaining({ message: 'Media not found.' })
      );
    });
  });

  describe('uploadFiles', () => {
    // SHA-256 of an empty buffer (File created with no content)
    const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    let fetchSpy: jasmine.Spy;

    // crypto.subtle.digest resolves via a native browser task that is NOT
    // synchronized with Zone.js's macrotask queue (setTimeout). Spying on the
    // service's private sha256 method makes the entire upload chain run as plain
    // microtasks, so a single setTimeout(r, 0) reliably drains it before
    // http.expectOne() fires.
    const flushUpload = () => new Promise<void>(r => setTimeout(r, 0));

    beforeEach(() => {
      spyOn(service as any, 'sha256').and.resolveTo(EMPTY_SHA256);
      fetchSpy = spyOn(window, 'fetch').and.resolveTo(
        new Response(null, { status: 200 })
      );
    });

    it('uses single PUT for small files (under multipart threshold)', async () => {
      const file = new File([], 'photo.jpg', { type: 'image/jpeg' });

      const promise = service.uploadFiles('a1', [file]);
      await flushUpload();

      http.expectOne('/api/albums/a1/media/upload-url').flush({
        [EMPTY_SHA256]: { url: 'https://gcs/put-url', multipart: false },
      });

      const mediaIds = await promise;
      expect(mediaIds).toEqual([EMPTY_SHA256]);
      expect(fetchSpy).toHaveBeenCalledOnceWith(
        'https://gcs/put-url',
        jasmine.objectContaining({ method: 'PUT' })
      );
      // No Content-Range for a single PUT
      const callHeaders = fetchSpy.calls.first().args[1].headers as Record<string, string>;
      expect('Content-Range' in callHeaders).toBeFalse();
    });

    it('uses chunked PUT with Content-Range for large files', async () => {
      const CHUNK = 8 * 1024 * 1024;
      const FILE_SIZE = CHUNK * 3 + 1; // 4 chunks
      const file = new File([], 'video.mp4', { type: 'video/mp4' });
      Object.defineProperty(file, 'size', { value: FILE_SIZE, configurable: true });

      // Simulate GCS: 308 Resume Incomplete for chunks 1-3, 200 OK for the last
      let callCount = 0;
      fetchSpy.and.callFake(() => {
        callCount++;
        return Promise.resolve(new Response(null, { status: callCount < 4 ? 308 : 200 }));
      });

      const promise = service.uploadFiles('a1', [file]);
      await flushUpload();

      http.expectOne('/api/albums/a1/media/upload-url').flush({
        [EMPTY_SHA256]: { url: 'https://gcs/session', multipart: true },
      });

      await promise;

      expect(fetchSpy.calls.count()).toBe(4);
      for (const call of fetchSpy.calls.all()) {
        expect(call.args[0]).toBe('https://gcs/session');
        const headers = call.args[1].headers as Record<string, string>;
        expect(headers['Content-Range']).toBeTruthy();
      }
      // Last chunk's Content-Range must end at the final byte of the file
      const lastRange = (fetchSpy.calls.mostRecent().args[1].headers as Record<string, string>)['Content-Range'];
      expect(lastRange).toMatch(new RegExp(`-${FILE_SIZE - 1}/${FILE_SIZE}$`));
    });

    it('stops sending chunks when GCS returns 200 on an intermediate chunk (early completion)', async () => {
      const CHUNK = 8 * 1024 * 1024;
      const file = new File([], 'video.mp4', { type: 'video/mp4' });
      Object.defineProperty(file, 'size', { value: CHUNK * 4 + 1, configurable: true });

      // GCS completes after the 2nd chunk (early 200)
      let callCount = 0;
      fetchSpy.and.callFake(() => {
        callCount++;
        return Promise.resolve(new Response(null, { status: callCount === 1 ? 308 : 200 }));
      });

      const promise = service.uploadFiles('a1', [file]);
      await flushUpload();

      http.expectOne('/api/albums/a1/media/upload-url').flush({
        [EMPTY_SHA256]: { url: 'https://gcs/session', multipart: true },
      });

      await promise;
      // Must stop after the early 200, not send all 5 chunks
      expect(fetchSpy.calls.count()).toBe(2);
    });

    it('throws when GCS returns 308 for the last chunk (upload incomplete)', async () => {
      const file = new File([], 'video.mp4', { type: 'video/mp4' });
      // 1-byte file → single chunk that is also the last chunk
      Object.defineProperty(file, 'size', { value: 1, configurable: true });
      fetchSpy.and.resolveTo(new Response(null, { status: 308 }));

      const promise = service.uploadFiles('a1', [file]);
      await flushUpload();

      http.expectOne('/api/albums/a1/media/upload-url').flush({
        [EMPTY_SHA256]: { url: 'https://gcs/session', multipart: true },
      });

      await expectAsync(promise).toBeRejectedWithError(/HTTP 308/);
    });

    it('resumes from Range header offset when 308 response has Range', async () => {
      const CHUNK = 8 * 1024 * 1024;
      const FILE_SIZE = CHUNK * 2 + 1; // 3 chunks normally
      const file = new File([], 'video.mp4', { type: 'video/mp4' });
      Object.defineProperty(file, 'size', { value: FILE_SIZE, configurable: true });

      // Chunk 1: GCS only received 1 byte (Range: bytes=0-0)
      // Chunk 2: normal 308 (from resumed offset 1)
      // Chunk 3: 200 done
      let callCount = 0;
      fetchSpy.and.callFake(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(new Response(null, { status: 308, headers: { Range: 'bytes=0-0' } }));
        }
        return Promise.resolve(new Response(null, { status: callCount === 3 ? 200 : 308 }));
      });

      const promise = service.uploadFiles('a1', [file]);
      await flushUpload();

      http.expectOne('/api/albums/a1/media/upload-url').flush({
        [EMPTY_SHA256]: { url: 'https://gcs/session', multipart: true },
      });

      await promise;

      expect(fetchSpy.calls.count()).toBe(3);
      const ranges = fetchSpy.calls.all().map(
        c => (c.args[1].headers as Record<string, string>)['Content-Range']
      );
      // Second chunk must resume from byte 1, not from CHUNK_SIZE
      expect(ranges[0]).toBe(`bytes 0-${CHUNK - 1}/${FILE_SIZE}`);
      expect(ranges[1]).toMatch(/^bytes 1-/);
    });

    it('uses redirect:manual on chunked PUT requests', async () => {
      const file = new File([], 'video.mp4', { type: 'video/mp4' });
      Object.defineProperty(file, 'size', { value: 1, configurable: true });
      fetchSpy.and.resolveTo(new Response(null, { status: 200 }));

      const promise = service.uploadFiles('a1', [file]);
      await flushUpload();
      http.expectOne('/api/albums/a1/media/upload-url').flush({
        [EMPTY_SHA256]: { url: 'https://gcs/session', multipart: true },
      });
      await promise;

      expect((fetchSpy.calls.first().args[1] as RequestInit).redirect).toBe('manual');
    });

    it('advances offset by chunk size when GCS returns opaqueredirect (Safari 308 behavior)', async () => {
      const CHUNK = 8 * 1024 * 1024;
      const FILE_SIZE = CHUNK * 2 + 1; // 3 chunks
      const file = new File([], 'video.mp4', { type: 'video/mp4' });
      Object.defineProperty(file, 'size', { value: FILE_SIZE, configurable: true });

      // Safari returns type='opaqueredirect' / status=0 for GCS 308 Resume Incomplete.
      // Response.type is a read-only getter, so use a plain object mock.
      const opaqueResponse = { type: 'opaqueredirect', ok: false, status: 0, headers: new Headers() };

      let callCount = 0;
      fetchSpy.and.callFake(() => {
        callCount++;
        return Promise.resolve(callCount < 3 ? opaqueResponse : new Response(null, { status: 200 }));
      });

      const promise = service.uploadFiles('a1', [file]);
      await flushUpload();
      http.expectOne('/api/albums/a1/media/upload-url').flush({
        [EMPTY_SHA256]: { url: 'https://gcs/session', multipart: true },
      });
      await promise;

      expect(fetchSpy.calls.count()).toBe(3);
      const ranges = fetchSpy.calls.all().map(
        c => (c.args[1].headers as Record<string, string>)['Content-Range']
      );
      expect(ranges[0]).toBe(`bytes 0-${CHUNK - 1}/${FILE_SIZE}`);
      expect(ranges[1]).toBe(`bytes ${CHUNK}-${CHUNK * 2 - 1}/${FILE_SIZE}`);
    });

    it('throws on opaqueredirect for the last chunk', async () => {
      const file = new File([], 'video.mp4', { type: 'video/mp4' });
      Object.defineProperty(file, 'size', { value: 1, configurable: true });

      const opaqueResponse = { type: 'opaqueredirect', ok: false, status: 0, headers: new Headers() };
      fetchSpy.and.resolveTo(opaqueResponse as unknown as Response);

      const promise = service.uploadFiles('a1', [file]);
      await flushUpload();
      http.expectOne('/api/albums/a1/media/upload-url').flush({
        [EMPTY_SHA256]: { url: 'https://gcs/session', multipart: true },
      });

      await expectAsync(promise).toBeRejectedWithError(/last chunk not finalized/);
    });

    it('skips upload and returns empty array when server returns no URL', async () => {
      const file = new File([], 'photo.jpg', { type: 'image/jpeg' });

      const promise = service.uploadFiles('a1', [file]);
      await flushUpload();

      http.expectOne('/api/albums/a1/media/upload-url').flush({});

      const mediaIds = await promise;
      expect(mediaIds).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('calls onProgress after each file completes', async () => {
      const file = new File([], 'photo.jpg', { type: 'image/jpeg' });
      const progressCalls: [number, number][] = [];

      const promise = service.uploadFiles('a1', [file], (done, total) =>
        progressCalls.push([done, total])
      );
      await flushUpload();

      http.expectOne('/api/albums/a1/media/upload-url').flush({
        [EMPTY_SHA256]: { url: 'https://gcs/put-url', multipart: false },
      });

      await promise;
      expect(progressCalls).toEqual([[1, 1]]);
    });
  });
});
