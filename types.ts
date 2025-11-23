import { Timestamp, FieldValue } from 'firebase/firestore';

export interface Event {
  id: string;
  name: string;
  isHidden?: boolean;
}

export type TicketStatus = 'AVAILABLE' | 'USED';
export type Sector = string;
export type SectorFilter = 'All' | Sector;

export interface Ticket {
  id: string;
  sector: Sector;
  status: TicketStatus;
  usedAt?: number; // Milliseconds since epoch for client-side use
  details?: {
    ownerName?: string;
    eventName?: string;
  };
}

export type ScanStatus = 'VALID' | 'INVALID' | 'USED' | 'ERROR' | 'WRONG_SECTOR';

export interface ScanLog {
    ticketId: string;
    status: ScanStatus;
    timestamp: Timestamp | FieldValue;
    deviceId?: string; // ID of the device that performed the scan
}

export interface DisplayableScanLog extends Omit<ScanLog, 'timestamp'>{
    id: string;
    timestamp: number; // Milliseconds
    ticketSector: Sector;
    isPending?: boolean;
    deviceId?: string;
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