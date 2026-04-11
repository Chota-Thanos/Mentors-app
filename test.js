const fs = require('fs');
const path = require('path');
const p = path.resolve('supa_frontend/src/app/page.tsx');
let content = fs.readFileSync(p, 'utf8');

const returnRegex = /  return \([\s\S]*?(?=function MinimalCreatorHome)/;
const match = content.match(returnRegex);
if(match) {
  let r = match[0];
  
  // Cut pieces from r
  const splitContent = r.split('<section');
  // We can re-assemble
  
  // Or I can just output it to check
  // console.log(match[0].length);
}
