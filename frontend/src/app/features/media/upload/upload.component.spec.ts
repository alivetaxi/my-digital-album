import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { UploadComponent } from './upload.component';
import { MediaService, FileValidationError } from '../../../core/services/media.service';

function createComponent() {
  const mediaSpy = jasmine.createSpyObj<MediaService>('MediaService', [
    'validateFiles',
    'uploadFiles',
  ]);
  // Default: all files accepted, upload succeeds
  mediaSpy.validateFiles.and.returnValue({ accepted: [], rejected: [], truncated: false });
  mediaSpy.uploadFiles.and.resolveTo([]);

  TestBed.configureTestingModule({
    imports: [UploadComponent],
    schemas: [NO_ERRORS_SCHEMA],
    providers: [{ provide: MediaService, useValue: mediaSpy }],
  });

  const fixture = TestBed.createComponent(UploadComponent);
  fixture.componentRef.setInput('albumId', 'a1');
  return { fixture, component: fixture.componentInstance, mediaSpy };
}

describe('UploadComponent', () => {
  describe('addFiles (via onFileInput)', () => {
    it('populates entries with accepted files', () => {
      const { component, mediaSpy } = createComponent();
      const file = new File([], 'photo.jpg', { type: 'image/jpeg' });
      mediaSpy.validateFiles.and.returnValue({
        accepted: [file],
        rejected: [],
        truncated: false,
      });

      component.onFileInput({ target: { files: [file], value: '' } } as unknown as Event);

      expect(component.entries().length).toBe(1);
      expect(component.entries()[0].file).toBe(file);
      expect(component.entries()[0].progress).toBe(0);
    });

    it('populates rejections and truncated flag', () => {
      const { component, mediaSpy } = createComponent();
      const file = new File([], 'doc.pdf', { type: 'application/pdf' });
      const rejection: FileValidationError = { file, reason: 'format' };
      mediaSpy.validateFiles.and.returnValue({
        accepted: [],
        rejected: [rejection],
        truncated: true,
      });

      component.onFileInput({ target: { files: [file], value: '' } } as unknown as Event);

      expect(component.entries().length).toBe(0);
      expect(component.rejections().length).toBe(1);
      expect(component.truncated()).toBeTrue();
    });
  });

  describe('removeEntry', () => {
    it('removes the entry at the specified index', () => {
      const { component } = createComponent();
      const f1 = new File([], 'a.jpg');
      const f2 = new File([], 'b.jpg');
      component.entries.set([
        { file: f1, progress: 0 },
        { file: f2, progress: 0 },
      ]);

      component.removeEntry(0);

      expect(component.entries().length).toBe(1);
      expect(component.entries()[0].file).toBe(f2);
    });
  });

  describe('upload', () => {
    it('does nothing when entries is empty', fakeAsync(async () => {
      const { component, mediaSpy } = createComponent();
      await component.upload();
      expect(mediaSpy.uploadFiles).not.toHaveBeenCalled();
    }));

    it('calls uploadFiles and emits done on success', fakeAsync(async () => {
      const { component, mediaSpy } = createComponent();
      const file = new File([], 'photo.jpg', { type: 'image/jpeg' });
      component.entries.set([{ file, progress: 0 }]);
      mediaSpy.uploadFiles.and.resolveTo(['media-id-1']);

      let doneEmitted = false;
      component.done.subscribe(() => (doneEmitted = true));

      const promise = component.upload();
      tick();
      await promise;

      expect(mediaSpy.uploadFiles).toHaveBeenCalledWith('a1', [file], jasmine.any(Function));
      expect(doneEmitted).toBeTrue();
      expect(component.isUploading()).toBeFalse();
    }));

    it('sets errorMessage and does not emit done on failure', fakeAsync(async () => {
      const { component, mediaSpy } = createComponent();
      component.entries.set([{ file: new File([], 'x.jpg'), progress: 0 }]);
      mediaSpy.uploadFiles.and.rejectWith(new Error('network'));

      let doneEmitted = false;
      component.done.subscribe(() => (doneEmitted = true));

      const promise = component.upload();
      tick();
      await promise;

      expect(component.errorMessage()).toBeTruthy();
      expect(doneEmitted).toBeFalse();
      expect(component.isUploading()).toBeFalse();
    }));

    it('updates uploadDone and entries progress via onProgress callback', fakeAsync(async () => {
      const { component, mediaSpy } = createComponent();
      const file = new File([], 'photo.jpg', { type: 'image/jpeg' });
      component.entries.set([{ file, progress: 0 }]);

      mediaSpy.uploadFiles.and.callFake(
        (_albumId: string, _files: File[], onProgress?: (done: number, total: number) => void) => {
          onProgress?.(1, 1);
          return Promise.resolve(['id']);
        }
      );

      const promise = component.upload();
      tick();
      await promise;

      expect(component.uploadDone()).toBe(1);
      expect(component.entries()[0].progress).toBe(100);
    }));
  });

  describe('cancel', () => {
    it('emits the cancelled output', () => {
      const { component } = createComponent();
      let cancelledEmitted = false;
      component.cancelled.subscribe(() => (cancelledEmitted = true));

      component.cancel();

      expect(cancelledEmitted).toBeTrue();
    });
  });

  describe('formatSize', () => {
    it('formats bytes', () => {
      const { component } = createComponent();
      expect(component.formatSize(512)).toBe('512 B');
    });

    it('formats kilobytes', () => {
      const { component } = createComponent();
      expect(component.formatSize(2048)).toBe('2.0 KB');
    });

    it('formats megabytes', () => {
      const { component } = createComponent();
      expect(component.formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
    });
  });
});
