import { Component, computed, ElementRef, OnInit, signal, viewChild, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Media } from '../../../core/models';
import { MOCK_ALBUMS, getMockMediaForAlbum } from '../../../core/services/mock-data';

@Component({
  selector: 'app-album-detail',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './album-detail.component.html',
  styleUrl: './album-detail.component.scss',
})
export class AlbumDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);

  readonly albumId = signal('');
  readonly album = computed(() => MOCK_ALBUMS.find(a => a.id === this.albumId()) ?? null);
  readonly mediaItems = signal<Media[]>([]);
  readonly isLoading = signal(false);
  readonly nextCursor = signal<string | null>(null);
  readonly loadError = signal(false);
  readonly currentPage = signal(1);

  readonly sentinel = viewChild<ElementRef>('sentinel');

  private observer: IntersectionObserver | null = null;

  ngOnInit() {
    this.albumId.set(this.route.snapshot.paramMap.get('albumId') ?? '');
    this.loadPage(1);

    // Set up intersection observer after initial load
    setTimeout(() => this.setupObserver(), 100);
  }

  private loadPage(page: number) {
    this.isLoading.set(true);
    this.loadError.set(false);

    // Simulate async load with 800ms delay
    setTimeout(() => {
      const result = getMockMediaForAlbum(this.albumId(), page);
      this.mediaItems.update(items => [...items, ...result.items]);
      this.nextCursor.set(result.nextCursor);
      this.currentPage.set(page);
      this.isLoading.set(false);
    }, page === 1 ? 0 : 1200);
  }

  loadMore() {
    if (this.isLoading() || this.nextCursor() === null) return;
    this.loadPage(this.currentPage() + 1);
  }

  retryLoad() {
    this.loadPage(this.currentPage() + 1);
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

  trackById(_: number, media: Media) {
    return media.id;
  }

  get skeletonArray() {
    return new Array(5);
  }
}
