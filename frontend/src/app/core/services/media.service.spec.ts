import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { MediaService } from './media.service';
import { AuthService } from '../auth/auth.service';

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
    const makeFile = (name: string, type: string, size: number) =>
      new File(['x'.repeat(size)], name, { type });

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

    it('rejects files over 30 MB', () => {
      const file = makeFile('big.jpg', 'image/jpeg', 31 * 1024 * 1024);
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
      await Promise.resolve();
      http.expectOne(req => req.url === '/api/albums/a1/media').flush({
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
      await Promise.resolve();
      const req = http.expectOne(r => r.url === '/api/albums/a1/media');
      expect(req.request.params.get('after')).toBe('cursor123');
      req.flush({ items: [], nextCursor: null });
      await promise;
    });

    it('throws AlbumApiError on 404', async () => {
      const promise = service.listMedia('missing');
      await Promise.resolve();
      http.expectOne(r => r.url === '/api/albums/missing/media').flush(
        { error: { code: 'ALBUM_NOT_FOUND', message: 'Album not found.', status: 404 } },
        { status: 404, statusText: 'Not Found' }
      );

      await expectAsync(promise).toBeRejectedWith(
        jasmine.objectContaining({ message: 'Album not found.' })
      );
    });

    it('throws AlbumApiError on 403 for non-member', async () => {
      const promise = service.listMedia('a1');
      await Promise.resolve();
      http.expectOne(r => r.url === '/api/albums/a1/media').flush(
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
      await Promise.resolve();
      http.expectOne('/api/albums/a1/media/m1').flush({
        ...MOCK_MEDIA_RAW,
        description: 'Hello',
      });

      const result = await promise;
      expect(result.description).toBe('Hello');
    });

    it('throws AlbumApiError on 403', async () => {
      const promise = service.updateMedia('a1', 'm1', { description: 'X' });
      await Promise.resolve();
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
      await Promise.resolve();
      http.expectOne('/api/albums/a1/media/missing').flush(
        { error: { code: 'MEDIA_NOT_FOUND', message: 'Media not found.', status: 404 } },
        { status: 404, statusText: 'Not Found' }
      );

      await expectAsync(promise).toBeRejectedWith(
        jasmine.objectContaining({ message: 'Media not found.' })
      );
    });
  });

  describe('deleteMedia', () => {
    it('sends DELETE request', async () => {
      const promise = service.deleteMedia('a1', 'm1');
      await Promise.resolve();
      http.expectOne('/api/albums/a1/media/m1').flush(null);

      await expectAsync(promise).toBeResolved();
    });

    it('throws AlbumApiError on 400 when media is cover', async () => {
      const promise = service.deleteMedia('a1', 'm1');
      await Promise.resolve();
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
      await Promise.resolve();
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
      await Promise.resolve();
      http.expectOne('/api/albums/a1/media/missing').flush(
        { error: { code: 'MEDIA_NOT_FOUND', message: 'Media not found.', status: 404 } },
        { status: 404, statusText: 'Not Found' }
      );

      await expectAsync(promise).toBeRejectedWith(
        jasmine.objectContaining({ message: 'Media not found.' })
      );
    });
  });
});
