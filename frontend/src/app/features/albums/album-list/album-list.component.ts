import { Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Album } from '../../../core/models';
import { MOCK_ALBUMS, MOCK_CURRENT_USER } from '../../../core/services/mock-data';

@Component({
  selector: 'app-album-list',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './album-list.component.html',
  styleUrl: './album-list.component.scss',
})
export class AlbumListComponent {
  readonly currentUser = signal(MOCK_CURRENT_USER);

  readonly myAlbums = computed(() =>
    MOCK_ALBUMS.filter(a => a.ownerId === this.currentUser().uid)
  );

  readonly sharedWithMe = computed(() =>
    MOCK_ALBUMS.filter(a =>
      a.ownerId !== this.currentUser().uid &&
      a.visibility === 'group' &&
      a.groupId !== null &&
      this.currentUser().groupIds.includes(a.groupId)
    )
  );

  readonly publicAlbums = computed(() =>
    MOCK_ALBUMS.filter(a =>
      a.ownerId !== this.currentUser().uid &&
      a.visibility === 'public'
    )
  );

  trackById(_: number, album: Album) {
    return album.id;
  }
}
