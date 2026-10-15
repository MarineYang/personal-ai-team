import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

// Codex's stdio transport is newline-delimited JSON (not LSP Content-Length).
export class CodexClient extends EventEmitter {
  constructor({ cwd, timeoutMs = 60_000 } = {}) {
    super();
    this.cwd = cwd;
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
    this.nextId = 1;
    this.child = null;
    this.startPromise = null;
    this.closing = false;
    this.buffer = '';
    // Deliberately do not retain or publish stderr contents, which can contain
    // user configuration or credentials. Keep only a bounded byte count.
    this.stderrBytes = 0;
  }

  start() {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this._start();
    return this.startPromise;
  }

  async _start() {
    this.closing = false;
    this.child = spawn('codex', ['app-server', '--listen', 'stdio://'], {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    const child = this.child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => this._consume(chunk));
    child.stderr.on('data', chunk => {
      this.stderrBytes = Math.min(65_536, this.stderrBytes + chunk.length);
    });
    child.stdin.on('error', error => {
      this._rejectPending(error);
      if (!this.closing) this._reportError(error);
    });
    child.on('error', error => {
      this._rejectPending(error);
      if (!this.closing) this._reportError(error);
    });
    child.on('close', (code, signal) => {
      const error = new Error(`Codex app-server exited (${signal ?? code ?? 'unknown'}).`);
      this._rejectPending(error);
      if (this.child === child) this.child = null;
      if (!this.closing) this.emit('exit', { code, signal });
    });
    try {
      const initialized = await this.request('initialize', {
        clientInfo: { name: 'personal_ai_team', title: '내 AI 팀', version: '0.1.0' },
        capabilities: { experimentalApi: true },
      });
      this._write({ method: 'initialized', params: {} });
      return initialized;
    } catch (error) {
      this.close();
      throw error;
    }
  }

  request(method, params = {}) {
    if (!this.child || this.closing || this.child.exitCode !== null) {
      return Promise.reject(new Error('Codex app-server is not running.'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, this.timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      try {
        this._write({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  respond(id, result) {
    this._write({ id, result });
  }

  _write(message) {
    if (!this.child?.stdin?.writable || this.closing) {
      throw new Error('Codex app-server input is closed.');
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  _consume(chunk) {
    this.buffer += chunk;
    let newline;
    while ((newline = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); }
      catch {
        // Never include raw protocol data in errors: it may contain user text.
        this._reportError(new Error('Codex emitted an invalid JSON protocol line.'));
        continue;
      }
      if (!message || typeof message !== 'object' || Array.isArray(message)) {
        this._reportError(new Error('Codex emitted an invalid protocol message.'));
        continue;
      }
      const hasId = Object.hasOwn(message, 'id');
      if (typeof message.method === 'string') {
        this.emit(hasId ? 'request' : 'notification', hasId
          ? { id: message.id, method: message.method, params: message.params ?? {} }
          : { method: message.method, params: message.params ?? {} });
      } else if (hasId) {
        const pending = this.pending.get(message.id);
        if (!pending) continue; // A response may arrive after its timeout.
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) {
          const error = new Error(message.error.message ?? 'Codex request failed.');
          error.code = message.error.code;
          pending.reject(error);
        } else if (Object.hasOwn(message, 'result')) {
          pending.resolve(message.result);
        } else {
          pending.reject(new Error('Codex returned a response without a result.'));
        }
      }
    }
    if (Buffer.byteLength(this.buffer, 'utf8') > 16 * 1024 * 1024) {
      const error = new Error('Codex protocol line exceeded the 16 MB limit.');
      this._reportError(error);
      this.close();
    }
  }

  _reportError(error) {
    // EventEmitter throws on an unobserved error event; startup already rejects
    // its request, so don't crash the host if it hasn't installed listeners yet.
    if (this.listenerCount('error')) this.emit('error', error);
  }

  _rejectPending(error) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
  }

  close() {
    if (this.closing) return;
    this.closing = true;
    this._rejectPending(new Error('Codex app-server connection closed.'));
    const child = this.child;
    if (!child) return;
    child.stdin.end();
    child.kill('SIGTERM');
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, 2_000);
    timer.unref?.();
    child.once('close', () => clearTimeout(timer));
  }
}
