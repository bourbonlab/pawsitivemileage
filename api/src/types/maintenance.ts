export interface MaintenanceRecord {
  vehicleId: string;
  recordId: string;
  userId: string;
  schemaId?: string;
  schemaName?: string;
  customTypeName?: string;
  datePerformed: string;
  odometerAtService: number;
  cost: number;
  location?: string;
  notes?: string;
  receiptPhotoKey?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderInput {
  schemaName: string;
  mileageInterval: number | null;
  timeIntervalDays: number | null;
  lastServiceOdometer: number;
  lastServiceDate: string;
  currentOdometer: number;
  currentDate: string;
}

export interface Reminder {
  schemaName: string;
  type: 'mileage' | 'time' | 'both';
  mileageRemaining: number | null;
  daysRemaining: number | null;
  isOverdue: boolean;
}
