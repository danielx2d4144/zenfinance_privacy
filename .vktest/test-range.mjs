import { execSync } from 'child_process';

const versionsToTest = [
  '0.84.0', '0.83.0', '0.80.0', '0.70.0',
  '0.60.0', '0.50.0', '0.40.0', '0.30.0'
];

console.log('Testing bb.js versions for VK size...\n');

for (const ver of versionsToTest) {
  try {
    console.log(`Installing @aztec/bb.js@${ver}...`);
    execSync(`npm install --no-save @aztec/bb.js@${ver}`, { 
      stdio: 'ignore',
      timeout: 60000 
    });
    
    const result = execSync(`node test-vk-size.mjs "${ver}"`, { 
      encoding: 'utf-8',
      timeout: 30000
    });
    console.log(result);
  } catch (err) {
    console.log(`Version ${ver}: ERROR - ${err.message}\n`);
  }
}
