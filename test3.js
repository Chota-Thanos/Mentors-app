const fs = require('fs');
const path = require('path');
const file = path.resolve('supa_frontend/src/app/page.tsx');
let content = fs.readFileSync(file, 'utf8');

content = content.replace("    </div>\n  );\n  );\n}", "    </div>\n  );\n}");

fs.writeFileSync(file, content, 'utf8');
console.log("Fixed syntax error");
