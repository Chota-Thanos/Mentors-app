const fs = require('fs');
const path = require('path');

const targetFiles = [
  path.resolve('supa_frontend/src/components/premium/TestSeriesConsole.tsx'),
  path.resolve('supa_frontend/src/components/premium/TestSeriesDetailView.tsx'),
  path.resolve('supa_frontend/src/components/home/PublicLandingPage.tsx')
];

for (const file of targetFiles) {
  if (!fs.existsSync(file)) continue;
  let content = fs.readFileSync(file, 'utf8');

  // Align purely to match Home page colors in generic files if present
  content = content
    .replace(/\btext-slate-900(?!\s*dark:text)/g, 'text-[#141b2d] dark:text-white')
    .replace(/\btext-slate-800(?!\s*dark:text)/g, 'text-[#1c263c] dark:text-gray-100')
    .replace(/\btext-slate-700(?!\s*dark:text)/g, 'text-[#334155] dark:text-gray-200')
    .replace(/\btext-slate-600(?!\s*dark:text)/g, 'text-[#636b86] dark:text-gray-300')
    .replace(/\btext-slate-500(?!\s*dark:text)/g, 'text-[#6c7590] dark:text-[#94a3b8]')
    .replace(/\bbg-slate-50\b(?!\/)(?!\s*dark:bg)/g, 'bg-[#f8faff] dark:bg-[#0f172a]')
    .replace(/\bbg-slate-100\b(?!\/)(?!\s*dark:bg)/g, 'bg-[#eef4ff] dark:bg-[#16213e]')
    .replace(/\bborder-slate-200\b(?!\/)(?!\s*dark:border)/g, 'border-[#dce3fb] dark:border-[#1e2a4a]')
    .replace(/\bborder-slate-300\b(?!\/)(?!\s*dark:border)/g, 'border-[#c9d6fb] dark:border-[#2a3c6b]');

  const replacements = [
    { target: /\bbg-white(?!\s*dark:bg(?:-|\w))/g, rep: 'bg-white dark:bg-[#0b1120]' },
    { target: /\btext-\[\#141b2d\](?!\s*dark:text-)/g, rep: 'text-[#141b2d] dark:text-white' },
    { target: /\btext-\[\#1235ae\](?!\s*dark:text-)/g, rep: 'text-[#1235ae] dark:text-[#a5bdf8]' },
    { target: /\btext-\[\#636b86\](?!\s*dark:text-)/g, rep: 'text-[#636b86] dark:text-[#94a3b8]' },
    { target: /\btext-\[\#6c7590\](?!\s*dark:text-)/g, rep: 'text-[#6c7590] dark:text-[#94a3b8]' },
    { target: /\btext-\[\#173aa9\](?!\s*dark:text-)/g, rep: 'text-[#173aa9] dark:text-[#8ea9ff]' },
    { target: /\bborder-\[\#dce3fb\](?!\s*dark:border-)/g, rep: 'border-[#dce3fb] dark:border-[#1e2a4a]' },
    { target: /\bbg-\[\#f8faff\](?!\s*dark:bg-)/g, rep: 'bg-[#f8faff] dark:bg-[#0f172a]' },
    { target: /\bbg-\[\#eef4ff\](?!\s*dark:bg-)/g, rep: 'bg-[#eef4ff] dark:bg-[#16213e]' },
    { target: /\bborder-\[\#cdd8f4\](?!\s*dark:border-)/g, rep: 'border-[#cdd8f4] dark:border-[#2a3c6b]' },
    { target: /\btext-\[\#17328f\](?!\s*dark:text-)/g, rep: 'text-[#17328f] dark:text-[#9bb5ff]' },
    { target: /\bborder-\[\#c9d6fb\](?!\s*dark:border-)/g, rep: 'border-[#c9d6fb] dark:border-[#2a3c6b]' }
  ];

  for (const { target, rep } of replacements) {
    content = content.replace(target, rep);
  }

  // Handle generic linear-gradients safely adding dark mode
  content = content.replace(/bg-\[linear-gradient\([^\]]+\)\](?!\s*dark:bg-)/g, (match) => {
     return match + ' dark:bg-slate-900';
  });

  fs.writeFileSync(file, content, 'utf8');
  console.log("Processed " + file);
}
