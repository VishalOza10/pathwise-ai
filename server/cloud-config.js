// Shared by packaging and startup so an incomplete cloud build cannot be published.
export function cloudConfig(env, saved = {}) {
  const origin = env.APP_ORIGIN || saved.origin || (env.AWS_APP_ID && env.AWS_BRANCH
    ? `https://${env.AWS_BRANCH}.${env.AWS_APP_ID}.amplifyapp.com` : undefined);
  const table = env.PATHWISE_TABLE || saved.table;
  const region = env.PATHWISE_REGION || env.AWS_REGION || saved.region || 'us-east-1';
  if (!origin || !table) throw new Error('Deployment configuration incomplete: APP_ORIGIN and PATHWISE_TABLE are required. Connect durable storage before deploying.');
  let url;
  try { url = new URL(origin); } catch { throw new Error('APP_ORIGIN must be a single HTTPS origin'); }
  if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password)
    throw new Error('APP_ORIGIN must be a single HTTPS origin');
  if (!/^[A-Za-z0-9_.-]{3,255}$/.test(table)) throw new Error('Invalid DynamoDB table name');
  if (!/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(region)) throw new Error('Invalid AWS region');
  return { origin, table, region };
}
