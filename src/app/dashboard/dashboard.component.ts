import { Component, OnInit, OnDestroy, signal, inject, ChangeDetectorRef, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ChartConfiguration, ChartOptions } from 'chart.js';
import { BaseChartDirective } from 'ng2-charts';
import { AnalyticsService } from '../services/analytics.service';
import { SocketService, LiveOccupancyEvent, AlertEvent } from '../services/socket.service';
import { AuthService } from '../services/auth.service';
import { Site } from '../models/auth.model';
import { Subscription, forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, BaseChartDirective],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css'
})
export class DashboardComponent implements OnInit, OnDestroy, AfterViewInit {
  private analyticsService = inject(AnalyticsService);
  private socketService = inject(SocketService);
  private authService = inject(AuthService);
  private cdr = inject(ChangeDetectorRef);
  private subscriptions = new Subscription();
  private documentClickHandler = this.handleDocumentClick.bind(this);

  @ViewChild('occupancyChart') occupancyChart?: BaseChartDirective;
  @ViewChild('demographicsChart') demographicsChart?: BaseChartDirective;
  @ViewChild('demographicsDoughnutChart') demographicsDoughnutChart?: BaseChartDirective;

  // Metrics
  liveOccupancy = signal(0);
  todayFootfall = signal(0);
  averageDwellTime = signal(0);
  dwellTimeUnit = signal('minutes');
  
  // Comparisons
  occupancyComparison = signal<{ change: number; changePercent: number } | null>(null);
  footfallComparison = signal<{ change: number; changePercent: number } | null>(null);
  dwellTimeComparison = signal<{ change: number; changePercent: number } | null>(null);

  // Demographics
  currentDemographics = signal({ male: 0, female: 0 });

  // Alerts
  alerts = signal<Array<AlertEvent & { id: string; dismissed?: boolean }>>([]);
  showAlertsPanel = signal(false);
  
  // User
  userEmail = signal<string>('');

  // Sites
  sites = signal<Array<{ siteId: string; name: string }>>([]);
  selectedSite = signal<{ siteId: string; name: string } | null>(null);
  showSiteDropdown = signal(false);
  
  // Zone mapping: zoneId -> zoneName
  private zoneMap = new Map<string, string>();
  
  // Date filter
  dateFilter = signal<'today' | 'yesterday' | 'week' | 'month'>('today');

  // Chart data - using signals for reactivity
  occupancyChartData = signal<ChartConfiguration<'line'>['data']>({
    labels: [],
    datasets: [{
      label: 'Occupancy',
      data: [],
      borderColor: 'rgb(20, 184, 166)', // Teal-500
      backgroundColor: 'rgba(20, 184, 166, 0.2)', // Light teal fill
      tension: 0.4,
      fill: true,
      pointRadius: 0,
      pointHoverRadius: 4,
      borderWidth: 2
    }]
  });

  demographicsChartData = signal<ChartConfiguration<'line'>['data']>({
    labels: [],
    datasets: [
      {
        label: 'Male',
        data: [],
        borderColor: 'rgb(20, 184, 166)', // Teal-500 (darker)
        backgroundColor: 'rgba(20, 184, 166, 0.6)', // Darker teal fill
        tension: 0.4,
        fill: true,
        pointRadius: 0,
        pointHoverRadius: 4,
        borderWidth: 0
      },
      {
        label: 'Female',
        data: [],
        borderColor: 'rgb(153, 246, 228)', // Teal-200 (lighter)
        backgroundColor: 'rgba(153, 246, 228, 0.6)', // Lighter teal fill
        tension: 0.4,
        fill: true,
        pointRadius: 0,
        pointHoverRadius: 4,
        borderWidth: 0
      }
    ]
  });

  demographicsDoughnutChartData = signal<ChartConfiguration<'doughnut'>['data']>({
    labels: ['Male', 'Female'],
    datasets: [{
      data: [0, 0],
      backgroundColor: ['rgb(20, 184, 166)', 'rgba(153, 246, 228, 0.8)'], // Teal colors
      borderWidth: 0
    }]
  });

  occupancyChartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false
      },
      tooltip: {
        mode: 'index',
        intersect: false,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        padding: 12,
        titleColor: '#fff',
        bodyColor: '#fff',
        borderColor: 'rgb(20, 184, 166)',
        borderWidth: 1
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        max: 120,
        ticks: {
          stepSize: 30,
          precision: 0,
          color: '#6B7280',
          font: {
            size: 12
          }
        },
        grid: {
          color: 'rgba(0, 0, 0, 0.05)'
        }
      },
      x: {
        ticks: {
          color: '#6B7280',
          font: {
            size: 11
          }
        },
        grid: {
          display: false
        }
      }
    }
  };

  demographicsChartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false
      },
      tooltip: {
        mode: 'index',
        intersect: false,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        padding: 12,
        titleColor: '#fff',
        bodyColor: '#fff',
        borderColor: 'rgb(20, 184, 166)',
        borderWidth: 1
      }
    },
    scales: {
      y: {
        beginAtZero: false,
        min: 60,
        max: 120,
        ticks: {
          stepSize: 30,
          precision: 0,
          color: '#6B7280',
          font: {
            size: 12
          }
        },
        grid: {
          color: 'rgba(0, 0, 0, 0.05)'
        }
      },
      x: {
        ticks: {
          color: '#6B7280',
          font: {
            size: 11
          }
        },
        grid: {
          display: false
        }
      }
    }
  };

  demographicsDoughnutChartOptions: ChartOptions<'doughnut'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            const label = context.label || '';
            const value = context.parsed || 0;
            const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0);
            const percentage = total > 0 ? ((value / total) * 100).toFixed(0) : 0;
            return `${label}: ${percentage}%`;
          }
        }
      }
    }
  };

  isLoading = signal(true);

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
          let totalZonesFound = 0;
          sites.forEach(site => {
            console.log('Processing site:', site.siteId, site.name);
            if (site.zones && Array.isArray(site.zones)) {
              console.log('  Site has', site.zones.length, 'zones');
              site.zones.forEach(zone => {
                if (zone && zone.zoneId && zone.name) {
                  this.zoneMap.set(zone.zoneId, zone.name);
                  totalZonesFound++;
                  console.log('  ✓ Added zone mapping:', zone.zoneId, '->', zone.name);
                } else {
                  console.warn('  ⚠ Invalid zone object:', zone);
                }
              });
            } else {
              console.warn('  ⚠ Site has no zones array:', site.siteId, site.name, 'zones:', site.zones);
            }
          });
          console.log('✅ Zone map initialized with', this.zoneMap.size, 'zones from', sites.length, 'sites');
          if (this.zoneMap.size > 0) {
            console.log('Zone map entries:', Array.from(this.zoneMap.entries()));
          } else {
            console.error('❌ WARNING: Zone map is empty! This will cause "Unknown Zone" to appear in alerts.');
            console.error('Check if sites API response includes zones array with zoneId and name properties.');
          }
          
          // Get stored site ID or use first site
          const storedSiteId = this.authService.getStoredSiteId();
          const siteToUse = storedSiteId 
            ? sites.find(s => s.siteId === storedSiteId) || sites[0]
            : sites[0];
          
          // Set selected site
          this.selectedSite.set({ siteId: siteToUse.siteId, name: siteToUse.name });
          this.authService.setSiteId(siteToUse.siteId);
          
          // Load dashboard data
          this.loadDashboardData(siteToUse.siteId);
          this.setupSocketListeners();
        } else {
          console.error('No sites available');
          this.isLoading.set(false);
        }
      },
      error: (error) => {
        console.error('Error fetching sites:', error);
        this.isLoading.set(false);
      }
    });
  }

  private handleDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.site-dropdown-container')) {
      this.showSiteDropdown.set(false);
    }
  }

  onSiteChange(site: { siteId: string; name: string }): void {
    this.selectedSite.set(site);
    this.authService.setSiteId(site.siteId);
    this.showSiteDropdown.set(false);
    // Reload all data with new site ID
    this.loadDashboardData(site.siteId);
  }

  setDateFilter(filter: 'today' | 'yesterday' | 'week' | 'month'): void {
    this.dateFilter.set(filter);
    const siteId = this.selectedSite()?.siteId || this.authService.getStoredSiteId();
    if (siteId) {
      this.loadDashboardData(siteId);
    }
  }

  toggleSiteDropdown(): void {
    this.showSiteDropdown.update(value => !value);
  }

  ngAfterViewInit(): void {
    // Charts will be updated when data loads
  }

  ngOnDestroy(): void {
    document.removeEventListener('click', this.documentClickHandler);
    this.subscriptions.unsubscribe();
    this.socketService.disconnect();
  }

  private loadDashboardData(siteId?: string): void {
    if (!siteId) {
      console.error('Site ID is required');
      this.isLoading.set(false);
      return;
    }

    this.isLoading.set(true);

    // Calculate time ranges based on date filter
    // API expects UTC epoch-millis
    const now = new Date();
    const nowUtc = new Date();
    let fromUtc: number;
    let toUtc: number;
    
    const filter = this.dateFilter();
    
    if (filter === 'today') {
      // Today: from start of today to now
      const todayStart = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate(), 0, 0, 0, 0));
      fromUtc = todayStart.getTime();
      toUtc = now.getTime();
    } else if (filter === 'yesterday') {
      // Yesterday: full day
      const yesterdayStart = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate() - 1, 0, 0, 0, 0));
      const yesterdayEnd = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate() - 1, 23, 59, 59, 999));
      fromUtc = yesterdayStart.getTime();
      toUtc = yesterdayEnd.getTime();
    } else if (filter === 'week') {
      // Last 7 days
      fromUtc = now.getTime() - (7 * 24 * 60 * 60 * 1000);
      toUtc = now.getTime();
    } else {
      // Last 30 days (month)
      fromUtc = now.getTime() - (30 * 24 * 60 * 60 * 1000);
      toUtc = now.getTime();
    }

    // For footfall, always use today's range when filter is 'today'
    let todayFromUtc: number;
    let todayToUtc: number;
    if (filter === 'today') {
      const todayStart = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate(), 0, 0, 0, 0));
      const todayEnd = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate(), 23, 59, 59, 999));
      todayFromUtc = todayStart.getTime();
      todayToUtc = todayEnd.getTime();
    } else {
      // For other filters, use the same range
      todayFromUtc = fromUtc;
      todayToUtc = toUtc;
    }

    // Use forkJoin to wait for all API calls to complete
    forkJoin({
      occupancy: this.analyticsService.getOccupancyTimeseries(siteId, fromUtc, toUtc).pipe(
        catchError(error => {
          console.error('Error loading occupancy:', error);
          console.error('Error status:', error.status);
          console.error('Error message:', error.message);
          console.error('Error details:', error.error);
          return of(null);
        })
      ),
      footfall: this.analyticsService.getTodayFootfall(siteId, todayFromUtc, todayToUtc).pipe(
        catchError(error => {
          console.error('Error loading footfall:', error);
          console.error('Error status:', error.status);
          console.error('Error message:', error.message);
          console.error('Error details:', error.error);
          return of(null);
        })
      ),
      dwellTime: this.analyticsService.getAverageDwellTime(siteId, fromUtc, toUtc).pipe(
        catchError(error => {
          console.error('Error loading dwell time:', error);
          console.error('Error status:', error.status);
          console.error('Error message:', error.message);
          console.error('Error details:', error.error);
          return of(null);
        })
      ),
      demographics: this.analyticsService.getDemographics(siteId, fromUtc, toUtc).pipe(
        catchError(error => {
          console.error('Error loading demographics:', error);
          console.error('Error status:', error.status);
          console.error('Error message:', error.message);
          console.error('Error details:', error.error);
          return of(null);
        })
      )
    }).subscribe({
      next: (results) => {
        // Process occupancy data
        if (results.occupancy) {
          console.log('Occupancy API Response:', results.occupancy);
          const response = results.occupancy as any;
          
          // Handle buckets format (actual API response)
          if (response.buckets && Array.isArray(response.buckets) && response.buckets.length > 0) {
            const buckets = response.buckets;
            // Get latest occupancy value for current occupancy
            const latestBucket = buckets[buckets.length - 1];
            const occupancy = latestBucket?.avg ?? 0;
            this.liveOccupancy.set(occupancy);
            
            // Update chart with buckets data
            const labels = buckets.map((bucket: any) => {
              const timestamp = bucket.utc || bucket.local;
              return new Date(timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            });
            const values = buckets.map((bucket: any) => bucket.avg ?? 0);
            
            this.occupancyChartData.set({
              labels,
              datasets: [{
                label: 'Occupancy',
                data: values,
                borderColor: 'rgb(20, 184, 166)', // Teal-500
                backgroundColor: 'rgba(20, 184, 166, 0.2)', // Light teal fill
                tension: 0.4,
                fill: true,
                pointRadius: 0,
                pointHoverRadius: 4,
                borderWidth: 2
              }]
            });
            this.cdr.detectChanges();
          } 
          // Fallback to timeseries format (if API changes)
          else if (results.occupancy.timeseries && Array.isArray(results.occupancy.timeseries) && results.occupancy.timeseries.length > 0) {
            const timeseries = results.occupancy.timeseries;
            const occupancy = response.currentOccupancy ?? response.occupancy ?? (timeseries.length > 0 ? timeseries[timeseries.length - 1]?.occupancy : 0);
            this.liveOccupancy.set(occupancy);
            
            const labels = timeseries.map(point => {
              const pointAny = point as any;
              const timestamp = point.timestamp || pointAny.time || pointAny.date;
              return new Date(timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            });
            const values = timeseries.map(point => {
              const pointAny = point as any;
              return point.occupancy || pointAny.count || 0;
            });
            
            this.occupancyChartData.set({
              labels,
              datasets: [{
                label: 'Occupancy',
                data: values,
                borderColor: 'rgb(20, 184, 166)', // Teal-500
                backgroundColor: 'rgba(20, 184, 166, 0.2)', // Light teal fill
                tension: 0.4,
                fill: true,
                pointRadius: 0,
                pointHoverRadius: 4,
                borderWidth: 2
              }]
            });
            this.cdr.detectChanges();
            // Force chart update
            setTimeout(() => {
              this.occupancyChart?.chart?.update();
            }, 0);
          } else {
            console.warn('No buckets or timeseries data found in occupancy response');
            this.liveOccupancy.set(0);
          }
          
          if (results.occupancy.comparison) {
            this.occupancyComparison.set({
              change: results.occupancy.comparison.change,
              changePercent: results.occupancy.comparison.changePercent
            });
          }
        } else {
          this.liveOccupancy.set(0);
        }

        // Process footfall data
        if (results.footfall) {
          console.log('Footfall API Response:', results.footfall);
          const response = results.footfall as any;
          const footfall = results.footfall.footfall ?? response.todayFootfall ?? response.count ?? 0;
          this.todayFootfall.set(footfall);
        } else {
          this.todayFootfall.set(0);
        }

        // Process dwell time data
        if (results.dwellTime) {
          console.log('Dwell Time API Response:', results.dwellTime);
          const response = results.dwellTime as any;
          // API returns avgDwellMinutes (not averageDwellTime)
          const dwellTime = response.avgDwellMinutes ?? results.dwellTime.averageDwellTime ?? response.dwellTime ?? response.avgDwellTime ?? 0;
          this.averageDwellTime.set(dwellTime);
          // API doesn't return unit, it's always minutes
          this.dwellTimeUnit.set('minutes');
          if (results.dwellTime.comparison) {
            this.dwellTimeComparison.set({
              change: results.dwellTime.comparison.change,
              changePercent: results.dwellTime.comparison.changePercent
            });
          }
        } else {
          this.averageDwellTime.set(0);
          this.dwellTimeUnit.set('minutes');
        }

        // Process demographics data
        if (results.demographics) {
          console.log('Demographics API Response:', results.demographics);
          const response = results.demographics as any;
          
          // Handle buckets format (actual API response)
          if (response.buckets && Array.isArray(response.buckets) && response.buckets.length > 0) {
            const buckets = response.buckets;
            // Get latest bucket for current demographics
            const latestBucket = buckets[buckets.length - 1];
            const maleValue = latestBucket?.male ?? 0;
            const femaleValue = latestBucket?.female ?? 0;
            this.currentDemographics.set({
              male: maleValue,
              female: femaleValue
            });
            
            // Update doughnut chart
            const total = maleValue + femaleValue;
            this.demographicsDoughnutChartData.set({
              labels: ['Male', 'Female'],
              datasets: [{
                data: [maleValue, femaleValue],
                backgroundColor: ['rgb(20, 184, 166)', 'rgba(153, 246, 228, 0.8)'], // Teal colors
                borderWidth: 0
              }]
            });
            
            // Update chart with buckets data
            const labels = buckets.map((bucket: any) => {
              const timestamp = bucket.utc || bucket.local;
              return new Date(timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            });
            const maleValues = buckets.map((bucket: any) => bucket.male ?? 0);
            const femaleValues = buckets.map((bucket: any) => bucket.female ?? 0);
            
            this.demographicsChartData.set({
              labels,
              datasets: [
                {
                  label: 'Male',
                  data: maleValues,
                  borderColor: 'rgb(20, 184, 166)', // Teal-500 (darker)
                  backgroundColor: 'rgba(20, 184, 166, 0.6)', // Darker teal fill
                  tension: 0.4,
                  fill: true,
                  pointRadius: 0,
                  pointHoverRadius: 4,
                  borderWidth: 0
                },
                {
                  label: 'Female',
                  data: femaleValues,
                  borderColor: 'rgb(153, 246, 228)', // Teal-200 (lighter)
                  backgroundColor: 'rgba(153, 246, 228, 0.6)', // Lighter teal fill
                  tension: 0.4,
                  fill: true,
                  pointRadius: 0,
                  pointHoverRadius: 4,
                  borderWidth: 0
                }
              ]
            });
            this.cdr.detectChanges();
            // Force chart update
            setTimeout(() => {
              this.demographicsDoughnutChart?.chart?.update();
            }, 0);
          }
          // Fallback to timeseries format (if API changes)
          else if (results.demographics.timeseries && Array.isArray(results.demographics.timeseries) && results.demographics.timeseries.length > 0) {
            const timeseries = results.demographics.timeseries;
            const current = results.demographics.current ?? { male: 0, female: 0 };
            const maleValue = current.male ?? 0;
            const femaleValue = current.female ?? 0;
            this.currentDemographics.set({
              male: maleValue,
              female: femaleValue
            });
            
            // Update doughnut chart
            const total = maleValue + femaleValue;
            this.demographicsDoughnutChartData.set({
              labels: ['Male', 'Female'],
              datasets: [{
                data: [maleValue, femaleValue],
                backgroundColor: ['rgb(20, 184, 166)', 'rgba(153, 246, 228, 0.8)'], // Teal colors
                borderWidth: 0
              }]
            });
            
            const labels = timeseries.map(point => {
              const pointAny = point as any;
              const timestamp = point.timestamp || pointAny.time || pointAny.date;
              return new Date(timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            });
            const maleValues = timeseries.map(point => point.male ?? 0);
            const femaleValues = timeseries.map(point => point.female ?? 0);
            
            this.demographicsChartData.set({
              labels,
              datasets: [
                {
                  label: 'Male',
                  data: maleValues,
                  borderColor: 'rgb(20, 184, 166)', // Teal-500 (darker)
                  backgroundColor: 'rgba(20, 184, 166, 0.6)', // Darker teal fill
                  tension: 0.4,
                  fill: true,
                  pointRadius: 0,
                  pointHoverRadius: 4,
                  borderWidth: 0
                },
                {
                  label: 'Female',
                  data: femaleValues,
                  borderColor: 'rgb(153, 246, 228)', // Teal-200 (lighter)
                  backgroundColor: 'rgba(153, 246, 228, 0.6)', // Lighter teal fill
                  tension: 0.4,
                  fill: true,
                  pointRadius: 0,
                  pointHoverRadius: 4,
                  borderWidth: 0
                }
              ]
            });
            this.cdr.detectChanges();
            // Force chart update
            setTimeout(() => {
              this.demographicsChart?.chart?.update();
              this.demographicsDoughnutChart?.chart?.update();
            }, 0);
          } else {
            console.warn('No buckets or timeseries data found in demographics response');
            this.currentDemographics.set({ male: 0, female: 0 });
          }
        } else {
          this.currentDemographics.set({ male: 0, female: 0 });
        }

        this.isLoading.set(false);
        
        // Ensure charts are updated after all data is loaded
        setTimeout(() => {
          this.occupancyChart?.chart?.update('none');
          this.demographicsChart?.chart?.update('none');
          this.demographicsDoughnutChart?.chart?.update('none');
        }, 100);
      },
      error: (error) => {
        console.error('Error loading dashboard data:', error);
        this.isLoading.set(false);
      }
    });
  }

  private setupSocketListeners(): void {
    this.socketService.connect();

    // Listen for live occupancy updates
    const occupancySub = this.socketService.onLiveOccupancy().subscribe((event: LiveOccupancyEvent) => {
      this.liveOccupancy.set(event.occupancy);
    });
    this.subscriptions.add(occupancySub);

    // Listen for alerts
    const alertSub = this.socketService.onAlert().subscribe((event: any) => {
      console.log('Alert received (full object):', event);
      console.log('Alert keys:', Object.keys(event));
      console.log('Zone map size:', this.zoneMap.size);
      console.log('Zone map contents:', Array.from(this.zoneMap.entries()));
      
      // Handle different alert formats - check for zone in various possible fields
      // Check flat fields first
      let zoneValue = event.zone || event.zoneId || event.zoneName || event.location || event.zone_id || 
                      event.fromZone || event.toZone;
      
      // Check nested objects if zone not found
      if (!zoneValue && event.data) {
        zoneValue = event.data.zone || event.data.zoneId || event.data.zoneName;
      }
      if (!zoneValue && event.payload) {
        zoneValue = event.payload.zone || event.payload.zoneId || event.payload.zoneName;
      }
      if (!zoneValue && event.metadata) {
        zoneValue = event.metadata.zone || event.metadata.zoneId || event.metadata.zoneName;
      }
      
      console.log('Zone value found:', zoneValue, 'from fields:', {
        zone: event.zone,
        zoneId: event.zoneId,
        zoneName: event.zoneName,
        location: event.location,
        zone_id: event.zone_id,
        fromZone: event.fromZone,
        toZone: event.toZone,
        'data.zone': event.data?.zone,
        'payload.zone': event.payload?.zone,
        'metadata.zone': event.metadata?.zone
      });
      
      // Log all keys to help debug
      console.log('All alert keys:', Object.keys(event));
      
      // Normalize actionType from different formats
      let actionType: 'entry' | 'exit' = 'exit';
      if (event.actionType) {
        actionType = event.actionType;
      } else if (event.direction) {
        // Handle 'zone-exit', 'zone-entry', 'exit', 'entry' formats
        const direction = event.direction.toLowerCase();
        if (direction.includes('exit')) {
          actionType = 'exit';
        } else if (direction.includes('entry') || direction.includes('enter')) {
          actionType = 'entry';
        }
      }
      
      // Ensure timestamp is valid, use current time if missing or invalid
      let timestamp = event.timestamp || event.ts;
      if (timestamp && typeof timestamp === 'number') {
        // Convert epoch milliseconds to ISO string
        timestamp = new Date(timestamp).toISOString();
      } else if (!timestamp || isNaN(new Date(timestamp).getTime())) {
        timestamp = new Date().toISOString();
      }
      
      // Map zone ID to zone name if zone is provided
      let zoneName = zoneValue;
      
      // Check if zone exists and is not empty
      if (zoneName && typeof zoneName === 'string' && zoneName.trim() !== '') {
        const trimmedZone = zoneName.trim();
        
        // Try to find in zone map (might be zoneId)
        if (this.zoneMap.has(trimmedZone)) {
          zoneName = this.zoneMap.get(trimmedZone)!;
          console.log('✓ Mapped zone ID to name:', trimmedZone, '->', zoneName);
        } else {
          // Check if it's already a zone name by searching values (case-insensitive)
          const foundEntry = Array.from(this.zoneMap.entries()).find(([id, name]) => 
            name.toLowerCase() === trimmedZone.toLowerCase()
          );
          if (foundEntry) {
            console.log('✓ Zone is already a name:', trimmedZone);
            zoneName = foundEntry[1]; // Use the canonical name from map
          } else {
            // Try partial matching or check if zone might be in a different format
            const partialMatch = Array.from(this.zoneMap.entries()).find(([id, name]) => 
              id.toLowerCase().includes(trimmedZone.toLowerCase()) || 
              name.toLowerCase().includes(trimmedZone.toLowerCase())
            );
            
            if (partialMatch) {
              console.log('✓ Found partial match:', trimmedZone, '->', partialMatch[1]);
              zoneName = partialMatch[1];
            } else {
              console.warn('⚠ Zone not found in map. Event zone:', trimmedZone);
              console.warn('Available zone IDs:', Array.from(this.zoneMap.keys()));
              console.warn('Available zone names:', Array.from(this.zoneMap.values()));
              // If zone map is empty, that's a bigger problem
              if (this.zoneMap.size === 0) {
                console.error('❌ Zone map is empty! Zones may not have loaded correctly.');
              }
              // Keep the original value - might be a valid zone name not in our map
              zoneName = trimmedZone; // Keep original but trimmed
            }
          }
        }
      } else {
        // Zone is null, undefined, or empty
        console.warn('⚠ Alert has no zone information. Full event object:', JSON.stringify(event, null, 2));
        console.warn('Checking all possible zone fields:', {
          zone: event.zone,
          zoneId: event.zoneId,
          zoneName: event.zoneName,
          location: event.location,
          zone_id: event.zone_id,
          fromZone: event.fromZone,
          toZone: event.toZone
        });
        console.warn('Zone map has', this.zoneMap.size, 'zones available');
        
        // Check if zone info might be in direction field (e.g., "zone-exit" might contain zone name)
        if (event.direction && typeof event.direction === 'string') {
          const directionParts = event.direction.split('-');
          if (directionParts.length > 1) {
            const possibleZone = directionParts[0]; // "zone" from "zone-exit"
            if (possibleZone && possibleZone !== 'zone') {
              // If it's not just "zone", it might be a zone identifier
              if (this.zoneMap.has(possibleZone)) {
                zoneName = this.zoneMap.get(possibleZone)!;
                console.log('Found zone in direction field:', possibleZone, '->', zoneName);
              }
            }
          }
        }
        
        // If we still don't have a zone, try site name as fallback
        if (!zoneName || zoneName === '') {
          if (event.site || event.siteId) {
            const siteInfo = this.sites().find(s => s.siteId === event.site || s.siteId === event.siteId || s.name === event.site);
            if (siteInfo) {
              zoneName = `${siteInfo.name} (Zone Unknown)`;
              console.log('Using site name as fallback:', zoneName);
            } else {
              zoneName = '';
            }
          } else {
            zoneName = '';
          }
        }
      }
      
      const alertWithId: AlertEvent & { id: string; dismissed?: boolean } = {
        actionType: actionType,
        zone: zoneName,
        site: event.site || event.siteId || '',
        severity: event.severity || 'low',
        timestamp: timestamp,
        id: event.eventId || `${Date.now()}-${Math.random()}`
      };
      console.log('Final alert with zone:', alertWithId.zone);
      console.log('Final alert object:', alertWithId);
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

  logout(): void {
    this.authService.logout();
  }

  formatDwellTime(minutes: number, unit: string): string {
    if (unit === 'hours') {
      return `${minutes.toFixed(1)} hrs`;
    }
    // Format as "08min 30sec" style
    const mins = Math.floor(minutes);
    const secs = Math.round((minutes - mins) * 60);
    return `${mins.toString().padStart(2, '0')}min ${secs.toString().padStart(2, '0')}sec`;
  }

  getTotalCrowd(): number {
    const demo = this.currentDemographics();
    return demo.male + demo.female;
  }

  getTotalCrowdPercentage(): number {
    const demo = this.currentDemographics();
    const total = demo.male + demo.female;
    if (total === 0) return 0;
    // Return the larger percentage (like in the image showing 61%)
    const malePercent = Math.round((demo.male / total) * 100);
    const femalePercent = Math.round((demo.female / total) * 100);
    return Math.max(malePercent, femalePercent);
  }

  getMalePercentage(): number {
    const total = this.getTotalCrowd();
    if (total === 0) return 0;
    return Math.round((this.currentDemographics().male / total) * 100);
  }

  getFemalePercentage(): number {
    const total = this.getTotalCrowd();
    if (total === 0) return 0;
    return Math.round((this.currentDemographics().female / total) * 100);
  }

  // Expose Math to template
  Math = Math;
}




