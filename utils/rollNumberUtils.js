const User = require('../models/User');

async function generateRollNumber(department, year) {
    const deptCodes = {
        'computer science': 'CS',
        'electronics': 'EC',
        'electronics & communication': 'EC',
        'electrical & electronics': 'EE',
        'mechanical engineering': 'ME',
        'mechanical': 'ME',
        'civil engineering': 'CV',
        'civil': 'CV',
        'automobile engineering': 'AE',
        'aerospace engineering': 'AS',
        'biotechnology': 'BT',
        'chemical engineering': 'CH',
        'data science': 'DS',
        'artificial intelligence': 'AI',
        'ai&datascience': 'ADS',
        'ai & ds': 'ADS',
        'ai&machinelearning': 'AML',
        'ai & ml': 'AML',
        'information technology': 'IT'
    };

    const searchDept = (department || '').toLowerCase().trim();
    const deptCode = (deptCodes[searchDept])
        ? deptCodes[searchDept]
        : (searchDept)
            ? searchDept.split(' ').map(word => word[0]).join('').toUpperCase().slice(0, 3)
            : 'XX';
    
    const prefix = `${year}${deptCode}`;
    console.log(`Generating roll number for prefix: ${prefix} (Dept: ${department}, Year: ${year})`);

    const lastUser = await User.findOne({ rollNumber: new RegExp(`^${prefix}`) })
        .sort({ rollNumber: -1 });

    let nextIndex = 101;
    if (lastUser && lastUser.rollNumber) {
        const match = lastUser.rollNumber.match(/\d+$/);
        if (match) {
            nextIndex = parseInt(match[0]) + 1;
        }
    }

    const finalRoll = `${prefix}${nextIndex}`;
    console.log(`Generated Roll Number: ${finalRoll}`);
    return finalRoll;
}

module.exports = { generateRollNumber };
