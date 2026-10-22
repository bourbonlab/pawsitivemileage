# PawsitiveMileage — Roadmap

## Driver & Trip Insights
- Driving habit scoring based on fillup frequency, MPG trends, and maintenance adherence
- Trip logging with start/end odometer, purpose (personal vs business), and mileage deduction tracking for tax time
- Business vs personal mileage reporting (fill-ups already carry an `isBusiness` flag)

## Fuel Price Intelligence
- Gas station price tracking from fillup history (cheapest stations, average price by area)
- Price alerts when stations near usual routes drop below a threshold (SNS notification)

## Vehicle Health & Lifecycle
- Maintenance cost forecasting based on historical patterns and schema intervals
- Vehicle total cost of ownership dashboard (fuel + maintenance + estimated depreciation)
- Tire and battery life tracking as first-class maintenance subtypes with dedicated reminder logic

## Social & Sharing
- ~~Fleet/household view with aggregate stats across all vehicles, compare cost per vehicle~~ → **Shipped:** Shared Garage (share vehicles by email with readonly/fuel/maintenance/full permissions)
- Public vehicle profile pages (opt-in) with lifetime stats
- Aggregate stats dashboard across all shared vehicles
- Anonymized opt-in MPG leaderboard

## Automation & Integrations
- Recurring fillup pattern detection ("you usually fill up every 8 days, you're due soon")
- OBD-II integration prep — API endpoint for telemetry data ingestion
- Slack/Discord webhook notifications for maintenance reminders

## Data & Export Enhancements
- Scheduled email reports (weekly/monthly digest) via SES
- Import from additional sources (GasBuddy, Drivvo, Fuelio CSV formats)
- Shareable chart URL embeds for forums and social media

## Mobile
- Android app on Google Play (store listing and closed test in progress; until then the APK is on the site)
- Analytics, sharing management and exports in the Android app
- iOS app on the same API contract

## Quality of Life
- ~~Offline fillup entry with sync~~ → **Shipped** in the Android app (Room queue + WorkManager, idempotency keys); the web app still needs a connection
- Quick-fill mode — one-tap entry reusing last station, fuel type, estimates gallons from spend
- ~~Dark mode (Tailwind 4 `dark:` variant pass)~~ → **Shipped:** light, dark and system themes
- Multi-currency support for international travel
