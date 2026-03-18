import { Component, inject, input, output, signal } from '@angular/core';
import { MediaService, FileValidationError } from '../../../core/services/media.service';

interface UploadEntry {
  file: File;
  progress: number; // 0-100, or -1 for error
}

@Component({
  selector: 'app-upload',
  standalone: true,
  templateUrl: './upload.component.html',
  styleUrl: './upload.component.scss',
})
export class UploadComponent {
  readonly albumId = input.required<string>();
  readonly done = output<void>();
  readonly cancelled = output<void>();

  private readonly mediaService = inject(MediaService);

  readonly entries = signal<UploadEntry[]>([]);
  readonly rejections = signal<FileValidationError[]>([]);
  readonly truncated = signal(false);
  readonly isUploading = signal(false);
  readonly uploadDone = signal(0);
  readonly uploadTotal = signal(0);
  readonly errorMessage = signal<string | null>(null);
  readonly isDragging = signal(false);

  onDragOver(event: DragEvent) {
    event.preventDefault();
    this.isDragging.set(true);
  }

  onDragLeave() {
    this.isDragging.set(false);
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    this.isDragging.set(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    this.addFiles(files);
  }

  onFileInput(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = ''; // reset so the same file can be re-picked
    this.addFiles(files);
  }

  private addFiles(files: File[]) {
    const all = [...this.entries().map(e => e.file), ...files];
    const { accepted, rejected, truncated } = this.mediaService.validateFiles(all);
    this.entries.set(accepted.map(f => ({ file: f, progress: 0 })));
    this.rejections.set(rejected);
    this.truncated.set(truncated);
  }

  removeEntry(index: number) {
    this.entries.update(list => list.filter((_, i) => i !== index));
  }

  async upload() {
    const files = this.entries().map(e => e.file);
    if (!files.length) return;

    this.isUploading.set(true);
    this.errorMessage.set(null);
    this.uploadDone.set(0);
    this.uploadTotal.set(files.length);

    try {
      await this.mediaService.uploadFiles(this.albumId(), files, (done, total) => {
        this.uploadDone.set(done);
        this.uploadTotal.set(total);
        this.entries.update(list =>
          list.map((e, i) => (i < done ? { ...e, progress: 100 } : e))
        );
      });
      this.done.emit();
    } catch {
      this.errorMessage.set('Upload failed. Please try again.');
    } finally {
      this.isUploading.set(false);
    }
  }

  cancel() {
    this.cancelled.emit();
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
