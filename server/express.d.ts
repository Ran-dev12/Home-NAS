import type { SessionUser } from './auth.ts';
import type { DeviceRow } from './routes/devices.ts';

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
      device?: DeviceRow;
    }
  }
}

export {};
