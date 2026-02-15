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
            scopes: ['openid', 'email', 'profile', 'aws.cognito.signin.user.admin'],
            redirectSignIn: [redirectBase + '/callback'],
            redirectSignOut: [redirectBase + '/'],
            responseType: 'code',
            providers: ['Google'],
          },
        },
      },
    },
  });
}
