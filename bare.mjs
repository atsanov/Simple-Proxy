import { createBareServer } from '@nebula-services/bare-server-node';

export function createBareServerInstance(routePath = '/bare/') {
  return createBareServer(routePath, {
    log: false,
    cors: { origin: '*', methods: ['GET', 'POST', 'HEAD', 'OPTIONS'], allowedHeaders: ['*'], exposedHeaders: ['*'] },
    maxResponseSize: 50 * 1024 * 1024,
    requestTimeout: 30000,
    forwardHeaders: ['user-agent', 'referer', 'accept', 'accept-language', 'accept-encoding'],
    stripHeaders: ['set-cookie', 'www-authenticate']
  });
}
export default createBareServerInstance;