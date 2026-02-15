# PawsitiveMileage — AWS Cost Estimate

Region: **us-east-1**  
Target scale: **~1,000 monthly active users**  
Pricing: **On-demand**, as of February 2026  
Sources: [AWS Pricing API](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/price-changes.html)

---

## Infrastructure Inventory

| Category | Resource | Quantity | Config |
|----------|----------|----------|--------|
| Compute | Lambda functions | 10 | 256 MB, 30s timeout, Node.js 22.x, X-Ray active |
| API | API Gateway v2 (HTTP API) | 1 | JWT authorizer, CORS |
| Database | DynamoDB tables | 5 | On-demand billing, PITR enabled |
| Database | DynamoDB GSIs | 6 | On-demand (across Users, Vehicles, Fillups ×2, Maintenance) |
| Storage | S3 buckets | 3 | Frontend, Photos, Exports (7-day lifecycle) |
| CDN | CloudFront distribution | 1 | OAC, TLS 1.2, SPA error handling |
| Auth | Cognito User Pool | 1 | Google OAuth, Hosted UI |
| Monitoring | CloudWatch Dashboard | 1 | API, Lambda, DynamoDB widgets |
| Monitoring | CloudWatch Logs | 10 log groups | 1-week (non-prod) / 3-month (prod) retention |

---

## Usage Assumptions (~1,000 MAU)

| Metric | Estimate | Rationale |
|--------|----------|-----------|
| API requests/month | 50,000 | ~50 requests per user per month |
| Lambda invocations/month | 50,000 | 1:1 with API requests |
| Lambda avg duration | 200 ms | Typical CRUD + DynamoDB round-trip |
| DynamoDB reads (RRU)/month | 500,000 | ~10 reads per API call avg |
| DynamoDB writes (WRU)/month | 100,000 | ~2 writes per API call avg |
| S3 storage | 5 GB | Frontend assets (~50 MB) + photos (~5 GB) |
| S3 PUT requests/month | 2,000 | Photo uploads + exports |
| S3 GET requests/month | 20,000 | Frontend assets + photo views |
| CloudFront requests/month | 500,000 | Page loads, assets, API passthrough |
| CloudFront data transfer | 10 GB | Frontend assets + images |
| CloudWatch Logs ingestion | 1 GB/month | 10 functions × structured JSON logs |
| Cognito MAU | 1,000 | Target user base |

---

## Per-Service Cost Breakdown

### 1. AWS Lambda

| Line Item | Unit Price | Usage | Monthly Cost |
|-----------|-----------|-------|-------------|
| Requests | $0.20 / 1M requests | 50,000 | $0.01 |
| Compute (GB-seconds) | $0.0000166667 / GB-s | 50,000 × 0.2s × 0.25 GB = 2,500 GB-s | $0.04 |
| X-Ray traces | $0.000001 / trace (first 100K free) | 50,000 | $0.00 |
| **Lambda subtotal** | | | **$0.05** |

Free tier: 1M requests + 400,000 GB-s/month → fully covered.

### 2. API Gateway v2 (HTTP API)

| Line Item | Unit Price | Usage | Monthly Cost |
|-----------|-----------|-------|-------------|
| API requests | $1.00 / 1M requests | 50,000 | $0.05 |
| **API Gateway subtotal** | | | **$0.05** |

Free tier: 1M requests/month for 12 months → fully covered in year 1.

### 3. Amazon DynamoDB (On-Demand)

| Line Item | Unit Price | Usage | Monthly Cost |
|-----------|-----------|-------|-------------|
| Read request units (RRU) | $0.125 / 1M RRU | 500,000 | $0.06 |
| Write request units (WRU) | $0.625 / 1M WRU | 100,000 | $0.06 |
| Storage (first 25 GB free) | $0.25 / GB-month | ~1 GB | $0.00 |
| PITR (continuous backups) | $0.20 / GB-month | ~1 GB × 5 tables | $1.00 |
| **DynamoDB subtotal** | | | **$1.12** |

Free tier: 25 GB storage + 25 RRU + 25 WRU provisioned (on-demand has no perpetual free tier for requests, but storage is covered).

### 4. Amazon S3

| Line Item | Unit Price | Usage | Monthly Cost |
|-----------|-----------|-------|-------------|
| Standard storage | $0.023 / GB-month | 5 GB | $0.12 |
| PUT/POST requests | $0.005 / 1K requests | 2,000 | $0.01 |
| GET requests | $0.0004 / 1K requests | 20,000 | $0.01 |
| **S3 subtotal** | | | **$0.14** |

Free tier: 5 GB storage + 20K GET + 2K PUT for 12 months → fully covered in year 1.

### 5. Amazon CloudFront

| Line Item | Unit Price | Usage | Monthly Cost |
|-----------|-----------|-------|-------------|
| HTTPS requests (US/EU) | $0.01 / 10K requests | 500,000 | $0.50 |
| Data transfer out (US) | $0.085 / GB (first 10 TB) | 10 GB | $0.85 |
| **CloudFront subtotal** | | | **$1.35** |

Free tier: 1 TB data transfer + 10M requests/month (always free) → fully covered.

### 6. Amazon Cognito

| Line Item | Unit Price | Usage | Monthly Cost |
|-----------|-----------|-------|-------------|
| MAU (Lite tier) | $0.0055 / MAU | 1,000 | $5.50 |
| **Cognito subtotal** | | | **$5.50** |

Free tier: First 10,000 MAU free with Cognito Lite tier → **fully covered**.

> Note: Cognito pricing changed in late 2024. The Lite tier includes 10,000 MAU free, which covers this workload entirely. The $5.50 figure above represents the cost without free tier.

### 7. Amazon CloudWatch

| Line Item | Unit Price | Usage | Monthly Cost |
|-----------|-----------|-------|-------------|
| Dashboard | $3.00 / dashboard-month | 1 | $3.00 |
| Logs ingestion | $0.50 / GB | 1 GB | $0.50 |
| Logs storage | $0.03 / GB-month | ~0.5 GB (1-week retention) | $0.02 |
| X-Ray traces stored | $0.000001 / trace | 50,000 | $0.00 |
| **CloudWatch subtotal** | | | **$3.52** |

Free tier: 5 GB logs ingestion, 5 GB logs storage, 3 dashboards (basic) → partially covered.

### 8. AWS Certificate Manager

| Line Item | Unit Price | Usage | Monthly Cost |
|-----------|-----------|-------|-------------|
| Public certificates | Free | 2 (API + Frontend) | $0.00 |

---

## Monthly Cost Summary

| Service | Without Free Tier | With Free Tier (Year 1) |
|---------|-------------------|------------------------|
| Lambda | $0.05 | $0.00 |
| API Gateway v2 | $0.05 | $0.00 |
| DynamoDB | $1.12 | $1.00 (PITR only) |
| S3 | $0.14 | $0.00 |
| CloudFront | $1.35 | $0.00 |
| Cognito | $5.50 | $0.00 |
| CloudWatch | $3.52 | $0.52 |
| ACM | $0.00 | $0.00 |
| **Total** | **$11.73/month** | **$1.52/month** |

### Annual Projection

| Scenario | Monthly | Annual |
|----------|---------|--------|
| With free tier (year 1) | ~$1.52 | ~$18.24 |
| Without free tier | ~$11.73 | ~$140.76 |

---

## Key Observations

- **Cognito is the largest cost** at $5.50/month without free tier, but the 10K MAU free tier covers this workload entirely.
- **CloudWatch Dashboard** at $3/month is the single largest fixed cost. Consider removing it in non-production environments.
- **DynamoDB PITR** adds ~$1/month across 5 tables. Could be disabled in non-prod to save costs.
- **CloudFront** always-free tier (1 TB transfer + 10M requests) covers this workload indefinitely, not just year 1.
- At ~1,000 users, the entire stack runs for **under $2/month** with free tier benefits, or **under $12/month** at full price.

## Scaling Notes

| Scale | Estimated Monthly Cost |
|-------|----------------------|
| 100 users | ~$5 (dominated by fixed costs: dashboard, PITR) |
| 1,000 users | ~$12 |
| 5,000 users | ~$30 |
| 10,000 users | ~$65 |

Costs scale roughly linearly with usage beyond the free tier thresholds. The serverless architecture means zero cost for idle resources — you only pay for what you use.

---

*Generated from live AWS Pricing API data and CDK infrastructure analysis. Actual costs may vary based on usage patterns, data transfer, and AWS pricing changes.*
