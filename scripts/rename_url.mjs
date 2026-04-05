import fs from 'fs';
import path from 'path';

const searchTerms = [
  { from: /test-series/g, to: 'programs' },
  { from: /test_series_manage/g, to: 'programs_manage' }, // In case there are some route names
  // Let's add Test Series -> Programs for text
  { from: /Test Series/g, to: 'Programs' },
  { from: /test series/gi, to: 'programs' } // ignore case for plain text
];

const ignoreDirs = ['node_modules', '.git', '.next', 'dist', 'build', '.venv', '__pycache__'];

function walkAndReplace(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    if (ignoreDirs.includes(file)) continue;
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      walkAndReplace(fullPath);
    } else {
      if (!fullPath.match(/\.(ts|tsx|js|jsx|py|html|md|json)$/)) continue;
      
      let content = fs.readFileSync(fullPath, 'utf8');
      let newContent = content;
      
      // Specifically do not replace the table name `test_series` which uses underscore, 
      // but replace test-series.
      newContent = newContent.replace(/test-series/g, 'programs');
      // For UI texts:
      newContent = newContent.replace(/Test Series/g, 'Programs');
      newContent = newContent.replace(/test series/g, 'programs');
      newContent = newContent.replace(/Test series/g, 'Programs');

      if (content !== newContent) {
        fs.writeFileSync(fullPath, newContent);
        console.log(`Updated ${fullPath}`);
      }
    }
  }
}

walkAndReplace('e:/Mentors-app/supa_frontend');
walkAndReplace('e:/Mentors-app/supa_back');
walkAndReplace('e:/Mentors-app/supa_mobile');
