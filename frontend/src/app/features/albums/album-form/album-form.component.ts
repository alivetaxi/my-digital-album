import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AlbumApiError, AlbumService } from '../../../core/services/album.service';
import { Album, Visibility } from '../../../core/models';

@Component({
  selector: 'app-album-form',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './album-form.component.html',
  styleUrl: './album-form.component.scss',
})
export class AlbumFormComponent {
  /** When provided, the form is in edit mode. */
  readonly album = input<Album | null>(null);

  readonly saved = output<Album>();
  readonly cancelled = output<void>();

  private readonly albumService = inject(AlbumService);

  readonly title = signal('');
  readonly visibility = signal<Visibility>('private');
  readonly isSaving = signal(false);
  readonly errorMessage = signal<string | null>(null);

  ngOnInit() {
    const a = this.album();
    if (a) {
      this.title.set(a.title);
      this.visibility.set(a.visibility);
    }
  }

  async save() {
    if (!this.title().trim()) return;
    this.isSaving.set(true);
    this.errorMessage.set(null);

    try {
      let result: Album;
      const a = this.album();
      if (a) {
        result = await this.albumService.updateAlbum(a.id, {
          title: this.title().trim(),
          visibility: this.visibility(),
        });
      } else {
        result = await this.albumService.createAlbum({
          title: this.title().trim(),
          visibility: this.visibility(),
        });
      }
      this.saved.emit(result);
    } catch (err) {
      this.errorMessage.set(
        err instanceof AlbumApiError ? err.message : 'Something went wrong.'
      );
    } finally {
      this.isSaving.set(false);
    }
  }

  cancel() {
    this.cancelled.emit();
  }

  setVisibility(v: Visibility) {
    this.visibility.set(v);
  }
}
