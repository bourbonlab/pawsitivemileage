import { Link } from 'react-router';

/**
 * Public account-deletion page (no sign-in needed): the "delete account" URL for Google Play and
 * GET /v1/meta. It names the app, gives the steps on the web and in the Android app, and says
 * what is deleted and what is kept for how long.
 */
export default function DeleteAccountInfoPage() {
  const support = import.meta.env.VITE_SUPPORT_EMAIL;
  return (
    <div className="container mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-2 text-3xl font-bold">Delete your PawsitiveMileage account</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        You can delete your PawsitiveMileage account and all of its data yourself, at any time, on the web or in the
        Android app.
      </p>

      <section className="space-y-4 text-sm leading-relaxed">
        <h2 className="text-xl font-semibold">On the web</h2>
        <ol className="ml-6 list-decimal space-y-1">
          <li>
            Sign in at <Link to="/login" className="text-primary underline">pawsitivemileage.app</Link> with the Google
            account you use for PawsitiveMileage.
          </li>
          <li>
            Open <Link to="/account" className="text-primary underline">Account</Link> (top right).
          </li>
          <li>Under <strong>Danger Zone</strong>, choose <strong>Delete Account</strong>, type DELETE and confirm.</li>
        </ol>

        <h2 className="text-xl font-semibold">In the Android app</h2>
        <ol className="ml-6 list-decimal space-y-1">
          <li>In the Garage, tap <strong>Account</strong>.</li>
          <li>Tap <strong>Delete account</strong>, type DELETE and confirm.</li>
        </ol>

        <h2 className="text-xl font-semibold">What is deleted</h2>
        <p>Deletion is immediate and can't be undone. It removes:</p>
        <ul className="ml-6 list-disc space-y-1">
          <li>your profile (name and email) and your sign-in account</li>
          <li>all your vehicles, with their fill-ups and maintenance records</li>
          <li>all photos and receipts you uploaded, and any exports</li>
          <li>vehicles you shared with others, and shares others made with you</li>
        </ul>
        <p>Fill-ups or maintenance you added to someone else's shared vehicle stay with that vehicle.</p>

        <h2 className="text-xl font-semibold">What is kept, and for how long</h2>
        <ul className="ml-6 list-disc space-y-1">
          <li>Database backups, used only to recover from failures, contain deleted data for up to 35 days.</li>
          <li>Service logs record your account ID, not your vehicles or records, and are kept for 90 days.</li>
        </ul>

        {support && (
          <>
            <h2 className="text-xl font-semibold">Can't sign in?</h2>
            <p>
              Email{' '}
              <a href={`mailto:${support}?subject=Delete my PawsitiveMileage account`} className="text-primary underline">
                {support}
              </a>{' '}
              from the address you sign in with, and we'll delete the account for you.
            </p>
          </>
        )}

        <p className="pt-4">
          See also the <Link to="/privacy" className="text-primary underline">Privacy Policy</Link>.
        </p>
      </section>
    </div>
  );
}
