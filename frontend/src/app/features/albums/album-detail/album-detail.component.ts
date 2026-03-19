import { Component, ElementRef, OnDestroy, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Album, Media } from '../../../core/models';
import { AlbumService } from '../../../core/services/album.service';
import { AuthService } from '../../../core/auth/auth.service';
import { MediaService } from '../../../core/services/media.service';
import { UploadComponent } from '../../media/upload/upload.component';
import { AlbumFormComponent } from '../album-form/album-form.component';

@Component({
  selector: 'app-album-detail',
  standalone: true,
  imports: [RouterLink, UploadComponent, AlbumFormComponent],
  templateUrl: './album-detail.component.html',
  styleUrl: './album-detail.component.scss',
})
export class AlbumDetailComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly albumService = inject(AlbumService);
  private readonly mediaService = inject(MediaService);
  private readonly auth = inject(AuthService);

  readonly isAuthenticated = computed(() => this.auth.uid() !== null);

  readonly isOwner = computed(() => {
    const album = this.album();
    return album !== null && album.ownerId === this.auth.uid();
  });

  readonly albumId = signal('');
  readonly album = signal<Album | null>(null);
  readonly mediaItems = signal<Media[]>([]);
  readonly isLoading = signal(false);
  readonly nextCursor = signal<string | null>(null);
  readonly loadError = signal(false);
  readonly showUpload = signal(false);
  readonly showEditForm = signal(false);

  readonly sentinel = viewChild<ElementRef>('sentinel');

  private observer: IntersectionObserver | null = null;
  /** Map of mediaId → unsubscribe fn for Firestore thumbnail watchers */
  private watchers = new Map<string, () => void>();

  async ngOnInit() {
    this.albumId.set(this.route.snapshot.paramMap.get('albumId') ?? '');
    await this.loadAlbum();
    await this.loadMedia();
    setTimeout(() => this.setupObserver(), 100);
  }

  ngOnDestroy() {
    this.observer?.disconnect();
    this.watchers.forEach(unsub => unsub());
    this.watchers.clear();
  }

  private async loadAlbum() {
    try {
      const album = await this.albumService.getAlbum(this.albumId());
      this.album.set(album);
    } catch {
      // ignore — album header missing is non-fatal; grid still loads
    }
  }

  private async loadMedia(after?: string) {
    this.isLoading.set(true);
    this.loadError.set(false);
    try {
      const page = await this.mediaService.listMedia(this.albumId(), 30, after);
      this.mediaItems.update(items => [...items, ...page.items]);
      this.nextCursor.set(page.nextCursor);
      // Watch thumbnail status for any pending items
      for (const m of page.items) {
        if (m.thumbnailStatus === 'pending') {
          this.watchItem(m);
        }
      }
    } catch {
      this.loadError.set(true);
    } finally {
      this.isLoading.set(false);
    }
  }

  private watchItem(media: Media) {
    if (this.watchers.has(media.id)) return;
    const unsub = this.mediaService.watchThumbnailStatus(
      this.albumId(),
      media.id,
      (status, thumbnailPath) => {
        this.mediaItems.update(list =>
          list.map(m =>
            m.id === media.id
              ? {
                  ...m,
                  thumbnailStatus: status,
                  thumbnailPath,
                  thumbnailUrl: this.mediaService.thumbnailUrl(thumbnailPath),
                }
              : m
          )
        );
        if (status !== 'pending') {
          this.watchers.get(media.id)?.();
          this.watchers.delete(media.id);
        }
      }
    );
    this.watchers.set(media.id, unsub);
  }

  loadMore() {
    if (this.isLoading() || this.nextCursor() === null) return;
    this.loadMedia(this.nextCursor()!);
  }

  retryLoad() {
    this.loadMedia(this.nextCursor() ?? undefined);
  }

  onUploadDone() {
    this.showUpload.set(false);
    // Reload from scratch to pick up newly uploaded items
    this.mediaItems.set([]);
    this.nextCursor.set(null);
    this.loadMedia();
    // Refresh album header (mediaCount changed server-side after thumbnail processing)
    this.loadAlbum();
  }

  private setupObserver() {
    const sentinelEl = this.sentinel()?.nativeElement;
    if (!sentinelEl) return;

    this.observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && !this.isLoading() && this.nextCursor() !== null) {
        this.loadMore();
      }
    }, { rootMargin: '200px' });

    this.observer.observe(sentinelEl);
  }

  onEditSaved(updated: Album) {
    this.album.set(updated);
    this.showEditForm.set(false);
  }

  async setCoverMedia(mediaId: string) {
    const albumId = this.albumId();
    const updated = await this.albumService.updateAlbum(albumId, { coverMediaId: mediaId });
    this.album.set(updated);
  }

  trackById(_: number, media: Media) {
    return media.id;
  }

  get skeletonArray() {
    return new Array(5);
  }
}
