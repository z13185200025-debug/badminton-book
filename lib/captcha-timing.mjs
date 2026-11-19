export function captchaReadyWaitMs(config={}) {
  const value=config.captchaReadyWaitMs??1000;
  if(!Number.isInteger(value)||value<0||value>1000)throw new Error('验证码准备等待须为 0–1000 毫秒的整数');
  return value;
}
