const { execSync } = require('child_process');
const fs = require('fs');

console.log('Starting Vercel deployment prep...');

// Check if vercel CLI is installed
try {
  execSync('vercel --version');
} catch (e) {
  console.log('Vercel CLI not found. Please install it: npm install -g vercel');
}

console.log('To deploy the server to Vercel:');
console.log('1. Install Vercel CLI: npm install -g vercel');
console.log('2. Run: vercel');
console.log('3. Set the following environment variables in Vercel dashboard:');
console.log('   - DATABASE_URL: your postgres connection string');
console.log('   - NODE_ENV: production');
