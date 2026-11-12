export const catalogRefreshIntervalMs=15000;
export const rateLimitNotice=value=>/访问频繁|请求(?:过于)?频繁|操作过于频繁|限制访问中|访问次数.{0,12}(?:超限|限制)|too many requests|rate[ -]?limit/i.test(String(value||''));
export function assertNotRateLimited(body,httpStatus=200) {
  const message=typeof body==='string'?body:[body?.message,body?.messageEn,body?.msg,body?.data?.message].filter(Boolean).join(' ');
  if(httpStatus===429||Number(body?.code)===429||rateLimitNotice(message))throw Object.assign(new Error('学校限制访问，已停止本次请求。请等待限制解除后再手动启动；若已提交过订单，请先核对订单结果。'),{code:'RATE_LIMITED'});
}
