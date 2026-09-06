export const APP_VERSION = 'v1.0.0s';
export const APP_VERSION_RAW = '1.0.0';

if (typeof window !== 'undefined') {
  window.APP_VERSION = APP_VERSION;
}

export default APP_VERSION;
