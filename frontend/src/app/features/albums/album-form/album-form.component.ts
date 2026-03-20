import { Component, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AlbumApiError, AlbumService } from '../../../core/services/album.service';
import { Album, Group, Visibility } from '../../../core/models';
import { GroupService } from '../../../core/services/group.service';

@Component({
  selector: 'app-album-form',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './album-form.component.html',
  styleUrl: './album-form.component.scss',
})
export class AlbumFormComponent implements OnInit {
  /** When provided, the form is in edit mode. */
  readonly album = input<Album | null>(null);

  readonly saved = output<Album>();
  readonly cancelled = output<void>();

  private readonly albumService = inject(AlbumService);
  private readonly groupService = inject(GroupService);

  readonly title = signal('');
  readonly visibility = signal<Visibility>('private');
  readonly selectedGroupId = signal<string | null>(null);
  readonly groups = signal<Group[]>([]);
  readonly isSaving = signal(false);
  readonly errorMessage = signal<string | null>(null);

  async ngOnInit() {
    const a = this.album();
    if (a) {
      this.title.set(a.title);
      this.visibility.set(a.visibility);
      if (a.groupId) this.selectedGroupId.set(a.groupId);
    }
    try {
      this.groups.set(await this.groupService.listMyGroups());
    } catch { /* non-critical */ }
  }

  async save() {
    if (!this.title().trim()) return;
    if (this.visibility() === 'group' && !this.selectedGroupId()) return;
    this.isSaving.set(true);
    this.errorMessage.set(null);

    const groupId = this.visibility() === 'group' ? this.selectedGroupId() : null;

    try {
      let result: Album;
      const a = this.album();
      if (a) {
        result = await this.albumService.updateAlbum(a.id, {
          title: this.title().trim(),
          visibility: this.visibility(),
          groupId,
        });
      } else {
        result = await this.albumService.createAlbum({
          title: this.title().trim(),
          visibility: this.visibility(),
          groupId,
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
    if (v !== 'group') this.selectedGroupId.set(null);
  }
}
