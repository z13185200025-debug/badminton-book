import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePaymentText} from '../lib/payment.mjs';
const target={date:'2026-11-07',accountName:'测试用户',court:'No.1',slot:'12:00-13:00'};
const text='Welcome! 测试用户\n北航国新院运动健身场馆羽毛球馆 2026年11月07日\nNo.1：12:00-13:00\nPlease pay：\n¥\n0\nCNY\nPay （597s）';
test('payment validation binds the zero price to the exact account and session',()=>{
  assert.equal(validatePaymentText(text,target).amount,0);
  for(const changed of [text.replace('\n0\n','\n5\n'),text.replace('No.1','No.2'),text.replace('11月07','11月08'),text.replace('测试用户','别人'),text+'\nNo.2：12:00-13:00',text.replace('Please pay','Refund')]) assert.throws(()=>validatePaymentText(changed,target));
});
