import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { AppComponent } from './app.component';
import { BottomNavComponent } from './shared/components/bottom-nav/bottom-nav.component';

describe('AppComponent', () => {
  let routerEvents$: Subject<NavigationEnd>;

  function createComponent(initialUrl = '/') {
    routerEvents$ = new Subject<NavigationEnd>();
    const routerStub = {
      url: initialUrl,
      events: routerEvents$.asObservable(),
    };

    TestBed.configureTestingModule({
      imports: [AppComponent],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [{ provide: Router, useValue: routerStub }],
    });

    // Remove child components that pull in heavy dependencies (Router internals,
    // Firebase, etc.) so this spec stays focused on AppComponent logic only.
    TestBed.overrideComponent(AppComponent, {
      remove: { imports: [RouterOutlet, BottomNavComponent] },
    });

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance };
  }

  describe('showNav', () => {
    it('is true for a regular page URL', () => {
      const { component } = createComponent('/albums');
      expect(component.showNav()).toBeTrue();
    });

    it('is false when the initial URL is /login', () => {
      const { component } = createComponent('/login');
      expect(component.showNav()).toBeFalse();
    });

    it('is false when the initial URL contains /media/', () => {
      const { component } = createComponent('/albums/a1/media/m1');
      expect(component.showNav()).toBeFalse();
    });

    it('updates to false when NavigationEnd fires for /login', () => {
      const { component, fixture } = createComponent('/albums');
      expect(component.showNav()).toBeTrue();

      routerEvents$.next(new NavigationEnd(1, '/login', '/login'));
      fixture.detectChanges();

      expect(component.showNav()).toBeFalse();
    });

    it('updates to true when navigating away from /login', () => {
      const { component, fixture } = createComponent('/login');
      expect(component.showNav()).toBeFalse();

      routerEvents$.next(new NavigationEnd(2, '/albums', '/albums'));
      fixture.detectChanges();

      expect(component.showNav()).toBeTrue();
    });

    it('updates to false when navigating into a media viewer', () => {
      const { component, fixture } = createComponent('/albums');

      routerEvents$.next(new NavigationEnd(3, '/albums/a1/media/m1', '/albums/a1/media/m1'));
      fixture.detectChanges();

      expect(component.showNav()).toBeFalse();
    });
  });
});
