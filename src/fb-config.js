export default {
  search: {
    defaultRadiusKM: 65,
    defaultSort: 'CREATION_TIME_DESCEND',
    resultsPerPage: 24,
    maxPages: 5,
  },
  location: {
    latitude: 40.4032,
    longitude: -3.7037,
  },
  timing: {
    minDelayBetweenRequests: 1200,
    maxDelayBetweenRequests: 2800,
    sessionRefreshInterval: 30 * 60 * 1000,
    retryDelay: 9000,
    maxRetries: 3,
  },
  proxy: {
    enabled: process.env.PROXY_ENABLED === 'true' || false,
    host: process.env.PROXY_HOST || '',
    port: process.env.PROXY_PORT || '',
    username: process.env.PROXY_USER || '',
    password: process.env.PROXY_PASS || '',
  },
};