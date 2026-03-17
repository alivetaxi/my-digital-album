import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'albums', pathMatch: 'full' },
  {
    path: 'login',
    loadComponent: () =>
      import('./features/auth/login/login.component').then(m => m.LoginComponent),
  },
  {
    path: 'albums',
    loadComponent: () =>
      import('./features/albums/album-list/album-list.component').then(m => m.AlbumListComponent),
  },
  {
    path: 'albums/:albumId',
    loadComponent: () =>
      import('./features/albums/album-detail/album-detail.component').then(m => m.AlbumDetailComponent),
  },
  {
    path: 'albums/:albumId/media/:mediaId',
    loadComponent: () =>
      import('./features/media/viewer/media-viewer.component').then(m => m.MediaViewerComponent),
  },
  { path: '**', redirectTo: 'albums' },
];
