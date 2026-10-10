export class LineFramer {
  constructor(onLine, onError = () => {}) {
    this.onLine = onLine;
    this.onError = onError;
    this.buffer = '';
    this.discard = false;
  }
  push(chunk) {
    for (const c of chunk) {
      if (c === '\r') continue;
      if (c === '\n') {
        if (!this.discard && this.buffer) this.onLine(this.buffer);
        this.buffer = '';
        this.discard = false;
      } else if (!this.discard) {
        this.buffer += c;
        if (this.buffer.length > 512) {
          this.buffer = '';
          this.discard = true;
          this.onError(new Error('Oversized serial response'));
        }
      }
    }
  }
}
export class SerialLink {
  constructor(onLine, onClose) {
    this.onLine = onLine;
    this.onClose = onClose;
    this.queue = Promise.resolve();
    this.closing = false;
    this.closeTask = null;
    this.opening = false;
  }
  async connect() {
    if (!navigator.serial)
      throw new Error('Use desktop Chrome or Edge for USB, or choose simulation.');
    if (this.opening) throw new Error('USB connection is already opening');
    this.opening = true;
    try {
      // Reconnect must wait for every resource from the previous port to be released.
      await this.closeTask;
      if (this.port) throw new Error('USB is already connected');
      this.closeTask = null;
      this.closing = false;
      this.readTask = null;
      this.port = await navigator.serial.requestPort();
      try {
        await this.port.open({ baudRate: 115200 });
        this.writer = this.port.writable.getWriter();
        this.reader = this.port.readable.getReader();
        this.queue = Promise.resolve();
        this.readTask = this.readLoop();
      } catch (e) {
        await this.close(false);
        throw e;
      }
    } finally {
      this.opening = false;
    }
  }
  send(line) {
    if (!this.writer || this.closing)
      return Promise.reject(new Error('USB is disconnected'));
    if (line.length > 150 || /[\r\n]/.test(line))
      return Promise.reject(new Error('Invalid command'));
    const bytes = new TextEncoder().encode(line + '\n');
    const task = this.queue.then(() => this.writer.write(bytes));
    this.queue = task.catch(() => {});
    return task;
  }
  async readLoop() {
    let reason = 'USB disconnected';
    const decoder = new TextDecoder();
    const framer = new LineFramer(this.onLine, (e) => {
      reason = e.message;
      void this.close();
    });
    try {
      while (!this.closing) {
        const { value, done } = await this.reader.read();
        if (done) break;
        framer.push(decoder.decode(value, { stream: true }));
      }
    } catch (e) {
      reason = e.message;
    } finally {
      this.reader?.releaseLock();
      this.reader = null;
      if (!this.closing) {
        await this.releasePort();
        this.onClose(reason);
      }
    }
  }
  async releasePort() {
    try {
      this.writer?.releaseLock();
    } catch {}
    this.writer = null;
    try {
      await this.port?.close();
    } catch {}
    this.port = null;
  }
  close(notify = true) {
    if (this.closing && this.closeTask) return this.closeTask;
    this.closing = true;
    // All close callers receive the same promise, including handlers switching modes.
    this.closeTask = (async () => {
      try {
        await this.reader?.cancel();
      } catch {}
      await this.readTask;
      await this.queue;
      await this.releasePort();
      if (notify) this.onClose('USB disconnected');
    })();
    return this.closeTask;
  }
}
