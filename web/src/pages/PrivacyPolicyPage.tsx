export default function PrivacyPolicyPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-8 text-3xl font-bold">Privacy Policy</h1>
      <p className="mb-4 text-sm text-muted-foreground">Last updated: October 22, 2026</p>

      <section className="space-y-4 text-sm leading-relaxed">
        <h2 className="text-xl font-semibold">1. Information We Collect</h2>
        <p>
          When you use PawsitiveMileage, we collect information you provide directly, including your
          name, email address (via Google sign-in), vehicle details, fuel fillup records, maintenance
          logs, and any photos or receipts you upload.
        </p>

        <h2 className="text-xl font-semibold">2. How We Use Your Information</h2>
        <p>We use your information to:</p>
        <ul className="ml-6 list-disc space-y-1">
          <li>Provide and maintain the PawsitiveMileage service</li>
          <li>Calculate fuel economy metrics and analytics</li>
          <li>Send maintenance reminders you have configured</li>
          <li>Improve and optimize the application</li>
        </ul>

        <h2 className="text-xl font-semibold">3. Data Storage &amp; Security</h2>
        <p>
          Your data is stored securely using Amazon Web Services (AWS) infrastructure, including
          DynamoDB for structured data and S3 for uploaded files. All data is encrypted in transit
          via TLS and at rest using AWS-managed encryption keys.
        </p>

        <h2 className="text-xl font-semibold">4. Third-Party Services</h2>
        <p>
          We use AWS Cognito with Google OAuth 2.0 for authentication. We do not sell, rent, or
          share your personal information with third parties for marketing purposes.
        </p>

        <h2 className="text-xl font-semibold">5. Data Retention &amp; Deletion</h2>
        <p>
          Your data is retained as long as your account is active. You can delete your account and
          all associated data yourself at any time, on the web or in the Android app; see{' '}
          <a href="/delete-account" className="text-primary underline">Delete your account</a>. Deletion
          is immediate. Database backups, used only for recovery, contain deleted data for up to 35
          days, and service logs, which record your account ID but not your data, are kept for 90
          days.
        </p>

        <h2 className="text-xl font-semibold">6. Cookies</h2>
        <p>
          We use essential cookies and local storage for authentication session management. We do not
          use tracking or advertising cookies.
        </p>

        <h2 className="text-xl font-semibold">7. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. We will notify you of any changes by
          posting the new policy on this page and updating the "Last updated" date.
        </p>

        <h2 className="text-xl font-semibold">8. Contact</h2>
        <p>
          If you have questions about this Privacy Policy, please contact us at{' '}
          <a href={`mailto:${import.meta.env.VITE_SUPPORT_EMAIL}`} className="text-primary underline">
            {import.meta.env.VITE_SUPPORT_EMAIL}
          </a>
          .
        </p>
      </section>
    </div>
  );
}
