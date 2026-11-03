// 비서끼리 처리 API. 판단과 상태 변경은 orchestrator가 하고, 여기서는 누가 요청했는지만 확인한다.
// 중재(Gemini)가 일어날 수 있는 요청은 사람마다 10분에 30회로 막는다.
import { readJson, HttpError } from '../http.mjs';

export function registerAgentRoutes(routes, { orchestrator, member, overLimit = () => false }) {
  const limited = (uid) => {
    if (overLimit(`uid:${uid}`)) throw new HttpError(429, '요청이 너무 많아요. 10분 뒤에 다시 시도해 주세요.');
  };

  routes.post('/api/rooms/:id/invoices/send', async ({ req, params }) => {
    const { me } = await member(req, params.id);
    limited(me.uid);
    return orchestrator.sendInvoices(params.id, me.uid);
  });

  routes.post('/api/rooms/:id/invoices/:iid/answer', async ({ req, params }) => {
    const { me } = await member(req, params.id);
    return orchestrator.answerInvoice(params.id, params.iid, me.uid, await readJson(req));
  });

  routes.post('/api/rooms/:id/disputes', async ({ req, params }) => {
    const { me } = await member(req, params.id);
    limited(me.uid);
    const { expenseId, claim } = await readJson(req);
    return orchestrator.raiseDispute(params.id, { by: me.uid, expenseId, claim, evidence: [] });
  });

  routes.post('/api/rooms/:id/disputes/:did/mediate', async ({ req, params }) => {
    const { me } = await member(req, params.id);
    limited(me.uid);
    return orchestrator.mediate(params.id, params.did, me.uid);
  });

  routes.post('/api/rooms/:id/disputes/:did/agree', async ({ req, params }) => {
    const { me } = await member(req, params.id);
    return orchestrator.agree(params.id, params.did, me.uid);
  });

  // 중재안 거부: 이의가 끝나고 지금 배분 그대로 정산이 이어진다. { reason? }는 한 줄 사유
  routes.post('/api/rooms/:id/disputes/:did/reject', async ({ req, params }) => {
    const { me } = await member(req, params.id);
    return orchestrator.reject(params.id, params.did, me.uid, await readJson(req));
  });

  // 받을 계좌(#8이 설정 화면을 만든다). 계좌번호는 송금 당사자에게만 내려간다(GET room의 redactTransfer)
  routes.post('/api/rooms/:id/payout', async ({ req, params }) => {
    const { me } = await member(req, params.id);
    return orchestrator.setPayout(params.id, me.uid, await readJson(req));
  });

  // qr: 데스크톱 송금 화면을 열 때 휴대폰으로 넘길 QR 토큰을 새로 받는다(보내는 사람만)
  // not-received: 받는 사람이 "아직 안 들어왔어요"(sent일 때만). 상태는 sent로 두고 표시만 붙여 보내는 사람에게 다시 묻는다
  const step = { approve: 'approveTransfer', qr: 'qrFor', sent: 'markSent', confirm: 'confirmReceipt', 'not-received': 'reportNotReceived' };
  for (const [path, fn] of Object.entries(step)) {
    routes.post(`/api/rooms/:id/transfers/:tid/${path}`, async ({ req, params }) => {
      const { me } = await member(req, params.id);
      return orchestrator[fn](params.id, params.tid, me.uid);
    });
  }
}
