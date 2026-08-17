const fs = require('fs');
const paths = ['html/owner/enrollement.html','html/owner/payment.html'];
const voidTags = new Set(['br','hr','img','input','meta','link','area','base','col','command','embed','keygen','param','source','track','wbr']);
const regex = /<\/?([a-zA-Z0-9:_-]+)([^>]*)>/g;
for (const path of paths) {
  const text = fs.readFileSync(path, 'utf8');
  const stack = [];
  let m;
  console.log('\n===', path, '===');
  while ((m = regex.exec(text)) !== null) {
    const tag = m[1].toLowerCase();
    const full = m[0];
    if (full.startsWith('</')) {
      if (!stack.length) {
        console.log('extra close', tag, 'at', m.index);
        break;
      }
      const last = stack.pop();
      if (last !== tag) {
        console.log('mismatch', last, 'closed by', tag, 'at', m.index);
        const snippet = text.slice(Math.max(0, m.index-150), m.index+150);
        console.log('snippet:', JSON.stringify(snippet));
        break;
      }
    } else if (!voidTags.has(tag) && !full.endsWith('/>')) {
      stack.push(tag);
    }
  }
  console.log('remaining stack', stack.slice(-10));
}
