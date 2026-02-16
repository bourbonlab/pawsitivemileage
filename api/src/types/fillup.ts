export interface Fillup {
  vehicleId: string;
  fillupId: string;
  userId: string;
  date: string;
  currencySpent: number;
  gallonsAdded: number;
  odometerReading: number;
  isPartialFill: boolean;
  isBusiness: boolean;
  // Derived metrics
  pricePerGallon: number | null;
  milesSinceLastFillup: number | null;
  mpg: number | null;
  costPerMile: number | null;
  daysSinceLastFillup: number | null;
  // Optional
  locationLat?: number;
  locationLng?: number;
  stationName?: string;
  address?: string;
  receiptPhotoKey?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FillupInput {
  date: string;
  currencySpent: number;
  gallonsAdded: number;
  odometerReading: number;
  isPartialFill: boolean;
}

export interface DerivedMetrics {
  pricePerGallon: number | null;
  milesSinceLastFillup: number | null;
  mpg: number | null;
  costPerMile: number | null;
  daysSinceLastFillup: number | null;
}
