
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
  usedAt?: number;
  source?: string;
  details?: {
    ownerName?: string;
    email?: string;
    phone?: string;
    document?: string;
    eventName?: string;
    originalId?: string | number;
    pdfConfig?: any;
    purchaseCode?: string;
    alertMessage?: string;
    // Campo para controle interno: Para quem o ingresso foi enviado
    destination?: string;
    // Atribuição do ingresso (ex: VIP, Cortesia)
    assignment?: string;
  };
}

export type ScanStatus = 'VALID' | 'INVALID' | 'USED' | 'ERROR' | 'WRONG_SECTOR' | 'ALERT_REQUIRED';

export interface ScanLog {
    ticketId: string;
    status: ScanStatus;
    timestamp: Timestamp | FieldValue;
    deviceId?: string;
    operator?: string;
}

export interface DisplayableScanLog extends Omit<ScanLog, 'timestamp'>{
    id: string;
    timestamp: number;
    ticketSector: Sector;
    isPending?: boolean;
    deviceId?: string;
    operator?: string;
}

export interface ImportLog {
    id: string;
    timestamp: any; // Pode ser number ou Timestamp do Firestore
    sourceName: string;
    newCount: number;
    existingCount: number;
    updatedCount: number;
    sectorsAffected: Record<string, number>;
    status: 'success' | 'error';
    errorMessage?: string;
    type?: 'local' | 'cloud';
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
    password?: string;
    role: UserRole;
    allowedEvents: string[];
}

export interface SectorGroup {
    id: string;
    name: string;
    includedSectors: string[];
}

export type ImportType = 'tickets' | 'participants' | 'buyers' | 'checkins' | 'custom' | 'google_sheets';

export interface ImportSource {
    id: string;
    name: string;
    url: string;
    token: string;
    externalEventId?: string;
    type: ImportType;
    autoImport: boolean;
    lastImportTime?: number;
}

export interface ImportSettingsV2 {
    sources: ImportSource[];
    globalAutoImportEnabled: boolean;
}
