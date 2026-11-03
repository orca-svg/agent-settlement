export function firebaseConfig(env) {
  const { FIREBASE_PROJECT_ID: projectId, FIREBASE_API_KEY: apiKey, FIREBASE_AUTH_DOMAIN: authDomain, FIREBASE_APP_ID: appId } = env;
  return projectId && apiKey && authDomain && appId ? { projectId, apiKey, authDomain, appId } : null;
}
export async function firebaseAuth(env) {
  if (!firebaseConfig(env)) return null;
  if (env.NODE_ENV === 'production' && env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('운영에서는 Auth Emulator를 사용할 수 없어요');
  const { initializeApp, applicationDefault } = await import('firebase-admin/app');
  const { getAuth } = await import('firebase-admin/auth');
  const app = initializeApp({ projectId: env.FIREBASE_PROJECT_ID, ...(env.FIREBASE_AUTH_EMULATOR_HOST ? {} : { credential: applicationDefault() }) });
  return getAuth(app);
}
