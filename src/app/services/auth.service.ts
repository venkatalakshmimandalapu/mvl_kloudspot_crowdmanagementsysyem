import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap, map } from 'rxjs';
import { LoginRequest, LoginResponse, Site } from '../models/auth.model';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);
  // Use absolute URL since API allows CORS
  private readonly API_BASE = 'https://hiring-dev.internal.kloudspot.com/api';
  private readonly TOKEN_KEY = 'auth_token';
  private readonly SITE_ID_KEY = 'site_id';
  private readonly USER_EMAIL_KEY = 'user_email';

  login(credentials: LoginRequest): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${this.API_BASE}/auth/login`, credentials).pipe(
      tap(response => {
        console.log('Login response:', response);
        localStorage.setItem(this.TOKEN_KEY, response.token);
        // Store the login email if user object exists, otherwise store the credentials email
        if (response.user?.email) {
          localStorage.setItem(this.USER_EMAIL_KEY, response.user.email);
        } else {
          localStorage.setItem(this.USER_EMAIL_KEY, credentials.email);
        }
      })
    );
  }

  logout(): void {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.SITE_ID_KEY);
    localStorage.removeItem(this.USER_EMAIL_KEY);
    this.router.navigate(['/login']);
  }

  getToken(): string | null {
    return localStorage.getItem(this.TOKEN_KEY);
  }

  isAuthenticated(): boolean {
    return !!this.getToken();
  }

  getSiteId(): Observable<string> {
    return this.http.get<Site[]>(`${this.API_BASE}/sites`).pipe(
      tap(sites => console.log('Sites API response:', sites)),
      map((sites) => {
        if (sites && sites.length > 0) {
          const siteId = sites[0].siteId;
          console.log('Storing site ID:', siteId);
          localStorage.setItem(this.SITE_ID_KEY, siteId);
          return siteId;
        }
        console.warn('No sites found in response');
        return '';
      })
    );
  }

  getAllSites(): Observable<Site[]> {
    return this.http.get<Site[]>(`${this.API_BASE}/sites`);
  }

  getStoredSiteId(): string | null {
    return localStorage.getItem(this.SITE_ID_KEY);
  }

  setSiteId(siteId: string): void {
    localStorage.setItem(this.SITE_ID_KEY, siteId);
  }

  getUserEmail(): string | null {
    return localStorage.getItem(this.USER_EMAIL_KEY);
  }
}
