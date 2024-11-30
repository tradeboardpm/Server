module.exports = (requiredEnvs) => {
  const missing = requiredEnvs.filter(env => !process.env[env]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
};