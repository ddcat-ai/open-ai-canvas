export class AdmissionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export class SessionAdmission {
  constructor({ limit, maxQueue, waitTimeout }) {
    this.limit = limit;
    this.maxQueue = maxQueue;
    this.waitTimeout = waitTimeout;
    this.active = 0;
    this.waiters = [];
    this.closed = false;
  }

  acquire(signal) {
    if (signal.aborted) return Promise.reject(new AdmissionError(499, "Agent request cancelled"));
    if (this.closed) return Promise.reject(new AdmissionError(503, "Agent service is shutting down"));
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve(this.lease());
    }
    if (this.waiters.length >= this.maxQueue) return Promise.reject(new AdmissionError(429, "Agent queue is full"));
    return new Promise((resolve, reject) => {
      const remove = error => {
        const index = this.waiters.indexOf(waiter);
        if (index < 0) return;
        this.waiters.splice(index, 1);
        waiter.dispose();
        reject(error);
      };
      const abort = () => remove(new AdmissionError(499, "Agent request cancelled while queued"));
      const timer = setTimeout(() => remove(new AdmissionError(503, "Agent queue wait timed out")), this.waitTimeout);
      const waiter = {
        resolve,
        reject,
        dispose: () => { clearTimeout(timer); signal.removeEventListener("abort", abort); },
      };
      signal.addEventListener("abort", abort, { once: true });
      this.waiters.push(waiter);
    });
  }

  lease() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.admit();
    };
  }

  admit() {
    while (!this.closed && this.waiters.length && this.active < this.limit) {
      const waiter = this.waiters.shift();
      waiter.dispose();
      this.active++;
      waiter.resolve(this.lease());
    }
  }

  setLimit(limit) {
    this.limit = limit;
    this.admit();
  }

  close() {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter.dispose();
      waiter.reject(new AdmissionError(503, "Agent service is shutting down"));
    }
  }
}
