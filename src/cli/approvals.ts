/**
 * Cola de aprobaciones del CLI (F1-04 → TUI).
 *
 * El servidor puede pedir varias aprobaciones casi a la vez (tools en
 * paralelo); preguntarlas de una en una evita menús superpuestos. La cola vive
 * en el proceso: no persiste nada ni pisa la decisión del escritorio.
 */
import type { ApprovalDecision, ApprovalRequestV2 } from '../agent/sessionTypes.js';

export type ApprovalHandler = (approval: ApprovalRequestV2) => Promise<ApprovalDecision | null>;

export class ApprovalQueue {
  private readonly queue: ApprovalRequestV2[] = [];
  private readonly idleWaiters: Array<() => void> = [];
  private draining = false;
  private closed = false;

  constructor(
    private readonly handle: ApprovalHandler,
    private readonly onError?: (error: unknown) => void
  ) {}

  /** Encola y arranca el drenaje; nunca lanza hacia el stream SSE. */
  push(approval: ApprovalRequestV2): void {
    if (this.closed) return;
    this.queue.push(approval);
    void this.drain();
  }

  /** Deja de aceptar trabajo (fin del stream) y descarta lo que faltaba. */
  close(): void {
    this.closed = true;
    this.queue.length = 0;
  }

  get pending(): number {
    return this.queue.length;
  }

  /** Resuelve cuando no queda nada por preguntar (tests y cierre ordenado). */
  idle(): Promise<void> {
    if (!this.draining && this.queue.length === 0) return Promise.resolve();
    return new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (!this.closed && this.queue.length > 0) {
        const approval = this.queue.shift() as ApprovalRequestV2;
        try {
          await this.handle(approval);
        } catch (error) {
          // Una decisión que falla no puede bloquear las siguientes.
          this.onError?.(error);
        }
      }
    } finally {
      this.draining = false;
      const waiters = this.idleWaiters.splice(0, this.idleWaiters.length);
      for (const resolve of waiters) resolve();
    }
  }
}
