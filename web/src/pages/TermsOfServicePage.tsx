export default function TermsOfServicePage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-8 text-3xl font-bold">Terms of Service</h1>
      <p className="mb-4 text-sm text-muted-foreground">Last updated: February 15, 2026</p>

      <section className="space-y-4 text-sm leading-relaxed">
        <h2 className="text-xl font-semibold">1. Acceptance of Terms</h2>
        <p>
          By accessing or using PawsitiveMileage, you agree to be bound by these Terms of Service.
          If you do not agree to these terms, please do not use the service.
        </p>

        <h2 className="text-xl font-semibold">2. Description of Service</h2>
        <p>
          PawsitiveMileage is a vehicle fuel tracking and maintenance management application. The
          service allows you to log fuel purchases, track vehicle maintenance, view analytics, and
          export your data.
        </p>

        <h2 className="text-xl font-semibold">3. User Accounts</h2>
        <p>
          You must sign in with a valid Google account to use PawsitiveMileage. You are responsible
          for maintaining the security of your account and for all activities that occur under your
          account.
        </p>

        <h2 className="text-xl font-semibold">4. User Data</h2>
        <p>
          You retain ownership of all data you enter into PawsitiveMileage. You grant us a limited
          license to store, process, and display your data solely for the purpose of providing the
          service to you.
        </p>

        <h2 className="text-xl font-semibold">5. Acceptable Use</h2>
        <p>You agree not to:</p>
        <ul className="ml-6 list-disc space-y-1">
          <li>Use the service for any unlawful purpose</li>
          <li>Attempt to gain unauthorized access to the service or its systems</li>
          <li>Interfere with or disrupt the service</li>
          <li>Upload malicious content or files</li>
        </ul>

        <h2 className="text-xl font-semibold">6. Service Availability</h2>
        <p>
          We strive to keep PawsitiveMileage available at all times but do not guarantee
          uninterrupted access. The service may be temporarily unavailable for maintenance or due to
          circumstances beyond our control.
        </p>

        <h2 className="text-xl font-semibold">7. Limitation of Liability</h2>
        <p>
          PawsitiveMileage is provided "as is" without warranties of any kind. We are not liable for
          any damages arising from your use of the service, including but not limited to data loss or
          inaccurate calculations.
        </p>

        <h2 className="text-xl font-semibold">8. Termination</h2>
        <p>
          We reserve the right to suspend or terminate your access to the service at any time for
          violation of these terms. You may stop using the service and request account deletion at
          any time.
        </p>

        <h2 className="text-xl font-semibold">9. Changes to Terms</h2>
        <p>
          We may update these Terms of Service from time to time. Continued use of the service after
          changes constitutes acceptance of the updated terms.
        </p>

        <h2 className="text-xl font-semibold">10. Contact</h2>
        <p>
          If you have questions about these Terms of Service, please contact us at{' '}
          <a href="mailto:support@bourbonlab.net" className="text-primary underline">
            support@bourbonlab.net
          </a>
          .
        </p>
      </section>
    </div>
  );
}
