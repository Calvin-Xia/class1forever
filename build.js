const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, 'js', 'data.js');
const envVarName = 'STUDENTS_DATA';

if (process.env[envVarName]) {
    try {
        const studentsData = JSON.parse(process.env[envVarName]);
        const dataContent = `let students=\n${JSON.stringify(studentsData, null, 4)}\n`;
        fs.writeFileSync(dataPath, dataContent, 'utf8');
        console.log('✅ data.js 已从环境变量生成');
    } catch (error) {
        console.error('❌ 解析环境变量失败:', error.message);
        process.exit(1);
    }
} else {
    console.log('⚠️  环境变量 STUDENTS_DATA 未设置，检查本地 data.js 是否存在');
    if (!fs.existsSync(dataPath)) {
        console.error('❌ 本地 data.js 不存在，请设置环境变量或提供本地 data.js');
        process.exit(1);
    }
    console.log('✅ 使用本地 data.js');
}
