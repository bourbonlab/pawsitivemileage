export interface MaintenanceSchema {
  schemaId: string;
  name: string;
  description: string;
  defaultMileageInterval: number | null;
  defaultTimeIntervalDays: number | null;
  category: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
