import { execSync } from 'child_process';
import { rmSync } from 'fs';

// Clean caches
try { rmSync('/home/team/shared/site/dist', { recursive: true, force: true }); } catch {}
try { rmSync('/home/team/shared/site/.vinxi', { recursive: true, force: true }); } catch {}

// Run publish
const result = execSync('bash /home/team/shared/site/publish.sh', {
  cwd: '/home/team/shared/site',
  stdio: 'inherit',
  timeout: 120000
});

console.log('Publish complete');
