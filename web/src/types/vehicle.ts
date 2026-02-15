export interface Vehicle {
  userId: string;
  vehicleId: string;
  nickname: string;
  make: string;
  model: string;
  year: number;
  trim?: string;
  color?: string;
  vin?: string;
  licensePlate?: string;
  tankSize?: number;
  fuelType?: string;
  photoKey?: string;
  isArchived: boolean;
  maintenanceOverrides?: Record<string, MaintenanceOverride>;
  createdAt: string;
  updatedAt: string;
}

export interface MaintenanceOverride {
  mileageInterval?: number;
  timeIntervalDays?: number;
}
