/**
 * EventBus - Pub/Sub pattern untuk komunikasi antar plugin
 * Lightweight, no dependencies
 */
class EventBus {
  constructor() {
    this.events = new Map();
    this.onceEvents = new Map();
  }

  /**
   * Subscribe ke event
   * @param {string} event - Nama event
   * @param {Function} callback - Handler
   * @param {Object} context - Context binding (optional)
   * @returns {Function} Unsubscribe function
   */
  on(event, callback, context = null) {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    
    const handler = { callback, context, once: false };
    this.events.get(event).push(handler);

    // Return unsubscribe function
    return () => this.off(event, callback);
  }

  /**
   * Subscribe sekali, auto-unsubscribe setelah trigger
   */
  once(event, callback, context = null) {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    
    const handler = { callback, context, once: true };
    this.events.get(event).push(handler);

    return () => this.off(event, callback);
  }

  /**
   * Unsubscribe dari event
   */
  off(event, callback) {
    if (!this.events.has(event)) return;
    
    const handlers = this.events.get(event);
    const index = handlers.findIndex(h => h.callback === callback);
    
    if (index > -1) {
      handlers.splice(index, 1);
    }
    
    if (handlers.length === 0) {
      this.events.delete(event);
    }
  }

  /**
   * Emit event ke semua subscriber
   * @param {string} event - Nama event
   * @param {*} data - Data yang dikirim
   */
  emit(event, data = null) {
    if (!this.events.has(event)) return;

    const handlers = [...this.events.get(event)]; // Copy array
    
    handlers.forEach(handler => {
      try {
        if (handler.context) {
          handler.callback.call(handler.context, data);
        } else {
          handler.callback(data);
        }
        
        // Remove jika 'once'
        if (handler.once) {
          this.off(event, handler.callback);
        }
      } catch (error) {
        console.error(`[EventBus] Error in handler for "${event}":`, error);
      }
    });
  }

  /**
   * Clear semua event (untuk cleanup)
   */
  clear() {
    this.events.clear();
  }

  /**
   * Get list active events (untuk debugging)
   */
  getActiveEvents() {
    return Array.from(this.events.keys());
  }
}

// Export singleton
export const eventBus = new EventBus();
export default eventBus;