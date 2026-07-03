import {
  Component, computed, ElementRef,
  HostListener, inject, OnInit, signal, viewChild,
} from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Album, Media } from '../../../core/models';
import { AlbumApiError, AlbumService } from '../../../core/services/album.service';
import { MediaPage, MediaService } from '../../../core/services/media.service';
import { AuthService } from '../../../core/auth/auth.service';

const MAX_LOCATE_PAGES = 50; // 1500 items — comfortably above any real album

/** Passed via router `state` by AlbumDetailComponent so a grid click can skip the network search entirely. */
interface NavigationMediaState {
  mediaList: Media[];
  nextCursor: string | null;
}

@Component({
  selector: 'app-media-viewer',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './media-viewer.component.html',
  styleUrl: './media-viewer.component.scss',
})
export class MediaViewerComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly mediaService = inject(MediaService);
  private readonly albumService = inject(AlbumService);
  private readonly auth = inject(AuthService);
  readonly albumId = signal('');
  readonly album = signal<Album | null>(null);
  readonly mediaList = signal<Media[]>([]);
  readonly currentIndex = signal(0);
  readonly nextCursor = signal<string | null>(null);
  readonly isLoading = signal(true);
  readonly isPreloading = signal(false);
  readonly loadError = signal(false);

  // Swipe / animation
  readonly dragOffset = signal(0);
  private readonly isDraggingActive = signal(false);
  readonly dragTransition = computed(() =>
    this.isDraggingActive() ? 'none' : 'transform 0.25s ease-out'
  );

  readonly currentMedia = computed(() => this.mediaList()[this.currentIndex()] ?? null);

  // Permissions — edit/delete visible only to uploader or album owner
  readonly canEdit = computed(() => {
    const uid = this.auth.uid();
    const m = this.currentMedia();
    const a = this.album();
    if (!uid || !m || !a) return false;
    return m.uploaderId === uid || a.ownerId === uid;
  });

  // Original URL (signed, fetched on demand; cached per media id)
  private readonly originalUrlCache = new Map<string, string>();
  readonly currentOriginalUrl = signal<string | null>(null);
  readonly isLoadingOriginal = signal(false);

  // Edit description
  readonly isEditing = signal(false);
  readonly editValue = signal('');
  readonly isSaving = signal(false);
  readonly saveError = signal<string | null>(null);

  // Delete
  readonly isDeleting = signal(false);
  readonly deleteError = signal<string | null>(null);

  // Touch tracking
  private touchStartX = 0;
  private touchStartY = 0;
  private touchIsHorizontal = false;

  readonly stripRef = viewChild<ElementRef>('strip');

  async ngOnInit() {
    this.albumId.set(this.route.snapshot.paramMap.get('albumId') ?? '');
    const initialId = this.route.snapshot.paramMap.get('mediaId') ?? '';

    try {
      const passed = this.location.getState() as NavigationMediaState | null;
      const passedIndex = passed?.mediaList?.findIndex(m => m.id === initialId) ?? -1;

      const [album, result] = await Promise.all([
        this.albumService.getAlbum(this.albumId()).catch(() => null),
        passedIndex >= 0
          ? Promise.resolve({
              items: passed!.mediaList,
              nextCursor: passed!.nextCursor,
              index: passedIndex,
            })
          : this.loadMediaAndLocate(initialId),
      ]);

      this.album.set(album);
      this.mediaList.set(result.items);
      this.nextCursor.set(result.nextCursor);
      this.currentIndex.set(result.index);
      this.isLoading.set(false);

      setTimeout(() => this.scrollStripToIndex(this.currentIndex()), 100);
      this.loadOriginalUrl(this.currentIndex());
    } catch {
      this.loadError.set(true);
      this.isLoading.set(false);
    }
  }

  /**
   * Paginates through `listMedia` until `targetId` is found or pagination is exhausted.
   * Only used as a fallback when no navigation state was passed (deep link, refresh,
   * or the target isn't in the passed list) — the album grid's infinite scroll may have
   * already loaded items past the first page by the time the user clicks one, so a
   * single page-1 fetch can miss the clicked item.
   */
  private async loadMediaAndLocate(
    targetId: string
  ): Promise<{ items: Media[]; nextCursor: string | null; index: number }> {
    let items: Media[] = [];
    let cursor: string | undefined;
    const seenIds = new Set<string>();

    for (let i = 0; i < MAX_LOCATE_PAGES; i++) {
      let page: MediaPage;
      try {
        page = await this.mediaService.listMedia(this.albumId(), 30, cursor);
      } catch (err) {
        // Nothing fetched yet — there's nothing to show, surface as a hard failure.
        if (items.length === 0) throw err;
        // Already have usable pages — degrade to a best-effort result instead of
        // discarding everything fetched so far.
        return { items, nextCursor: cursor ?? null, index: 0 };
      }

      const newItems = page.items.filter(m => !seenIds.has(m.id));
      newItems.forEach(m => seenIds.add(m.id));
      items = [...items, ...newItems];

      const idx = items.findIndex(m => m.id === targetId);
      if (idx >= 0) {
        return { items, nextCursor: page.nextCursor, index: idx };
      }
      // A page with no new items (despite a non-null cursor) means pagination made
      // no forward progress — stop instead of burning the rest of the search budget.
      if (page.nextCursor === null || newItems.length === 0) {
        return { items, nextCursor: page.nextCursor, index: 0 };
      }
      cursor = page.nextCursor;
    }

    return { items, nextCursor: cursor ?? null, index: 0 };
  }

  private async loadOriginalUrl(index: number) {
    const media = this.mediaList()[index];
    if (!media) return;

    if (this.originalUrlCache.has(media.id)) {
      this.currentOriginalUrl.set(this.originalUrlCache.get(media.id)!);
      return;
    }

    this.isLoadingOriginal.set(true);
    try {
      const url = await this.mediaService.getOriginalUrl(this.albumId(), media.id);
      this.originalUrlCache.set(media.id, url);
      // Only apply if the user hasn't navigated away
      if (this.currentMedia()?.id === media.id) {
        this.currentOriginalUrl.set(url);
      }
    } catch {
      // Fall back silently — photos will render via thumbnailUrl
    } finally {
      this.isLoadingOriginal.set(false);
    }
  }

  goTo(index: number) {
    if (index < 0) {
      this.bounceBack('left');
      return;
    }
    const list = this.mediaList();
    if (index >= list.length) {
      if (this.nextCursor() !== null || this.isPreloading()) {
        this.triggerPreload();
        return;
      }
      this.bounceBack('right');
      return;
    }
    this.currentIndex.set(index);
    this.currentOriginalUrl.set(null);
    this.isEditing.set(false);
    this.deleteError.set(null);
    this.scrollStripToIndex(index);
    this.checkPreload(index);
    this.loadOriginalUrl(index);
  }

  private checkPreload(index: number) {
    const list = this.mediaList();
    if (this.nextCursor() && !this.isPreloading() && index >= list.length - 5) {
      this.triggerPreload();
    }
  }

  private async triggerPreload() {
    if (this.isPreloading() || !this.nextCursor()) return;
    this.isPreloading.set(true);
    try {
      const page = await this.mediaService.listMedia(
        this.albumId(), 30, this.nextCursor()!
      );
      this.mediaList.update(items => [...items, ...page.items]);
      this.nextCursor.set(page.nextCursor);
    } catch {
      // Non-blocking; strip will just not extend
    } finally {
      this.isPreloading.set(false);
    }
  }

  private bounceBack(dir: 'left' | 'right') {
    const offset = dir === 'left' ? 60 : -60;
    this.dragOffset.set(offset);
    setTimeout(() => this.dragOffset.set(0), 250);
  }

  private scrollStripToIndex(index: number) {
    const strip = this.stripRef()?.nativeElement as HTMLElement | undefined;
    if (!strip) return;
    const itemWidth = 68; // thumb 64px + 4px gap
    const center = strip.clientWidth / 2;
    strip.scrollTo({ left: index * itemWidth - center + itemWidth / 2, behavior: 'smooth' });
  }

  // ---------------------------------------------------------------------------
  // Edit description
  // ---------------------------------------------------------------------------

  startEdit() {
    this.editValue.set(this.currentMedia()?.description ?? '');
    this.saveError.set(null);
    this.isEditing.set(true);
  }

  cancelEdit() {
    this.isEditing.set(false);
    this.saveError.set(null);
  }

  /** iOS Safari doesn't restore viewport zoom after keyboard dismissal. Force-reset it. */
  resetViewportZoom() {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!meta) return;
    const orig = meta.content;
    meta.content = 'width=device-width, initial-scale=1, maximum-scale=1';
    requestAnimationFrame(() => { meta.content = orig; });
  }

  async saveDescription() {
    const media = this.currentMedia();
    if (!media) return;
    this.isSaving.set(true);
    this.saveError.set(null);
    try {
      const updated = await this.mediaService.updateMedia(
        this.albumId(), media.id, { description: this.editValue().trim() || null }
      );
      this.mediaList.update(list => list.map(m => m.id === updated.id ? updated : m));
      this.isEditing.set(false);
    } catch (err) {
      this.saveError.set(
        err instanceof AlbumApiError ? err.api.message : 'Failed to save description.'
      );
    } finally {
      this.isSaving.set(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Delete media
  // ---------------------------------------------------------------------------

  async deleteMedia() {
    const media = this.currentMedia();
    if (!media) return;
    if (!confirm('Delete this item? This cannot be undone.')) return;

    this.isDeleting.set(true);
    this.deleteError.set(null);
    try {
      await this.mediaService.deleteMedia(this.albumId(), media.id);

      const newList = this.mediaList().filter(m => m.id !== media.id);
      if (newList.length === 0) {
        this.router.navigate(['/albums', this.albumId()]);
        return;
      }
      const nextIdx = Math.min(this.currentIndex(), newList.length - 1);
      this.mediaList.set(newList);
      this.currentIndex.set(nextIdx);
      this.currentOriginalUrl.set(null);
      this.loadOriginalUrl(nextIdx);
    } catch (err) {
      this.deleteError.set(
        err instanceof AlbumApiError ? err.api.message : 'Failed to delete item.'
      );
    } finally {
      this.isDeleting.set(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Touch / keyboard navigation
  // ---------------------------------------------------------------------------

  @HostListener('touchstart', ['$event'])
  onTouchStart(e: TouchEvent) {
    this.touchStartX = e.touches[0].clientX;
    this.touchStartY = e.touches[0].clientY;
    this.touchIsHorizontal = false;
    this.isDraggingActive.set(true);
  }

  @HostListener('touchmove', ['$event'])
  onTouchMove(e: TouchEvent) {
    if (!this.isDraggingActive()) return;
    const dx = e.touches[0].clientX - this.touchStartX;
    const dy = e.touches[0].clientY - this.touchStartY;
    if (!this.touchIsHorizontal && Math.abs(dy) > Math.abs(dx)) {
      this.isDraggingActive.set(false);
      this.dragOffset.set(0);
      return;
    }
    this.touchIsHorizontal = true;
    e.preventDefault();
    this.dragOffset.set(dx);
  }

  @HostListener('touchend', ['$event'])
  onTouchEnd(e: TouchEvent) {
    if (!this.isDraggingActive()) return;
    this.isDraggingActive.set(false);
    const dx = e.changedTouches[0].clientX - this.touchStartX;
    this.dragOffset.set(0);
    if (Math.abs(dx) > 50) {
      if (dx < 0) {
        this.goTo(this.currentIndex() + 1);
      } else {
        this.goTo(this.currentIndex() - 1);
      }
    }
  }

  @HostListener('keydown', ['$event'])
  onKeyDown(e: KeyboardEvent) {
    if (this.isEditing()) return; // don't navigate while editing
    if (e.key === 'ArrowLeft') this.goTo(this.currentIndex() - 1);
    if (e.key === 'ArrowRight') this.goTo(this.currentIndex() + 1);
    if (e.key === 'Escape') this.cancelEdit();
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  formatDate(d: Date | null): string {
    if (!d) return '';
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }
}
