import { execSync } from 'child_process';

// Test 0.87.x down to 0.80.x
const versionsToTest = [
  '0.87.9', '0.87.0',
  '0.86.0', '0.85.0', '0.84.0', '0.83.0', '0.82.0', '0.81.0', '0.80.0'
];

console.log('Testing 0.x versions for 1888-byte UltraHonk VKs...\n');

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
    
    // Extract just the VK size line
    const match = result.match(/VK size: (\d+) bytes/);
    if (match) {
      const size = parseInt(match[1]);
      console.log(`${size} bytes${size === 1888 ? ' ✅ MATCH!' : ''}`);
      if (size === 1888) {
        console.log('\n🎯 Found compatible version: ' + ver);
        break;
      }
    } else {
      console.log('ERROR - ' + result.split('\n')[0]);
    }
  } catch (err) {
    console.log('FAIL - ' + err.message.split('\n')[0]);
  }
}
