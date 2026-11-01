// 비서끼리 처리 API. 판단과 상태 변경은 orchestrator가 하고, 여기서는 누가 요청했는지만 확인한다.
import { readJson } from '../http.mjs';

export function registerAgentRoutes(routes, { orchestrator, member }) {
  routes.post('/api/rooms/:id/invoices/send', async ({ req, params }) => {
    const { me } = await member(req, params.id);
    return orchestrator.sendInvoices(params.id, me.uid);
  });

  routes.post('/api/rooms/:id/invoices/:iid/answer', async ({ req, params }) => {
    const { me } = await member(req, params.id);
    return orchestrator.answerInvoice(params.id, params.iid, me.uid, await readJson(req));
  });
}
