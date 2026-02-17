export type SharePermission = 'readonly' | 'fuel' | 'maintenance' | 'full';

export interface ShareRecord {
  shareId: string;
  ownerUserId: string;
  sharedEmail: string;
  vehicleId: string;
  permission: SharePermission;
  createdAt: string;
  updatedAt: string;
}

export interface SharedVehicle {
  vehicle: {
    vehicleId: string;
    nickname: string;
    make: string;
    model: string;
    year: number;
    photoKey?: string;
  };
  ownerDisplayName: string;
  permission: SharePermission;
  shareId: string;
}
