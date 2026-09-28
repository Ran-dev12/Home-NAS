import type { Response } from 'express';

interface Client {
  userId: number;
  isAdmin: boolean;
  res: Response;
}

export interface EventScope {
  /** Deliver to these users. */
  userIds?: number[];
  /** Also deliver to every admin. */
  admins?: boolean;
  /** Deliver to everyone signed in. */
  all?: boolean;
}

/** Server-sent events, scoped so one user's file activity never reaches another user's browser. */
export class EventHub {
  private clients = new Set<Client>();
  private heartbeat: NodeJS.Timeout;

  constructor() {
    this.heartbeat = setInterval(() => {
      for (const c of this.clients) c.res.write(': ping\n\n');
    }, 25_000);
    this.heartbeat.unref();
  }

  add(userId: number, isAdmin: boolean, res: Response): () => void {
    const client: Client = { userId, isAdmin, res };
    this.clients.add(client);
    return () => this.clients.delete(client);
  }

  emit(event: string, data: unknown, scope: EventScope) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of this.clients) {
      const hit = scope.all || (scope.admins && c.isAdmin) || scope.userIds?.includes(c.userId);
      if (!hit) continue;
      try {
        c.res.write(payload);
      } catch {
        this.clients.delete(c);
      }
    }
  }

  closeAll() {
    for (const c of this.clients) {
      try {
        c.res.end();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
  }

  stop() {
    clearInterval(this.heartbeat);
    this.closeAll();
  }
}
