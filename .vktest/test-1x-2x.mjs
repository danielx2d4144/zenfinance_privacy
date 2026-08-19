import { execSync } from 'child_process';

const versionsToTest = [
  '2.1.0-rc.16', '2.1.0-rc.10', '2.1.0-rc.5', '2.1.0-rc.1',
  '1.2.1', '1.2.0', '1.1.3', '1.1.2', '1.1.0'
];

console.log('Testing 1.x and 2.x versions for 1888-byte UltraHonk VKs...\n');

for (const ver of versionsToTest) {
  try {
    process.stdout.write(`Testing ${ver}... `);
    execSync(`npm install --no-save @aztec/bb.js@${ver}`, { 
      stdio: 'ignore',
      timeout: 60000 
    });
    
    const result = execSync(`node test-vk-backend-api.mjs "${ver}"`, { 
      encoding: 'utf-8',
      timeout: 30000
    });
    
    const match = result.match(/VK size: (\d+) bytes/);
    if (match) {
      const size = parseInt(match[1]);
      console.log(`${size} bytes${size === 1888 ? ' ✅ MATCH!' : ''}`);
      if (size === 1888) {
        console.log('\n🎯 Found compatible version: ' + ver);
        console.log('Full output:\n' + result);
        break;
      }
    } else {
      console.log('ERROR - ' + result.split('\n')[0]);
    }
  } catch (err) {
    const errMsg = err.message.split('\n')[0];
    console.log('FAIL - ' + (errMsg.length > 80 ? errMsg.substring(0, 80) + '...' : errMsg));
  }
}
