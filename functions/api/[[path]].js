import { handlePortfolioRequest } from '../_shared/api.mjs';

export async function onRequest(context) {
  return handlePortfolioRequest(context.request, context.env);
}
