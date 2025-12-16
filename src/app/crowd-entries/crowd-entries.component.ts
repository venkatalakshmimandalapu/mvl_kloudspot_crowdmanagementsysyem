import { Component, OnInit, OnDestroy, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AnalyticsService } from '../services/analytics.service';
import { AuthService } from '../services/auth.service';
import { SocketService, AlertEvent } from '../services/socket.service';
import { EntryExitRecord } from '../models/analytics.model';
import { Site } from '../models/auth.model';
import { format, parseISO } from 'date-fns';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-crowd-entries',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './crowd-entries.component.html',
  styleUrl: './crowd-entries.component.css'
})
export class CrowdEntriesComponent implements OnInit, OnDestroy {
  private analyticsService = inject(AnalyticsService);
  private authService = inject(AuthService);
  private socketService = inject(SocketService);
  private subscriptions = new Subscription();

  records = signal<EntryExitRecord[]>([]);
  currentPage = signal(1);
  pageSize = signal(10);
  totalRecords = signal(0);
  totalPages = signal(0);
  isLoading = signal(false);

  // Alerts
  alerts = signal<Array<AlertEvent & { id: string; dismissed?: boolean }>>([]);
  showAlertsPanel = signal(false);
  
  // User
  userEmail = signal<string>('');

  // Sites
  sites = signal<Array<{ siteId: string; name: string }>>([]);
  selectedSite = signal<{ siteId: string; name: string } | null>(null);
  showSiteDropdown = signal(false);
  private documentClickHandler = this.handleDocumentClick.bind(this);
  
  // Zone mapping: zoneId -> zoneName
  private zoneMap = new Map<string, string>();

  ngOnInit(): void {
    // Add click listener to close dropdown when clicking outside
    document.addEventListener('click', this.documentClickHandler);
    
    // Get user email
    const email = this.authService.getUserEmail();
    if (email) {
      this.userEmail.set(email);
    }
    
    // Load all sites first
    this.authService.getAllSites().subscribe({
      next: (sites) => {
        if (sites && sites.length > 0) {
          // Store all sites
          this.sites.set(sites.map(s => ({ siteId: s.siteId, name: s.name })));
          
          // Build zone mapping from all sites
          this.zoneMap.clear();
          sites.forEach(site => {
            if (site.zones && Array.isArray(site.zones)) {
              site.zones.forEach(zone => {
                this.zoneMap.set(zone.zoneId, zone.name);
              });
            }
          });
          console.log('Zone map initialized:', this.zoneMap);
          
          // Get stored site ID or use first site
          const storedSiteId = this.authService.getStoredSiteId();
          const siteToUse = storedSiteId 
            ? sites.find(s => s.siteId === storedSiteId) || sites[0]
            : sites[0];
          
          // Set selected site
          this.selectedSite.set({ siteId: siteToUse.siteId, name: siteToUse.name });
          this.authService.setSiteId(siteToUse.siteId);
          
          // Load entries with the selected site
          this.loadEntries();
          this.setupSocketListeners();
        } else {
          console.error('No sites available');
        }
      },
      error: (error) => {
        console.error('Error fetching sites:', error);
      }
    });
  }

  ngOnDestroy(): void {
    document.removeEventListener('click', this.documentClickHandler);
    this.subscriptions.unsubscribe();
  }

  onSiteChange(site: { siteId: string; name: string }): void {
    this.selectedSite.set(site);
    this.authService.setSiteId(site.siteId);
    this.showSiteDropdown.set(false);
    // Reload entries with new site ID
    this.loadEntries();
  }

  toggleSiteDropdown(): void {
    this.showSiteDropdown.update(value => !value);
  }

  private handleDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.site-dropdown-container')) {
      this.showSiteDropdown.set(false);
    }
  }

  private setupSocketListeners(): void {
    this.socketService.connect();

    // Listen for alerts
    const alertSub = this.socketService.onAlert().subscribe((event: AlertEvent) => {
      console.log('Alert received:', event);
      // Ensure timestamp is valid, use current time if missing or invalid
      let timestamp = event.timestamp;
      if (!timestamp || isNaN(new Date(timestamp).getTime())) {
        timestamp = new Date().toISOString();
      }
      
      // Map zone ID to zone name if zone is provided
      let zoneName = event.zone;
      if (zoneName && this.zoneMap.has(zoneName)) {
        // If zone is a zoneId, map it to zone name
        zoneName = this.zoneMap.get(zoneName)!;
      } else if (!zoneName || zoneName.trim() === '') {
        // If zone is empty or missing, set to null so template shows "Unknown Zone"
        zoneName = '';
      }
      // If zoneName exists but not in map, it might already be a name, so keep it
      
      const alertWithId = {
        ...event,
        zone: zoneName,
        timestamp: timestamp,
        id: `${Date.now()}-${Math.random()}`
      };
      this.alerts.update(alerts => [alertWithId, ...alerts]);
    });
    this.subscriptions.add(alertSub);
  }

  dismissAlert(alertId: string): void {
    this.alerts.update(alerts => alerts.filter(alert => alert.id !== alertId));
  }

  dismissAllAlerts(): void {
    this.alerts.set([]);
  }

  toggleAlertsPanel(): void {
    this.showAlertsPanel.update(value => !value);
  }

  getUnreadAlertCount(): number {
    return this.alerts().filter(alert => !alert.dismissed).length;
  }
  
  getUserInitials(): string {
    const email = this.userEmail();
    if (!email) return '?';
    
    // Extract name from email (before @)
    const namePart = email.split('@')[0];
    
    // Split by dots, underscores, or capitalize letters
    const parts = namePart.split(/[._-]/);
    
    if (parts.length >= 2) {
      // Take first letter of first two parts
      return (parts[0][0] + parts[1][0]).toUpperCase();
    } else {
      // Take first two letters
      return namePart.substring(0, 2).toUpperCase();
    }
  }

  getSeverityColor(severity: 'low' | 'medium' | 'high'): string {
    switch (severity) {
      case 'high':
        return 'bg-red-100 text-red-800 border-red-300';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'low':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  }

  getSeverityIcon(severity: 'low' | 'medium' | 'high'): string {
    switch (severity) {
      case 'high':
        return 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z';
      case 'medium':
        return 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z';
      case 'low':
        return 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z';
      default:
        return 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z';
    }
  }

  formatAlertTime(timestamp: string): string {
    try {
      if (!timestamp) {
        // Use current time as fallback instead of "Unknown time"
        const now = new Date();
        const hours = now.getHours();
        const minutes = now.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours % 12 || 12;
        const displayMinutes = minutes.toString().padStart(2, '0');
        return `Today, ${displayHours}:${displayMinutes} ${ampm}`;
      }

      // Try to parse the timestamp - handle different formats
      let date: Date;
      
      // Check if it's a Unix timestamp (number as string)
      if (/^\d+$/.test(timestamp)) {
        date = new Date(parseInt(timestamp));
      } else {
        date = new Date(timestamp);
      }

      // Check if date is valid
      if (isNaN(date.getTime())) {
        console.warn('Invalid timestamp:', timestamp);
        // Try to use current time as fallback
        date = new Date();
      }

      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const alertDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      
      // Format time as "10:00 AM"
      const hours = date.getHours();
      const minutes = date.getMinutes();
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours % 12 || 12;
      const displayMinutes = minutes.toString().padStart(2, '0');
      const timeString = `${displayHours}:${displayMinutes} ${ampm}`;
      
      // Check if it's today
      if (alertDate.getTime() === today.getTime()) {
        return `Today, ${timeString}`;
      }
      
      // Check if it's yesterday
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      if (alertDate.getTime() === yesterday.getTime()) {
        return `Yesterday, ${timeString}`;
      }
      
      // Otherwise show date
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + timeString;
    } catch (error) {
      console.error('Error formatting alert time:', error, timestamp);
      // Return current time as fallback
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours % 12 || 12;
      const displayMinutes = minutes.toString().padStart(2, '0');
      return `Today, ${displayHours}:${displayMinutes} ${ampm}`;
    }
  }

  showAlertInfo(alert: AlertEvent & { id: string; dismissed?: boolean }): void {
    // Mark alert as dismissed (seen/read)
    const alertList = this.alerts();
    const updatedAlerts = alertList.map(a => 
      a.id === alert.id ? { ...a, dismissed: true } : a
    );
    this.alerts.set(updatedAlerts);
    
    // Log alert info (can add modal later if needed)
    console.log('Alert info:', alert);
  }

  loadEntries(): void {
    this.isLoading.set(true);
    const siteId = this.authService.getStoredSiteId();

    this.analyticsService.getEntryExitRecords({
      pageNumber: this.currentPage(),
      pageSize: this.pageSize(),
      siteId: siteId || undefined
    }).subscribe({
      next: (response) => {
        console.log('Entry Exit API Response:', response);
        if (response && response.records) {
          this.records.set(response.records || []);
          // Handle pagination from root level (actual API structure)
          this.totalRecords.set(response.totalRecords || 0);
          this.totalPages.set(response.totalPages || 0);
        } else {
          console.warn('Unexpected API response structure:', response);
          this.records.set([]);
          this.totalRecords.set(0);
          this.totalPages.set(0);
        }
        this.isLoading.set(false);
      },
      error: (error) => {
        console.error('Error loading entries:', error);
        console.error('Error details:', error.error);
        this.records.set([]);
        this.totalRecords.set(0);
        this.totalPages.set(0);
        this.isLoading.set(false);
      }
    });
  }

  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages()) {
      this.currentPage.set(page);
      this.loadEntries();
    }
  }

  previousPage(): void {
    if (this.currentPage() > 1) {
      this.goToPage(this.currentPage() - 1);
    }
  }

  nextPage(): void {
    if (this.currentPage() < this.totalPages()) {
      this.goToPage(this.currentPage() + 1);
    }
  }

  formatTime(utcTimestamp: number | null | undefined, localTime?: string | null): string {
    if (utcTimestamp === null || utcTimestamp === undefined) {
      return '--';
    }
    try {
      // Use UTC timestamp (epoch milliseconds)
      const date = new Date(utcTimestamp);
      return format(date, 'h:mm a');
    } catch {
      // Fallback to local time string if provided
      if (localTime) {
        try {
          // Extract time from "14/12/2025 16:57:20" format
          const timeMatch = localTime.match(/(\d{2}:\d{2}:\d{2})/);
          if (timeMatch) {
            const [hours, minutes] = timeMatch[1].split(':');
            const hour12 = parseInt(hours) % 12 || 12;
            const ampm = parseInt(hours) >= 12 ? 'PM' : 'AM';
            return `${hour12}:${minutes} ${ampm}`;
          }
        } catch {
          return localTime;
        }
      }
      return '--';
    }
  }

  formatDwellTime(minutes: number | null | undefined, exitUtc: number | null = null): string {
    // If there's no exit time, show "--"
    if (!exitUtc || minutes === null || minutes === undefined || minutes === 0) {
      return '--';
    }
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  }

  getInitials(name: string | null | undefined): string {
    if (!name) {
      return '??';
    }
    const parts = name.split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

  isString(value: any): boolean {
    return typeof value === 'string';
  }

  goToPageIfNumber(pageNum: number | string): void {
    if (typeof pageNum === 'number') {
      this.goToPage(pageNum);
    }
  }

  getGenderBadgeClass(gender: string): string {
    return gender === 'male' 
      ? 'bg-blue-100 text-blue-800' 
      : 'bg-pink-100 text-pink-800';
  }

  logout(): void {
    this.authService.logout();
  }

  // Expose Math to template
  Math = Math;

  getPageNumbers(): (number | string)[] {
    const total = this.totalPages();
    const current = this.currentPage();
    const pages: (number | string)[] = [];

    if (total <= 7) {
      // Show all pages if 7 or fewer
      for (let i = 1; i <= total; i++) {
        pages.push(i);
      }
    } else {
      // Show first page
      pages.push(1);

      if (current > 3) {
        pages.push('...');
      }

      // Show pages around current
      const start = Math.max(2, current - 1);
      const end = Math.min(total - 1, current + 1);

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }

      if (current < total - 2) {
        pages.push('...');
      }

      // Show last page
      pages.push(total);
    }

    return pages;
  }
}




