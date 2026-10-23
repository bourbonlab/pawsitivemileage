import { Amplify } from 'aws-amplify';

export function configureAmplify() {
  const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID;
  const userPoolClientId = import.meta.env.VITE_COGNITO_APP_CLIENT_ID;
  const domain = import.meta.env.VITE_COGNITO_DOMAIN;

  if (!userPoolId || !userPoolClientId || !domain) {
    console.warn(
      'Missing Cognito environment variables. Auth will not work correctly.',
    );
  }

  const redirectBase = window.location.origin;

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: userPoolId ?? '',
        userPoolClientId: userPoolClientId ?? '',
        loginWith: {
          oauth: {
            domain: domain ?? '',
            // Identity scopes only: the user-admin scope would let a token change the user's email
            scopes: ['openid', 'email', 'profile'],
            redirectSignIn: [redirectBase + '/callback'],
            redirectSignOut: [redirectBase],
            responseType: 'code',
            providers: ['Google'],
          },
        },
      },
    },
  });
}
