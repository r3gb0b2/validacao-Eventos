
import { Timestamp, FieldValue } from 'firebase/firestore';

export interface Event {
  id: string;
  name: string;
  isHidden?: boolean;
}

export type TicketStatus = 'AVAILABLE' | 'USED' | 'STANDBY';
export type Sector = string;
export type SectorFilter = 'All' | Sector;

export interface Ticket {
  id: string;
  sector: Sector;
  status: TicketStatus;
  usedAt?: number; // Milliseconds since epoch for client-side use
  source?: string; // Origem do ingresso (ex: 'secret_generator')
  details?: {
    ownerName?: string;
    eventName?: string;
    originalId?: string | number; // ID numérico/original da API externa
  };
}

export type ScanStatus = 'VALID' | 'INVALID' | 'USED' | 'ERROR' | 'WRONG_SECTOR';

export interface ScanLog {
    ticketId: string;
    status: ScanStatus;
    timestamp: Timestamp | FieldValue;
    deviceId?: string; // ID of the device that performed the scan
    operator?: string; // Name of the operator/gate
}

export interface DisplayableScanLog extends Omit<ScanLog, 'timestamp'>{
    id: string;
    timestamp: number; // Milliseconds
    ticketSector: Sector;
    isPending?: boolean;
    deviceId?: string;
    operator?: string;
}

export interface TimeBucket {
    time: string;
    counts: { [sector: string]: number };
    total: number;
}

export interface AnalyticsData {
    timeBuckets: TimeBucket[];
    firstAccess: number | null;
    lastAccess: number | null;
    peak: {
        time: string;
        count: number;
    };
}

export type UserRole = 'SUPER_ADMIN' | 'ADMIN';

export interface User {
    id: string;
    username: string;
    password?: string; // Only used for creation/auth, prefer not to store plainly in prod but per request
    role: UserRole;
    allowedEvents: string[]; // Array of Event IDs
}

export interface SectorGroup {
    id: string;
    name: string;
    includedSectors: string[];
}
