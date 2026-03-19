import { Component, inject, signal, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Album } from '../../../core/models';
import { AlbumApiError, AlbumService } from '../../../core/services/album.service';
import { AuthService } from '../../../core/auth/auth.service';
import { AlbumFormComponent } from '../album-form/album-form.component';

@Component({
  selector: 'app-album-list',
  standalone: true,
  imports: [RouterLink, AlbumFormComponent],
  templateUrl: './album-list.component.html',
  styleUrl: './album-list.component.scss',
})
export class AlbumListComponent implements OnInit {
  private readonly albumService = inject(AlbumService);
  readonly isAuthenticated = inject(AuthService).isAuthenticated;

  readonly myAlbums = signal<Album[]>([]);
  readonly sharedWithMe = signal<Album[]>([]);
  readonly publicAlbums = signal<Album[]>([]);
  readonly isLoading = signal(true);
  readonly loadError = signal(false);

  readonly showForm = signal(false);
  readonly editingAlbum = signal<Album | null>(null);
  readonly deleteError = signal<string | null>(null);

  async ngOnInit() {
    await this.loadAlbums();
  }

  private async loadAlbums() {
    this.isLoading.set(true);
    this.loadError.set(false);
    try {
      const data = await this.albumService.listAlbums();
      this.myAlbums.set(data.mine);
      this.sharedWithMe.set(data.shared);
      this.publicAlbums.set(data.public);
    } catch {
      this.loadError.set(true);
    } finally {
      this.isLoading.set(false);
    }
  }

  openCreateForm() {
    this.editingAlbum.set(null);
    this.showForm.set(true);
  }

  openEditForm(album: Album) {
    this.editingAlbum.set(album);
    this.showForm.set(true);
  }

  onSaved(album: Album) {
    this.showForm.set(false);
    const editing = this.editingAlbum();
    if (editing) {
      this.myAlbums.update(list => list.map(a => (a.id === album.id ? album : a)));
    } else {
      this.myAlbums.update(list => [album, ...list]);
    }
    this.editingAlbum.set(null);
  }

  onFormCancelled() {
    this.showForm.set(false);
    this.editingAlbum.set(null);
  }

  async deleteAlbum(album: Album) {
    this.deleteError.set(null);
    if (!confirm(`Delete "${album.title}"? This cannot be undone.`)) return;
    try {
      await this.albumService.deleteAlbum(album.id);
      this.myAlbums.update(list => list.filter(a => a.id !== album.id));
    } catch (err) {
      if (err instanceof AlbumApiError) {
        this.deleteError.set(err.api.message);
      }
    }
  }

  trackById(_: number, album: Album) {
    return album.id;
  }
}
