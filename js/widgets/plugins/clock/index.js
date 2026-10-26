/**
 * Clock Plugin - Example implementation
 */
import { createIcon } from "../../../core/icons.js";

export default class ClockPlugin {
  constructor(context, options = {}) {
    this.context = context;
    this.options = { ...context.manifest.config, ...options };
    
    this.state = {
      currentTime: new Date(),
      timerId: null,
      isRunning: false
    };
    
    this.elements = {};
  }

  async init() {
    const { createElement, getContainer } = this.context;
    
    // Get or create container
    let container = getContainer();
    if (!container) {
      console.warn('[Clock] No container found, creating floating widget');
      container = createElement('div', {
        className: 'widget-clock',
        dataset: { plugin: 'clock' }
      });
      document.body.appendChild(container);
    }
    
    // Build UI
    this.buildUI(container);
    
    // Start clock
    this.start();
    
    // Listen untuk settings changes
    this.context.events.on('settings:updated', (data) => {
      if (data.plugin === 'clock') {
        this.updateSettings(data.config);
      }
    });
    
    this.context.log('Clock plugin initialized');
  }

  buildUI(container) {
    const { createElement } = this.context;
    
    // Clear container
    container.innerHTML = '';
    container.classList.add('clock-widget');
    
    // Time display
    this.elements.time = createElement('div', {
      className: 'clock-time'
    });
    
    // Date display
    this.elements.date = createElement('div', {
      className: 'clock-date'
    });
    
    // Settings button (optional)
    this.elements.settings = createElement('button', {
      className: 'clock-settings-btn',
      title: 'Settings'
    });
    this.elements.settings.append(createIcon("12_settings.png"));
    this.elements.settings.onclick = () => this.openSettings();
    
    container.appendChild(this.elements.time);
    container.appendChild(this.elements.date);
    container.appendChild(this.elements.settings);
  }

  start() {
    if (this.state.isRunning) return;
    
    this.update(); // Update immediately
    this.state.timerId = setInterval(() => this.update(), 1000);
    this.state.isRunning = true;
  }

  stop() {
    if (this.state.timerId) {
      clearInterval(this.state.timerId);
      this.state.timerId = null;
      this.state.isRunning = false;
    }
  }

  update() {
    const now = new Date();
    const { format, showSeconds, timezone } = this.options;
    
    // Format time
    let timeString;
    if (timezone === 'local') {
      timeString = now.toLocaleTimeString('en-US', {
        hour12: format === '12h',
        hour: '2-digit',
        minute: '2-digit',
        second: showSeconds ? '2-digit' : undefined
      });
    } else {
      // Specific timezone
      timeString = now.toLocaleTimeString('en-US', {
        timeZone: timezone,
        hour12: format === '12h',
        hour: '2-digit',
        minute: '2-digit',
        second: showSeconds ? '2-digit' : undefined
      });
    }
    
    // Format date
    const dateString = now.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    
    // Update DOM
    if (this.elements.time) {
      this.elements.time.textContent = timeString;
    }
    if (this.elements.date) {
      this.elements.date.textContent = dateString;
    }
    
    // Emit event untuk plugin lain yang mungkin butuh waktu
    this.context.events.emit('clock:tick', { time: now });
  }

  updateSettings(newConfig) {
  const next = { ...this.options, ...newConfig };
  try {
    if (next.timezone !== 'local') new Intl.DateTimeFormat('en-US', { timeZone: next.timezone });
  } catch {
    this.context.toast({ message: `Unknown time zone "${next.timezone}"`, type: 'warn' });
    next.timezone = this.options.timezone;
  }
  this.options = next;
}

  openSettings() {
    // Emit event ke settings plugin (jika ada)
    this.context.events.emit('settings:open', {
      plugin: 'clock',
      config: this.options,
      schema: {
        format: { type: 'select', options: ['12h', '24h'] },
        showSeconds: { type: 'boolean' },
        timezone: { type: 'string', placeholder: 'Asia/Jakarta' }
      }
    });
  }

  // Cleanup saat plugin di-unload
  async destroy() {
    this.stop();
    
    // Remove event listeners
    this.context.events.off('settings:updated', this.updateSettings);
    
    // Clear storage jika perlu (atau biarkan untuk persist)
    // this.context.storage.clear();
    
    this.context.log('Clock plugin destroyed');
  }

  // Public API (bisa diakses plugin lain)
  getCurrentTime() {
    return new Date();
  }

  setTimezone(tz) {
    this.options.timezone = tz;
    this.update();
  }
}