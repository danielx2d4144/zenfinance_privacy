import { execSync } from 'child_process';

const versionsToTest = [
  '0.84.0', '0.83.0', '0.82.0', '0.81.0', '0.80.0',
  '0.75.0', '0.70.0', '0.65.0', '0.60.0'
];

console.log('Testing bb.js versions for VK size (backend API)...\n');

for (const ver of versionsToTest) {
  try {
    console.log(`Installing @aztec/bb.js@${ver}...`);
    execSync(`npm install --no-save @aztec/bb.js@${ver}`, { 
      stdio: 'ignore',
      timeout: 60000 
    });
    
    const result = execSync(`node test-vk-backend-api.mjs "${ver}"`, { 
      encoding: 'utf-8',
      timeout: 30000
    });
    console.log(result);
    
    // If we found 1888 bytes, stop searching
    if (result.includes('1888 bytes')) {
      console.log('\n✅ FOUND COMPATIBLE VERSION!\n');
      break;
    }
  } catch (err) {
    console.log(`Version ${ver}: ERROR - ${err.message.split('\n')[0]}\n`);
  }
}
