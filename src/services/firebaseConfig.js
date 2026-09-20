// src/services/firebaseConfig.js — read the Firebase config out of the
// environment and say, precisely, what is missing.
//
// Without this the app called initializeApp() with undefined everywhere and
// died somewhere inside the SDK, leaving a white page and a stack trace. A
// first-time setup mistake should produce instructions, not a crash.

export const FIREBASE_ENV_VARS = [
  { key: 'VITE_FIREBASE_API_KEY',        field: 'apiKey',            label: 'Web API key' },
  { key: 'VITE_FIREBASE_AUTH_DOMAIN',    field: 'authDomain',        label: 'Auth domain' },
  { key: 'VITE_FIREBASE_PROJECT_ID',     field: 'projectId',         label: 'Project ID' },
  { key: 'VITE_FIREBASE_STORAGE_BUCKET', field: 'storageBucket',     label: 'Storage bucket' },
  { key: 'VITE_FIREBASE_SENDER_ID',      field: 'messagingSenderId', label: 'Messaging sender ID' },
  { key: 'VITE_FIREBASE_APP_ID',         field: 'appId',             label: 'App ID' },
];

/** A value that is present but still the placeholder from .env.example. */
const PLACEHOLDER = /^(AIzaSy\.\.\.|your-project-id|1:123456789012:web:abc123def456|123456789012|your-project-id\.(firebaseapp\.com|appspot\.com))$/;

/**
 * @param {Record<string,string|undefined>} env  usually `import.meta.env`
 * @returns {{ config: object, missing: {key,label,reason}[], ok: boolean }}
 */
export function readFirebaseConfig(env = {}) {
  const config = {};
  const missing = [];

  for (const { key, field, label } of FIREBASE_ENV_VARS) {
    const raw = env[key];
    const value = typeof raw === 'string' ? raw.trim() : '';
    config[field] = value;

    if (!value) {
      missing.push({ key, label, reason: 'not set' });
    } else if (PLACEHOLDER.test(value)) {
      // Copying .env.example without editing it is the most common mistake,
      // and it fails in exactly the same confusing way as not copying it.
      missing.push({ key, label, reason: 'still the example value' });
    }
  }

  return { config, missing, ok: missing.length === 0 };
}
