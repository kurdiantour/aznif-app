const fs = require('fs');
const path = require('path');

function search(dir, pattern) {
    let results = [];
    const files = fs.readdirSync(dir);
    for (const file of files) {
        if (file === 'node_modules' || file === '.git' || file === '.expo' || file === 'scratch') continue;
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            results = results.concat(search(filePath, pattern));
        } else if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js') || file.endsWith('.jsx')) {
            const content = fs.readFileSync(filePath, 'utf8');
            if (pattern.test(content)) {
                results.push(filePath);
            }
        }
    }
    return results;
}

const pattern = /react-native-purchases|RevenueCat|lib\/purchases/i;
const found = search(__dirname, pattern);
console.log(found.join('\n'));
