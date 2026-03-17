import {
  Component, computed, ElementRef, HostListener,
  OnInit, signal, viewChild, inject
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Media } from '../../../core/models';
import { getMockMediaForAlbum } from '../../../core/services/mock-data';

@Component({
  selector: 'app-media-viewer',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './media-viewer.component.html',
  styleUrl: './media-viewer.component.scss',
})
export class MediaViewerComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);

  readonly albumId = signal('');
  readonly initialMediaId = signal('');
  readonly mediaList = signal<Media[]>([]);
  readonly currentIndex = signal(0);
  readonly nextCursor = signal<string | null>(null);
  readonly isPreloading = signal(false);
  readonly dragOffset = signal(0);
  private readonly isDraggingActive = signal(false);
  readonly dragTransition = computed(() =>
    this.isDraggingActive() ? 'none' : 'transform 0.25s ease-out'
  );

  readonly currentMedia = computed(() => this.mediaList()[this.currentIndex()] ?? null);

  private touchStartX = 0;
  private touchStartY = 0;
  private touchIsHorizontal = false;

  readonly stripRef = viewChild<ElementRef>('strip');

  ngOnInit() {
    this.albumId.set(this.route.snapshot.paramMap.get('albumId') ?? '');
    this.initialMediaId.set(this.route.snapshot.paramMap.get('mediaId') ?? '');

    const result = getMockMediaForAlbum(this.albumId(), 1);
    this.mediaList.set(result.items);
    this.nextCursor.set(result.nextCursor);

    const idx = result.items.findIndex(m => m.id === this.initialMediaId());
    this.currentIndex.set(idx >= 0 ? idx : 0);

    setTimeout(() => this.scrollStripToIndex(this.currentIndex()), 100);
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
    this.scrollStripToIndex(index);
    this.checkPreload(index);
  }

  private checkPreload(index: number) {
    const list = this.mediaList();
    if (this.nextCursor() && !this.isPreloading() && index >= list.length - 5) {
      this.triggerPreload();
    }
  }

  private triggerPreload() {
    if (this.isPreloading() || !this.nextCursor()) return;
    this.isPreloading.set(true);
    setTimeout(() => {
      const result = getMockMediaForAlbum(this.albumId(), 2);
      this.mediaList.update(items => [...items, ...result.items]);
      this.nextCursor.set(result.nextCursor);
      this.isPreloading.set(false);
    }, 800);
  }

  private bounceBack(dir: 'left' | 'right') {
    const offset = dir === 'left' ? 60 : -60;
    this.dragOffset.set(offset);
    setTimeout(() => this.dragOffset.set(0), 250);
  }

  private scrollStripToIndex(index: number) {
    const strip = this.stripRef()?.nativeElement as HTMLElement | undefined;
    if (!strip) return;
    const itemWidth = 68;
    const center = strip.clientWidth / 2;
    strip.scrollTo({ left: index * itemWidth - center + itemWidth / 2, behavior: 'smooth' });
  }

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
      dx < 0 ? this.goTo(this.currentIndex() + 1) : this.goTo(this.currentIndex() - 1);
    }
  }

  @HostListener('keydown', ['$event'])
  onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft') this.goTo(this.currentIndex() - 1);
    if (e.key === 'ArrowRight') this.goTo(this.currentIndex() + 1);
  }

  formatDate(d: Date | null): string {
    if (!d) return '';
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }
}
